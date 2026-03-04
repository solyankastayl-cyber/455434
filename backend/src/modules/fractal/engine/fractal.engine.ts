/**
 * Main Fractal Engine Service - PRODUCTION VERSION
 * With in-memory window index for fast pattern matching
 * BLOCK 18: ML Feature persistence on match
 */

import { CanonicalStore } from '../data/canonical.store.js';
import { SimilarityEngine, buildWindowVector, SimilarityMode } from './similarity.engine.js';
import { ForwardStatsCalculator, Outcome } from './forward.stats.js';
import { WindowIndex, WindowLen, WindowVec } from './window.index.js';
import { ExplainabilityEngine, ExplainabilityResult } from './explainability.engine.js';
import { WindowStore } from '../data/window.store.js';
import { FeatureExtractor, VolReg, TrendReg } from './feature.extractor.js';
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

const EPS = 1e-12;

export class FractalEngine {
  private canonicalStore = new CanonicalStore();
  private sim = new SimilarityEngine();
  private statsCalculator = new ForwardStatsCalculator();
  private index = new WindowIndex();
  private explainability = new ExplainabilityEngine();
  
  // ML Feature Layer
  private windowStore = new WindowStore();
  private featureExtractor = new FeatureExtractor();

  // Cache
  private cache: {
    loadedAt: number;
    ts: Date[];
    closes: number[];
    quality: number[];
  } | null = null;

  private CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  private INDEX_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Main match endpoint
   * BLOCK 34.10: Added similarityMode for asOf-safe simulations
   */
  async match(request: FractalMatchRequest): Promise<FractalMatchResponse> {
    const symbol = request.symbol || FRACTAL_SYMBOL;
    const timeframe = request.timeframe || FRACTAL_TIMEFRAME;
    const windowLen = request.windowLen || 30;
    const topK = request.topK || TOP_K_MATCHES;
    const horizonDays = request.forwardHorizon || FORWARD_HORIZON_DAYS;
    const minGapDays = MIN_GAP_DAYS;
    const asOf = request.asOf ? new Date(request.asOf) : undefined;
    
    // BLOCK 34.10: Default to raw_returns for simulation (asOf-safe)
    const similarityMode: SimilarityMode = request.similarityMode ?? "raw_returns";
    
    // BLOCK 34.11: Flag to include series for relative signal
    const includeSeriesUsed = request.includeSeriesUsed ?? false;

    // Validate window size
    if (!WINDOW_SIZES.includes(windowLen as 30 | 60 | 90)) {
      throw new Error(`Invalid window size. Must be one of: ${WINDOW_SIZES.join(', ')}`);
    }

    // Ensure cache and index are up to date
    await this.ensureCache(symbol, timeframe, horizonDays);

    let { ts, closes } = this.cache!;

    // BLOCK 34.8.1: asOf filter for look-ahead protection
    // In simulation mode, we only see data <= asOf
    let asOfEndIdx = closes.length - 1;
    if (asOf) {
      const asOfTs = asOf.getTime();
      asOfEndIdx = this.findIndexByTs(ts, asOf);
      
      // Validate no look-ahead leak
      if (asOfEndIdx >= 0 && ts[asOfEndIdx].getTime() > asOfTs) {
        asOfEndIdx--;
      }
      
      if (asOfEndIdx < windowLen + horizonDays + 5) {
        return this.emptyResponse(windowLen, timeframe, asOf);
      }
      
      // Slice data up to asOf
      ts = ts.slice(0, asOfEndIdx + 1);
      closes = closes.slice(0, asOfEndIdx + 1);
    }

    if (closes.length < windowLen + horizonDays + 5) {
      return this.emptyResponse(windowLen, timeframe, asOf);
    }

    // BLOCK 34.10: Build current window vector using selected mode
    // Extract closes for current window (latest windowLen+1 closes to get windowLen returns)
    const currentCloses = closes.slice(-windowLen - 1);
    const currentVec = buildWindowVector(currentCloses, similarityMode);

    // Calculate current window norm for cosine
    let curNorm = 0;
    for (let i = 0; i < currentVec.length; i++) curNorm += currentVec[i] * currentVec[i];
    curNorm = Math.sqrt(curNorm) || 1;

    // Get current window timestamps
    const currentEndIdx = closes.length - 1;
    const currentStartIdx = Math.max(0, currentEndIdx - windowLen);

    // BLOCK 34.10: Build historical vectors using same mode (NOT from pre-built index)
    // This ensures hist and cur use identical vector construction
    const candidates: Array<{ endIdx: number; score: number; startTs: Date; endTs: Date }> = [];
    
    // Iterate over all possible historical windows
    const minHistIdx = windowLen; // Need at least windowLen+1 prices
    const maxHistIdx = closes.length - 1 - minGapDays; // Respect min gap from current
    
    // For asOf mode, also respect forward horizon
    const effectiveMaxIdx = asOf 
      ? Math.min(maxHistIdx, asOfEndIdx - horizonDays)
      : maxHistIdx;

    for (let endIdx = minHistIdx; endIdx <= effectiveMaxIdx; endIdx++) {
      // Skip if too close to current window
      const distanceDays = Math.abs(currentEndIdx - endIdx);
      if (distanceDays < minGapDays) continue;

      // BLOCK 34.10: Build historical vector with SAME mode as current
      const histCloses = closes.slice(endIdx - windowLen, endIdx + 1);
      const histVec = buildWindowVector(histCloses, similarityMode);

      // Calculate hist norm
      let histNorm = 0;
      for (let i = 0; i < histVec.length; i++) histNorm += histVec[i] * histVec[i];
      histNorm = Math.sqrt(histNorm) || 1;

      // Cosine similarity
      let dot = 0;
      for (let i = 0; i < currentVec.length && i < histVec.length; i++) {
        dot += currentVec[i] * histVec[i];
      }
      const score = dot / (curNorm * histNorm + EPS);

      candidates.push({
        endIdx,
        score,
        startTs: ts[endIdx - windowLen],
        endTs: ts[endIdx]
      });
    }

    // Sort by score descending and take top-K
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, topK);

