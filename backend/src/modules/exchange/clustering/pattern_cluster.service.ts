/**
 * BLOCK 2.12 — Pattern Cluster Service
 * =====================================
 * Runs clustering on latest snapshots.
 */

import type { Db, Collection } from 'mongodb';
import crypto from 'crypto';
import { buildZVector } from './vector_builder.js';
import { kmeansCosine } from './kmeans.js';
import type { FeatureStatsDoc } from './feature_stats.service.js';

export interface PatternClusterDoc {
  _id?: any;
  clusterRunId: string;
  ts: Date;
  tf: string;
  venue: string;
  marketType: string;
  k: number;
  centroids: number[][];
  featureKeys: string[];
  createdAt: Date;
}

export interface PatternMembershipDoc {
  _id?: any;
  clusterRunId: string;
  symbolKey: string;
  clusterId: number;
  distance: number;
  ts: Date;
  vectorHash: string;
  tags: Record<string, any>;
  createdAt: Date;
}

// Default feature keys for clustering
export const DEFAULT_CLUSTER_FEATURES = [
  'ret_1h', 'ret_24h', 'funding_rate', 'funding_annualized',
  'oi_chg_1h', 'volume_log', 'momentum_score', 'squeeze_score',
  'crowdedness', 'score_up', 'score_down'
];

export class PatternClusterService {
  private snapshotsCol: Collection | null = null;
  private statsCol: Collection<FeatureStatsDoc> | null = null;
  private clustersCol: Collection<PatternClusterDoc> | null = null;
  private membershipsCol: Collection<PatternMembershipDoc> | null = null;

  init(db: Db) {
    this.snapshotsCol = db.collection('exchange_symbol_snapshots');
    this.statsCol = db.collection('exchange_feature_stats');
    this.clustersCol = db.collection('exchange_pattern_clusters');
    this.membershipsCol = db.collection('exchange_pattern_memberships');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (!this.clustersCol || !this.membershipsCol) return;
    try {
      await this.clustersCol.createIndex({ clusterRunId: 1 }, { unique: true });
      await this.clustersCol.createIndex({ ts: -1, venue: 1, marketType: 1, tf: 1 });
      await this.membershipsCol.createIndex({ clusterRunId: 1, symbolKey: 1 }, { unique: true });
      await this.membershipsCol.createIndex({ clusterRunId: 1, clusterId: 1 });
    } catch (e) {
      console.warn('[PatternCluster] Index error:', e);
    }
  }

