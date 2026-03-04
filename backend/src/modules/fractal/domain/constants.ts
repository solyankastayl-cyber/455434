/**
 * Fractal Module Constants - PRODUCTION
 */

export const FRACTAL_SYMBOL = 'BTC';
export const FRACTAL_TIMEFRAME = '1d';

// Kraken CSV has data from 2013-10-06 for XBTUSD
export const FRACTAL_START_DATE = new Date('2013-10-06T00:00:00Z');

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Number of days to reconcile when doing incremental updates
export const RECONCILE_TAIL_DAYS = 30;

// Window sizes for pattern matching (in days)
// Extended to support STRUCTURE tier horizons (180d, 365d)
export const WINDOW_SIZES = [30, 45, 60, 90, 120, 180] as const;
export type WindowSize = typeof WINDOW_SIZES[number];

// Forward horizon for outcome statistics (days)
export const FORWARD_HORIZON_DAYS = 30;

// Number of top matches to return
export const TOP_K_MATCHES = 25;

// Minimum gap between matched windows and current window (to avoid leakage)
export const MIN_GAP_DAYS = 60;

// Source priorities (production)
export const SOURCE_PRIORITY = ['kraken_csv', 'coinbase'] as const;
