/**
 * BLOCK 36.0-36.3 — Fractal Engine V2
 * 
 * V2 Features:
 * - Pattern Age Decay (36.1)
 * - Regime-Conditioned Similarity (36.2)
 * - Dynamic Similarity Floor + Temporal Dispersion (36.3)
 * - Backward compatible with V1 (features disabled by default)
 * 
 * V1 endpoints continue to work unchanged.
 * V2 endpoints enable new features.
 */

import { CanonicalStore } from '../data/canonical.store.js';
import { SimilarityEngine, buildWindowVector, SimilarityMode } from './similarity.engine.js';
import { ForwardStatsCalculator, Outcome } from './forward.stats.js';
import { WindowIndex, WindowLen, WindowVec } from './window.index.js';
import { ExplainabilityEngine } from './explainability.engine.js';
import { WindowStore } from '../data/window.store.js';
import { FeatureExtractor } from './feature.extractor.js';
import {
  FractalMatchRequest,
  FractalMatchResponse
} from '../contracts/fractal.contracts.js';
import {
  FRACTAL_SYMBOL,
  FRACTAL_TIMEFRAME,
  FORWARD_HORIZON_DAYS,
  TOP_K_MATCHES,
  WINDOW_SIZES,
  MIN_GAP_DAYS
} from '../domain/constants.js';

// V2 Imports
import { applyAgeDecay, AgeDecayConfig, DEFAULT_AGE_DECAY } from './age-decay.js';
import { 
  classifyRegime, 
  filterByRegime, 
  computeRegimeFeatures,
  RegimeKey,
  RegimeConditionedConfig,
  DEFAULT_REGIME_CONFIG
} from './regime-conditioned.js';
// BLOCK 36.3: Match filters
import {
  applyDynamicFloor,
  enforceTemporalDispersion,
  analyzeMatchDistribution,
  DynamicFloorConfig,
  DispersionConfig,
  DynamicFloorStats,
  DispersionStats,
} from './match-filters.js';
import { V1_FINAL_CONFIG, V2_EXPERIMENTAL_CONFIG } from '../config/fractal.presets.js';

const EPS = 1e-12;

/**
 * Extended match request for V2 features
 */
export interface FractalMatchRequestV2 extends FractalMatchRequest {
  // V2 Feature flags (36.1-36.2)
  ageDecayEnabled?: boolean;
  ageDecayLambda?: number;
  regimeConditioned?: boolean;
  regimeFallbackEnabled?: boolean;
  
  // BLOCK 36.3: Dynamic Floor + Dispersion
  useDynamicFloor?: boolean;
  dynamicQuantile?: number;
  useTemporalDispersion?: boolean;
  maxMatchesPerYear?: number;
  
  // Version selector
  version?: 1 | 2;
}

/**
 * Extended match response for V2
 */
export interface FractalMatchResponseV2 extends FractalMatchResponse {
  // V2 metadata
  v2?: {
    version: number;
    ageDecay: {
      enabled: boolean;
      lambda: number;
    };
    regime: {
      enabled: boolean;
      currentRegime: RegimeKey;
      matchedRegimes: Record<RegimeKey, number>;
    };
    // BLOCK 36.3: Filter stats
    dynamicFloor?: DynamicFloorStats;
    dispersion?: DispersionStats;
    matchDistribution?: {
      byYear: Record<number, { count: number; avgSimilarity: number }>;
      concentrationScore: number;
      dominantYear: number | null;
      dominantYearPct: number;
    };
    matchesWithDecay?: Array<{
      startTs: Date;
      endTs: Date;
      rawScore: number;
      ageWeight: number;
      finalScore: number;
      ageYears: number;
      regimeKey?: RegimeKey;
    }>;
  };
}

/**
 * Historical window with V2 metadata
 */
interface HistoricalWindow {
  endIdx: number;
  score: number;
  similarity: number;  // alias for score (for filter functions)
  startTs: Date;
  endTs: Date;
  regimeKey?: RegimeKey;
}

export class FractalEngineV2 {
  private canonicalStore = new CanonicalStore();
  private sim = new SimilarityEngine();
  private statsCalculator = new ForwardStatsCalculator();
  private index = new WindowIndex();
  private explainability = new ExplainabilityEngine();
  
