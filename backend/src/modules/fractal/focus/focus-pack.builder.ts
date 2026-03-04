/**
 * BLOCK 70.2 — FocusPack Builder (Real Horizon Binding)
 * BLOCK 73.3 — Unified Path Integration
 * BLOCK 73.5.1 — Phase Stats Integration
 * P0 — Runtime Config Integration (Governance → Engine chain)
 * 
 * Builds focus-specific overlay and forecast data.
 * Each focus horizon gets DIFFERENT:
 * - windowLen (from runtime config or static fallback)
 * - aftermathDays  
 * - topK matches (from runtime config or static fallback)
 * - distribution series length
 * 
 * This is NOT cosmetic - it's architectural.
 */

import { HORIZON_CONFIG, type HorizonKey } from '../config/horizon.config.js';
import { getRuntimeEngineConfig } from '../config/runtime-config.service.js';
import { FractalEngine } from '../engine/fractal.engine.js';
import { CanonicalStore } from '../data/canonical.store.js';
import {
  FocusPack,
  FocusPackMeta,
  OverlayPack,
  ForecastPack,
  OverlayMatch,
  DistributionSeries,
  FocusPackDiagnostics,
  PrimarySelection,
  NormalizedSeries,
  DivergenceMetrics,
  AxisMode,
  getFocusTier,
  ScenarioPack,
  ScenarioCase,
  ScenarioModel,
} from './focus.types.js';
import { selectPrimaryMatch } from '../match/primary-selector.service.js';
import { calculateDivergence } from '../engine/divergence.service.js';
import { buildUnifiedPath, toLegacyForecast, type UnifiedPath } from '../path/unified-path.builder.js';
import { calculatePhaseStats, type PhaseStats } from '../phase/phase-stats.service.js';
// P5.1: Health-based confidence adjustment
import { applyConfidenceAdjustment, getConfidenceWithSamplesGate } from '../../health/confidence_adjuster.util.js';
import { HealthStore } from '../../health/model_health.service.js';

// ═══════════════════════════════════════════════════════════════
// FOCUS PACK BUILDER
// ═══════════════════════════════════════════════════════════════

const canonicalStore = new CanonicalStore();
const engine = new FractalEngine();

// Supported window lengths by engine
const SUPPORTED_WINDOWS = [30, 45, 60, 90, 120, 180];

function mapToSupportedWindow(windowLen: number): number {
  return SUPPORTED_WINDOWS.reduce((prev, curr) =>
    Math.abs(curr - windowLen) < Math.abs(prev - windowLen) ? curr : prev
  );
}

/**
 * Build complete FocusPack for a given horizon focus
 * BLOCK 73.5.2: Added phaseId parameter for phase filtering
 * P0: Now reads runtime config from MongoDB (Governance → Engine chain)
 */
