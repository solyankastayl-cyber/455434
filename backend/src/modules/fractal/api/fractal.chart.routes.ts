/**
 * FRACTAL V2.1 — Chart Data Endpoint
 * BLOCK 73.5.1 — Phase Stats for hover tooltips
 * 
 * GET /api/fractal/v2.1/chart
 * Returns: candles, SMA200, phase zones, phase stats for UI rendering
 * 
 * Supports:
 * - BTC: from canonical store
 * - SPX: from spx_candles collection
 * 
 * Contract:
 * - Candles: Daily OHLCV
 * - SMA200: 200-day simple moving average
 * - PhaseZones: Market phase regions (MARKUP, MARKDOWN, etc.)
 * - PhaseStats: Statistics for each phase (duration, return, matches)
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { CanonicalStore } from '../data/canonical.store.js';
import { calculatePhaseStats, type PhaseStats } from '../phase/phase-stats.service.js';
import { SpxCandleModel } from '../../spx/spx.mongo.js';

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

interface CandleData {
  t: number;  // Unix timestamp (ms)
  o: number;  // Open
  h: number;  // High
  l: number;  // Low
  c: number;  // Close
  v: number;  // Volume
}

interface SMA200Point {
  t: number;
  value: number;
}

interface PhaseZone {
  from: number;
  to: number;
  phase: string;
}

interface ChartResponse {
  symbol: string;
  tf: string;
  asOf: string;
  count: number;
  candles: CandleData[];
  sma200: SMA200Point[];
  phaseZones: PhaseZone[];
  // BLOCK 73.5.1: Phase stats for hover
  phaseStats?: PhaseStats[];
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

const canonicalStore = new CanonicalStore();

/**
 * Get SPX candles from spx_candles collection
 */
async function getSpxCandles(limit: number, asOf?: string) {
  const query: any = {};
  
  if (asOf) {
    // Parse asOf date and filter
    const asOfDate = new Date(asOf);
    const asOfTs = asOfDate.getTime();
    query.ts = { $lte: asOfTs };
  }
  
  const rows = await SpxCandleModel
    .find(query)
    .sort({ ts: -1 })
    .limit(limit)
    .lean();
  
  // Reverse to chronological order and map to standard format
  return rows.reverse().map(c => ({
    ts: new Date(c.ts),
    ohlcv: {
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume || 0
    },
    meta: {
      symbol: 'SPX',
      timeframe: '1d'
    }
  }));
}

/**
 * Calculate SMA for given period
 */
function calculateSMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += closes[j];
    }
    result.push(sum / period);
  }
  
  return result;
}

/**
 * Detect market phase from price action
 * Returns: MARKUP | MARKDOWN | ACCUMULATION | DISTRIBUTION | RECOVERY | CAPITULATION
 */
function detectPhaseAtIndex(
  closes: number[],
  index: number,
  sma20: (number | null)[],
  sma50: (number | null)[],
  sma200: (number | null)[]
): string {
  if (index < 200) return 'UNKNOWN';
  
  const price = closes[index];
  const ma20 = sma20[index];
  const ma50 = sma50[index];
  const ma200 = sma200[index];
  
  if (!ma20 || !ma50 || !ma200) return 'UNKNOWN';
  
  // Calculate momentum indicators
  const priceVsMa20 = (price - ma20) / ma20;
  const priceVsMa50 = (price - ma50) / ma50;
  const priceVsMa200 = (price - ma200) / ma200;
  const ma20VsMa50 = (ma20 - ma50) / ma50;
  const ma50VsMa200 = (ma50 - ma200) / ma200;
  
  // Calculate recent drawdown (last 90 days)
  const lookback = Math.min(90, index);
  const recentSlice = closes.slice(index - lookback, index + 1);
  const recentHigh = Math.max(...recentSlice);
  const drawdown = (recentHigh - price) / recentHigh;
  
  // Phase detection logic
  if (drawdown > 0.35 && priceVsMa200 < -0.25) {
    return 'CAPITULATION';
  }
  
  if (priceVsMa200 < -0.10 && ma20VsMa50 < 0 && ma50VsMa200 < 0) {
    return 'MARKDOWN';
  }
  
  if (priceVsMa200 > 0.15 && ma20VsMa50 > 0.02 && ma50VsMa200 > 0.05) {
    return 'MARKUP';
  }
  
  if (priceVsMa200 > 0.10 && ma20VsMa50 < -0.01) {
    return 'DISTRIBUTION';
  }
  
  if (priceVsMa200 < 0 && ma20VsMa50 > 0.01) {
    return 'RECOVERY';
  }
  
  return 'ACCUMULATION';
}

/**
 * Generate phase zones from daily phase classifications
 */