    // Calculate forward outcomes using original cache (for forward stats)
    // Note: We use the full cache closes for forward stats calculation
    // because we want to know what actually happened after each historical match
    const outcomes: Outcome[] = [];
    for (const m of top) {
      const o = this.statsCalculator.computeOutcomes(this.cache!.closes, m.endIdx, horizonDays);
      if (o) outcomes.push(o);
    }

    // Aggregate statistics
    const agg = this.statsCalculator.aggregate(outcomes);
    const stability = Math.min(1, agg.sampleSize / Math.max(10, topK));

    const response: FractalMatchResponse = {
      ok: true,
      asOf: asOf ?? ts[ts.length - 1],
      pattern: {
        windowLen,
        timeframe,
        representation: 'log_returns_zscore'
      },
      matches: top.map((x, idx) => ({
        startTs: x.startTs,
        endTs: x.endTs,
        score: x.score,
        rank: idx + 1
      })),
      forwardStats: {
        horizonDays,
        return: agg.return,
        maxDrawdown: agg.maxDrawdown
      },
      confidence: {
        sampleSize: agg.sampleSize,
        stabilityScore: stability
      },
      safety: {
        excludedFromTraining: true,
        contextOnly: true,
        notes: [
          'Historical analogy - not a trading signal',
          'Past performance does not guarantee future results'
        ]
      },
      // BLOCK 34.11: Include truncated series for relative signal calculation
      seriesUsed: includeSeriesUsed 
        ? ts.map((t, i) => ({ ts: t, close: closes[i] }))
        : undefined
    };

    // BLOCK 18: Persist ML features (fire-and-forget)
    this.persistCurrentWindowFeature({
      windowLen,
      horizonDays,
      response,
      topMatchScore: top[0]?.score ?? 0,
      avgTopKScore: top.length > 0 
        ? top.reduce((s, m) => s + m.score, 0) / top.length 
        : 0
    }).catch(err => {
      console.error('[FractalEngine] Failed to persist ML features:', err);
    });

