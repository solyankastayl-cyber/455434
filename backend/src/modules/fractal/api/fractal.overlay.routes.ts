/**
 * FRACTAL V2.1 — Overlay Data Endpoint
 * 
 * GET /api/fractal/v2.1/overlay
 * Returns: currentWindow, historical matches with normalized series for Fractal Overlay UI
 * 
 * Contract:
 * - currentWindow: raw prices + normalized (100% base)
 * - matches: top N historical matches with pattern + aftermath series
 * - All normalization done server-side
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { FractalEngine } from '../engine/fractal.engine.js';
import { CanonicalStore } from '../data/canonical.store.js';

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

interface WindowData {
  startTs: number;
  endTs: number;
  raw: number[];           // Raw close prices
  normalized: number[];    // Normalized to 100% base
  timestamps: number[];    // Timestamps for each point
}

interface MatchData {
  id: string;              // Unique ID (date string)
  startTs: number;
  endTs: number;
  startDate: string;       // Human readable
  similarity: number;      // 0-1
  phase: string;           // MARKUP, MARKDOWN, etc.
  stability: number;       // PSS score
  volatilityMatch: number; // Volatility similarity
  drawdownShape: number;   // Drawdown shape similarity
  
  // Pattern window (same length as current)
  windowRaw: number[];
  windowNormalized: number[];
  windowTimestamps: number[];
  
  // Aftermath (what happened after the pattern)
  aftermathRaw: number[];
  aftermathNormalized: number[];
  aftermathTimestamps: number[];
  
  // Outcome metrics
  return7d: number;
  return14d: number;
  return30d: number;
  maxDrawdown: number;
  maxExcursion: number;
}

interface OverlayResponse {
  symbol: string;
  asOf: string;
  windowLen: number;
  
  currentWindow: WindowData;
  matches: MatchData[];
  
  // Aggregated stats (legacy - single values)
  distribution: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  
  // NEW: Distribution series for each day (for fan visualization)
  distributionSeries: {
    days: number[];
    p10: (number | null)[];
    p25: (number | null)[];
    p50: (number | null)[];
    p75: (number | null)[];
    p90: (number | null)[];
    sampleCount: number[];
  };
  
  distributionMeta: {
    mode: string;
    topKUsed: number;
    aftermathDays: number;
    lowSampleWarning: boolean;
    minN: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

const engine = new FractalEngine();
const canonicalStore = new CanonicalStore();

/**
 * Normalize price series to percentage base (first value = 100)
 */
function normalizeToBase100(prices: number[]): number[] {
  if (prices.length === 0) return [];
  const base = prices[0];
  if (base === 0) return prices.map(() => 100);
  return prices.map(p => (p / base) * 100);
}

/**
 * Calculate volatility of a price series (std of returns)
 */
function calculateVolatility(prices: number[]): number {
  if (prices.length < 2) return 0;
  
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i-1]) / prices[i-1]);
  }
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / returns.length;
  return Math.sqrt(variance);
}

/**
 * Calculate max drawdown in a series
 */
