/**
 * BLOCK 2.7 — Pattern Clusterer Service
 * =======================================
 * Builds pattern clusters from learning samples.
 */

import type { Db, Collection } from 'mongodb';
import type { Horizon } from '../db/types.js';
import type { Window, AltPatternCluster, AltSymbolClusterAssignment } from '../db/pattern.cluster.types.js';
import { cosine, addVec, scaleVec } from './vector.math.js';

function windowMs(w: Window): number {
  return w === '24h' ? 24 * 3600_000 : 7 * 24 * 3600_000;
}

interface ClusterBuild {
  id: string;
  n: number;
  sum: Record<string, number>;
  prototype: Record<string, number>;
  members: Array<{ symbol: string; sim: number; label: string; retPct: number }>;
}

export class AltPatternClustererService {
  private clusterCol: Collection<AltPatternCluster> | null = null;
  private assignmentCol: Collection<AltSymbolClusterAssignment> | null = null;
  private sampleCol: Collection<any> | null = null;
  private outcomeCol: Collection<any> | null = null;

  init(db: Db) {
    this.clusterCol = db.collection<AltPatternCluster>('alt_pattern_clusters');
    this.assignmentCol = db.collection<AltSymbolClusterAssignment>('alt_symbol_cluster_assignments');
    this.sampleCol = db.collection('alt_learning_samples');
    this.outcomeCol = db.collection('alt_candidate_outcomes');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (!this.clusterCol || !this.assignmentCol) return;
    try {
      await this.clusterCol.createIndex({ asOf: -1, horizon: 1, window: 1 });
      await this.clusterCol.createIndex({ horizon: 1, window: 1, clusterId: 1, asOf: -1 });
      await this.assignmentCol.createIndex({ horizon: 1, window: 1, symbol: 1 });
    } catch (e) {
      console.warn('[PatternClusterer] Index error:', e);
    }
  }

  /**
   * Recompute clusters for given horizon/window
   */
  async recompute(params: {
    horizon: Horizon;
    window: Window;
    simThreshold?: number;
    maxSamples?: number;
  }): Promise<{ ok: boolean; asOf: Date; clusters: number; samplesUsed: number }> {
    const { horizon, window, simThreshold = 0.92, maxSamples = 5000 } = params;

    if (!this.sampleCol || !this.outcomeCol || !this.clusterCol || !this.assignmentCol) {
      return { ok: false, asOf: new Date(), clusters: 0, samplesUsed: 0 };
    }

    const asOf = new Date();
    const from = new Date(Date.now() - windowMs(window));

    // Get samples with outcomes joined
    const rows = await this.sampleCol.aggregate([
      { $match: { horizon, ts0: { $gte: from } } },
      { $sort: { ts0: -1 } },
      { $limit: maxSamples },
      {
        $lookup: {
          from: 'alt_candidate_outcomes',
          localField: 'meta.predictionId',
          foreignField: 'predictionId',
          as: 'out'
        }
      },
      { $unwind: { path: '$out', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          symbol: 1,
          x: 1,
          label: '$out.label',
          retPct: '$out.retPct',
          snapshotId: '$meta.snapshotId',
          predictionId: '$meta.predictionId',
          fundingZ: '$meta.fundingZ'
        }
      }
    ]).toArray();

    // Online clustering
    const clusters: ClusterBuild[] = [];
    let counter = 0;

    for (const r of rows) {
      if (!r.x) continue;
      const label = r.label ?? 'NO_DATA';
      const retPct = Number(r.retPct ?? 0);

      // Find best matching cluster
      let bestIdx = -1;
      let bestSim = -1;

      for (let i = 0; i < clusters.length; i++) {
        const sim = cosine(r.x, clusters[i].prototype);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = i;
        }
      }

      if (bestIdx === -1 || bestSim < simThreshold) {
        // Create new cluster
        const id = `C${++counter}`;
        clusters.push({
          id,
          n: 1,
          sum: { ...r.x },
          prototype: { ...r.x },
          members: [{ symbol: r.symbol, sim: 1, label, retPct }],
        });
      } else {
        // Add to existing cluster
        const c = clusters[bestIdx];
        c.n += 1;
        c.sum = addVec(c.sum, r.x);
        c.prototype = scaleVec(c.sum, 1 / c.n);
        c.members.push({ symbol: r.symbol, sim: bestSim, label, retPct });
      }
    }

    // Persist clusters
    await this.persist({ asOf, horizon, window, clusters });