    return response;
  }

  /**
   * Get human-readable explanation
   */
  async explain(request: FractalMatchRequest): Promise<string> {
    const result = await this.match(request);

    if (result.matches.length === 0) {
      return 'Insufficient historical data for pattern matching.';
    }

    const { forwardStats, confidence, matches } = result;
    const topMatches = matches.slice(0, 3);

    const periods = topMatches.map(m => {
      const year = m.startTs.getFullYear();
      const month = m.startTs.toLocaleString('en', { month: 'short' });
      return `${month} ${year}`;
    }).join(', ');

    const returnStr = forwardStats.return.p50 >= 0 
      ? `+${(forwardStats.return.p50 * 100).toFixed(1)}%`
      : `${(forwardStats.return.p50 * 100).toFixed(1)}%`;

    const drawdownStr = `${(forwardStats.maxDrawdown.p50 * 100).toFixed(1)}%`;

    return [
      `Current market pattern resembles: ${periods}`,
      ``,
      `Based on ${confidence.sampleSize} similar historical periods:`,
      `- Median 30-day return: ${returnStr}`,
      `- Median max drawdown: ${drawdownStr}`,
      ``,
      `Confidence: ${Math.round(confidence.stabilityScore * 100)}%`,
      ``,
      `This is historical context, not a trading recommendation.`
    ].join('\n');
  }

  /**
   * Get detailed explainability breakdown (Block 13)
   */
  async explainDetailed(request: FractalMatchRequest): Promise<ExplainabilityResult> {
    const windowLen = request.windowLen || 30;
    const horizonDays = request.forwardHorizon || FORWARD_HORIZON_DAYS;

    // Get match results first
    const result = await this.match(request);

    if (!this.cache || result.matches.length === 0) {
      throw new Error('No matches available for explanation');
    }

    const { ts, closes } = this.cache;

    // Build full explanation
    return this.explainability.buildExplanation(
      result.matches,
      closes,
      ts,
      result.forwardStats,
      windowLen,
      horizonDays
    );
  }

  /**
   * Invalidate cache (call after data update)
   */
  invalidateCache(): void {
    this.cache = null;
    this.index.clear();
    console.log('[FractalEngine] Cache invalidated');
  }

  /**
   * Admin: clear cache
   */
  adminClearCache(): void {
    this.invalidateCache();
  }

  /**
   * Admin: rebuild index
   */
  async adminRebuildIndex(): Promise<void> {
    await this.ensureCache(FRACTAL_SYMBOL, FRACTAL_TIMEFRAME, FORWARD_HORIZON_DAYS);
  }

  /**
   * Build overlay data for visualization (Block 14)
   * Returns normalized price series for current window, best match, and forward projection
   */
  async buildOverlay(params: {
    windowLen: number;
    horizonDays: number;
    match: { startTs: Date; endTs: Date; score: number; rank: number };
  }): Promise<{
    current: { startTs: Date; endTs: Date; points: Array<{ t: string; v: number }> };
    match: { startTs: Date; endTs: Date; points: Array<{ t: string; v: number }>; score: number };
    forward: { startTs: Date; endTs: Date; points: Array<{ t: string; v: number }> };
  }> {
    await this.ensureCache(FRACTAL_SYMBOL, FRACTAL_TIMEFRAME, params.horizonDays);

    const { ts, closes } = this.cache!;

    // Current window indices
    const currentEndIdx = closes.length - 1;
    const currentStartIdx = Math.max(0, currentEndIdx - params.windowLen);

    // Match window indices
    const matchEndIdx = this.findIndexByTs(ts, new Date(params.match.endTs));
    const matchStartIdx = Math.max(0, matchEndIdx - params.windowLen);

    // Forward projection indices
    const forwardStartIdx = matchEndIdx;
    const forwardEndIdx = Math.min(closes.length - 1, matchEndIdx + params.horizonDays);

    // Normalize all segments to 100 at start
    const currentPoints = this.normalizeSegment(ts, closes, currentStartIdx, currentEndIdx);
    const matchPoints = this.normalizeSegment(ts, closes, matchStartIdx, matchEndIdx);
    const forwardPoints = this.normalizeSegmentContinuation(ts, closes, matchStartIdx, forwardStartIdx, forwardEndIdx);

    return {
      current: {
        startTs: ts[currentStartIdx],
        endTs: ts[currentEndIdx],
        points: currentPoints
      },
      match: {
        startTs: ts[matchStartIdx],
        endTs: ts[matchEndIdx],
        points: matchPoints,
        score: params.match.score
      },
      forward: {
        startTs: ts[forwardStartIdx],
        endTs: ts[forwardEndIdx],
        points: forwardPoints
      }
    };
  }

  /**
   * Binary search to find index by timestamp
   */
  private findIndexByTs(ts: Date[], target: Date): number {
    const t = target.getTime();
    let lo = 0, hi = ts.length - 1;
    
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const mt = ts[mid].getTime();
      if (mt === t) return mid;
      if (mt < t) lo = mid + 1;
      else hi = mid - 1;
    }
    
    // Fallback: nearest <=
    return Math.max(0, hi);
  }

  /**
   * Normalize segment to start at 100
   */
  private normalizeSegment(ts: Date[], closes: number[], startIdx: number, endIdx: number): Array<{ t: string; v: number }> {
    const base = closes[startIdx] || 1;
    const out: Array<{ t: string; v: number }> = [];

    for (let i = startIdx; i <= endIdx && i < closes.length; i++) {
      out.push({
        t: ts[i].toISOString().slice(0, 10),
        v: Math.round((closes[i] / base) * 10000) / 100 // 100.00 format
      });
    }
    return out;
  }

  /**
   * Normalize forward segment (continuation from match window base)
   */
  private normalizeSegmentContinuation(
    ts: Date[], 
    closes: number[], 
    baseIdx: number,
    startIdx: number, 
    endIdx: number
  ): Array<{ t: string; v: number }> {
    const base = closes[baseIdx] || 1;
    const out: Array<{ t: string; v: number }> = [];

    for (let i = startIdx; i <= endIdx && i < closes.length; i++) {
      out.push({
        t: ts[i].toISOString().slice(0, 10),
        v: Math.round((closes[i] / base) * 10000) / 100
      });
    }
    return out;
  }

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 18: ML FEATURE PERSISTENCE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Persist current window features for ML dataset
   */
  private async persistCurrentWindowFeature(args: {
    windowLen: number;
    horizonDays: number;
    response: FractalMatchResponse;
    topMatchScore: number;
    avgTopKScore: number;
  }): Promise<void> {
    if (!this.cache) return;

    const { ts, closes, quality } = this.cache;
    const endIdx = closes.length - 1;
    const startIdx = Math.max(0, endIdx - args.windowLen);

    // Extract window data
    const closesWindow = closes.slice(startIdx, endIdx + 1);
    const qualityWindow = quality.slice(startIdx, endIdx + 1);

    // Get regime from explainability
    const explainResult = await this.explainability.buildExplanation(
      args.response.matches,
      closes,
      ts,
      args.response.forwardStats,
      args.windowLen,
      args.horizonDays
    );

    const currentRegime = explainResult.currentRegime;
    const regimeVol = this.featureExtractor.encodeVolRegime(currentRegime.volatility);
    const regimeTrend = this.featureExtractor.encodeTrendRegime(currentRegime.trend);

    // Regime consistency from confidence
    const regimeConsistency = explainResult.confidence.factors.regimeAlignment.score;
    const effectiveSampleSize = args.response.confidence.sampleSize;

    // Extract features
    const features = this.featureExtractor.extract({
      closesWindow,
      qualityWindow,
      regimeVol,
      regimeTrend,
      topMatchScore: args.topMatchScore,
      avgTopKScore: args.avgTopKScore,
      regimeConsistency,
      effectiveSampleSize
    });

    // Prediction snapshot
    const fs = args.response.forwardStats;
    const prediction = {
      p10Return: fs.return.p10,
      p50Return: fs.return.p50,
      p90Return: fs.return.p90,
      p10MaxDD: fs.maxDrawdown.p10,
      p50MaxDD: fs.maxDrawdown.p50,
      p90MaxDD: fs.maxDrawdown.p90
    };

    const windowEndTs = ts[endIdx];
    const horizonEndTs = new Date(windowEndTs.getTime() + args.horizonDays * 86400000);

    // Best match debug info
    const bestMatch = args.response.matches[0];
    const debug = bestMatch ? {
      bestMatch: {
        startTs: new Date(bestMatch.startTs),
        endTs: new Date(bestMatch.endTs),
        score: bestMatch.score,
        windowQuality: features.avgQuality,
        regimeMatchScore: regimeConsistency
      }
    } : undefined;

    // Upsert to MongoDB
    await this.windowStore.upsertWindow({
      meta: {
        symbol: FRACTAL_SYMBOL,
        timeframe: FRACTAL_TIMEFRAME,
        windowLen: args.windowLen,
        horizonDays: args.horizonDays
      },
      windowEndTs,
      features,
      prediction,
      label: {
        ready: false,
        horizonEndTs
      },
      debug,
      createdAt: new Date()
    });

    console.log(`[FractalEngine] ML features persisted for ${windowEndTs.toISOString().slice(0, 10)}`);
  }

  // Private Methods
  private async ensureCache(symbol: string, timeframe: string, horizonDays: number): Promise<void> {
    const now = Date.now();

    const cacheFresh = this.cache && (now - this.cache.loadedAt < this.CACHE_TTL_MS);
    const indexFresh = this.index.getBuiltAt() && (now - (this.index.getBuiltAt() as number) < this.INDEX_TTL_MS);

    if (cacheFresh && indexFresh) return;

    console.log('[FractalEngine] Refreshing cache and index...');

    // Load price data with quality scores
    const series = await this.canonicalStore.getSeriesWithQuality(symbol, timeframe);

    this.cache = {
      loadedAt: now,
      ts: series.map(x => x.ts),
      closes: series.map(x => x.close),
      quality: series.map(x => x.quality)
    };

    // Build index for all supported window sizes
    this.index.clear();
    this.index.buildAll(this.cache.ts, this.cache.closes, [30, 60, 90], horizonDays);

    console.log(`[FractalEngine] Cache refreshed: ${this.cache.closes.length} candles`);
  }

  private emptyResponse(windowLen: number, timeframe: string, asOf?: Date): FractalMatchResponse {
    return {
      ok: false,
      asOf: asOf ?? new Date(),
      pattern: {
        windowLen,
        timeframe,
        representation: 'log_returns_zscore'
      },
      matches: [],
      forwardStats: {
        horizonDays: FORWARD_HORIZON_DAYS,
        return: { p10: 0, p50: 0, p90: 0, mean: 0 },
        maxDrawdown: { p10: 0, p50: 0, p90: 0 }
      },
      confidence: { sampleSize: 0, stabilityScore: 0 },
      safety: {
        excludedFromTraining: true,
        contextOnly: true,
        notes: ['Insufficient data']
      }
    };
  }
}
