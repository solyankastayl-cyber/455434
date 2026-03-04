/**
 * Raw OHLCV Store
 * Stores raw candles from multiple sources before canonical resolution
 */

import { RawOhlcvModel } from './schemas/fractal-raw-ohlcv.schema.js';
import { OhlcvCandle, RawOhlcvDocument } from '../contracts/fractal.contracts.js';

export class RawStore {
  /**
   * Upsert many candles from a specific source
   */
  async upsertMany(
    symbol: string,
    timeframe: string,
    source: string,
    candles: OhlcvCandle[]
  ): Promise<number> {
    if (candles.length === 0) return 0;

    const bulk = RawOhlcvModel.collection.initializeUnorderedBulkOp();

    for (const c of candles) {
      // Sanity check
      const sanityOk = 
        c.high >= Math.max(c.open, c.close) &&
        c.low <= Math.min(c.open, c.close) &&
        c.volume >= 0;

      bulk.find({
        'meta.symbol': symbol,
        'meta.timeframe': timeframe,
        'meta.source': source,
        ts: c.ts
      }).upsert().updateOne({
        $set: {
          meta: { symbol, timeframe, source },
          ts: c.ts,
          ohlcv: {
            o: c.open,
            h: c.high,
            l: c.low,
            c: c.close,
            v: c.volume
          },
          quality: { 
            sanity_ok: sanityOk, 
            flags: sanityOk ? [] : ['SANITY_FAIL'] 
          },
          ingestedAt: new Date()
        }
      });
    }

    const result = await bulk.execute();
    return result.upsertedCount + result.modifiedCount;
  }

  /**
   * Get all candidates for a specific timestamp
   */
  async getCandidates(
    symbol: string,
    timeframe: string,
    ts: Date
  ): Promise<RawOhlcvDocument[]> {
    return RawOhlcvModel.find({
      'meta.symbol': symbol,
      'meta.timeframe': timeframe,
      ts
    }).lean();
  }

  /**
   * Get date range of available raw data
   */
  async getDateRange(
    symbol: string,
    timeframe: string,
    source?: string
  ): Promise<{ min: Date | null; max: Date | null }> {
    const query: Record<string, unknown> = {
      'meta.symbol': symbol,
      'meta.timeframe': timeframe
    };
    if (source) query['meta.source'] = source;

    const [min, max] = await Promise.all([
      RawOhlcvModel.findOne(query).sort({ ts: 1 }).lean(),
      RawOhlcvModel.findOne(query).sort({ ts: -1 }).lean()
    ]);

    return {
      min: min?.ts || null,
      max: max?.ts || null
    };
  }

  /**
   * Count raw candles
   */
  async count(symbol: string, timeframe: string): Promise<number> {
    return RawOhlcvModel.countDocuments({
      'meta.symbol': symbol,
      'meta.timeframe': timeframe
    });
  }
}