    console.log(`[PatternClusterer] ${horizon}/${window}: ${clusters.length} clusters from ${rows.length} samples`);
    return { ok: true, asOf, clusters: clusters.length, samplesUsed: rows.length };
  }

  /**
   * Persist clusters and assignments
   */
  private async persist(input: {
    asOf: Date;
    horizon: Horizon;
    window: Window;
    clusters: ClusterBuild[];
  }): Promise<void> {
    const { asOf, horizon, window, clusters } = input;
    const now = new Date();

    if (!this.clusterCol || !this.assignmentCol) return;

    // Clear old data for this horizon/window
    await this.clusterCol.deleteMany({ horizon, window });
    await this.assignmentCol.deleteMany({ horizon, window });

    // Build cluster documents
    const clusterDocs: AltPatternCluster[] = clusters.map((c) => {
      const size = c.members.length;
      const avgRet = size ? c.members.reduce((s, m) => s + (m.retPct || 0), 0) / size : 0;

      const wins = c.members.filter(m => m.label === 'TRUE_POSITIVE').length;
      const losses = c.members.filter(m => m.label === 'FALSE_POSITIVE').length;
      const weaks = c.members.filter(m => m.label === 'WEAK').length;

      const winRate = size ? wins / size : 0;
      const lossRate = size ? losses / size : 0;
      const weakRate = size ? weaks / size : 0;

      // Top features by absolute weight
      const topFeatures = Object.entries(c.prototype)
        .map(([k, v]) => ({ k, w: Math.abs(Number(v ?? 0)) }))
        .sort((a, b) => b.w - a.w)
        .slice(0, 10);

      const symbols = c.members
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 50)
        .map(m => ({ symbol: m.symbol, score: m.sim }));

      return {
        asOf,
        horizon,
        window,
        clusterId: c.id,
        size,
        prototype: c.prototype,
        topFeatures,
        avgRetPct: avgRet,
        winRate,
        lossRate,
        weakRate,
        symbols,
        createdAt: now,
      };
    });

    if (clusterDocs.length) {
      await this.clusterCol.insertMany(clusterDocs, { ordered: false });
    }

    // Build assignment documents
    const assignmentDocs: AltSymbolClusterAssignment[] = [];
    for (const c of clusters) {
      for (const m of c.members) {
        assignmentDocs.push({
          asOf,
          horizon,
          window,
          symbol: m.symbol,
          clusterId: c.id,
          similarity: m.sim,
          createdAt: now,
        });
      }
    }

    if (assignmentDocs.length) {
      await this.assignmentCol.insertMany(assignmentDocs, { ordered: false });
    }
  }

  /**
   * Get clusters sorted by win rate
   */
  async getClusters(horizon: Horizon, window: Window, limit = 100): Promise<AltPatternCluster[]> {
    if (!this.clusterCol) return [];
    return this.clusterCol
      .find({ horizon, window }, { projection: { _id: 0 } })
      .sort({ winRate: -1, avgRetPct: -1, size: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get single cluster by ID
   */
  async getCluster(clusterId: string, horizon: Horizon, window: Window): Promise<AltPatternCluster | null> {
    if (!this.clusterCol) return null;
    return this.clusterCol.findOne(
      { clusterId, horizon, window },
      { projection: { _id: 0 } }
    );
  }

  /**
   * Get "next" candidates from winning clusters
   */
  async getNextCandidates(params: {
    horizon: Horizon;
    window: Window;
    minSim?: number;
    minWinRate?: number;
    limit?: number;
  }): Promise<Array<{
    symbol: string;
    clusterId: string;
    similarity: number;
    clusterWinRate: number;
    clusterAvgRet: number;
  }>> {
    const { horizon, window, minSim = 0.92, minWinRate = 0.45, limit = 20 } = params;

    if (!this.clusterCol || !this.outcomeCol) return [];

    // Get winning clusters
    const clusters = await this.clusterCol
      .find({ horizon, window, winRate: { $gte: minWinRate }, size: { $gte: 6 } })
      .sort({ winRate: -1, avgRetPct: -1 })
      .limit(20)
      .toArray();

    const picks: Array<{
      symbol: string;
      clusterId: string;
      similarity: number;
      clusterWinRate: number;
      clusterAvgRet: number;
    }> = [];

    for (const c of clusters) {
      for (const s of (c.symbols ?? [])) {
        if (s.score < minSim) continue;

        // Check if symbol already had recent TRUE_POSITIVE
        const last = await this.outcomeCol
          .find({ symbol: s.symbol, horizon })
          .sort({ ts0: -1 })
          .limit(1)
          .toArray();

        const lastLabel = last?.[0]?.label ?? null;
        if (lastLabel === 'TRUE_POSITIVE') continue;

        picks.push({
          symbol: s.symbol,
          clusterId: c.clusterId,
          similarity: s.score,
          clusterWinRate: c.winRate,
          clusterAvgRet: c.avgRetPct,
        });

        if (picks.length >= limit) break;
      }
      if (picks.length >= limit) break;
    }

    // Sort by similarity × winRate
    picks.sort((a, b) => (b.similarity * b.clusterWinRate) - (a.similarity * a.clusterWinRate));
    return picks.slice(0, limit);
  }
}

export const altPatternClustererService = new AltPatternClustererService();

console.log('[Alts] Pattern Clusterer Service loaded');
