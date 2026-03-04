/**
 * SPX CORE — Candles Service
 * 
 * BLOCK B5.2.1 — SPX Candle Adapter for Fractal Engine
 * 
 * ISOLATION: Does NOT import from /modules/btc/ or /modules/fractal/
 */

import { SpxCandleModel } from '../spx/spx.mongo.js';

export interface SpxCandle {
  t: number;  // timestamp ms
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
  v?: number; // volume
  date: string;
  cohort: string;
}

export class SpxCandlesService {
  /**
   * Get last N trading days of SPX candles
   */
  async getLastNDays(n: number): Promise<SpxCandle[]> {
    const rows = await SpxCandleModel.find({})
      .sort({ ts: -1 })
      .limit(n)
      .lean();

    return rows
      .reverse()
      .map(r => ({
        t: r.ts,
        o: r.open,
        h: r.high,
        l: r.low,
        c: r.close,
        v: r.volume ?? 0,
        date: r.date,
        cohort: r.cohort,
      }));
  }

  /**
   * Get all SPX candles (for scanning)
   */
  async getAllCandles(): Promise<SpxCandle[]> {
    const rows = await SpxCandleModel.find({})
      .sort({ ts: 1 })
      .lean();

    return rows.map(r => ({
      t: r.ts,
      o: r.open,
      h: r.high,
      l: r.low,
      c: r.close,
      v: r.volume ?? 0,
      date: r.date,
      cohort: r.cohort,
    }));
  }

  /**
   * Get candles in date range
   */
  async getCandlesInRange(startTs: number, endTs: number): Promise<SpxCandle[]> {
    const rows = await SpxCandleModel.find({
      ts: { $gte: startTs, $lte: endTs }
    })
    .sort({ ts: 1 })
    .lean();

    return rows.map(r => ({
      t: r.ts,
      o: r.open,
      h: r.high,
      l: r.low,
      c: r.close,
      v: r.volume ?? 0,
      date: r.date,
      cohort: r.cohort,
    }));
  }

  /**
   * Get candles after a timestamp
   */
  async getCandlesAfter(ts: number, limit: number): Promise<SpxCandle[]> {
    const rows = await SpxCandleModel.find({ ts: { $gt: ts } })
      .sort({ ts: 1 })
      .limit(limit)
      .lean();

    return rows.map(r => ({
      t: r.ts,
      o: r.open,
      h: r.high,
      l: r.low,
      c: r.close,
      v: r.volume ?? 0,
      date: r.date,
      cohort: r.cohort,
    }));
  }

  /**
   * Get latest candle
   */
  async getLatest(): Promise<SpxCandle | null> {
    const row = await SpxCandleModel.findOne({}).sort({ ts: -1 }).lean();
    if (!row) return null;

    return {
      t: row.ts,
      o: row.open,
      h: row.high,
      l: row.low,
      c: row.close,
      v: row.volume ?? 0,
      date: row.date,
      cohort: row.cohort,
    };
  }

  /**
   * Get total candle count
   */
  async getCount(): Promise<number> {
    return await SpxCandleModel.countDocuments({});
  }
}

// Singleton instance
export const spxCandlesService = new SpxCandlesService();
