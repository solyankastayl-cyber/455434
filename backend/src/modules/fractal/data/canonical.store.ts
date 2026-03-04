/**
 * Canonical OHLCV Store
 * Stores the resolved canonical candles (single source of truth)
 */

import { CanonicalOhlcvModel } from './schemas/fractal-canonical-ohlcv.schema.js';
import { CanonicalOhlcvDocument } from '../contracts/fractal.contracts.js';

export class CanonicalStore {
  /**
   * Upsert a single canonical candle
   */
  async upsert(candle: Omit<CanonicalOhlcvDocument, 'updatedAt'>): Promise<void> {
    await CanonicalOhlcvModel.updateOne(
      {
        'meta.symbol': candle.meta.symbol,
        'meta.timeframe': candle.meta.timeframe,
        ts: candle.ts
      },
      {
        $set: {
          ...candle,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
  }

  /**
   * Get the latest canonical timestamp
   */
  async getLatestTs(symbol: string, timeframe: string): Promise<Date | null> {
    const last = await CanonicalOhlcvModel
      .findOne({ 'meta.symbol': symbol, 'meta.timeframe': timeframe })
      .sort({ ts: -1 })
      .lean();

    return last?.ts || null;
  }

  /**
   * Get the earliest canonical timestamp
   */
  async getEarliestTs(symbol: string, timeframe: string): Promise<Date | null> {
    const first = await CanonicalOhlcvModel
      .findOne({ 'meta.symbol': symbol, 'meta.timeframe': timeframe })
      .sort({ ts: 1 })
      .lean();

    return first?.ts || null;
  }

  /**
   * Get canonical candles in a date range
   */
  async getRange(
    symbol: string,
    timeframe: string,
    from: Date,
    to: Date
  ): Promise<CanonicalOhlcvDocument[]> {
    return CanonicalOhlcvModel.find({
      'meta.symbol': symbol,
      'meta.timeframe': timeframe,
      ts: { $gte: from, $lte: to }
    }).sort({ ts: 1 }).lean();
  }

  /**
   * Get all canonical candles (sorted by time)
   */
  async getAll(symbol: string, timeframe: string): Promise<CanonicalOhlcvDocument[]> {
    return CanonicalOhlcvModel.find({
      'meta.symbol': symbol,
      'meta.timeframe': timeframe
    }).sort({ ts: 1 }).lean();
  }

  /**
   * Count canonical candles
   */
  async count(symbol: string, timeframe: string): Promise<number> {
    return CanonicalOhlcvModel.countDocuments({
      'meta.symbol': symbol,
      'meta.timeframe': timeframe
    });
  }

  /**
   * Get close prices as array (for engine)
   */
  async getClosePrices(
    symbol: string,
    timeframe: string
  ): Promise<Array<{ ts: Date; close: number }>> {
    const candles = await this.getAll(symbol, timeframe);
    return candles.map(c => ({ ts: c.ts, close: c.ohlcv.c }));
  }

  /**
   * Get series with quality scores (for ML features)
   */
  async getSeriesWithQuality(
    symbol: string,
    timeframe: string
  ): Promise<Array<{ ts: Date; close: number; quality: number }>> {
    const candles = await this.getAll(symbol, timeframe);
    return candles.map(c => ({
      ts: c.ts,
      close: c.ohlcv.c,
      quality: (c as any).quality?.qualityScore ?? 1.0
    }));
  }

  /**
   * Get last N candles in engine format (for BLOCK 58/59)
   */
  async getCandles(opts: {
    symbol: string;
    limit?: number;
  }): Promise<Array<{ ts: Date; open: number; high: number; low: number; close: number; volume: number }>> {
    const symbol = opts.symbol.replace('USD', '');
    const candles = await CanonicalOhlcvModel.find({
      'meta.symbol': symbol,
      'meta.timeframe': '1d'
    })
      .sort({ ts: -1 })
      .limit(opts.limit || 1200)
      .lean();

    return candles
      .reverse()
      .map(c => ({
        ts: c.ts,
        open: c.ohlcv.o,
        high: c.ohlcv.h,
        low: c.ohlcv.l,
        close: c.ohlcv.c,
        volume: c.ohlcv.v
      }));
  }
}