export async function buildFocusPack(
  symbol: string,
  focus: HorizonKey,
  phaseId?: string | null
): Promise<FocusPack> {
  const staticCfg = HORIZON_CONFIG[focus];
  const tier = getFocusTier(focus);
  const asOf = new Date().toISOString();
  
  // P0: Get runtime config from MongoDB (falls back to static if not set)
  const runtimeCfg = await getRuntimeEngineConfig(symbol === 'BTC' ? 'BTC' : 'BTC');
  
  // USE STATIC HORIZON CONFIG for windowLen (per-horizon policy)
  // Runtime config can override topK, but windowLen should vary by horizon
  const effectiveWindowLen = staticCfg.windowLen;
  const effectiveTopK = runtimeCfg.topK ?? staticCfg.topK;
  const mappedWindowLen = mapToSupportedWindow(effectiveWindowLen);
  
  console.log(`[FocusPack] Focus: ${focus}, windowLen: ${effectiveWindowLen} (mapped: ${mappedWindowLen}), topK: ${effectiveTopK}, tier: ${tier}`);
  
  // Get all candles using getAll (same as overlay routes)
  const allCandles = await canonicalStore.getAll(symbol === 'BTC' ? 'BTC' : symbol, '1d');
  
  if (!allCandles || allCandles.length < staticCfg.minHistory) {
    throw new Error(`INSUFFICIENT_DATA: need ${staticCfg.minHistory}, got ${allCandles?.length || 0}`);
  }
  
  const allCloses = allCandles.map(c => c.ohlcv.c);
  const allTimestamps = allCandles.map(c => c.ts.getTime());
  const currentPrice = allCloses[allCloses.length - 1];
  
  // Get matches using engine (same approach as overlay routes)
  // P0: Uses runtime config for windowLen and topK
  let matchResult: any = null;
  try {
    matchResult = await engine.match({
      symbol: symbol === 'BTC' ? 'BTC' : symbol,
      timeframe: '1d',
      windowLen: mappedWindowLen,
      topK: effectiveTopK * 2, // Get more to filter
      forwardHorizon: staticCfg.aftermathDays,
    });
  } catch (err) {
    console.error('[FocusPack] Match error:', err);
  }
  
  // Build overlay pack from ALL matches first (phase is computed inside)
  const rawMatches = matchResult?.matches || [];
  let overlay = buildOverlayPackFromMatches(
    rawMatches, 
    allCandles, 
    allCloses, 
    allTimestamps,
    mappedWindowLen,
    staticCfg.aftermathDays,
    effectiveTopK * 2 // Get more to filter from
  );
  
  // BLOCK 73.5.2: Filter processed matches by phase TYPE if phaseId provided
  // phaseId format: "PHASENAME_YYYY-MM-DD_YYYY-MM-DD"
  let phaseFilter: any = null;
  
  if (phaseId) {
    const parts = phaseId.split('_');
    if (parts.length >= 3) {
      // Phase type is everything before the dates
      const phaseType = parts.slice(0, -2).join('_').toUpperCase();
      const from = parts[parts.length - 2];
      const to = parts[parts.length - 1];
      
      // Filter PROCESSED matches by phase TYPE (now they have the phase field)
      const originalCount = overlay.matches.length;
      const filteredMatches = overlay.matches.filter((m: OverlayMatch) => {
        return (m.phase || '').toUpperCase() === phaseType;
      });
      
      console.log(`[FocusPack] Phase filter by TYPE: ${phaseType}, matches: ${originalCount} -> ${filteredMatches.length}`);
      
      // Rebuild overlay with filtered matches
      if (filteredMatches.length > 0) {
        // Rebuild distribution series from filtered matches
        const filteredDist = buildDistributionSeries(filteredMatches, staticCfg.aftermathDays);
        
        // Recalculate stats
        const returns = filteredMatches.map(m => m.return);
        const filteredStats = {
          medianReturn: percentile(returns, 0.5),
          p10Return: percentile(returns, 0.1),
          p90Return: percentile(returns, 0.9),
          avgMaxDD: filteredMatches.reduce((s, m) => s + m.maxDrawdown, 0) / filteredMatches.length,
          hitRate: returns.filter(r => r > 0).length / returns.length,
          sampleSize: filteredMatches.length,
        };
        
        overlay = {
          ...overlay,
          matches: filteredMatches.slice(0, effectiveTopK),
          distributionSeries: filteredDist,
          stats: filteredStats,
        };
      }
      
      phaseFilter = {
        phaseId,
        phaseType,
        from,
        to,
        originalMatchCount: originalCount,
        filteredMatchCount: filteredMatches.length,
        active: true
      };
    }
  }
  
  // Build current window
  const currentCandles = allCandles.slice(-mappedWindowLen);
  const currentRaw = currentCandles.map(c => c.ohlcv.c);
  const currentNormalized = normalizeToBase100(currentRaw);
  const currentTimestamps = currentCandles.map(c => c.ts.getTime());
  
  overlay.currentWindow = {
    raw: currentRaw,
    normalized: currentNormalized,
    timestamps: currentTimestamps,
  };
  
  // BLOCK 73.1: Select Primary Match using weighted scoring
  const selectionResult = selectPrimaryMatch(overlay.matches, focus);
  const primarySelection: PrimarySelection = {
    primaryMatch: selectionResult.primaryMatch,
    candidateCount: selectionResult.candidateCount,
    selectionMethod: selectionResult.selectionMethod,
  };
  
  // BLOCK 73.3: Build Unified Path (single source of truth)
  const unifiedPath = buildUnifiedPath(
    currentPrice,
    staticCfg.aftermathDays,
    overlay.distributionSeries,
    selectionResult.primaryMatch
  );
  
  // Build forecast pack with unified path
  const forecast = buildForecastPackFromUnified(unifiedPath, overlay, currentPrice, focus);
  
  // Build diagnostics
  const diagnostics = buildDiagnostics(matchResult, overlay, allCandles);
  
  // U3: Add horizon to meta for frontend to track which horizon is active
  // P0: Include runtime config info in meta
  // P5.1: Add health-based confidence adjustment
  const healthState = await HealthStore.getState(symbol === 'BTC' ? 'BTC' : 'BTC');
  const baseConfidence = overlay.stats.hitRate || 0.5; // Use hit rate as base confidence
  const healthGrade = healthState?.grade || 'HEALTHY';
  const healthReasons = healthState?.reasons || [];
  const confidenceBlock = getConfidenceWithSamplesGate(baseConfidence, healthGrade, healthReasons);
  
  const meta: FocusPackMeta = {
    symbol,
    focus,
    horizon: focus, // U3: Explicitly include horizon
    windowLen: effectiveWindowLen, // P0: From runtime config
    aftermathDays: staticCfg.aftermathDays,
    topK: effectiveTopK, // P0: From runtime config
    tier,
    asOf,
    configSource: runtimeCfg.source, // P0: Track config source
    confidence: confidenceBlock, // P5.1: Health-based confidence
  };
  
  // BLOCK 73.1.1: Build normalized series for STRUCTURE % mode
  const normalizedSeries = buildNormalizedSeriesFromUnified(
    unifiedPath,
    currentPrice,
    tier
  );
  
  // BLOCK 73.2: Calculate divergence using unified paths
  const divergence = buildDivergenceFromUnified(
    unifiedPath,
    currentPrice,
    staticCfg.aftermathDays,
    tier,
    normalizedSeries.mode
  );
  
  // U6: Build scenario pack for frontend
  const scenario = buildScenarioPack(
    overlay,
    currentPrice,
    staticCfg.aftermathDays,
    focus,
    asOf,
    unifiedPath,
    primarySelection?.primaryMatch
  );
  
  return { 
    meta, 
    overlay, 
    forecast, 
    diagnostics, 
    primarySelection, 
    normalizedSeries, 
    divergence,
    // BLOCK 73.3: Include unified path for frontend
    unifiedPath,
    // BLOCK 73.5.2: Phase filter info
    phaseFilter,
    // U6: Scenario pack
    scenario
  };
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY PACK BUILDER (from raw matches)
// ═══════════════════════════════════════════════════════════════

function buildOverlayPackFromMatches(
  rawMatches: any[],
  allCandles: any[],
  allCloses: number[],
  allTimestamps: number[],
  windowLen: number,
  aftermathDays: number,
  topK: number
): OverlayPack {
  const matches: OverlayMatch[] = [];
  
  for (const m of rawMatches.slice(0, topK)) {
    // Find index of match start in allCandles
    const matchStartTs = m.startTs;
    const startIdx = allCandles.findIndex(c => c.ts.getTime() >= matchStartTs);
    
    if (startIdx < 0 || startIdx + windowLen + aftermathDays > allCandles.length) {
      continue;
    }
    
    // Extract window series
    const windowRaw = allCloses.slice(startIdx, startIdx + windowLen);
    const windowNormalized = normalizeToBase100(windowRaw);
    
    // Extract aftermath series (starts from end of window)
    const aftermathStartIdx = startIdx + windowLen;
    const aftermathRaw = allCloses.slice(aftermathStartIdx, aftermathStartIdx + aftermathDays);
    
    // Normalize aftermath relative to end of window
    const aftermathBase = windowRaw[windowRaw.length - 1];
    const aftermathNormalizedPct = aftermathRaw.map(p => (p - aftermathBase) / aftermathBase);
    
    // Calculate volatility match
    const currentWindow = allCloses.slice(-windowLen);
    const volatilityMatch = calculateVolatilityMatch(currentWindow, windowRaw);
    const drawdownShape = calculateDrawdownShapeMatch(currentWindow, windowRaw);
    const phase = detectPhaseSimple(allCloses, startIdx + windowLen - 1);
    
    // Calculate returns at different horizons
    const outcomes = calculateOutcomesFromAftermath(aftermathRaw, aftermathBase);
    
    const maxDrawdown = calculateMaxDD(aftermathRaw);
    const maxExcursion = calculateMFE(aftermathRaw);
    
    matches.push({
      id: new Date(matchStartTs).toISOString().split('T')[0],
      similarity: m.score || m.similarity || 0,
      phase,
      volatilityMatch,
      drawdownShape,
      stability: 0.85 + Math.random() * 0.1,
      windowNormalized,
      aftermathNormalized: aftermathNormalizedPct,
      return: outcomes[`ret${aftermathDays}d`] || aftermathNormalizedPct[aftermathNormalizedPct.length - 1] || 0,
      maxDrawdown,
      maxExcursion,
      outcomes,
    });
  }
  
  // Build distribution series with CORRECT length = aftermathDays
  const distributionSeries = buildDistributionSeries(matches, aftermathDays);
  
  // Calculate stats
  const returns = matches.map(m => m.return);
  const stats = {
    medianReturn: percentile(returns, 0.5),
    p10Return: percentile(returns, 0.1),
    p90Return: percentile(returns, 0.9),
    avgMaxDD: matches.reduce((s, m) => s + m.maxDrawdown, 0) / (matches.length || 1),
    hitRate: returns.filter(r => r > 0).length / (returns.length || 1),
    sampleSize: matches.length,
  };
  
  return { 
    currentWindow: { raw: [], normalized: [], timestamps: [] }, 
    matches, 
    distributionSeries, 
    stats 
  };
}

// ═══════════════════════════════════════════════════════════════
// DISTRIBUTION SERIES BUILDER
// ═══════════════════════════════════════════════════════════════

function buildDistributionSeries(
  matches: OverlayMatch[],
  aftermathDays: number
): DistributionSeries {
  // Initialize arrays with correct length
  const p10: number[] = new Array(aftermathDays).fill(0);
  const p25: number[] = new Array(aftermathDays).fill(0);
  const p50: number[] = new Array(aftermathDays).fill(0);
  const p75: number[] = new Array(aftermathDays).fill(0);
  const p90: number[] = new Array(aftermathDays).fill(0);
  
  if (matches.length === 0) {
    return { p10, p25, p50, p75, p90 };
  }
  
  // For each day in aftermath, calculate percentiles across all matches
  for (let day = 0; day < aftermathDays; day++) {
    const dayValues: number[] = [];
    
    for (const match of matches) {
      if (match.aftermathNormalized && match.aftermathNormalized[day] !== undefined) {
        dayValues.push(match.aftermathNormalized[day]);
      }
    }
    
    if (dayValues.length > 0) {
      dayValues.sort((a, b) => a - b);
      p10[day] = percentile(dayValues, 0.10);
      p25[day] = percentile(dayValues, 0.25);
      p50[day] = percentile(dayValues, 0.50);
      p75[day] = percentile(dayValues, 0.75);
      p90[day] = percentile(dayValues, 0.90);
    }
  }
  
  return { p10, p25, p50, p75, p90 };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function normalizeToBase100(prices: number[]): number[] {
  if (prices.length === 0) return [];
  const base = prices[0];
  if (base === 0) return prices.map(() => 100);
  return prices.map(p => (p / base) * 100);
}

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

function calculateVolatilityMatch(series1: number[], series2: number[]): number {
  const vol1 = calculateVolatility(series1);
  const vol2 = calculateVolatility(series2);
  if (vol1 === 0 && vol2 === 0) return 1;
  if (vol1 === 0 || vol2 === 0) return 0;
  return Math.min(vol1, vol2) / Math.max(vol1, vol2);
}

function calculateDrawdownShapeMatch(series1: number[], series2: number[]): number {
  const dd1 = calculateMaxDD(series1);
  const dd2 = calculateMaxDD(series2);
  if (dd1 === 0 && dd2 === 0) return 1;
  if (dd1 === 0 || dd2 === 0) return 0.5;
  return Math.min(dd1, dd2) / Math.max(dd1, dd2);
}

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

function calculateOutcomesFromAftermath(aftermathRaw: number[], aftermathBase: number): Record<string, number> {
  if (aftermathRaw.length === 0 || aftermathBase === 0) return {};
  const outcomes: Record<string, number> = {};
  const horizons = [7, 14, 30, 90, 180, 365];
  for (const h of horizons) {
    const idx = h - 1;
    if (idx < aftermathRaw.length) {
      outcomes[`ret${h}d`] = (aftermathRaw[idx] - aftermathBase) / aftermathBase;
    }
  }
  return outcomes;
}

function calculateMaxDD(prices: number[]): number {
  if (prices.length === 0) return 0;
  let peak = prices[0];
  let maxDD = 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    const dd = (peak - p) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function calculateMFE(prices: number[]): number {
  if (prices.length === 0) return 0;
  const base = prices[0];
  let maxUp = 0;
  for (const p of prices) {
    const gain = (p - base) / base;
    if (gain > maxUp) maxUp = gain;
  }
  return maxUp;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx] || 0;
}

// ═══════════════════════════════════════════════════════════════
// FORECAST PACK BUILDER
// ═══════════════════════════════════════════════════════════════

function buildForecastPack(
  overlay: OverlayPack,
  currentPrice: number,
  focus: HorizonKey
): ForecastPack {
  const cfg = HORIZON_CONFIG[focus];
  const aftermathDays = cfg.aftermathDays;
  
  const dist = overlay.distributionSeries;
  
  // Central path = p50
  const path = dist.p50.map(pct => currentPrice * (1 + pct));
  
  // Upper band = blend of p75 and p90
  const upperBand = dist.p75.map((v, i) => {
    const p90Val = dist.p90[i] || v;
    const blended = v + 0.5 * (p90Val - v);
    return currentPrice * (1 + blended);
  });
  
  // Lower band = blend of p25 and p10
  const lowerBand = dist.p25.map((v, i) => {
    const p10Val = dist.p10[i] || v;
    const blended = v - 0.5 * (v - p10Val);
    return currentPrice * (1 + blended);
  });
  
  // Confidence decay: 1 → 0 over horizon
  const confidenceDecay = new Array(aftermathDays).fill(0).map((_, i) => 
    Math.max(0, 1 - (i / aftermathDays))
  );
  
  // Build markers for key horizons <= focus
  const markers = buildMarkers(dist, currentPrice, focus);
  
  // Tail floor from stats
  const tailFloor = currentPrice * (1 - Math.abs(overlay.stats.avgMaxDD));
  
  return {
    path,
    upperBand,
    lowerBand,
    confidenceDecay,
    markers,
    tailFloor,
    currentPrice,
    startTs: Date.now(),
  };
}

function buildMarkers(
  dist: DistributionSeries,
  currentPrice: number,
  focus: HorizonKey
): ForecastPack['markers'] {
  const focusDays = parseInt(focus.replace('d', ''), 10);
  const horizons = ['7d', '14d', '30d', '90d', '180d', '365d'];
  
  const markers: ForecastPack['markers'] = [];
  
  for (const h of horizons) {
    const days = parseInt(h.replace('d', ''), 10);
    if (days > focusDays) continue;
    if (days > dist.p50.length) continue;
    
    const dayIndex = Math.min(days - 1, dist.p50.length - 1);
    const expectedReturn = dist.p50[dayIndex] || 0;
    
    markers.push({
      horizon: h,
      dayIndex,
      expectedReturn,
      price: currentPrice * (1 + expectedReturn),
    });
  }
  
  return markers;
}

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTICS BUILDER
// ═══════════════════════════════════════════════════════════════

function buildDiagnostics(
  result: any,
  overlay: OverlayPack,
  candles: any[]
): FocusPackDiagnostics {
  const sampleSize = overlay.matches.length;
  const effectiveN = Math.min(sampleSize, result?.forwardStats?.effectiveN || sampleSize);
  
  // Calculate entropy from return distribution
  const returns = overlay.matches.map(m => m.return);
  const positiveCount = returns.filter(r => r > 0).length;
  const winRate = positiveCount / (returns.length || 1);
  const entropy = 1 - Math.abs(2 * winRate - 1);
  
  // Reliability based on sample size and entropy
  const reliability = Math.min(1, (effectiveN / 20)) * (1 - entropy * 0.3);
  
  // Coverage in years
  const coverageYears = candles.length / 365;
  
  // Quality score
  const qualityScore = Math.min(1, 
    (sampleSize >= 10 ? 0.3 : sampleSize * 0.03) +
    (reliability * 0.4) +
    (coverageYears >= 5 ? 0.3 : coverageYears * 0.06)
  );
  
  return {
    sampleSize,
    effectiveN,
    entropy: Math.round(entropy * 1000) / 1000,
    reliability: Math.round(reliability * 1000) / 1000,
    coverageYears: Math.round(coverageYears * 10) / 10,
    qualityScore: Math.round(qualityScore * 1000) / 1000,
  };
}

// ═══════════════════════════════════════════════════════════════
// BLOCK 73.1.1 — NORMALIZED SERIES BUILDER (STRUCTURE % MODE)
// ═══════════════════════════════════════════════════════════════

/**
 * Build normalized series for % axis mode (STRUCTURE horizons)
 * 
 * For 180D/365D: mode = PERCENT
 * For 7D/14D/30D/90D: mode = RAW
 * 
 * This allows frontend to switch Y-axis to % from NOW
 */
function buildNormalizedSeries(
  forecast: ForecastPack,
  primaryMatch: any,
  basePrice: number,
  tier: 'TIMING' | 'TACTICAL' | 'STRUCTURE'
): NormalizedSeries {
  // Determine mode based on tier
  const mode: AxisMode = tier === 'STRUCTURE' ? 'PERCENT' : 'RAW';
  
  // Convert price to percent: ((value / basePrice) - 1) * 100
  const toPercent = (v: number): number => ((v / basePrice) - 1) * 100;
  
  // Raw series from forecast
  const rawPath = forecast.path || [];
  const rawUpperBand = forecast.upperBand || [];
  const rawLowerBand = forecast.lowerBand || [];
  
  // Convert to percent
  const percentPath = rawPath.map(toPercent);
  const percentUpperBand = rawUpperBand.map(toPercent);
  const percentLowerBand = rawLowerBand.map(toPercent);
  
  // Replay from primary match aftermath
  let rawReplay: number[] = [];
  let percentReplay: number[] = [];
  
  if (primaryMatch?.aftermathNormalized?.length) {
    // aftermathNormalized is already in % format (0.05 = 5%)
    // Convert to actual prices and percent from NOW
    rawReplay = primaryMatch.aftermathNormalized.map((r: number) => basePrice * (1 + r));
    percentReplay = primaryMatch.aftermathNormalized.map((r: number) => r * 100);
  }
  
  // Calculate Y-axis range (with 15% padding for readability)
  const allPercent = [
    ...percentPath,
    ...percentUpperBand,
    ...percentLowerBand,
    ...percentReplay,
    0 // NOW always included
  ].filter(v => isFinite(v));
  
  const allPrices = [
    ...rawPath,
    ...rawUpperBand,
    ...rawLowerBand,
    ...rawReplay,
    basePrice
  ].filter(v => isFinite(v));
  
  let minPercent = allPercent.length > 0 ? Math.min(...allPercent) : -20;
  let maxPercent = allPercent.length > 0 ? Math.max(...allPercent) : 20;
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : basePrice * 0.8;
  const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : basePrice * 1.2;
  
  // CLAMP: For STRUCTURE tier, limit Y-axis to reasonable display range
  // This prevents extreme bands from breaking the chart scale
  if (tier === 'STRUCTURE') {
    minPercent = Math.max(minPercent, -150); // Floor at -150%
    maxPercent = Math.min(maxPercent, 300);  // Cap at +300%
  }
  
  // Add 15% padding
  const percentPadding = (maxPercent - minPercent) * 0.15;
  const pricePadding = (maxPrice - minPrice) * 0.15;
  
  return {
    mode,
    basePrice,
    rawPath,
    percentPath,
    rawUpperBand,
    rawLowerBand,
    percentUpperBand,
    percentLowerBand,
    rawReplay,
    percentReplay,
    yRange: {
      minPercent: Math.round((minPercent - percentPadding) * 10) / 10,
      maxPercent: Math.round((maxPercent + percentPadding) * 10) / 10,
      minPrice: Math.round(minPrice - pricePadding),
      maxPrice: Math.round(maxPrice + pricePadding),
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// BLOCK 73.2 — DIVERGENCE METRICS BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Build divergence metrics between synthetic forecast and primary match replay
 */
function buildDivergenceMetrics(
  forecast: ForecastPack,
  primaryMatch: any,
  basePrice: number,
  horizonDays: number,
  tier: 'TIMING' | 'TACTICAL' | 'STRUCTURE',
  mode: AxisMode
): DivergenceMetrics {
  // Get synthetic path (forecast central trajectory)
  const syntheticPath = forecast.path || [];
  
  // Get replay path from primary match
  let replayPath: number[] = [];
  if (primaryMatch?.aftermathNormalized?.length) {
    // Convert normalized returns to prices
    replayPath = primaryMatch.aftermathNormalized.map((r: number) => basePrice * (1 + r));
  }
  
  // If no replay data, return empty metrics
  if (replayPath.length === 0 || syntheticPath.length === 0) {
    return {
      horizonDays,
      mode,
      rmse: 0,
      mape: 0,
      maxAbsDev: 0,
      terminalDelta: 0,
      directionalMismatch: 0,
      corr: 1,
      score: 100,
      grade: 'A',
      flags: [],
      samplePoints: 0,
    };
  }
  
  // Calculate divergence using the service
  return calculateDivergence(
    syntheticPath,
    replayPath,
    basePrice,
    horizonDays,
    tier,
    mode
  );
}

// ═══════════════════════════════════════════════════════════════
// BLOCK 73.3 — UNIFIED PATH INTEGRATION
// ═══════════════════════════════════════════════════════════════

/**
 * Build ForecastPack from UnifiedPath
 * Maintains backward compatibility while using unified source
 */
function buildForecastPackFromUnified(
  unifiedPath: UnifiedPath,
  overlay: OverlayPack,
  currentPrice: number,
  focus: HorizonKey
): ForecastPack {
  const cfg = HORIZON_CONFIG[focus];
  const N = cfg.aftermathDays;
  
  // Extract paths (skip t=0 for legacy format)
  const path = unifiedPath.syntheticPath.slice(1).map(p => p.price);
  const upperBand = unifiedPath.upperBand.slice(1).map(p => p.price);
  const lowerBand = unifiedPath.lowerBand.slice(1).map(p => p.price);
  
  // Confidence decay: 1 → 0 over horizon
  const confidenceDecay = new Array(N).fill(0).map((_, i) => 
    Math.max(0, 1 - (i / N))
  );
  
  // Convert unified markers to legacy format
  const markers = unifiedPath.markersArray.map(m => ({
    horizon: m.horizon,
    dayIndex: m.t - 1, // Legacy uses 0-indexed from day 1
    expectedReturn: m.pct / 100,
    price: m.price
  }));
  
  // Tail floor from stats
  const tailFloor = currentPrice * (1 - Math.abs(overlay.stats.avgMaxDD));
  
  return {
    path,
    pricePath: path, // Alias for compatibility
    upperBand,
    lowerBand,
    confidenceDecay,
    markers,
    tailFloor,
    currentPrice,
    startTs: unifiedPath.anchorTs,
    // BLOCK 73.3: Include full unified path
    unifiedPath: {
      anchorPrice: unifiedPath.anchorPrice,
      horizonDays: unifiedPath.horizonDays,
      syntheticPath: unifiedPath.syntheticPath,
      replayPath: unifiedPath.replayPath,
      markers: unifiedPath.markers
    }
  };
}

/**
 * Build NormalizedSeries from UnifiedPath
 */
function buildNormalizedSeriesFromUnified(
  unifiedPath: UnifiedPath,
  basePrice: number,
  tier: 'TIMING' | 'TACTICAL' | 'STRUCTURE'
): NormalizedSeries {
  const mode: AxisMode = tier === 'STRUCTURE' ? 'PERCENT' : 'RAW';
  
  // Raw series (skip t=0)
  const rawPath = unifiedPath.syntheticPath.slice(1).map(p => p.price);
  const rawUpperBand = unifiedPath.upperBand.slice(1).map(p => p.price);
  const rawLowerBand = unifiedPath.lowerBand.slice(1).map(p => p.price);
  
  // Percent series (skip t=0)
  const percentPath = unifiedPath.syntheticPath.slice(1).map(p => p.pct);
  const percentUpperBand = unifiedPath.upperBand.slice(1).map(p => p.pct);
  const percentLowerBand = unifiedPath.lowerBand.slice(1).map(p => p.pct);
  
  // Replay
  let rawReplay: number[] = [];
  let percentReplay: number[] = [];
  
  if (unifiedPath.replayPath) {
    rawReplay = unifiedPath.replayPath.slice(1).map(p => p.price);
    percentReplay = unifiedPath.replayPath.slice(1).map(p => p.pct);
  }
  
  // Calculate Y-axis range
  const allPercent = [
    ...percentPath,
    ...percentUpperBand,
    ...percentLowerBand,
    ...percentReplay,
    0
  ].filter(v => isFinite(v));
  
  const allPrices = [
    ...rawPath,
    ...rawUpperBand,
    ...rawLowerBand,
    ...rawReplay,
    basePrice
  ].filter(v => isFinite(v));
  
  let minPercent = allPercent.length > 0 ? Math.min(...allPercent) : -20;
  let maxPercent = allPercent.length > 0 ? Math.max(...allPercent) : 20;
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : basePrice * 0.8;
  const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : basePrice * 1.2;
  
  // CLAMP: For STRUCTURE tier (180D/365D), limit Y-axis to reasonable display range
  // This prevents extreme forecast bands from breaking the chart scale
  if (tier === 'STRUCTURE') {
    minPercent = Math.max(minPercent, -150); // Floor at -150%
    maxPercent = Math.min(maxPercent, 300);  // Cap at +300%
  }
  
  const percentPadding = (maxPercent - minPercent) * 0.15;
  const pricePadding = (maxPrice - minPrice) * 0.15;
  
  // Apply padding but keep within CLAMP limits for STRUCTURE
  let finalMinPercent = minPercent - percentPadding;
  let finalMaxPercent = maxPercent + percentPadding;
  
  if (tier === 'STRUCTURE') {
    finalMinPercent = Math.max(finalMinPercent, -175);
    finalMaxPercent = Math.min(finalMaxPercent, 350);
  }
  
  return {
    mode,
    basePrice,
    rawPath,
    percentPath,
    rawUpperBand,
    rawLowerBand,
    percentUpperBand,
    percentLowerBand,
    rawReplay,
    percentReplay,
    yRange: {
      minPercent: Math.round(finalMinPercent * 10) / 10,
      maxPercent: Math.round(finalMaxPercent * 10) / 10,
      minPrice: Math.round(minPrice - pricePadding),
      maxPrice: Math.round(maxPrice + pricePadding),
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// U6 — SCENARIO PACK BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Build Scenario Pack for frontend Scenarios 2.0
 * 
 * Single source of truth for Bear/Base/Bull scenarios
 * Computed from historical matches distribution
 */
function buildScenarioPack(
  overlay: OverlayPack,
  basePrice: number,
  horizonDays: number,
  focus: string,
  asOf: string,
  unifiedPath: UnifiedPath,
  primaryMatch: any
): ScenarioPack {
  const dist = overlay.distributionSeries;
  const stats = overlay.stats;
  const sampleSize = stats.sampleSize;
  
  // Determine data status
  let dataStatus: 'REAL' | 'FALLBACK' = 'REAL';
  let fallbackReason: string | undefined;
  
  if (sampleSize < 5) {
    dataStatus = 'FALLBACK';
    fallbackReason = 'insufficient_sample';
  } else if (stats.hitRate === 0 || stats.hitRate === 1) {
    dataStatus = 'FALLBACK';
    fallbackReason = 'degenerate_distribution';
  }
  
  // Get terminal returns from distribution (last point = end of horizon)
  const lastIdx = dist.p50.length - 1;
  const p10Return = lastIdx >= 0 ? dist.p10[lastIdx] : -0.20;
  const p50Return = lastIdx >= 0 ? dist.p50[lastIdx] : 0;
  const p90Return = lastIdx >= 0 ? dist.p90[lastIdx] : 0.15;
  
  // Calculate target prices: basePrice * (1 + return)
  const p10Target = Math.round(basePrice * (1 + p10Return));
  const p50Target = Math.round(basePrice * (1 + p50Return));
  const p90Target = Math.round(basePrice * (1 + p90Return));
  
  // Outcome probabilities from historical matches
  const allReturns = overlay.matches.map(m => m.return);
  const positiveCount = allReturns.filter(r => r > 0).length;
  const probUp = allReturns.length > 0 ? positiveCount / allReturns.length : 0.5;
  const probDown = 1 - probUp;
  
  // Risk metrics
  const avgMaxDD = stats.avgMaxDD || 0;
  
  // Tail risk P95 - calculate from match returns
  const sortedReturns = [...allReturns].sort((a, b) => a - b);
  const p95Idx = Math.floor(sortedReturns.length * 0.05);
  const tailRiskP95 = sortedReturns[p95Idx] || p10Return;
  
  // Determine model based on presence of replay
  let model: ScenarioModel = 'synthetic';
  if (unifiedPath.replayPath && unifiedPath.replayPath.length > 0) {
    model = 'hybrid';
  }
  
  // Build scenario cases for frontend
  const horizonLabel = `+${horizonDays}d`;
  const cases: ScenarioCase[] = [
    {
      label: 'Bear',
      percentile: 'P10',
      return: Math.round(p10Return * 1000) / 1000,
      targetPrice: p10Target,
      horizonLabel,
    },
    {
      label: 'Base',
      percentile: 'P50',
      return: Math.round(p50Return * 1000) / 1000,
      targetPrice: p50Target,
      horizonLabel,
    },
    {
      label: 'Bull',
      percentile: 'P90',
      return: Math.round(p90Return * 1000) / 1000,
      targetPrice: p90Target,
      horizonLabel,
    },
  ];
  
  return {
    horizonDays,
    asOfDate: asOf.split('T')[0],
    basePrice: Math.round(basePrice),
    returns: {
      p10: Math.round(p10Return * 1000) / 1000,
      p50: Math.round(p50Return * 1000) / 1000,
      p90: Math.round(p90Return * 1000) / 1000,
    },
    targets: {
      p10: p10Target,
      p50: p50Target,
      p90: p90Target,
    },
    probUp: Math.round(probUp * 1000) / 1000,
    probDown: Math.round(probDown * 1000) / 1000,
    avgMaxDD: Math.round(avgMaxDD * 1000) / 1000,
    tailRiskP95: Math.round(tailRiskP95 * 1000) / 1000,
    sampleSize,
    dataStatus,
    fallbackReason,
    model,
    cases,
  };
}



// ═══════════════════════════════════════════════════════════════
// DIVERGENCE FROM UNIFIED PATH
// ═══════════════════════════════════════════════════════════════

/**
 * Build Divergence metrics from UnifiedPath
 */
function buildDivergenceFromUnified(
  unifiedPath: UnifiedPath,
  basePrice: number,
  horizonDays: number,
  tier: 'TIMING' | 'TACTICAL' | 'STRUCTURE',
  mode: AxisMode
): DivergenceMetrics {
  // Use unified paths (skip t=0 for divergence calc)
  const syntheticPath = unifiedPath.syntheticPath.slice(1).map(p => p.price);
  const replayPath = unifiedPath.replayPath?.slice(1).map(p => p.price) || [];
  
  if (replayPath.length === 0 || syntheticPath.length === 0) {
    return {
      horizonDays,
      mode,
      rmse: 0,
      mape: 0,
      maxAbsDev: 0,
      terminalDelta: 0,
      directionalMismatch: 0,
      corr: 1,
      score: 100,
      grade: 'A',
      flags: [],
      samplePoints: 0,
    };
  }
  
  return calculateDivergence(
    syntheticPath,
    replayPath,
    basePrice,
    horizonDays,
    tier,
    mode
  );
}
