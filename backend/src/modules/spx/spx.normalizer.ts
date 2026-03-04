/**
 * SPX TERMINAL — Normalizer
 * 
 * BLOCK B4 — Converts Stooq rows to canonical SpxCandle format
 */

import type { SpxCandle } from './spx.types.js';
import type { StooqRow } from './spx.stooq.client.js';
import { pickSpxCohort } from './spx.cohorts.js';

/**
 * Convert YYYY-MM-DD to UTC midnight timestamp
 */
function dayStartUtcTs(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * Convert Stooq rows to canonical SpxCandle records
 */
export function toCanonicalSpxCandles(rows: StooqRow[]): SpxCandle[] {
  return rows.map((r) => ({
    ts: dayStartUtcTs(r.date),
    date: r.date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume ?? null,

    symbol: 'SPX' as const,
    source: 'STOOQ' as const,
    cohort: pickSpxCohort(r.date),
  }));
}

/**
 * Filter candles by date range
 */
export function filterByDateRange(
  candles: SpxCandle[],
  from?: string,
  to?: string
): SpxCandle[] {
  let result = candles;

  if (from) {
    const fromTs = dayStartUtcTs(from);
    result = result.filter(c => c.ts >= fromTs);
  }

  if (to) {
    const toTs = dayStartUtcTs(to);
    result = result.filter(c => c.ts <= toTs);
  }

  return result;
}
