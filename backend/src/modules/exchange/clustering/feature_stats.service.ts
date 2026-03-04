/**
 * BLOCK 2.12 — Feature Stats Service
 * ===================================
 * Computes means/stds per feature for normalization.
 */

import type { Db, Collection } from 'mongodb';
import { ObjectId } from 'mongodb';

export interface FeatureStatsDoc {
  _id?: ObjectId;
  tf: string;
  venue: string;
  marketType: string;
  means: Record<string, number>;
  stds: Record<string, number>;
  sampleCount: number;
  updatedAt: Date;
  createdAt: Date;
}

export class FeatureStatsService {
  private snapshotsCol: Collection | null = null;
  private statsCol: Collection<FeatureStatsDoc> | null = null;

  init(db: Db) {
    this.snapshotsCol = db.collection('exchange_symbol_snapshots');
    this.statsCol = db.collection<FeatureStatsDoc>('exchange_feature_stats');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (!this.statsCol) return;
    try {
      await this.statsCol.createIndex({ tf: 1, venue: 1, marketType: 1 }, { unique: true });
    } catch (e) {
      console.warn('[FeatureStats] Index error:', e);
    }
  }

  async recompute(opts: {
    tf: '5m' | '15m' | '1h';
    venue: string;
    marketType: 'spot' | 'perp';
    lookbackHours: number;
    minSamples: number;
    featureKeys: string[];
  }): Promise<{ ok: boolean; n: number; reason?: string }> {
    if (!this.snapshotsCol || !this.statsCol) {
      return { ok: false, n: 0, reason: 'NOT_INITIALIZED' };
    }

    const since = new Date(Date.now() - opts.lookbackHours * 3600_000);

    const cursor = this.snapshotsCol.find(
      { tf: opts.tf, venue: opts.venue, marketType: opts.marketType, ts: { $gte: since } },
      { projection: { features: 1 } }
    );

    let n = 0;
    const sum: Record<string, number> = {};
    const sum2: Record<string, number> = {};

    for await (const doc of cursor) {
      n++;
      const f = (doc as any).features || {};
      for (const k of opts.featureKeys) {
        const v = f[k];
        const x = typeof v === 'number' && isFinite(v) ? v : 0;
        sum[k] = (sum[k] ?? 0) + x;
        sum2[k] = (sum2[k] ?? 0) + x * x;
      }
    }

    if (n < opts.minSamples) {
      return { ok: false, n, reason: 'NOT_ENOUGH_SAMPLES' };
    }

    const means: Record<string, number> = {};
    const stds: Record<string, number> = {};

    for (const k of opts.featureKeys) {
      const m = (sum[k] ?? 0) / n;
      const variance = (sum2[k] ?? 0) / n - m * m;
      means[k] = m;
      stds[k] = Math.sqrt(Math.max(1e-9, variance));
    }

    const now = new Date();
    await this.statsCol.updateOne(
      { tf: opts.tf, venue: opts.venue, marketType: opts.marketType },
      {
        $set: { means, stds, updatedAt: now, sampleCount: n },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    return { ok: true, n };
  }

  async getPack(q: { tf: string; venue: string; marketType: string }): Promise<FeatureStatsDoc | null> {
    if (!this.statsCol) return null;
    return this.statsCol.findOne({ tf: q.tf, venue: q.venue, marketType: q.marketType });
  }
}

export const featureStatsService = new FeatureStatsService();

console.log('[Clustering] Feature Stats Service loaded');
