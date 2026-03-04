/**
 * SPX CORE — Scan Service
 * 
 * BLOCK B5.2.1 — Historical Match Scanner
 * 
 * Scans SPX historical data to find similar patterns to current window.
 * ISOLATION: Does NOT import from /modules/btc/ or /modules/fractal/
 */

import { spxCandlesService, type SpxCandle } from './spx-candles.service.js';
import { normalizeSeries } from './spx-normalize.js';
import { computeSimilarity, computeCorrelation } from './spx-match.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface SpxScanConfig {
  windowLen: number;           // Length of pattern window (e.g., 30 days)
  aftermathDays: number;       // Days to look forward after match
  minSimilarity: number;       // Minimum similarity threshold (0-100)
  maxMatches: number;          // Maximum matches to return
  excludeRecentDays: number;   // Exclude most recent N days from search
}

export interface SpxRawMatch {
  id: string;                  // YYYY-MM-DD format
  startTs: number;             // Window start timestamp
  endTs: number;               // Window end timestamp
  similarity: number;          // 0-100 similarity score
  correlation: number;         // Pearson correlation
  windowNormalized: number[];  // Normalized window prices
  aftermathNormalized: number[]; // Normalized aftermath prices (% from window end)
  cohort: string;              // Data cohort
  
  // Aftermath metrics
  return: number;              // Terminal return %
  maxDrawdown: number;         // Maximum drawdown %
  maxExcursion: number;        // Maximum favorable excursion %
}

