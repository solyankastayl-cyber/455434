/**
 * TA Service v2.0 — Main orchestrator for Technical Analysis
 * 
 * Uses the new production-grade TA core:
 * - ATR-adaptive Pivot Engine
 * - Market Structure Engine (HH/HL/LH/LL)
 * - Level Engine (S/R zones)
 * - Detector Registry for patterns
 * - Scoring Engine for pattern ranking
 * - Storage Service for audit trail (Phase 4)
 */

import { getMongoDb } from '../../../db/mongoose.js';
import { 
  Series, 
  TAContext, 
  TAEngineConfig, 
  DEFAULT_TA_CONFIG,
  CandidatePattern,
  Candle,
  FeaturePack
} from '../domain/types.js';
import { buildTAContext, getRegimeLabel } from '../core/series.js';
import { detectorRegistry } from '../detectors/index.js';
import { scoreAndSelectPatterns, ScoredPattern, DEFAULT_SCORE_CONFIG } from '../scoring/score.js';
import { taStorageService } from '../storage/ta-storage.service.js';
import { getMarketDataProvider, MarketDataProvider } from '../data/market.provider.js';

// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// Request/Response Types
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

export type TaAnalyzeRequest = {
  asset: string;
  timeframe?: string;
  lookback?: number;
};

export type TaAnalyzeResponse = {
  ok: boolean;
  asset: string;
  timeframe: string;
  
  // Run ID for audit trail
  runId?: string;
  
  // Core analysis
  structure: {
    regime: string;
    regimeLabel: string;
    hhhlScore: number;
    compressionScore: number;
    lastSwingHigh?: { price: number; ts: number };
    lastSwingLow?: { price: number; ts: number };
  };
  
  // Pivots summary
  pivots: {
    total: number;
    swingHighs: number;
    swingLows: number;
    avgStrength: number;
    recent: Array<{
      type: string;
      price: number;
      ts: number;
      strength: number;
    }>;
  };
  
  // S/R Levels
  levels: Array<{
    id: string;
    price: number;
    band: number;
    type: string;
    strength: number;
    touches: number;
  }>;
  
  // Detected patterns (top-K scored patterns)
  patterns: ScoredPattern[];
  
  // All ranked patterns (for debugging/analysis)
  ranked?: ScoredPattern[];
  
  // Dropped patterns (below threshold)
  dropped?: ScoredPattern[];
  
  // Features for ML
  features: Record<string, number>;
  
  // Phase 7: Feature Pack (structured features)
  featuresPack?: FeaturePack;
  
  // Metadata
  meta: {
    candlesUsed: number;
    detectorsRun: number;
    totalPatternsFound: number;
    timestamp: string;
  };
};

// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// TA Service
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

export class TaService {
  private config: TAEngineConfig;
  private marketDataProvider: MarketDataProvider;

  constructor(config: Partial<TAEngineConfig> = {}) {
    this.config = { ...DEFAULT_TA_CONFIG, ...config };
    // Use mock provider by default for development, can switch to 'binance' or 'mongo'
    this.marketDataProvider = getMarketDataProvider('mock');
    console.log(`[TA Service] Using ${this.marketDataProvider.getName()} market data provider`);
  }

  /**
   * Main analysis endpoint
   */
  async analyze(request: TaAnalyzeRequest): Promise<TaAnalyzeResponse> {
    const { asset, timeframe = '1D', lookback = 200 } = request;
    
    // 1. Fetch OHLCV data
    const candles = await this.fetchCandles(asset, lookback);
    
    if (candles.length < 20) {
      return this.createEmptyResponse(asset, timeframe, candles.length);
    }

    // 2. Build TA context
    const series: Series = {
      asset,
      tf: '1D',
      candles,
    };
    
    const ctx = buildTAContext(series, this.config);
    
    // 3. Run all registered detectors
    const rawPatterns = detectorRegistry.detectAll(ctx);
    
    // 4. Score and select top patterns
    const { ranked, top, dropped } = scoreAndSelectPatterns(ctx, rawPatterns, {
      topK: 3,
      minScoreToShow: 0.30,
    });
    
    // 5. Save to audit trail (Phase 4)
    let runId: string | undefined;
    try {
      runId = await taStorageService.saveTARun(asset, timeframe, ctx);
      await taStorageService.savePatterns(runId, asset, ranked);
      await taStorageService.saveDecision(runId, asset, timeframe, top, rawPatterns.length, dropped.length);
    } catch (err) {
      console.error('[TA] Failed to save audit trail:', err);
    }
    
    // 6. Build response
    return this.buildResponse(ctx, { ranked, top, dropped }, timeframe, rawPatterns.length, runId);
  }

