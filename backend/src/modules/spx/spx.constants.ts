/**
 * SPX TERMINAL — Constants
 * 
 * BLOCK B1 — SPX Data Foundation
 */

export const SPX = {
  symbol: 'SPX' as const,
  stooqSymbol: '^spx',
  tf: '1d' as const,
};

export const SPX_DATA_DIR = process.env.SPX_DATA_DIR || 'data';
export const SPX_STOOQ_CSV_URL =
  process.env.SPX_STOOQ_CSV_URL || 'https://stooq.com/q/d/l/?s=^spx&i=d';

// Cohort boundaries
export const SPX_COHORT_BOUNDARIES = {
  V1950: { start: 1950, end: 1989 },
  V1990: { start: 1990, end: 2007 },
  V2008: { start: 2008, end: 2019 },
  V2020: { start: 2020, end: 2025 },
  LIVE: { start: 2026, end: 9999 },
};