  private windowStore = new WindowStore();
  private featureExtractor = new FeatureExtractor();

  private cache: {
    loadedAt: number;
    ts: Date[];
    closes: number[];
    quality: number[];
    // V2: Regime labels per window
    regimeLabels?: Map<number, RegimeKey>;
  } | null = null;

  private CACHE_TTL_MS = 60 * 60 * 1000;

  /**
   * V2 Match endpoint with age decay and regime conditioning
   */
  async matchV2(request: FractalMatchRequestV2): Promise<FractalMatchResponseV2> {
    const symbol = request.symbol || FRACTAL_SYMBOL;
    const timeframe = request.timeframe || FRACTAL_TIMEFRAME;
    const windowLen = request.windowLen || 60;
    const topK = request.topK || TOP_K_MATCHES;
    const horizonDays = request.forwardHorizon || FORWARD_HORIZON_DAYS;
    const minGapDays = MIN_GAP_DAYS;
    const asOf = request.asOf ? new Date(request.asOf) : undefined;
    const similarityMode: SimilarityMode = request.similarityMode ?? "raw_returns";
    
    // V2 config from request or defaults
    const version = request.version ?? 2;
    const config = version === 1 ? V1_FINAL_CONFIG : V2_EXPERIMENTAL_CONFIG;
    
    const ageDecayConfig: AgeDecayConfig = {
      enabled: request.ageDecayEnabled ?? config.ageDecayEnabled,
      lambda: request.ageDecayLambda ?? config.ageDecayLambda,
    };
    
    const regimeConfig: RegimeConditionedConfig = {
      enabled: request.regimeConditioned ?? config.regimeConditioned,
      fallbackEnabled: request.regimeFallbackEnabled ?? true,
      minMatchesBeforeFallback: 18,
    };

    // Validate window size
    if (!WINDOW_SIZES.includes(windowLen as 30 | 60 | 90)) {
      throw new Error(`Invalid window size. Must be one of: ${WINDOW_SIZES.join(', ')}`);
    }

    // Ensure cache is loaded
    await this.ensureCache(symbol, timeframe, horizonDays, windowLen);

    let { ts, closes } = this.cache!;
    const asOfTs = asOf?.getTime() ?? Date.now();

    // asOf filter for look-ahead protection
    let asOfEndIdx = closes.length - 1;
    if (asOf) {
      asOfEndIdx = this.findIndexByTs(ts, asOf);
      if (asOfEndIdx >= 0 && ts[asOfEndIdx].getTime() > asOfTs) {
        asOfEndIdx--;
      }
      if (asOfEndIdx < windowLen + horizonDays + 5) {
        return this.emptyResponseV2(windowLen, timeframe, asOf, ageDecayConfig, regimeConfig);
      }
      ts = ts.slice(0, asOfEndIdx + 1);
      closes = closes.slice(0, asOfEndIdx + 1);
    }

    if (closes.length < windowLen + horizonDays + 5) {
      return this.emptyResponseV2(windowLen, timeframe, asOf, ageDecayConfig, regimeConfig);
    }

    // Build current window vector
    const currentCloses = closes.slice(-windowLen - 1);
    const currentVec = buildWindowVector(currentCloses, similarityMode);

    let curNorm = 0;
    for (let i = 0; i < currentVec.length; i++) curNorm += currentVec[i] * currentVec[i];
    curNorm = Math.sqrt(curNorm) || 1;

    const currentEndIdx = closes.length - 1;

    // V2: Compute current regime
    const currentRegimeFeatures = computeRegimeFeatures(currentCloses);
    const currentRegime = classifyRegime(currentRegimeFeatures);

    // Build historical candidates
    const candidates: HistoricalWindow[] = [];
    
    const minHistIdx = windowLen;
    const maxHistIdx = closes.length - 1 - minGapDays;
    const effectiveMaxIdx = asOf 
      ? Math.min(maxHistIdx, asOfEndIdx - horizonDays)
      : maxHistIdx;

    for (let endIdx = minHistIdx; endIdx <= effectiveMaxIdx; endIdx++) {
      const distanceDays = Math.abs(currentEndIdx - endIdx);
      if (distanceDays < minGapDays) continue;

      const histCloses = closes.slice(endIdx - windowLen, endIdx + 1);
      const histVec = buildWindowVector(histCloses, similarityMode);

      let histNorm = 0;
      for (let i = 0; i < histVec.length; i++) histNorm += histVec[i] * histVec[i];
      histNorm = Math.sqrt(histNorm) || 1;

      let dot = 0;
      for (let i = 0; i < currentVec.length && i < histVec.length; i++) {
        dot += currentVec[i] * histVec[i];
      }
      const score = dot / (curNorm * histNorm + EPS);

      // V2: Compute regime for historical window
      const histRegimeFeatures = computeRegimeFeatures(histCloses);
      const histRegime = classifyRegime(histRegimeFeatures);

      candidates.push({
        endIdx,
        score,
        similarity: score,  // alias for filter functions
        startTs: ts[endIdx - windowLen],
        endTs: ts[endIdx],
        regimeKey: histRegime,
      });
    }

    // V2: Filter by regime (BLOCK 36.2)
    let filteredCandidates = regimeConfig.enabled
      ? filterByRegime(candidates, currentRegime, regimeConfig)
      : candidates;

    // BLOCK 36.3: Dynamic Similarity Floor
    const dynamicFloorConfig: DynamicFloorConfig = {
      enabled: request.useDynamicFloor ?? config.useDynamicFloor,
      staticFloor: config.minSimilarity,
      dynamicQuantile: request.dynamicQuantile ?? config.dynamicQuantile,
    };
    
    let dynamicFloorStats: DynamicFloorStats | undefined;
    if (dynamicFloorConfig.enabled) {
      const floorResult = applyDynamicFloor(filteredCandidates, dynamicFloorConfig);
      filteredCandidates = floorResult.filtered;
      dynamicFloorStats = floorResult.stats;
    }

    // V2: Apply age decay (BLOCK 36.1)
    const candidatesWithDecay = filteredCandidates.map(c => {
      const decay = applyAgeDecay(c.score, c.endTs, asOfTs, ageDecayConfig);
      return {
        ...c,
        rawScore: c.score,
        ageWeight: decay.ageWeight,
        finalScore: decay.finalScore,
        ageYears: decay.ageYears,
      };
    });

    // Sort by finalScore (age-adjusted) instead of raw score
    candidatesWithDecay.sort((a, b) => b.finalScore - a.finalScore);
    
    // BLOCK 36.3: Temporal Dispersion (Anti-Clustering)
    const dispersionConfig: DispersionConfig = {
      enabled: request.useTemporalDispersion ?? config.useTemporalDispersion,
      maxPerYear: request.maxMatchesPerYear ?? config.maxMatchesPerYear,
    };
    
    let dispersionStats: DispersionStats | undefined;
    let topCandidates = candidatesWithDecay;
    
    if (dispersionConfig.enabled) {
      const dispersionResult = enforceTemporalDispersion(candidatesWithDecay, dispersionConfig);
      topCandidates = dispersionResult.dispersed;
      dispersionStats = dispersionResult.stats;
    }
    
    // Take top K after all filters
    const top = topCandidates.slice(0, topK);
    
    // Analyze final match distribution
    const matchDistribution = analyzeMatchDistribution(top);

    // Calculate forward outcomes
    const outcomes: Outcome[] = [];
    for (const m of top) {
      const o = this.statsCalculator.computeOutcomes(this.cache!.closes, m.endIdx, horizonDays);
      if (o) outcomes.push(o);
    }

    const agg = this.statsCalculator.aggregate(outcomes);
    const stability = Math.min(1, agg.sampleSize / Math.max(10, topK));

    // Count regime distribution in matches
    const regimeDistribution: Record<RegimeKey, number> = {
      BULL: 0, BEAR: 0, SIDE: 0, CRASH: 0, BUBBLE: 0
    };
    for (const m of top) {
      if (m.regimeKey) regimeDistribution[m.regimeKey]++;
    }

    const response: FractalMatchResponseV2 = {
      ok: true,
      asOf: asOf ?? ts[ts.length - 1],
      pattern: {
        windowLen,
        timeframe,
        representation: similarityMode as any,
      },
      matches: top.map((x, idx) => ({
        startTs: x.startTs,
        endTs: x.endTs,
        score: x.finalScore, // V2: use age-adjusted score
        rank: idx + 1,
      })),
      forwardStats: {
        horizonDays,
        return: agg.return,
        maxDrawdown: agg.maxDrawdown,
      },
      confidence: {
        sampleSize: agg.sampleSize,
        stabilityScore: stability,
      },
      safety: {
        excludedFromTraining: true,
        contextOnly: true,
        notes: ['V2 engine with age decay and regime conditioning'],
      },
      // V2 metadata
      v2: {
        version,
        ageDecay: {
          enabled: ageDecayConfig.enabled,
          lambda: ageDecayConfig.lambda,
        },
        regime: {
          enabled: regimeConfig.enabled,
          currentRegime,
          matchedRegimes: regimeDistribution,
        },
        // BLOCK 36.3: Filter stats
        dynamicFloor: dynamicFloorStats,
        dispersion: dispersionStats,
        matchDistribution,
        matchesWithDecay: top.map(x => ({
          startTs: x.startTs,
          endTs: x.endTs,
          rawScore: x.rawScore,
          ageWeight: x.ageWeight,
          finalScore: x.finalScore,
          ageYears: x.ageYears,
          regimeKey: x.regimeKey,
        })),
      },
    };

    return response;
  }