  async run(opts: {
    tf: '5m' | '15m' | '1h';
    venue: string;
    marketType: 'spot' | 'perp';
    k: number;
    limit: number;
    minQuality: number;
    featureKeys?: string[];
  }): Promise<{ clusterRunId: string; ts: Date; n: number; k: number }> {
    if (!this.snapshotsCol || !this.statsCol || !this.clustersCol || !this.membershipsCol) {
      throw new Error('NOT_INITIALIZED');
    }

    const featureKeys = opts.featureKeys ?? DEFAULT_CLUSTER_FEATURES;

    // Get stats pack
    const pack = await this.statsCol.findOne({
      tf: opts.tf,
      venue: opts.venue,
      marketType: opts.marketType,
    });
    if (!pack) throw new Error('FEATURE_STATS_MISSING');

    // Get latest timestamp
    const latest = await this.snapshotsCol
      .find({ tf: opts.tf, venue: opts.venue, marketType: opts.marketType })
      .sort({ ts: -1 })
      .limit(1)
      .toArray();
    if (!latest.length) throw new Error('NO_SNAPSHOTS');

    const latestTs = latest[0].ts as Date;

    // Get snapshots at latest ts
    const docs = await this.snapshotsCol
      .find({
        tf: opts.tf,
        venue: opts.venue,
        marketType: opts.marketType,
        ts: latestTs,
        'dataQuality.qualityScore': { $gte: opts.minQuality },
      })
      .limit(opts.limit)
      .toArray();

    if (docs.length < opts.k * 3) {
      throw new Error(`NOT_ENOUGH_VECTORS: ${docs.length} < ${opts.k * 3}`);
    }

    // Build vectors
    const vectors: number[][] = [];
    const keys: string[] = [];
    const tagByKey: Record<string, any> = {};

    for (const d of docs) {
      const doc = d as any;
      keys.push(doc.symbolKey);
      tagByKey[doc.symbolKey] = doc.tags ?? {};
      vectors.push(
        buildZVector(doc.features || {}, {
          featureKeys,
          stats: { means: pack.means, stds: pack.stds },
          missingValue: 0,
          clipZ: 4,
        })
      );
    }

    // Run clustering
    const { centroids, assignments, distances } = kmeansCosine(vectors, opts.k, 18);

    // Generate cluster run ID
    const clusterRunId = crypto
      .createHash('sha1')
      .update(`${opts.tf}|${opts.venue}|${opts.marketType}|${latestTs.toISOString()}|k=${opts.k}`)
      .digest('hex');

    const now = new Date();

    // Save cluster document
    await this.clustersCol.updateOne(
      { clusterRunId },
      {
        $set: {
          clusterRunId,
          ts: latestTs,
          tf: opts.tf,
          venue: opts.venue,
          marketType: opts.marketType,
          k: opts.k,
          centroids,
          featureKeys,
          createdAt: now,
        },
      },
      { upsert: true }
    );

    // Save memberships
    const membershipOps = keys.map((symbolKey, i) => ({
      updateOne: {
        filter: { clusterRunId, symbolKey },
        update: {
          $set: {
            clusterRunId,
            symbolKey,
            clusterId: assignments[i],
            distance: distances[i],
            ts: latestTs,
            vectorHash: crypto.createHash('md5').update(vectors[i].join(',')).digest('hex'),
            tags: tagByKey[symbolKey],
            createdAt: now,
          },
        },
        upsert: true,
      },
    }));

    if (membershipOps.length > 0) {
      await this.membershipsCol.bulkWrite(membershipOps, { ordered: false });
    }

    console.log(`[PatternCluster] Run complete: ${clusterRunId}, n=${vectors.length}, k=${opts.k}`);
    return { clusterRunId, ts: latestTs, n: vectors.length, k: opts.k };
  }

  async getLatestRun(opts: { venue: string; marketType: string; tf: string }): Promise<PatternClusterDoc | null> {
    if (!this.clustersCol) return null;
    return this.clustersCol
      .findOne({ venue: opts.venue, marketType: opts.marketType, tf: opts.tf }, { sort: { ts: -1 } });
  }

  async getClusterMembers(clusterRunId: string, clusterId: number): Promise<PatternMembershipDoc[]> {
    if (!this.membershipsCol) return [];
    return this.membershipsCol
      .find({ clusterRunId, clusterId })
      .sort({ distance: 1 })
      .toArray();
  }

  async getClusterSummary(clusterRunId: string): Promise<Array<{
    clusterId: number;
    size: number;
    avgDistance: number;
    representatives: Array<{ symbolKey: string; distance: number }>;
  }>> {
    if (!this.membershipsCol) return [];

    const pipeline = [
      { $match: { clusterRunId } },
      {
        $group: {
          _id: '$clusterId',
          size: { $sum: 1 },
          avgDistance: { $avg: '$distance' },
          members: { $push: { symbolKey: '$symbolKey', distance: '$distance' } },
        },
      },
      { $sort: { size: -1 } },
    ];

    const results = await this.membershipsCol.aggregate(pipeline).toArray();

    return results.map((r: any) => ({
      clusterId: r._id,
      size: r.size,
      avgDistance: r.avgDistance,
      representatives: (r.members as any[])
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5)
        .map((m) => ({ symbolKey: m.symbolKey, distance: m.distance })),
    }));
  }
}

export const patternClusterService = new PatternClusterService();

console.log('[Clustering] Pattern Cluster Service loaded');