export interface SpxScanResult {
  ok: boolean;
  matches: SpxRawMatch[];
  scannedWindows: number;
  processingTimeMs: number;
  config: SpxScanConfig;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT CONFIG
// ═══════════════════════════════════════════════════════════════

const DEFAULT_SCAN_CONFIG: SpxScanConfig = {
  windowLen: 30,
  aftermathDays: 30,
  minSimilarity: 40,  // Lowered from 55 for better match coverage
  maxMatches: 50,
  excludeRecentDays: 60,
};

// Minimum year for scanning - pre-1950 data is too different in scale
const MIN_SCAN_YEAR = 1950;

// ═══════════════════════════════════════════════════════════════
// SCAN ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Scan SPX history for matches similar to current window
 */
export async function scanSpxMatches(
  config: Partial<SpxScanConfig> = {}
): Promise<SpxScanResult> {
  const t0 = Date.now();
  const cfg: SpxScanConfig = { ...DEFAULT_SCAN_CONFIG, ...config };
  
  // Get all candles and filter to modern era (post-1950)
  const allCandlesRaw = await spxCandlesService.getAllCandles();
  const minTs = new Date(`${MIN_SCAN_YEAR}-01-01`).getTime();
  const allCandles = allCandlesRaw.filter(c => c.t >= minTs);
  
  if (allCandles.length < cfg.windowLen + cfg.aftermathDays + cfg.excludeRecentDays) {
    return {
      ok: false,
      matches: [],
      scannedWindows: 0,
      processingTimeMs: Date.now() - t0,
      config: cfg,
    };
  }
  
  // Get current window (most recent windowLen days, excluding very recent)
  const searchEndIdx = allCandles.length - cfg.excludeRecentDays;
  const currentWindowStart = searchEndIdx - cfg.windowLen;
  const currentWindow = allCandles.slice(currentWindowStart, searchEndIdx);
  
  console.log(`[SPX Scan] searchEndIdx=${searchEndIdx}, windowLen=${cfg.windowLen}, currentWindowStart=${currentWindowStart}`);
  
  if (currentWindow.length < cfg.windowLen) {
    return {
      ok: false,
      matches: [],
      scannedWindows: 0,
      processingTimeMs: Date.now() - t0,
      config: cfg,
    };
  }
  
  // Normalize current window
  const currentCloses = currentWindow.map(c => c.c);
  const currentNormalized = normalizeSeries(currentCloses);
  
  // Scan historical windows
  const matches: SpxRawMatch[] = [];
  let scannedWindows = 0;
  
  // Search from windowLen to searchEndIdx - windowLen - aftermathDays
  // This ensures we have both window and aftermath data
  const scanEnd = searchEndIdx - cfg.windowLen - cfg.aftermathDays;
  
  for (let i = cfg.windowLen; i < scanEnd; i++) {
    // Extract historical window
    const windowCandles = allCandles.slice(i - cfg.windowLen, i);
    const windowCloses = windowCandles.map(c => c.c);
    const windowNormalized = normalizeSeries(windowCloses);
    
    // Compute similarity
    const similarity = computeSimilarity(currentNormalized, windowNormalized);
    
    if (similarity >= cfg.minSimilarity) {
      // Extract aftermath
      const aftermathCandles = allCandles.slice(i, i + cfg.aftermathDays);
      const aftermathCloses = aftermathCandles.map(c => c.c);
      
      // Normalize aftermath relative to window end
      const windowEndPrice = windowCloses[windowCloses.length - 1];
      const aftermathNormalized = aftermathCloses.map(p => 
        (p - windowEndPrice) / windowEndPrice
      );
      
      // Calculate metrics
      const terminalReturn = aftermathNormalized[aftermathNormalized.length - 1] || 0;
      const maxDrawdown = calculateMaxDrawdown(aftermathCloses, windowEndPrice);
      const maxExcursion = calculateMaxExcursion(aftermathCloses, windowEndPrice);
      const correlation = computeCorrelation(currentNormalized, windowNormalized);
      
      const matchDate = windowCandles[windowCandles.length - 1].date;
      
      matches.push({
        id: matchDate,
        startTs: windowCandles[0].t,
        endTs: windowCandles[windowCandles.length - 1].t,
        similarity,
        correlation,
        windowNormalized,
        aftermathNormalized,
        cohort: windowCandles[windowCandles.length - 1].cohort,
        return: terminalReturn * 100, // Convert to %
        maxDrawdown: maxDrawdown * 100,
        maxExcursion: maxExcursion * 100,
      });
    }
    
    scannedWindows++;
  }
  
  // Sort by similarity (descending) and limit
  matches.sort((a, b) => b.similarity - a.similarity);
  const topMatches = matches.slice(0, cfg.maxMatches);
  
  return {
    ok: true,
    matches: topMatches,
    scannedWindows,
    processingTimeMs: Date.now() - t0,
    config: cfg,
  };
}

/**
 * Scan with custom current window (for specific focus horizon)
 */
export async function scanSpxMatchesForWindow(
  currentWindow: number[],
  config: Partial<SpxScanConfig> = {}
): Promise<SpxScanResult> {
  console.log('[SPX Scan] scanSpxMatchesForWindow CALLED with window length:', currentWindow.length);
  const t0 = Date.now();
  const cfg: SpxScanConfig = { 
    ...DEFAULT_SCAN_CONFIG, 
    windowLen: currentWindow.length,
    ...config 
  };
  
  // Get all candles and filter to modern era (post-1950)
  const allCandlesRaw = await spxCandlesService.getAllCandles();
  const minTs = new Date(`${MIN_SCAN_YEAR}-01-01`).getTime();
  const allCandles = allCandlesRaw.filter(c => c.t >= minTs);
  
  if (allCandles.length < cfg.windowLen + cfg.aftermathDays + cfg.excludeRecentDays) {
    return {
      ok: false,
      matches: [],
      scannedWindows: 0,
      processingTimeMs: Date.now() - t0,
      config: cfg,
    };
  }
  
  // Normalize current window
  const currentNormalized = normalizeSeries(currentWindow);
  
  // Scan historical windows
  const matches: SpxRawMatch[] = [];
  let scannedWindows = 0;
  
  const searchEndIdx = allCandles.length - cfg.excludeRecentDays;
  const scanEnd = searchEndIdx - cfg.windowLen - cfg.aftermathDays;
  
  for (let i = cfg.windowLen; i < scanEnd; i++) {
    const windowCandles = allCandles.slice(i - cfg.windowLen, i);
    const windowCloses = windowCandles.map(c => c.c);
    const windowNormalized = normalizeSeries(windowCloses);
    
    const similarity = computeSimilarity(currentNormalized, windowNormalized);
    
    // DEBUG: Log first few similarity scores
    if (i < cfg.windowLen + 5) {
      console.log(`[SPX Scan Debug] Window ${i}: similarity=${similarity.toFixed(1)}`);
    }
    
    if (similarity >= cfg.minSimilarity) {
      const aftermathCandles = allCandles.slice(i, i + cfg.aftermathDays);
      const aftermathCloses = aftermathCandles.map(c => c.c);
      
      const windowEndPrice = windowCloses[windowCloses.length - 1];
      const aftermathNormalized = aftermathCloses.map(p => 
        (p - windowEndPrice) / windowEndPrice
      );
      
      const terminalReturn = aftermathNormalized[aftermathNormalized.length - 1] || 0;
      const maxDrawdown = calculateMaxDrawdown(aftermathCloses, windowEndPrice);
      const maxExcursion = calculateMaxExcursion(aftermathCloses, windowEndPrice);
      const correlation = computeCorrelation(currentNormalized, windowNormalized);
      
      const matchDate = windowCandles[windowCandles.length - 1].date;
      
      matches.push({
        id: matchDate,
        startTs: windowCandles[0].t,
        endTs: windowCandles[windowCandles.length - 1].t,
        similarity,
        correlation,
        windowNormalized,
        aftermathNormalized,
        cohort: windowCandles[windowCandles.length - 1].cohort,
        return: terminalReturn * 100,
        maxDrawdown: maxDrawdown * 100,
        maxExcursion: maxExcursion * 100,
      });
    }
    
    scannedWindows++;
  }
  
  matches.sort((a, b) => b.similarity - a.similarity);
  const topMatches = matches.slice(0, cfg.maxMatches);
  
  return {
    ok: true,
    matches: topMatches,
    scannedWindows,
    processingTimeMs: Date.now() - t0,
    config: cfg,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function calculateMaxDrawdown(prices: number[], basePrice: number): number {
  if (prices.length === 0) return 0;
  
  let peak = basePrice;
  let maxDD = 0;
  
  for (const p of prices) {
    if (p > peak) peak = p;
    const dd = (peak - p) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  
  return maxDD;
}

function calculateMaxExcursion(prices: number[], basePrice: number): number {
  if (prices.length === 0) return 0;
  
  let maxUp = 0;
  for (const p of prices) {
    const gain = (p - basePrice) / basePrice;
    if (gain > maxUp) maxUp = gain;
  }
  
  return maxUp;
}

// Export singleton-like functions
export default {
  scanSpxMatches,
  scanSpxMatchesForWindow,
};
