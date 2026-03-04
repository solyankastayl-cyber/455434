/**
 * БЛОК 1.3 — Funding Store (MongoDB)
 * ===================================
 */

import type { Collection, Db } from 'mongodb';
import type { FundingContext } from './contracts/funding.context.js';

export class FundingStore {
  private col: Collection<FundingContext>;

  constructor(db: Db) {
    this.col = db.collection<FundingContext>('exchange_funding_context');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    try {
      await this.col.createIndex({ symbol: 1, ts: -1 });
      await this.col.createIndex({ ts: -1 });
      await this.col.createIndex({ label: 1, ts: -1 });
    } catch (e) {
      console.warn('[FundingStore] Index creation failed:', e);
    }
  }

  async upsertLatest(ctx: FundingContext) {
    await this.col.updateOne(
      { symbol: ctx.symbol, ts: ctx.ts },
      { $set: ctx },
      { upsert: true }
    );
  }

  async latest(symbol: string): Promise<FundingContext | null> {
    return this.col.find({ symbol }, { projection: { _id: 0 } }).sort({ ts: -1 }).limit(1).next();
  }

  async latestBulk(symbols: string[]): Promise<Map<string, FundingContext>> {
    const result = new Map<string, FundingContext>();
    
    const pipeline = [
      { $match: { symbol: { $in: symbols } } },
      { $sort: { ts: -1 } as any },
      { $group: { _id: '$symbol', doc: { $first: '$$ROOT' } } },
      { $project: { 'doc._id': 0 } },
    ];
    
    const cursor = this.col.aggregate(pipeline);
    for await (const item of cursor) {
      result.set(item._id, item.doc);
    }
    
    return result;
  }

  async timeline(symbol: string, limit = 200): Promise<FundingContext[]> {
    return this.col.find({ symbol }, { projection: { _id: 0 } }).sort({ ts: -1 }).limit(limit).toArray();
  }

  async getByLabel(label: string, limit = 50): Promise<FundingContext[]> {
    return this.col.find({ label }, { projection: { _id: 0 } }).sort({ ts: -1 }).limit(limit).toArray();
  }
}

console.log('[Funding] Store loaded');