  /**
   * Analyze with pre-supplied candles (no re-fetch).
   * Used by the Execution Simulator to avoid lookahead bias.
   */
  analyzeWithCandles(
    candles: Candle[],
    asset: string,
    timeframe: string = '1D'
  ): TaAnalyzeResponse {
    if (candles.length < 20) {
      return this.createEmptyResponse(asset, timeframe, candles.length);
    }

    const series: Series = { asset, tf: '1D', candles };
    const ctx = buildTAContext(series, this.config);
    const rawPatterns = detectorRegistry.detectAll(ctx);
    const { ranked, top, dropped } = scoreAndSelectPatterns(ctx, rawPatterns, {
      topK: 3,
      minScoreToShow: 0.30,
    });

    return this.buildResponse(ctx, { ranked, top, dropped }, timeframe, rawPatterns.length);
  }

  /**
   * Get raw TA context (for debugging/advanced use)
   */
  async getContext(asset: string, lookback: number = 200): Promise<TAContext | null> {
    const candles = await this.fetchCandles(asset, lookback);
    if (candles.length < 20) return null;
    
    const series: Series = {
      asset,
      tf: '1D',
      candles,
    };
    
    return buildTAContext(series, this.config);
  }

  /**
   * Fetch OHLCV candles using Market Data Provider
   * Provider can be: mock, binance, or mongo
   */
  private async fetchCandles(asset: string, lookback: number): Promise<Candle[]> {
    const candles = await this.marketDataProvider.getCandles(asset, '1D', lookback);
    
    // Convert to internal Candle format
    return candles.map((c: any) => ({
      ts: c.ts,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 0
    }));
  }

  /**
   * Build response from TA context
   */
  private buildResponse(
    ctx: TAContext,
    scoring: { ranked: ScoredPattern[]; top: ScoredPattern[]; dropped: ScoredPattern[] },
    timeframe: string,
    totalPatternsFound: number,
    runId?: string
  ): TaAnalyzeResponse {
    const { structure, pivots, levels, features, series } = ctx;
    const { ranked, top, dropped } = scoring;
    
    // Recent pivots (last 10)
    const recentPivots = pivots.slice(-10).map(p => ({
      type: p.type,
      price: p.price,
      ts: p.ts,
      strength: Math.round(p.strength * 100) / 100,
    }));
    
    // Pivot stats
    const swingHighs = pivots.filter(p => p.type === 'HIGH');
    const swingLows = pivots.filter(p => p.type === 'LOW');
    const avgStrength = pivots.length > 0
      ? pivots.reduce((s, p) => s + p.strength, 0) / pivots.length
      : 0;
    
    return {
      ok: true,
      asset: series.asset,
      timeframe,
      runId,
      
      structure: {
        regime: structure.regime,
        regimeLabel: getRegimeLabel(ctx),
        hhhlScore: Math.round(structure.hhhlScore * 100) / 100,
        compressionScore: Math.round(structure.compressionScore * 100) / 100,
        lastSwingHigh: structure.lastSwingHigh ? {
          price: structure.lastSwingHigh.price,
          ts: structure.lastSwingHigh.ts,
        } : undefined,
        lastSwingLow: structure.lastSwingLow ? {
          price: structure.lastSwingLow.price,
          ts: structure.lastSwingLow.ts,
        } : undefined,
      },
      
      pivots: {
        total: pivots.length,
        swingHighs: swingHighs.length,
        swingLows: swingLows.length,
        avgStrength: Math.round(avgStrength * 100) / 100,
        recent: recentPivots,
      },
      
      levels: levels.map(l => ({
        id: l.id,
        price: l.price,
        band: l.band,
        type: l.type,
        strength: l.strength,
        touches: l.touches,
      })),
      
      patterns: top,
      ranked,
      dropped,
      features,
      featuresPack: ctx.featuresPack,
      
      meta: {
        candlesUsed: series.candles.length,
        detectorsRun: detectorRegistry.count(),
        totalPatternsFound,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Create empty response for insufficient data
   */
  private createEmptyResponse(asset: string, timeframe: string, candlesCount: number): TaAnalyzeResponse {
    return {
      ok: false,
      asset,
      timeframe,
      structure: {
        regime: 'TRANSITION',
        regimeLabel: 'INSUFFICIENT_DATA',
        hhhlScore: 0,
        compressionScore: 0,
      },
      pivots: {
        total: 0,
        swingHighs: 0,
        swingLows: 0,
        avgStrength: 0,
        recent: [],
      },
      levels: [],
      patterns: [],
      ranked: [],
      dropped: [],
      features: {},
      meta: {
        candlesUsed: candlesCount,
        detectorsRun: 0,
        totalPatternsFound: 0,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Health check
   */
  async health(): Promise<{ ok: boolean; version: string; detectors: number }> {
    return {
      ok: true,
      version: '2.0.0',
      detectors: detectorRegistry.count(),
    };
  }
}
