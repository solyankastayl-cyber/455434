/**
 * SPX TERMINAL — Candles Query Service
 * 
 * BLOCK B1 — Query candles from MongoDB
 */

import { SpxCandleModel } from './spx.mongo.js';
import type { SpxCandleQuery, SpxCohort } from './spx.types.js';

function toTs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * Query SPX candles from database
 */
export async function querySpxCandles(q: SpxCandleQuery) {
  const limit = Math.max(1, Math.min(q.limit ?? 2000, 20000));

  const filter: any = { symbol: 'SPX' };
  // Accept both STOOQ and MANUAL sources
  if (q.source === 'stooq') {
    filter.$or = [{ source: 'STOOQ' }, { source: 'MANUAL' }];
  }

  if (q.from) filter.ts = { ...(filter.ts || {}), $gte: toTs(q.from) };
  if (q.to) filter.ts = { ...(filter.ts || {}), $lte: toTs(q.to) };
  if (q.cohort) filter.cohort = q.cohort;

  const rows = await SpxCandleModel.find(filter)
    .sort({ ts: 1 })
    .limit(limit)
    .lean();

  return rows;
}

/**
 * Get latest SPX candle
 */
export async function getLatestSpxCandle() {
  return await SpxCandleModel.findOne({}).sort({ ts: -1 }).lean();
}

/**
 * Get candles by cohort
 */
export async function getSpxCandlesByCohort(cohort: SpxCohort, limit = 5000) {
  return await SpxCandleModel.find({ cohort })
    .sort({ ts: 1 })
    .limit(limit)
    .lean();
}