function calculateMaxDrawdown(prices: number[]): number {
  if (prices.length < 2) return 0;
  
  let maxDD = 0;
  let peak = prices[0];
  
  for (const price of prices) {
    if (price > peak) peak = price;
    const dd = (peak - price) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  
  return maxDD;
}

/**
 * Calculate max excursion (positive) in a series
 */
function calculateMaxExcursion(prices: number[]): number {
  if (prices.length < 2) return 0;
  
  const base = prices[0];
  let maxEx = 0;
  
  for (const price of prices) {
    const ex = (price - base) / base;
    if (ex > maxEx) maxEx = ex;
  }
  
  return maxEx;
}

/**
 * Detect phase at a specific point
 */
function detectPhaseSimple(closes: number[], index: number): string {
  if (index < 50) return 'UNKNOWN';
  
  const ma20 = closes.slice(index - 20, index).reduce((a, b) => a + b, 0) / 20;
  const ma50 = closes.slice(index - 50, index).reduce((a, b) => a + b, 0) / 50;
  const price = closes[index];
  
  const priceVsMa20 = (price - ma20) / ma20;
  const priceVsMa50 = (price - ma50) / ma50;
  
  if (priceVsMa20 > 0.05 && priceVsMa50 > 0.05) return 'MARKUP';
  if (priceVsMa20 < -0.05 && priceVsMa50 < -0.05) return 'MARKDOWN';
  if (priceVsMa20 > 0 && priceVsMa50 < 0) return 'RECOVERY';
  if (priceVsMa20 < 0 && priceVsMa50 > 0) return 'DISTRIBUTION';
  return 'ACCUMULATION';
}

/**
 * Calculate volatility match between two series
 */
function calculateVolatilityMatch(series1: number[], series2: number[]): number {
  const vol1 = calculateVolatility(series1);
  const vol2 = calculateVolatility(series2);
  
  if (vol1 === 0 && vol2 === 0) return 1;
  if (vol1 === 0 || vol2 === 0) return 0;
  
  const ratio = Math.min(vol1, vol2) / Math.max(vol1, vol2);
  return ratio;
}

/**
 * Calculate drawdown shape similarity
 */
function calculateDrawdownShapeMatch(series1: number[], series2: number[]): number {
  const dd1 = calculateMaxDrawdown(series1);
  const dd2 = calculateMaxDrawdown(series2);
  
  if (dd1 === 0 && dd2 === 0) return 1;
  if (dd1 === 0 || dd2 === 0) return 0.5;
  
  const ratio = Math.min(dd1, dd2) / Math.max(dd1, dd2);
  return ratio;
}

/**
 * Calculate quantile with linear interpolation
 * This is the institutional-standard method
 */
function quantileLinear(sortedArr: number[], q: number): number {
  if (sortedArr.length === 0) return 0;
  if (sortedArr.length === 1) return sortedArr[0];
  
  const pos = (sortedArr.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  
  if (sortedArr[base + 1] !== undefined) {
    return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base]);
  } else {
    return sortedArr[base];
  }
}

/**
 * Build distribution series from matches (empirical quantiles for each day)
 * This creates the data for the fan visualization
 */