  /**
   * Backward compatible V1 match (calls engine without V2 features)
   */
  async match(request: FractalMatchRequest): Promise<FractalMatchResponse> {
    return this.matchV2({
      ...request,
      version: 1,
      ageDecayEnabled: false,
      regimeConditioned: false,
    });
  }

  // === Helper methods ===

  private async ensureCache(
    symbol: string, 
    timeframe: string, 
    horizonDays: number,
    windowLen: number = 60
  ): Promise<void> {
    const now = Date.now();
    if (this.cache && now - this.cache.loadedAt < this.CACHE_TTL_MS) {
      return;
    }

    const data = await this.canonicalStore.getAll(symbol, timeframe);
    if (!data.length) {
      throw new Error(`No data found for ${symbol}/${timeframe}`);
    }

    this.cache = {
      loadedAt: now,
      ts: data.map(d => d.ts),
      closes: data.map(d => d.ohlcv?.c ?? 0),
      quality: data.map(d => (d as any).quality?.qualityScore ?? 1),
    };
  }

  private findIndexByTs(ts: Date[], target: Date): number {
    const targetMs = target.getTime();
    let left = 0, right = ts.length - 1;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const midMs = ts[mid].getTime();
      if (midMs === targetMs) return mid;
      if (midMs < targetMs) left = mid + 1;
      else right = mid - 1;
    }
    return right;
  }

  private emptyResponseV2(
    windowLen: number,
    timeframe: string,
    asOf: Date | undefined,
    ageDecayConfig: AgeDecayConfig,
    regimeConfig: RegimeConditionedConfig
  ): FractalMatchResponseV2 {
    return {
      ok: true,
      asOf: asOf ?? new Date(),
      pattern: { windowLen, timeframe, representation: 'raw_returns' as any },
      matches: [],
      forwardStats: {
        horizonDays: FORWARD_HORIZON_DAYS,
        return: { mean: 0, p10: 0, p50: 0, p90: 0 },
        maxDrawdown: { p10: 0, p50: 0, p90: 0 },
      },
      confidence: { sampleSize: 0, stabilityScore: 0 },
      safety: {
        excludedFromTraining: true,
        contextOnly: true,
        notes: ['Empty response - insufficient data'],
      },
      v2: {
        version: 2,
        ageDecay: { enabled: ageDecayConfig.enabled, lambda: ageDecayConfig.lambda },
        regime: { enabled: regimeConfig.enabled, currentRegime: 'SIDE', matchedRegimes: { BULL: 0, BEAR: 0, SIDE: 0, CRASH: 0, BUBBLE: 0 } },
      },
    };
  }
}

// Export singleton
export const fractalEngineV2 = new FractalEngineV2();
