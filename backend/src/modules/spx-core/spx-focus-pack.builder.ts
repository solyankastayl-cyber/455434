/**
 * SPX CORE — Focus Pack Builder
 * 
 * BLOCK B5.2.5 — Complete Focus Pack Assembly
 * P3-A: Runtime-config integration for SPX Lifecycle
 * 
 * Builds complete SPX focus-pack for a given horizon.
 * Now reads runtime config from MongoDB (asset-aware).
 */

import { spxCandlesService, type SpxCandle } from './spx-candles.service.js';
import { normalizeSeries } from './spx-normalize.js';
import { scanSpxMatchesForWindow, type SpxRawMatch, type SpxScanConfig } from './spx-scan.service.js';
import { buildReplayPath, buildSyntheticPath, buildDistributionSeries, type PathPoint, type ReplayPath, type SyntheticPath } from './spx-replay.service.js';
import { selectPrimaryMatch, getHorizonTier, type SpxPrimaryMatch, type SpxPrimarySelectionResult, type SpxHorizonTier } from './spx-primary-selector.service.js';
import { calculateDivergence, type SpxDivergenceMetrics, type SpxAxisMode } from './spx-divergence.service.js';
import { detectPhaseFromCloses, type SpxPhase, type SpxPhaseResult } from './spx-phase.service.js';
import { SPX_HORIZON_CONFIG, type SpxHorizonKey, type SpxHorizonConfig, isValidSpxHorizon } from './spx-horizon.config.js';
// P3-A: Import runtime config for SPX
import { getRuntimeEngineConfig, type RuntimeEngineConfig } from '../fractal/config/runtime-config.service.js';
// P5.1: Import confidence adjustment for health-based modifier
import { applyConfidenceAdjustment, getConfidenceWithSamplesGate, type ConfidenceBlock } from '../health/confidence_adjuster.util.js';
import { HealthStore } from '../health/model_health.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface SpxFocusPackMeta {
  symbol: 'SPX';
  focus: SpxHorizonKey;
  windowLen: number;
  aftermathDays: number;
  topK: number;
  tier: SpxHorizonTier;
  asOf: string;
  // P3-A: Runtime config tracking
  configSource: 'mongo' | 'static';
  modelVersion?: string;
  // P5.1: Health-based confidence adjustment
  confidence?: ConfidenceBlock;
}

export interface SpxOverlayMatch {
  id: string;
  similarity: number;
  correlation: number;
  phase: SpxPhase;
  volatilityMatch: number;
  stabilityScore: number;
  windowNormalized: number[];
  aftermathNormalized: number[];
  return: number;
  maxDrawdown: number;
  maxExcursion: number;
  cohort: string;
}

export interface SpxOverlayPack {
  currentWindow: {
    raw: number[];
    normalized: number[];
    timestamps: number[];
  };
  matches: SpxOverlayMatch[];
  distributionSeries: {
    p10: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p90: number[];
  };
  stats: {
    medianReturn: number;
    p10Return: number;
    p90Return: number;
    avgMaxDD: number;
    hitRate: number;
    sampleSize: number;
  };
}

export interface SpxForecastPack {
  path: number[];
  upperBand: number[];
  lowerBand: number[];
  confidenceDecay: number[];
  markers: Array<{
    horizon: string;
    dayIndex: number;
    expectedReturn: number;
    price: number;
  }>;
  tailFloor: number;
  currentPrice: number;
  startTs: number;
}

export interface SpxPrimarySelection {
  primaryMatch: SpxPrimaryMatch | null;
  candidateCount: number;
  selectionMethod: string;
}

export interface SpxNormalizedSeries {
  mode: SpxAxisMode;
  basePrice: number;
  rawPath: number[];
  percentPath: number[];
  rawUpperBand: number[];
  rawLowerBand: number[];
  percentUpperBand: number[];
  percentLowerBand: number[];
  rawReplay: number[];
  percentReplay: number[];
  yRange: {
    minPercent: number;
    maxPercent: number;
    minPrice: number;
    maxPrice: number;
  };
}

export interface SpxFocusPackDiagnostics {
  sampleSize: number;
  effectiveN: number;
  entropy: number;
  reliability: number;
  coverageYears: number;
  qualityScore: number;
  scanTimeMs: number;
  totalTimeMs: number;
}

export interface SpxFocusPack {
  meta: SpxFocusPackMeta;
  price: {
    current: number;
    sma50: number;
    sma200: number;
    change1d: number;
    change7d: number;
    change30d: number;
  };
  phase: SpxPhaseResult;
  overlay: SpxOverlayPack;
  forecast: SpxForecastPack;
  primarySelection: SpxPrimarySelection;
  normalizedSeries: SpxNormalizedSeries;
  divergence: SpxDivergenceMetrics;
  diagnostics: SpxFocusPackDiagnostics;
}