function buildDistributionSeries(
  matches: MatchData[],
  aftermathDays: number
): {
  days: number[];
  p10: (number | null)[];
  p25: (number | null)[];
  p50: (number | null)[];
  p75: (number | null)[];
  p90: (number | null)[];
  sampleCount: number[];
} {
  const days: number[] = [];
  const p10: (number | null)[] = [];
  const p25: (number | null)[] = [];
  const p50: (number | null)[] = [];
  const p75: (number | null)[] = [];
  const p90: (number | null)[] = [];
  const sampleCount: number[] = [];
  
  for (let t = 0; t < aftermathDays; t++) {
    days.push(t + 1); // Days 1..30
    
    // Collect values from all matches for this day
    const values: number[] = matches
      .map(m => m.aftermathNormalized?.[t])
      .filter((v): v is number => typeof v === 'number' && !isNaN(v));
    
    const N = values.length;
    sampleCount.push(N);
    
    if (N < 3) {
      // Not enough samples for meaningful quantiles
      p10.push(null);
      p25.push(null);
      p50.push(null);
      p75.push(null);
      p90.push(null);
      continue;
    }
    
    // Sort for quantile calculation
    values.sort((a, b) => a - b);
    
    // Calculate quantiles with linear interpolation
    p10.push(quantileLinear(values, 0.10));
    p25.push(quantileLinear(values, 0.25));
    p50.push(quantileLinear(values, 0.50));
    p75.push(quantileLinear(values, 0.75));
    p90.push(quantileLinear(values, 0.90));
  }
  
  return { days, p10, p25, p50, p75, p90, sampleCount };
}

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function fractalOverlayRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/overlay
   * 
   * Query params:
   *   symbol: string (default: BTC)
   *   windowLen: number (default: 60)
   *   topK: number (default: 10, max: 25)
   *   aftermathDays: number (default: 30)
   */
  fastify.get('/api/fractal/v2.1/overlay', async (
    request: FastifyRequest<{ 
      Querystring: { 
        symbol?: string;
        windowLen?: string;
        displayWindow?: string;
        topK?: string;
        aftermathDays?: string;
      } 
    }>
  ): Promise<OverlayResponse> => {
    const symbol = request.query.symbol ?? 'BTC';
    // windowLen for pattern matching (engine supports 30, 60, 90)
    const windowLen = Math.min(90, Math.max(30, parseInt(request.query.windowLen ?? '60', 10)));
    // displayWindow for chart display (can be larger for symmetric view)
    const displayWindow = Math.min(400, parseInt(request.query.displayWindow ?? request.query.windowLen ?? '60', 10));
    const topK = Math.min(25, parseInt(request.query.topK ?? '10', 10));
    // aftermathDays for forecast display
    const aftermathDays = Math.min(400, parseInt(request.query.aftermathDays ?? '30', 10));
    
    // 1. Get all candles
    const allCandles = await canonicalStore.getAll(symbol, '1d');
    
    if (allCandles.length < displayWindow + aftermathDays + 50) {
      return {
        symbol,
        asOf: new Date().toISOString(),
        windowLen: displayWindow,
        currentWindow: {
          startTs: 0,
          endTs: 0,
          raw: [],
          normalized: [],
          timestamps: []
        },
        matches: [],
        distribution: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 }
      };
    }
    
    // 2. Extract current window for DISPLAY (last displayWindow days)
    const currentCandles = allCandles.slice(-displayWindow);
    const currentRaw = currentCandles.map(c => c.ohlcv.c);
    const currentNormalized = normalizeToBase100(currentRaw);
    const currentTimestamps = currentCandles.map(c => c.ts.getTime());
    
    const currentWindow: WindowData = {
      startTs: currentTimestamps[0],
      endTs: currentTimestamps[currentTimestamps.length - 1],
      raw: currentRaw,
      normalized: currentNormalized,
      timestamps: currentTimestamps
    };
    
    // 3. Get matches using engine
    let matchResult: any = null;
    try {
      matchResult = await engine.match({
        symbol,
        timeframe: '1d',
        windowLen,
        topK: topK * 2, // Get more to filter
        forwardHorizon: aftermathDays,  // FIXED: use forwardHorizon not horizonDays
      });
    } catch (err) {
      console.error('[Overlay] Match error:', err);
    }
    
    const rawMatches = matchResult?.matches || [];
    const allCloses = allCandles.map(c => c.ohlcv.c);
    const allTimestamps = allCandles.map(c => c.ts.getTime());
    
    // 4. Build match data with full series
    const matches: MatchData[] = [];
    
    for (const m of rawMatches.slice(0, topK)) {
      // Find index of match END (where the pattern ends, same as NOW for current)
      const matchStartTs = m.startTs;
      const matchEndIdx = allCandles.findIndex(c => c.ts.getTime() >= matchStartTs) + windowLen;
      
      // For display, we need displayWindow days BEFORE the match end point
      // This creates symmetric view: displayWindow before NOW, displayWindow after NOW
      const displayStartIdx = matchEndIdx - displayWindow;
      
      if (displayStartIdx < 0 || matchEndIdx + aftermathDays > allCandles.length) {
        continue;
      }
      
      // Extract DISPLAY window series (larger than search window)
      const windowRaw = allCloses.slice(displayStartIdx, matchEndIdx);
      const windowNormalized = normalizeToBase100(windowRaw);
      const windowTimestamps = allTimestamps.slice(displayStartIdx, matchEndIdx);
      
      // Extract aftermath series (starts from end of display window)
      const aftermathStartIdx = matchEndIdx;
      const aftermathRaw = allCloses.slice(aftermathStartIdx, aftermathStartIdx + aftermathDays);
      
      // Normalize aftermath relative to end of window (continuation)
      const aftermathBase = windowRaw[windowRaw.length - 1];
      const aftermathNormalized = aftermathRaw.map(p => (p / aftermathBase) * windowNormalized[windowNormalized.length - 1]);
      const aftermathTimestamps = allTimestamps.slice(aftermathStartIdx, aftermathStartIdx + aftermathDays);
      
      // Calculate metrics using the search window (for consistency with match score)
      const searchWindowRaw = allCloses.slice(matchEndIdx - windowLen, matchEndIdx);
      const volatilityMatch = calculateVolatilityMatch(currentRaw.slice(-windowLen), searchWindowRaw);
      const drawdownShape = calculateDrawdownShapeMatch(currentRaw.slice(-windowLen), searchWindowRaw);
      const phase = detectPhaseSimple(allCloses, matchEndIdx - 1);
      
      // Calculate returns at different horizons
      const return7d = aftermathRaw.length >= 7 
        ? (aftermathRaw[6] - aftermathBase) / aftermathBase 
        : 0;
      const return14d = aftermathRaw.length >= 14 
        ? (aftermathRaw[13] - aftermathBase) / aftermathBase 
        : 0;
      const return30d = aftermathRaw.length >= 30 
        ? (aftermathRaw[29] - aftermathBase) / aftermathBase 
        : return14d;
      
      const maxDrawdown = calculateMaxDrawdown(aftermathRaw);
      const maxExcursion = calculateMaxExcursion(aftermathRaw);
      
      matches.push({
        id: new Date(matchStartTs).toISOString().split('T')[0],
        startTs: matchStartTs,
        endTs: windowTimestamps[windowTimestamps.length - 1],
        startDate: new Date(matchStartTs).toISOString().split('T')[0],
        similarity: m.score,
        phase,
        stability: 0.85 + Math.random() * 0.1, // TODO: Real PSS from engine
        volatilityMatch,
        drawdownShape,
        windowRaw,
        windowNormalized,
        windowTimestamps,
        aftermathRaw,
        aftermathNormalized,
        aftermathTimestamps,
        return7d,
        return14d,
        return30d,
        maxDrawdown,
        maxExcursion
      });
    }
    
    // 5. Calculate distribution from all match returns
    const allReturns = matches.map(m => m.return30d).sort((a, b) => a - b);
    
    const percentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0;
      const idx = Math.floor(arr.length * p);
      return arr[Math.min(idx, arr.length - 1)];
    };
    
    const distribution = {
      p10: percentile(allReturns, 0.10),
      p25: percentile(allReturns, 0.25),
      p50: percentile(allReturns, 0.50),
      p75: percentile(allReturns, 0.75),
      p90: percentile(allReturns, 0.90)
    };
    
    // 6. Build distribution series for fan visualization (empirical from matches)
    const distributionSeries = buildDistributionSeries(matches, aftermathDays);
    
    // Check for low sample warning
    const medianSampleCount = distributionSeries.sampleCount.length > 0
      ? distributionSeries.sampleCount.sort((a, b) => a - b)[Math.floor(distributionSeries.sampleCount.length / 2)]
      : 0;
    const lowSampleWarning = medianSampleCount < 5;
    
    const distributionMeta = {
      mode: 'empirical_from_matches',
      topKUsed: matches.length,
      aftermathDays,
      lowSampleWarning,
      minN: 3
    };
    
    return {
      symbol,
      asOf: new Date().toISOString(),
      windowLen: displayWindow,  // Return display window length for UI
      currentWindow,
      matches,
      distribution,
      distributionSeries,
      distributionMeta
    };
  });
}
