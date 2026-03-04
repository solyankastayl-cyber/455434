/**
 * BLOCK 2.13 — Alt Movers Service
 * ================================
 * Finds lagging candidates in winning clusters.
 */

import type { Db, Collection } from 'mongodb';

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function normDist(d: number, dMax: number): number {
  if (!Number.isFinite(dMax) || dMax <= 0) return 0.5;
  return clamp01(d / dMax);
}

function liquidityFactor(volScore?: number | null, oiScore?: number | null): number {
  const v = typeof volScore === 'number' ? clamp01(volScore) : 0.5;
  const o = typeof oiScore === 'number' ? clamp01(oiScore) : 0.5;
  return 0.5 * v + 0.5 * o;
}

export interface AltMoverCandidate {
  symbolKey: string;
  base: string;
  clusterId: number;
  score: number;
  momentum: number;
  ret: number;
  distance: number;
  tags: Record<string, any>;
  reasons: string[];
}

export interface AltMoversResult {
  ts: Date;
  clusterRunId: string;
  horizon: string;
  winnersThreshold: number;
  lagThreshold: number;
  hotClusters: Array<{
    clusterId: number;
    size: number;
    winners: number;
    momentum: number;
  }>;
  candidates: AltMoverCandidate[];
}

export class AltMoversService {
  private membershipsCol: Collection | null = null;
  private clustersCol: Collection | null = null;
  private returnsCol: Collection | null = null;

  init(db: Db) {
    this.membershipsCol = db.collection('exchange_pattern_memberships');
    this.clustersCol = db.collection('exchange_pattern_clusters');
    this.returnsCol = db.collection('exchange_symbol_returns');
  }

  async build(opts: {
    venue: string;
    marketType: 'spot' | 'perp';
    tf: '5m' | '15m' | '1h';
    horizon: '1h' | '4h' | '24h';
    winnersThreshold: number;
    lagThreshold: number;
    minClusterSize: number;
    minMomentum: number;
    topKClusters: number;
    outLimit: number;
  }): Promise<AltMoversResult> {
    if (!this.membershipsCol || !this.clustersCol || !this.returnsCol) {
      throw new Error('NOT_INITIALIZED');
    }

    // Get latest cluster run
    const latestRun = await this.clustersCol
      .find({ venue: opts.venue, marketType: opts.marketType, tf: opts.tf })
      .sort({ ts: -1 })
      .limit(1)
      .toArray();

    if (!latestRun.length) {
      return {
        ts: new Date(),
        clusterRunId: '',
        horizon: opts.horizon,
        winnersThreshold: opts.winnersThreshold,
        lagThreshold: opts.lagThreshold,
        hotClusters: [],
        candidates: [],
      };
    }

    const run = latestRun[0] as any;
    const clusterRunId = run.clusterRunId;
    const ts = run.ts;

    // Get memberships
    const memberships = await this.membershipsCol
      .find({ clusterRunId })
      .project({ symbolKey: 1, clusterId: 1, distance: 1, tags: 1 })
      .toArray();

    // Get returns
    const returnsDocs = await this.returnsCol
      .find({ venue: opts.venue, marketType: opts.marketType, tf: opts.tf, ts })
      .project({ symbolKey: 1, [`ret_${opts.horizon}`]: 1, volScore: 1, oiScore: 1 })
      .toArray();

    const retMap = new Map<string, any>(returnsDocs.map((d: any) => [d.symbolKey, d]));
    const byCluster = new Map<number, any[]>();
    let maxDist = 0;

    for (const m of memberships) {
      const mem = m as any;
      maxDist = Math.max(maxDist, mem.distance ?? 0);
      const r = retMap.get(mem.symbolKey);
      const ret = r?.[`ret_${opts.horizon}`];
      const row = {
        symbolKey: mem.symbolKey,
        clusterId: mem.clusterId,
        distance: mem.distance ?? 1,
        tags: mem.tags ?? {},
        ret: typeof ret === 'number' ? ret : null,
        volScore: r?.volScore ?? null,
        oiScore: r?.oiScore ?? null,
      };
      if (!byCluster.has(mem.clusterId)) byCluster.set(mem.clusterId, []);
      byCluster.get(mem.clusterId)!.push(row);
    }

    // Compute cluster momentum
    const clusterStats: Array<{
      clusterId: number;
      size: number;
      winners: number;
      momentum: number;
    }> = [];

    for (const [cid, rows] of byCluster.entries()) {
      if (rows.length < opts.minClusterSize) continue;
      let winners = 0;
      let valid = 0;
      for (const r of rows) {
        if (typeof r.ret !== 'number') continue;
        valid++;
        if (r.ret >= opts.winnersThreshold) winners++;
      }
      const momentum = valid > 0 ? winners / valid : 0;
      clusterStats.push({ clusterId: cid, size: rows.length, winners, momentum });
    }

    clusterStats.sort((a, b) => b.momentum - a.momentum);
    const hotClusters = clusterStats
      .filter((c) => c.momentum >= opts.minMomentum)
      .slice(0, opts.topKClusters);

    // Pick lagging candidates
    const candidates: AltMoverCandidate[] = [];

    for (const hc of hotClusters) {
      const rows = byCluster.get(hc.clusterId) || [];
      for (const r of rows) {
        const ret = r.ret;
        if (typeof ret !== 'number') continue;

        // Skip if already moved
        if (ret >= opts.lagThreshold) continue;

        const distN = normDist(r.distance, maxDist);
        const closeness = 1 - distN;
        const lagFactor = clamp01((opts.lagThreshold - ret) / Math.max(1e-6, opts.lagThreshold));
        const liq = liquidityFactor(r.volScore, r.oiScore);

        const score =
          0.45 * hc.momentum +
          0.30 * closeness +
          0.15 * lagFactor +
          0.10 * liq;

        // Extract base from symbolKey
        const base = r.symbolKey.split(':')[0] || r.symbolKey;

        candidates.push({
          symbolKey: r.symbolKey,
          base,
          clusterId: hc.clusterId,
          score,
          momentum: hc.momentum,
          ret,
          distance: r.distance,
          tags: r.tags,
          reasons: [
            `clusterMomentum ${(hc.momentum * 100).toFixed(0)}%`,
            `lagging ${(ret * 100).toFixed(1)}% < ${(opts.lagThreshold * 100).toFixed(1)}%`,
            `centroidCloseness ${(closeness * 100).toFixed(0)}%`,
          ],
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    return {
      ts,
      clusterRunId,
      horizon: opts.horizon,
      winnersThreshold: opts.winnersThreshold,
      lagThreshold: opts.lagThreshold,
      hotClusters,
      candidates: candidates.slice(0, opts.outLimit),
    };
  }
}

export const altMoversService = new AltMoversService();

console.log('[AltMovers] Service loaded');