function generatePhaseZones(
  timestamps: number[],
  closes: number[],
  sma20: (number | null)[],
  sma50: (number | null)[],
  sma200: (number | null)[]
): PhaseZone[] {
  if (timestamps.length < 201) return [];
  
  const zones: PhaseZone[] = [];
  let currentPhase = 'UNKNOWN';
  let zoneStart = timestamps[200];
  
  for (let i = 200; i < timestamps.length; i++) {
    const phase = detectPhaseAtIndex(closes, i, sma20, sma50, sma200);
    
    if (phase !== currentPhase) {
      // Close previous zone
      if (currentPhase !== 'UNKNOWN') {
        zones.push({
          from: zoneStart,
          to: timestamps[i - 1],
          phase: currentPhase
        });
      }
      // Start new zone
      currentPhase = phase;
      zoneStart = timestamps[i];
    }
  }
  
  // Close last zone
  if (currentPhase !== 'UNKNOWN' && timestamps.length > 0) {
    zones.push({
      from: zoneStart,
      to: timestamps[timestamps.length - 1],
      phase: currentPhase
    });
  }
  
  return zones;
}

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function fractalChartRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/chart
   * 
   * Query params:
   *   symbol: string (default: BTC, supports: BTC | SPX)
   *   limit: number (default: 450, max: 2000)
   *   asOf: string (optional, YYYY-MM-DD for historical view)
   * 
   * Returns real OHLC candles for charting.
   * SPX uses spx_candles collection, BTC uses canonical store.
   */
  fastify.get('/api/fractal/v2.1/chart', async (
    request: FastifyRequest<{ 
      Querystring: { 
        symbol?: string;
        limit?: string;
        asOf?: string;
        tf?: string;
      } 
    }>
  ): Promise<ChartResponse> => {
    const symbol = (request.query.symbol ?? 'BTC').toUpperCase();
    const limit = Math.min(2000, parseInt(request.query.limit ?? '450', 10));
    const asOf = request.query.asOf;
    const tf = request.query.tf ?? '1D';
    
    // 1. Fetch candles based on symbol
    let allCandles: Array<{
      ts: Date;
      ohlcv: { o: number; h: number; l: number; c: number; v: number };
      meta: { symbol: string; timeframe: string };
    }>;
    
    if (symbol === 'SPX') {
      // SPX: Fetch from spx_candles collection
      // Need more history for SMA200, fetch extra then slice
      const extraForSma = 200;
      allCandles = await getSpxCandles(limit + extraForSma, asOf);
    } else {
      // BTC: Fetch from canonical store
      allCandles = await canonicalStore.getAll(symbol, '1d');
    }
    
    if (allCandles.length === 0) {
      return {
        symbol,
        tf,
        asOf: asOf || new Date().toISOString(),
        count: 0,
        candles: [],
        sma200: [],
        phaseZones: []
      };
    }
    
    // 2. Take last N candles (after SMA calculation)
    const candles = allCandles.slice(-limit);
    
    // 3. Extract arrays for calculations
    const timestamps = candles.map(c => c.ts.getTime());
    const closes = candles.map(c => c.ohlcv.c);
    
    // 4. Calculate SMAs (need more history for accurate SMA200)
    const fullCloses = allCandles.map(c => c.ohlcv.c);
    const fullTimestamps = allCandles.map(c => c.ts.getTime());
    
    const sma20Full = calculateSMA(fullCloses, 20);
    const sma50Full = calculateSMA(fullCloses, 50);
    const sma200Full = calculateSMA(fullCloses, 200);
    
    // 5. Slice SMAs to match requested limit
    const startIdx = fullCloses.length - limit;
    const sma200Slice = sma200Full.slice(startIdx);
    
    // 6. Build SMA200 response array
    const sma200Data: SMA200Point[] = [];
    for (let i = 0; i < candles.length; i++) {
      const val = sma200Slice[i];
      if (val !== null) {
        sma200Data.push({
          t: timestamps[i],
          value: val
        });
      }
    }
    
    // 7. Generate phase zones
    const phaseZones = generatePhaseZones(
      fullTimestamps,
      fullCloses,
      sma20Full,
      sma50Full,
      sma200Full
    );
    
    // Filter phase zones to requested range
    const rangeStart = timestamps[0];
    const rangeEnd = timestamps[timestamps.length - 1];
    const filteredZones = phaseZones
      .filter(z => z.to >= rangeStart && z.from <= rangeEnd)
      .map(z => ({
        from: Math.max(z.from, rangeStart),
        to: Math.min(z.to, rangeEnd),
        phase: z.phase
      }));
    
    // 8. Build candles response
    const candleData: CandleData[] = candles.map(c => ({
      t: c.ts.getTime(),
      o: c.ohlcv.o,
      h: c.ohlcv.h,
      l: c.ohlcv.l,
      c: c.ohlcv.c,
      v: c.ohlcv.v ?? 0
    }));
    
    // BLOCK 73.5.1: Calculate phase stats for hover tooltips
    const phaseStatsInput = filteredZones.map(z => ({
      phase: z.phase as any,
      from: new Date(z.from).toISOString(),
      to: new Date(z.to).toISOString()
    }));
    
    const candleStatsInput = candleData.map(c => ({
      t: new Date(c.t).toISOString(),
      o: c.o,
      h: c.h,
      l: c.l,
      c: c.c,
      v: c.v
    }));
    
    // Pass empty matches for now - will be populated by focus-pack
    const phaseStats = calculatePhaseStats(phaseStatsInput, candleStatsInput, []);
    
    // Determine asOf from latest candle
    const latestCandleDate = candleData.length > 0 
      ? new Date(candleData[candleData.length - 1].t).toISOString()
      : new Date().toISOString();
    
    return {
      symbol,
      tf,
      asOf: asOf || latestCandleDate,
      count: candleData.length,
      candles: candleData,
      sma200: sma200Data,
      phaseZones: filteredZones,
      phaseStats
    };
  });
}