// ═══════════════════════════════════════════════════════════════
// FOCUS PACK BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Build complete SPX Focus Pack for a given horizon
 * P3-A: Now uses runtime config from MongoDB
 */
export async function buildSpxFocusPack(focus: SpxHorizonKey): Promise<SpxFocusPack> {
  const t0 = Date.now();
  
  // Validate horizon
  if (!isValidSpxHorizon(focus)) {
    throw new Error(`Invalid SPX horizon: ${focus}`);
  }
  
  // P3-A: Get runtime config for SPX (from MongoDB or static fallback)
  const runtimeConfig = await getRuntimeEngineConfig('SPX');
  
  // Use new resolveWindowLenForHorizon which respects strategy
  const { resolveWindowLenForHorizon } = await import('../fractal/config/runtime-config.service.js');
  const windowLen = resolveWindowLenForHorizon(runtimeConfig, focus);
  
  // Merge runtime config with static horizon config
  // windowLen comes from resolveWindowLenForHorizon (respects HorizonPolicy)
  // topK can be overridden by runtime config
  const staticConfig = SPX_HORIZON_CONFIG[focus];
  const config = {
    ...staticConfig,
    windowLen,
    topK: runtimeConfig.topK ?? staticConfig.topK,
  };
  
  const tier = getHorizonTier(focus);
  const asOf = new Date().toISOString();
  
  // Get all candles
  const allCandles = await spxCandlesService.getAllCandles();
  
  if (allCandles.length < config.minHistory) {
    throw new Error(`INSUFFICIENT_DATA: need ${config.minHistory}, got ${allCandles.length}`);
  }
  
  const allCloses = allCandles.map(c => c.c);
  const allTimestamps = allCandles.map(c => c.t);
  
  // Current price info
  const latest = allCandles[allCandles.length - 1];
  const currentPrice = latest.c;
  
  // Calculate SMAs
  const sma50 = computeSMA(allCloses, 50);
  const sma200 = computeSMA(allCloses, Math.min(200, allCloses.length));
  
  // Price changes
  const price1dAgo = allCloses.length > 1 ? allCloses[allCloses.length - 2] : currentPrice;
  const price7dAgo = allCloses.length > 7 ? allCloses[allCloses.length - 8] : currentPrice;
  const price30dAgo = allCloses.length > 30 ? allCloses[allCloses.length - 31] : currentPrice;
  
  const change1d = ((currentPrice - price1dAgo) / price1dAgo) * 100;
  const change7d = ((currentPrice - price7dAgo) / price7dAgo) * 100;
  const change30d = ((currentPrice - price30dAgo) / price30dAgo) * 100;
  
  // Get current window (P3-A: uses runtime windowLen)
  const windowCandles = allCandles.slice(-config.windowLen);
  const currentWindowRaw = windowCandles.map(c => c.c);
  const currentWindowNormalized = normalizeSeries(currentWindowRaw);
  const currentWindowTimestamps = windowCandles.map(c => c.t);
  
  // Detect current phase
  const phaseResult = detectPhaseFromCloses(allCloses.slice(-200));
  
  // Scan for matches (P3-A: uses runtime topK)
  const scanConfig: Partial<SpxScanConfig> = {
    windowLen: config.windowLen,
    aftermathDays: config.aftermathDays,
    minSimilarity: 50,
    maxMatches: config.topK * 2,
    excludeRecentDays: config.aftermathDays + 10,
  };
  
  const scanResult = await scanSpxMatchesForWindow(currentWindowRaw, scanConfig);
  const scanTimeMs = scanResult.processingTimeMs;
  
  // Process matches (P3-A: uses runtime topK)
  const processedMatches: SpxOverlayMatch[] = scanResult.matches.slice(0, config.topK).map(m => ({
    id: m.id,
    similarity: m.similarity,
    correlation: m.correlation,
    phase: detectPhaseAtIndex(allCloses, findIndexByDate(allCandles, m.id)),
    volatilityMatch: calculateVolatilityMatch(currentWindowRaw, m.windowNormalized.map((n, i) => currentWindowRaw[0] * (1 + n))),
    stabilityScore: calculateStabilityScore(m),
    windowNormalized: m.windowNormalized,
    aftermathNormalized: m.aftermathNormalized,
    return: m.return,
    maxDrawdown: m.maxDrawdown,
    maxExcursion: m.maxExcursion,
    cohort: m.cohort,
  }));
  
  // Build distribution series
  const rawMatches = scanResult.matches.slice(0, config.topK);
  const distributionSeries = buildDistributionSeries(rawMatches, config.aftermathDays);
  
  // Calculate overlay stats
  const returns = processedMatches.map(m => m.return);
  const overlayStats = {
    medianReturn: percentile(returns, 0.5),
    p10Return: percentile(returns, 0.1),
    p90Return: percentile(returns, 0.9),
    avgMaxDD: processedMatches.reduce((s, m) => s + m.maxDrawdown, 0) / (processedMatches.length || 1),
    hitRate: returns.filter(r => r > 0).length / (returns.length || 1),
    sampleSize: processedMatches.length,
  };
  
  // Build overlay pack
  const overlay: SpxOverlayPack = {
    currentWindow: {
      raw: currentWindowRaw,
      normalized: currentWindowNormalized,
      timestamps: currentWindowTimestamps,
    },
    matches: processedMatches,
    distributionSeries,
    stats: overlayStats,
  };
  
  // Select primary match
  const selectionResult = selectPrimaryMatch(rawMatches, focus);
  const primarySelection: SpxPrimarySelection = {
    primaryMatch: selectionResult.primaryMatch,
    candidateCount: selectionResult.candidateCount,
    selectionMethod: selectionResult.selectionMethod,
  };
  
  // Build forecast pack
  const syntheticPath = buildSyntheticPath(rawMatches, currentPrice, config.aftermathDays);
  const forecast = buildForecastPack(syntheticPath, overlay, currentPrice, focus, config);
  
  // Build normalized series
  const mode: SpxAxisMode = tier === 'STRUCTURE' ? 'PERCENT' : 'RAW';
  const normalizedSeries = buildNormalizedSeries(
    syntheticPath,
    selectionResult.primaryMatch,
    currentPrice,
    mode
  );
  
  // Calculate divergence
  let divergence: SpxDivergenceMetrics;
  if (selectionResult.primaryMatch) {
    const replayPath = buildReplayPath(selectionResult.primaryMatch, currentPrice, config.aftermathDays);
    divergence = calculateDivergence(
      syntheticPath.points.map(p => p.price),
      replayPath.points.map(p => p.price),
      currentPrice,
      config.aftermathDays,
      tier,
      mode
    );
  } else {
    divergence = {
      horizonDays: config.aftermathDays,
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
  
  // Build diagnostics
  const diagnostics = buildDiagnostics(
    processedMatches,
    allCandles.length,
    scanTimeMs,
    Date.now() - t0
  );
  
  // P5.1: Get health state and apply confidence adjustment
  const healthState = await HealthStore.getState('SPX');
  const baseConfidence = overlay.stats.hitRate || 0.5;
  const healthGrade = healthState?.grade || 'HEALTHY';
  const healthReasons = healthState?.reasons || [];
  const confidenceBlock = getConfidenceWithSamplesGate(baseConfidence, healthGrade, healthReasons);
  
  return {
    meta: {
      symbol: 'SPX',
      focus,
      windowLen: config.windowLen,
      aftermathDays: config.aftermathDays,
      topK: config.topK,
      tier,
      asOf,
      // P3-A: Runtime config tracking
      configSource: runtimeConfig.source,
      modelVersion: runtimeConfig.version,
      // P5.1: Health-based confidence
      confidence: confidenceBlock,
    },
    price: {
      current: currentPrice,
      sma50,
      sma200,
      change1d: round(change1d, 2),
      change7d: round(change7d, 2),
      change30d: round(change30d, 2),
    },
    phase: phaseResult,
    overlay,
    forecast,
    primarySelection,
    normalizedSeries,
    divergence,
    diagnostics,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function computeSMA(prices: number[], period: number): number {
  if (prices.length < period) {
    return prices.length > 0 ? prices[prices.length - 1] : 0;
  }
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[Math.min(idx, sorted.length - 1)];
}

function round(value: number, decimals: number): number {
  const mult = Math.pow(10, decimals);
  return Math.round(value * mult) / mult;
}

function findIndexByDate(candles: SpxCandle[], dateStr: string): number {
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].date === dateStr) return i;
  }
  return -1;
}

function detectPhaseAtIndex(closes: number[], index: number): SpxPhase {
  if (index < 50 || index < 0) return 'NEUTRAL';
  
  const windowCloses = closes.slice(Math.max(0, index - 200), index + 1);
  const result = detectPhaseFromCloses(windowCloses);
  return result.phase;
}

function calculateVolatilityMatch(series1: number[], series2: number[]): number {
  const vol1 = calculateVolatility(series1);
  const vol2 = calculateVolatility(series2);
  if (vol1 === 0 && vol2 === 0) return 1;
  if (vol1 === 0 || vol2 === 0) return 0;
  return Math.min(vol1, vol2) / Math.max(vol1, vol2);
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

function calculateStabilityScore(match: SpxRawMatch): number {
  const ret = Math.abs(match.return);
  const dd = match.maxDrawdown;
  if (ret === 0 && dd === 0) return 0.5;
  if (dd === 0) return 1;
  const ratio = ret / (dd + 1);
  return Math.min(1, ratio / 3);
}

function buildForecastPack(
  syntheticPath: SyntheticPath,
  overlay: SpxOverlayPack,
  currentPrice: number,
  focus: SpxHorizonKey,
  config: SpxHorizonConfig
): SpxForecastPack {
  const N = config.aftermathDays;
  
  // Extract paths (skip t=0)
  const path = syntheticPath.points.slice(1).map(p => p.price);
  const upperBand = syntheticPath.bands.upper.slice(1).map(p => p.price);
  const lowerBand = syntheticPath.bands.lower.slice(1).map(p => p.price);
  
  // Confidence decay
  const confidenceDecay = new Array(N).fill(0).map((_, i) => 
    Math.max(0, 1 - (i / N))
  );
  
  // Build markers
  const focusDays = config.days;
  const horizons = ['7d', '14d', '30d', '90d', '180d', '365d'];
  const markers: SpxForecastPack['markers'] = [];
  
  for (const h of horizons) {
    const days = parseInt(h.replace('d', ''), 10);
    if (days > focusDays) continue;
    if (days > overlay.distributionSeries.p50.length) continue;
    
    const dayIndex = Math.min(days - 1, overlay.distributionSeries.p50.length - 1);
    const expectedReturn = overlay.distributionSeries.p50[dayIndex] || 0;
    
    markers.push({
      horizon: h,
      dayIndex,
      expectedReturn,
      price: currentPrice * (1 + expectedReturn),
    });
  }
  
  // Tail floor
  const tailFloor = currentPrice * (1 - Math.abs(overlay.stats.avgMaxDD / 100));
  
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

function buildNormalizedSeries(
  syntheticPath: SyntheticPath,
  primaryMatch: SpxPrimaryMatch | null,
  basePrice: number,
  mode: SpxAxisMode
): SpxNormalizedSeries {
  // Raw series (skip t=0)
  const rawPath = syntheticPath.points.slice(1).map(p => p.price);
  const rawUpperBand = syntheticPath.bands.upper.slice(1).map(p => p.price);
  const rawLowerBand = syntheticPath.bands.lower.slice(1).map(p => p.price);
  
  // Percent series
  const percentPath = syntheticPath.points.slice(1).map(p => p.pct);
  const percentUpperBand = syntheticPath.bands.upper.slice(1).map(p => p.pct);
  const percentLowerBand = syntheticPath.bands.lower.slice(1).map(p => p.pct);
  
  // Replay from primary match
  let rawReplay: number[] = [];
  let percentReplay: number[] = [];
  
  if (primaryMatch?.aftermathNormalized?.length) {
    rawReplay = primaryMatch.aftermathNormalized.map(r => basePrice * (1 + r));
    percentReplay = primaryMatch.aftermathNormalized.map(r => r * 100);
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
  
  const minPercent = allPercent.length > 0 ? Math.min(...allPercent) : -20;
  const maxPercent = allPercent.length > 0 ? Math.max(...allPercent) : 20;
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : basePrice * 0.8;
  const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : basePrice * 1.2;
  
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
      minPercent: round(minPercent - percentPadding, 1),
      maxPercent: round(maxPercent + percentPadding, 1),
      minPrice: Math.round(minPrice - pricePadding),
      maxPrice: Math.round(maxPrice + pricePadding),
    },
  };
}

function buildDiagnostics(
  matches: SpxOverlayMatch[],
  totalCandles: number,
  scanTimeMs: number,
  totalTimeMs: number
): SpxFocusPackDiagnostics {
  const sampleSize = matches.length;
  const effectiveN = Math.min(sampleSize, 25);
  
  // Calculate entropy from return distribution
  const returns = matches.map(m => m.return);
  const positiveCount = returns.filter(r => r > 0).length;
  const winRate = positiveCount / (returns.length || 1);
  const entropy = 1 - Math.abs(2 * winRate - 1);
  
  // Reliability
  const reliability = Math.min(1, (effectiveN / 20)) * (1 - entropy * 0.3);
  
  // Coverage in years
  const coverageYears = totalCandles / 252; // Trading days per year
  
  // Quality score
  const qualityScore = Math.min(1, 
    (sampleSize >= 10 ? 0.3 : sampleSize * 0.03) +
    (reliability * 0.4) +
    (coverageYears >= 10 ? 0.3 : coverageYears * 0.03)
  );
  
  return {
    sampleSize,
    effectiveN,
    entropy: round(entropy, 3),
    reliability: round(reliability, 3),
    coverageYears: round(coverageYears, 1),
    qualityScore: round(qualityScore, 3),
    scanTimeMs,
    totalTimeMs,
  };
}

export default { buildSpxFocusPack };
