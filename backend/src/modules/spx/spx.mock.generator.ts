/**
 * SPX TERMINAL — Mock Data Generator
 * 
 * Generates realistic SPX historical data for development/testing
 * when external APIs are rate-limited.
 * 
 * Based on actual S&P 500 historical patterns.
 */

import type { SpxCandle } from './spx.types.js';
import { pickSpxCohort } from './spx.cohorts.js';

// Historical SPX approximate values at key dates (for realistic generation)
const HISTORICAL_ANCHORS = [
  { date: '1950-01-03', close: 17 },
  { date: '1960-01-04', close: 59 },
  { date: '1970-01-02', close: 93 },
  { date: '1980-01-02', close: 108 },
  { date: '1990-01-02', close: 353 },
  { date: '2000-01-03', close: 1455 },
  { date: '2008-01-02', close: 1447 },
  { date: '2009-03-09', close: 677 },  // GFC bottom
  { date: '2010-01-04', close: 1133 },
  { date: '2015-01-02', close: 2058 },
  { date: '2020-01-02', close: 3258 },
  { date: '2020-03-23', close: 2237 },  // COVID bottom
  { date: '2021-01-04', close: 3700 },
  { date: '2022-01-03', close: 4796 },
  { date: '2023-01-03', close: 3824 },
  { date: '2024-01-02', close: 4743 },
  { date: '2025-01-02', close: 5881 },
  { date: '2025-12-31', close: 6200 },
];

function dateToTs(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0);
}

function tsToDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isWeekday(ts: number): boolean {
  const d = new Date(ts);
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6; // Not Sunday or Saturday
}

/**
 * Linear interpolation between two values
 */
function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

/**
 * Get interpolated price for a given date based on anchors
 */
function getInterpolatedPrice(ts: number): number {
  const sortedAnchors = HISTORICAL_ANCHORS.map(a => ({
    ts: dateToTs(a.date),
    close: a.close,
  })).sort((a, b) => a.ts - b.ts);

  // Before first anchor
  if (ts <= sortedAnchors[0].ts) {
    return sortedAnchors[0].close;
  }

  // After last anchor
  if (ts >= sortedAnchors[sortedAnchors.length - 1].ts) {
    return sortedAnchors[sortedAnchors.length - 1].close;
  }

  // Find bracketing anchors
  for (let i = 0; i < sortedAnchors.length - 1; i++) {
    const a1 = sortedAnchors[i];
    const a2 = sortedAnchors[i + 1];
    
    if (ts >= a1.ts && ts <= a2.ts) {
      const t = (ts - a1.ts) / (a2.ts - a1.ts);
      return lerp(a1.close, a2.close, t);
    }
  }

  return sortedAnchors[sortedAnchors.length - 1].close;
}

/**
 * Generate realistic daily volatility
 */
function getDailyVolatility(ts: number): number {
  const y = new Date(ts).getUTCFullYear();
  
  // Historical volatility regimes (approximate annualized vol)
  if (y >= 2020 && y <= 2020) return 0.35; // COVID crisis
  if (y >= 2008 && y <= 2009) return 0.40; // GFC crisis
  if (y >= 2000 && y <= 2002) return 0.25; // Dot-com bust
  if (y >= 1987 && y <= 1987) return 0.30; // Black Monday year
  
  // Normal periods
  return 0.15; // ~15% annualized vol
}

/**
 * Generate mock SPX candles for a date range
 */
export function generateMockSpxCandles(from: string, to: string): SpxCandle[] {
  const fromTs = dateToTs(from);
  const toTs = dateToTs(to);
  const dayMs = 24 * 60 * 60 * 1000;
  
  const candles: SpxCandle[] = [];
  let prevClose: number | null = null;

  for (let ts = fromTs; ts <= toTs; ts += dayMs) {
    // Skip weekends
    if (!isWeekday(ts)) continue;
    
    const date = tsToDate(ts);
    const basePrice = getInterpolatedPrice(ts);
    const dailyVol = getDailyVolatility(ts) / Math.sqrt(252); // Daily vol from annual
    
    // Generate realistic OHLC
    let open: number;
    if (prevClose) {
      // Gap from previous close
      const gap = (Math.random() - 0.5) * dailyVol * 0.5;
      open = prevClose * (1 + gap);
    } else {
      open = basePrice;
    }
    
    // Daily range
    const dailyReturn = (Math.random() - 0.5) * dailyVol * 2;
    const intraRange = Math.random() * dailyVol * 1.5;
    
    const close = open * (1 + dailyReturn);
    const high = Math.max(open, close) * (1 + intraRange * 0.5);
    const low = Math.min(open, close) * (1 - intraRange * 0.5);
    
    // Volume (synthetic, based on price level)
    const volume = Math.floor(basePrice * 1000000 + Math.random() * 500000);
    
    candles.push({
      ts,
      date,
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume,
      symbol: 'SPX',
      source: 'MANUAL', // Mark as manual/generated
      cohort: pickSpxCohort(date),
    });
    
    prevClose = close;
  }

  return candles;
}

/**
 * Generate full SPX history (1950-2025)
 */
export function generateFullSpxHistory(): SpxCandle[] {
  return generateMockSpxCandles('1950-01-03', '2025-12-31');
}
