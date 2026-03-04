/**
 * INDICATOR ENGINE SERVICE
 * =========================
 * 
 * Orchestrates all indicator providers to build IndicatorVector for each asset.
 */

import type {
  IIndicatorProvider,
  IndicatorInput,
  IndicatorOutput,
  IndicatorEngineConfig,
  VectorBuildResult,
  BatchVectorResult,
} from './indicator.types.js';
import { DEFAULT_ENGINE_CONFIG } from './indicator.types.js';
import type { IndicatorVector, MarketOHLCV, DerivativesSnapshot, Timeframe, Venue } from '../types.js';
import { ALL_PROVIDERS } from './providers/index.js';
import { ALT_THRESHOLDS } from '../constants.js';

export class IndicatorEngineService {
  private providers: IIndicatorProvider[] = [];
  private config: IndicatorEngineConfig;

  constructor(config?: Partial<IndicatorEngineConfig>) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
    
    // Register all providers
    for (const provider of ALL_PROVIDERS) {
      this.registerProvider(provider);
    }
    
    console.log(`[IndicatorEngine] Initialized with ${this.providers.length} providers`);
  }

  registerProvider(provider: IIndicatorProvider): void {
    this.providers.push(provider);
    console.log(`[IndicatorEngine] Registered provider: ${provider.id} (${provider.indicators.length} indicators)`);
  }

  // ═══════════════════════════════════════════════════════════════
  // BUILD INDICATOR VECTOR FOR SINGLE ASSET
  // ═══════════════════════════════════════════════════════════════

  async buildVector(
    symbol: string,
    venue: Venue,
    candles: MarketOHLCV[],
    derivatives?: DerivativesSnapshot,
    timeframe: Timeframe = '1h'
  ): Promise<VectorBuildResult> {
    const providerResults: VectorBuildResult['providers'] = [];
    const allOutputs: IndicatorOutput[] = [];
    const missing: string[] = [];

    const input: IndicatorInput = {
      symbol,
      candles,
      derivatives,
      ticker: candles.length > 0 ? {
        lastPrice: candles[candles.length - 1].close,
        volume24h: candles.slice(-24).reduce((sum, c) => sum + c.volume, 0),
      } : undefined,
      timeframe,
    };

    // Run providers (can be parallelized)
    const providerPromises = this.providers.map(async (provider) => {
      const providerStart = Date.now();
      try {
        if (candles.length < provider.requiredCandles) {
          return {
            id: provider.id,
            success: false,
            error: `Insufficient candles: ${candles.length} < ${provider.requiredCandles}`,
            durationMs: Date.now() - providerStart,
            outputs: [] as IndicatorOutput[],
          };
        }

        const outputs = await Promise.race([
          provider.calculate(input),
          new Promise<IndicatorOutput[]>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), this.config.timeoutMs)
          ),
        ]);

        return {
          id: provider.id,
          success: true,
          durationMs: Date.now() - providerStart,
          outputs,
        };
      } catch (error: any) {
        return {
          id: provider.id,
          success: false,
          error: error.message,
          durationMs: Date.now() - providerStart,
          outputs: [] as IndicatorOutput[],
        };
      }
    });

    const results = await Promise.all(providerPromises);

    for (const result of results) {
      providerResults.push({
        id: result.id,
        success: result.success,
        error: result.error,
        durationMs: result.durationMs,
      });

      if (result.success && result.outputs) {
        allOutputs.push(...result.outputs);
      } else if (!result.success) {
        // Track missing indicators from failed providers
        const provider = this.providers.find(p => p.id === result.id);
        if (provider) {
          missing.push(...provider.indicators);
        }
      }
    }

    // Build IndicatorVector from outputs
    const vector = this.assembleVector(symbol, venue, candles, allOutputs);

    // Calculate coverage
    const totalExpectedIndicators = this.providers.reduce(
      (sum, p) => sum + p.indicators.length, 0
    );
    const coverage = (totalExpectedIndicators - missing.length) / totalExpectedIndicators;

    // Set quality in vector
    vector.quality = {
      coverage,
      missing,
    };

    return {
      vector,
      missing,
      coverage,
      providers: providerResults,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // BATCH BUILD FOR MULTIPLE ASSETS
  // ═══════════════════════════════════════════════════════════════

  async buildBatch(
    assets: Array<{
      symbol: string;
      venue: Venue;
      candles: MarketOHLCV[];
      derivatives?: DerivativesSnapshot;
    }>,
    timeframe: Timeframe = '1h'
  ): Promise<BatchVectorResult> {
    const startTime = Date.now();
    const vectors = new Map<string, IndicatorVector>();
    const errors = new Map<string, string>();
    let totalCoverage = 0;
    let successCount = 0;

    // Process in parallel batches
    const batchSize = this.config.parallelProviders;
    
    for (let i = 0; i < assets.length; i += batchSize) {
      const batch = assets.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (asset) => {
        try {
          const result = await this.buildVector(
            asset.symbol,
            asset.venue,
            asset.candles,
            asset.derivatives,
            timeframe
          );
          
          return {
            symbol: asset.symbol,
            success: true,
            vector: result.vector as IndicatorVector,
            coverage: result.coverage,
          };
        } catch (error: any) {
          return {
            symbol: asset.symbol,
            success: false,
            error: error.message,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        if (result.success && result.vector) {
          vectors.set(result.symbol, result.vector);
          totalCoverage += result.coverage ?? 0;
          successCount++;
        } else {
          errors.set(result.symbol, result.error ?? 'Unknown error');
        }
      }
    }

    return {
      vectors,
      errors,
      stats: {
        total: assets.length,
        success: successCount,
        failed: errors.size,
        avgCoverage: successCount > 0 ? totalCoverage / successCount : 0,
        durationMs: Date.now() - startTime,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ASSEMBLE INDICATOR VECTOR
  // ═══════════════════════════════════════════════════════════════

  private assembleVector(
    symbol: string,
    venue: Venue,
    candles: MarketOHLCV[],
    outputs: IndicatorOutput[]
  ): Partial<IndicatorVector> {
    const outputMap = new Map<string, IndicatorOutput>();
    for (const output of outputs) {
      outputMap.set(output.key, output);
    }

    const getNum = (key: string, defaultVal = 0): number => {
      const o = outputMap.get(key);
      return typeof o?.value === 'number' ? o.value : defaultVal;
    };

    const getNorm = (key: string, defaultVal = 0): number => {
      const o = outputMap.get(key);
      return o?.normalized ?? defaultVal;
    };

    const getBool = (key: string): boolean => {
      const o = outputMap.get(key);
      return o?.value === true;
    };

    const lastCandle = candles[candles.length - 1];
    const price = lastCandle?.close ?? 0;

    // Calculate momentum returns
    const momentum1h = candles.length >= 2 
      ? ((candles[candles.length - 1].close - candles[candles.length - 2].close) / candles[candles.length - 2].close) * 100
      : 0;
    const momentum4h = candles.length >= 5
      ? ((candles[candles.length - 1].close - candles[candles.length - 5].close) / candles[candles.length - 5].close) * 100
      : 0;
    const momentum24h = candles.length >= 25
      ? ((candles[candles.length - 1].close - candles[candles.length - 25].close) / candles[candles.length - 25].close) * 100
      : 0;

    // Determine volatility regime
    const volZ = getNum('volatility_z');
    let volRegime: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
    if (volZ < -1) volRegime = 'LOW';
    else if (volZ < 1) volRegime = 'NORMAL';
    else if (volZ < 2) volRegime = 'HIGH';
    else volRegime = 'EXTREME';

    const vector: Partial<IndicatorVector> = {
      symbol,
      ts: Date.now(),
      venue,

      // Momentum
      rsi_14: getNum('rsi_14', 50),
      rsi_z: getNum('rsi_z'),
      momentum_1h: momentum1h,
      momentum_4h: momentum4h,
      momentum_24h: momentum24h,
      trend_score: getNorm('trend_score'),

      // Volatility
      atr_pct: getNum('atr_pct'),
      volatility_z: volZ,
      vol_regime: volRegime,

      // Derivatives
      funding_rate: getNum('funding_rate'),
      funding_z: getNum('funding_z'),
      oi_change_1h: getNum('oi_change_1h'),
      oi_z: getNum('oi_z'),
      long_share: getNum('long_share', 0.5),
      long_bias: getNum('long_bias'),

      // Liquidations
      liq_imbalance: getNum('liq_imbalance'),
      liq_z: getNum('liq_z'),
      cascade_risk: getNum('cascade_risk'),

      // Structure
      breakout_score: getNum('breakout_score'),
      meanrev_score: getNum('mean_reversion_score'),
      squeeze_score: getNum('squeeze_score'),

      // Flags
      oversold_flag: getNum('rsi_14', 50) < ALT_THRESHOLDS.oversoldRsi,
      overbought_flag: getNum('rsi_14', 50) > ALT_THRESHOLDS.overboughtRsi,
      squeeze_flag: getBool('squeeze_flag'),
      crowded_trade_flag: getBool('crowded_trade_flag'),

      // Quality (will be set by caller)
      quality: {
        coverage: 0,
        missing: [],
      },

      // Meta
      meta: {
        price,
        volume: lastCandle?.volume ?? 0,
        funding_raw: getNum('funding_rate'),
        oi_raw: 0, // Would need OI value from derivatives
      },
    };

    return vector;
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════

  getProviderStats(): Array<{
    id: string;
    category: string;
    indicators: string[];
    requiredCandles: number;
  }> {
    return this.providers.map(p => ({
      id: p.id,
      category: p.category,
      indicators: p.indicators,
      requiredCandles: p.requiredCandles,
    }));
  }

  getTotalIndicatorCount(): number {
    return this.providers.reduce((sum, p) => sum + p.indicators.length, 0);
  }
}

// Singleton instance
export const indicatorEngine = new IndicatorEngineService();

console.log('[ExchangeAlt] Indicator Engine Service loaded');
