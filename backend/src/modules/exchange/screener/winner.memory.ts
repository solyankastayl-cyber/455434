/**
 * BLOCK 1.4.6 — Winner Pattern Memory
 * =====================================
 * Stores patterns that led to winning outcomes.
 */

import type { Collection, Db } from 'mongodb';

export interface WinnerPattern {
  symbol: string;
  ts: number;
  vector: number[];         // normalized feature vector
  returnPct: number;        // actual return achieved
  horizon: '1h' | '4h' | '24h';
  fundingLabel: string;     // funding context at time
  clusterLabel?: string;    // cluster label if available
}

export class WinnerMemory {
  private col: Collection<WinnerPattern> | null = null;
  private inMemory: WinnerPattern[] = [];

  constructor(db?: Db) {
    if (db) {
      this.col = db.collection<WinnerPattern>('screener_winner_patterns');
      void this.ensureIndexes();
    }
  }

  private async ensureIndexes() {
    if (!this.col) return;
    try {
      await this.col.createIndex({ ts: -1 });
      await this.col.createIndex({ returnPct: -1 });
      await this.col.createIndex({ horizon: 1, ts: -1 });
    } catch (e) {
      console.warn('[WinnerMemory] Index creation failed:', e);
    }
  }

  /**
   * Add a winner pattern
   */
  async add(pattern: WinnerPattern): Promise<void> {
    if (this.col) {
      await this.col.insertOne(pattern);
    } else {
      this.inMemory.push(pattern);
    }
  }

  /**
   * Add batch of patterns
   */
  async addBatch(patterns: WinnerPattern[]): Promise<void> {
    if (patterns.length === 0) return;
    
    if (this.col) {
      await this.col.insertMany(patterns);
    } else {
      this.inMemory.push(...patterns);
    }
  }

  /**
   * Get top N winners by return
   */
  async top(n = 50, horizon?: '1h' | '4h' | '24h'): Promise<WinnerPattern[]> {
    if (this.col) {
      const query = horizon ? { horizon } : {};
      return this.col
        .find(query)
        .sort({ returnPct: -1 })
        .limit(n)
        .toArray();
    }

    let filtered = this.inMemory;
    if (horizon) {
      filtered = filtered.filter(p => p.horizon === horizon);
    }

    return filtered
      .sort((a, b) => b.returnPct - a.returnPct)
      .slice(0, n);
  }

  /**
   * Get recent winners (last N days)
   */
  async recent(days = 7, horizon?: '1h' | '4h' | '24h'): Promise<WinnerPattern[]> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    if (this.col) {
      const query: any = { ts: { $gte: cutoff } };
      if (horizon) query.horizon = horizon;
      
      return this.col
        .find(query)
        .sort({ returnPct: -1 })
        .limit(100)
        .toArray();
    }

    let filtered = this.inMemory.filter(p => p.ts >= cutoff);
    if (horizon) {
      filtered = filtered.filter(p => p.horizon === horizon);
    }

    return filtered.sort((a, b) => b.returnPct - a.returnPct);
  }

  /**
   * Get winners by funding context
   */
  async byFundingContext(
    fundingLabel: string,
    limit = 30
  ): Promise<WinnerPattern[]> {
    if (this.col) {
      return this.col
        .find({ fundingLabel })
        .sort({ returnPct: -1 })
        .limit(limit)
        .toArray();
    }

    return this.inMemory
      .filter(p => p.fundingLabel === fundingLabel)
      .sort((a, b) => b.returnPct - a.returnPct)
      .slice(0, limit);
  }

  /**
   * Get statistics
   */
  async stats(): Promise<{
    total: number;
    avgReturn: number;
    topReturn: number;
    byHorizon: Record<string, number>;
  }> {
    let patterns: WinnerPattern[];

    if (this.col) {
      patterns = await this.col.find({}).toArray();
    } else {
      patterns = this.inMemory;
    }

    const total = patterns.length;
    const avgReturn = total > 0
      ? patterns.reduce((sum, p) => sum + p.returnPct, 0) / total
      : 0;
    const topReturn = total > 0
      ? Math.max(...patterns.map(p => p.returnPct))
      : 0;

    const byHorizon: Record<string, number> = {};
    for (const p of patterns) {
      byHorizon[p.horizon] = (byHorizon[p.horizon] ?? 0) + 1;
    }

    return { total, avgReturn, topReturn, byHorizon };
  }
}

console.log('[Screener] Winner Memory loaded');
