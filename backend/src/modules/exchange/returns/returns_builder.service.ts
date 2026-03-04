/**
 * BLOCK 2.13 — Returns Builder Service
 * =====================================
 * Computes price returns for symbols.
 */

import type { Db, Collection } from 'mongodb';

export interface SymbolReturnsDoc {
  _id?: any;
  symbolKey: string;
  tf: string;
  venue: string;
  marketType: string;
  ts: Date;
  ret_1h: number | null;
  ret_4h: number | null;
  ret_24h: number | null;
  volScore: number | null;
  oiScore: number | null;
  createdAt: Date;
}

export class ReturnsBuilderService {
  private snapshotsCol: Collection | null = null;
  private returnsCol: Collection<SymbolReturnsDoc> | null = null;

  init(db: Db) {
    this.snapshotsCol = db.collection('exchange_symbol_snapshots');
    this.returnsCol = db.collection('exchange_symbol_returns');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (!this.returnsCol) return;
    try {
      await this.returnsCol.createIndex({ tf: 1, venue: 1, marketType: 1, ts: -1 });
      await this.returnsCol.createIndex({ symbolKey: 1, ts: -1 });
    } catch (e) {
      console.warn('[ReturnsBuilder] Index error:', e);
    }
  }

  async buildForLatest(opts: {
    tf: '5m' | '15m' | '1h';
    venue: string;
    marketType: 'spot' | 'perp';
    horizons: Array<'1h' | '4h' | '24h'>;
    limit: number;
  }): Promise<{ ts: Date; n: number }> {
    if (!this.snapshotsCol || !this.returnsCol) {
      throw new Error('NOT_INITIALIZED');
    }

    // Get latest ts
    const latest = await this.snapshotsCol
      .find({ tf: opts.tf, venue: opts.venue, marketType: opts.marketType })
      .sort({ ts: -1 })
      .limit(1)
      .toArray();

    if (!latest.length) throw new Error('NO_SNAPSHOTS');
    const tsNow = latest[0].ts as Date;

    // Step size in minutes based on tf
    const stepMinMap: Record<string, number> = { '5m': 5, '15m': 15, '1h': 60 };
    const stepMin = stepMinMap[opts.tf];

    const horizonSteps = (h: '1h' | '4h' | '24h') => {
      const mins = h === '1h' ? 60 : h === '4h' ? 240 : 1440;
      return Math.round(mins / stepMin);
    };

    // Get current snapshots
    const docsNow = await this.snapshotsCol
      .find({ tf: opts.tf, venue: opts.venue, marketType: opts.marketType, ts: tsNow })
      .limit(opts.limit)
      .toArray();

    // Build past timestamps
    const targets: Record<string, Date> = {};
    for (const h of opts.horizons) {
      const steps = horizonSteps(h);
      targets[h] = new Date(tsNow.getTime() - steps * stepMin * 60_000);
    }

    // Pull past snaps
    const pastByH: Record<string, Map<string, number>> = {};
    for (const h of opts.horizons) {
      const t = targets[h];
      const pastDocs = await this.snapshotsCol
        .find({ tf: opts.tf, venue: opts.venue, marketType: opts.marketType, ts: t })
        .project({ symbolKey: 1, price: 1 })
        .toArray();
      pastByH[h] = new Map(pastDocs.map((d: any) => [d.symbolKey, d.price]));
    }

    const ops = [];
    for (const d of docsNow) {
      const doc = d as any;
      const pNow = doc.price;
      if (typeof pNow !== 'number' || pNow <= 0) continue;

      const rec: any = {
        tf: opts.tf,
        venue: opts.venue,
        marketType: opts.marketType,
        ts: tsNow,
        symbolKey: doc.symbolKey,
        createdAt: new Date(),
      };

      for (const h of opts.horizons) {
        const pThen = pastByH[h].get(doc.symbolKey);
        if (typeof pThen === 'number' && pThen > 0) {
          rec[`ret_${h}`] = (pNow - pThen) / pThen;
        } else {
          rec[`ret_${h}`] = null;
        }
      }

      // Optional liquidity hints from features
      const f = doc.features || {};
      rec.volScore = typeof f.volume_log === 'number' ? f.volume_log / 10 : null;
      rec.oiScore = typeof f.oi_usd === 'number' ? Math.min(1, f.oi_usd / 1e9) : null;

      ops.push({
        updateOne: {
          filter: { tf: opts.tf, venue: opts.venue, marketType: opts.marketType, ts: tsNow, symbolKey: doc.symbolKey },
          update: { $set: rec },
          upsert: true,
        },
      });
    }

    if (ops.length > 0) {
      await this.returnsCol.bulkWrite(ops, { ordered: false });
    }

    return { ts: tsNow, n: ops.length };
  }

  async getReturnsAtTs(opts: {
    tf: string;
    venue: string;
    marketType: string;
    ts: Date;
  }): Promise<Map<string, SymbolReturnsDoc>> {
    if (!this.returnsCol) return new Map();

    const docs = await this.returnsCol
      .find({ tf: opts.tf, venue: opts.venue, marketType: opts.marketType, ts: opts.ts })
      .toArray();

    return new Map(docs.map((d) => [d.symbolKey, d]));
  }
}

export const returnsBuilderService = new ReturnsBuilderService();

console.log('[Returns] Builder Service loaded');
