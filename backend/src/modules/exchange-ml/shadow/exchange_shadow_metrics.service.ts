/**
 * Exchange Auto-Learning Loop - PR3: Shadow Metrics Service
 * 
 * Calculates and compares metrics between active and shadow models:
 * - Win rates
 * - Accuracy
 * - Precision/Recall
 * - Rolling window stats
 * - Stability variance
 */

import { Db } from 'mongodb';
import {
  ShadowComparisonMetrics,
  ShadowWindowStats,
  ShadowConfig,
  DEFAULT_SHADOW_CONFIG,
  ShadowPrediction,
} from './exchange_shadow.types.js';
import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';
import { getExchangeShadowRecorderService } from './exchange_shadow_recorder.service.js';
import { getExchangeModelRegistryService } from '../training/exchange_model_registry.service.js';

// ═══════════════════════════════════════════════════════════════
// SHADOW METRICS SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExchangeShadowMetricsService {
  private config: ShadowConfig;
  
  constructor(private db: Db, config?: Partial<ShadowConfig>) {
    this.config = { ...DEFAULT_SHADOW_CONFIG, ...config };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MAIN COMPARISON METRICS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Calculate comprehensive comparison metrics for a horizon.
   */
  async calculateMetrics(horizon: ExchangeHorizon): Promise<ShadowComparisonMetrics> {
    const recorderService = getExchangeShadowRecorderService(this.db);
    const registryService = getExchangeModelRegistryService(this.db);
    
    // Get registry info
    const registry = await registryService.getRegistry(horizon);
    
    // Get resolved predictions
    const predictions = await recorderService.getResolvedForMetrics({
      horizon,
      limit: this.config.longWindowSize,
    });
    
    // Get counts
    const counts = await recorderService.getCounts();
    const horizonCounts = counts.byHorizon[horizon];
    
    // Calculate metrics
    const metrics = this.computeMetrics(predictions);
    
    // Get time range
    const sortedByTime = [...predictions].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    
    return {
      horizon,
      activeModelId: registry?.activeModelId || null,
      shadowModelId: registry?.shadowModelId || null,
      
      totalPredictions: horizonCounts.total,
      resolvedPredictions: horizonCounts.resolved,
      pendingPredictions: horizonCounts.pending,
      
      activeAccuracy: metrics.activeAccuracy,
      activeWinRate: metrics.activeWinRate,
      activePrecision: metrics.activePrecision,
      activeRecall: metrics.activeRecall,
      
      shadowAccuracy: metrics.shadowAccuracy,
      shadowWinRate: metrics.shadowWinRate,
      shadowPrecision: metrics.shadowPrecision,
      shadowRecall: metrics.shadowRecall,
      
      accuracyDelta: metrics.shadowAccuracy - metrics.activeAccuracy,
      winRateDelta: metrics.shadowWinRate - metrics.activeWinRate,
      
      agreementRate: metrics.agreementRate,
      
      activeStability: metrics.activeStability,
      shadowStability: metrics.shadowStability,
      
      oldestPrediction: sortedByTime[0]?.createdAt || null,
      newestPrediction: sortedByTime[sortedByTime.length - 1]?.createdAt || null,
      
      computedAt: new Date(),
    };
  }
  
  /**
   * Get metrics for all horizons.
   */
  async calculateAllMetrics(): Promise<Record<ExchangeHorizon, ShadowComparisonMetrics>> {
    const horizons: ExchangeHorizon[] = ['1D', '7D', '30D'];
    const results: Record<ExchangeHorizon, ShadowComparisonMetrics> = {} as any;
    
    for (const horizon of horizons) {
      results[horizon] = await this.calculateMetrics(horizon);
    }
    
    return results;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // ROLLING WINDOW STATS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Calculate stats for short and long rolling windows.
   */
  async getWindowStats(horizon: ExchangeHorizon): Promise<{
    short: ShadowWindowStats;
    long: ShadowWindowStats;
  }> {
    const recorderService = getExchangeShadowRecorderService(this.db);
    
    // Get all resolved predictions
    const predictions = await recorderService.getResolvedForMetrics({
      horizon,
      limit: this.config.longWindowSize,
    });
    
    // Sort by time (newest first)
    const sorted = [...predictions].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    
    // Short window
    const shortWindow = sorted.slice(0, this.config.shortWindowSize);
    const shortStats = this.computeWindowStats(shortWindow, this.config.shortWindowSize);
    
    // Long window
    const longStats = this.computeWindowStats(sorted, this.config.longWindowSize);
    
    return {
      short: shortStats,
      long: longStats,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // COMPUTE HELPERS
  // ═══════════════════════════════════════════════════════════════
  
  private computeMetrics(predictions: ShadowPrediction[]): {
    activeAccuracy: number;
    activeWinRate: number;
    activePrecision: number;
    activeRecall: number;
    shadowAccuracy: number;
    shadowWinRate: number;
    shadowPrecision: number;
    shadowRecall: number;
    agreementRate: number;
    activeStability: number;
    shadowStability: number;
  } {
    if (predictions.length === 0) {
      return {
        activeAccuracy: 0,
        activeWinRate: 0,
        activePrecision: 0,
        activeRecall: 0,
        shadowAccuracy: 0,
        shadowWinRate: 0,
        shadowPrecision: 0,
        shadowRecall: 0,
        agreementRate: 0,
        activeStability: 0,
        shadowStability: 0,
      };
    }
    
    // Filter to only WIN/LOSS (exclude NEUTRAL)
    const valid = predictions.filter(p => 
      p.actualLabel === 'WIN' || p.actualLabel === 'LOSS'
    );
    
    if (valid.length === 0) {
      return {
        activeAccuracy: 0,
        activeWinRate: 0,
        activePrecision: 0,
        activeRecall: 0,
        shadowAccuracy: 0,
        shadowWinRate: 0,
        shadowPrecision: 0,
        shadowRecall: 0,
        agreementRate: 0,
        activeStability: 0,
        shadowStability: 0,
      };
    }
    
    const n = valid.length;
    
    // Confusion matrices
    const activeCM = { TP: 0, FP: 0, TN: 0, FN: 0 };
    const shadowCM = { TP: 0, FP: 0, TN: 0, FN: 0 };
    let agreements = 0;
    
    for (const p of valid) {
      const actualWin = p.actualLabel === 'WIN';
      
      // Active
      if (p.activeClass === 'WIN' && actualWin) activeCM.TP++;
      else if (p.activeClass === 'WIN' && !actualWin) activeCM.FP++;
      else if (p.activeClass === 'LOSS' && !actualWin) activeCM.TN++;
      else if (p.activeClass === 'LOSS' && actualWin) activeCM.FN++;
      
      // Shadow
      if (p.shadowClass === 'WIN' && actualWin) shadowCM.TP++;
      else if (p.shadowClass === 'WIN' && !actualWin) shadowCM.FP++;
      else if (p.shadowClass === 'LOSS' && !actualWin) shadowCM.TN++;
      else if (p.shadowClass === 'LOSS' && actualWin) shadowCM.FN++;
      
      // Agreement
      if (p.activeClass === p.shadowClass) agreements++;
    }
    
    // Calculate metrics
    const activeAccuracy = (activeCM.TP + activeCM.TN) / n;
    const shadowAccuracy = (shadowCM.TP + shadowCM.TN) / n;
    
    const activePredictedWin = activeCM.TP + activeCM.FP;
    const shadowPredictedWin = shadowCM.TP + shadowCM.FP;
    const actualWins = activeCM.TP + activeCM.FN;
    
    const activePrecision = activePredictedWin > 0 ? activeCM.TP / activePredictedWin : 0;
    const activeRecall = actualWins > 0 ? activeCM.TP / actualWins : 0;
    
    const shadowPrecision = shadowPredictedWin > 0 ? shadowCM.TP / shadowPredictedWin : 0;
    const shadowRecall = actualWins > 0 ? shadowCM.TP / actualWins : 0;
    
    const activeWinRate = activePredictedWin > 0 ? activeCM.TP / activePredictedWin : 0;
    const shadowWinRate = shadowPredictedWin > 0 ? shadowCM.TP / shadowPredictedWin : 0;
    
    const agreementRate = agreements / n;
    
    // Stability (variance of rolling accuracy)
    const activeStability = this.calculateStability(
      valid.map(p => p.activeCorrect === true ? 1 : 0)
    );
    const shadowStability = this.calculateStability(
      valid.map(p => p.shadowCorrect === true ? 1 : 0)
    );
    
    return {
      activeAccuracy,
      activeWinRate,
      activePrecision,
      activeRecall,
      shadowAccuracy,
      shadowWinRate,
      shadowPrecision,
      shadowRecall,
      agreementRate,
      activeStability,
      shadowStability,
    };
  }
  
  private computeWindowStats(predictions: ShadowPrediction[], windowSize: number): ShadowWindowStats {
    let activeCorrect = 0;
    let activeIncorrect = 0;
    let shadowCorrect = 0;
    let shadowIncorrect = 0;
    
    for (const p of predictions) {
      if (p.activeCorrect === true) activeCorrect++;
      else if (p.activeCorrect === false) activeIncorrect++;
      
      if (p.shadowCorrect === true) shadowCorrect++;
      else if (p.shadowCorrect === false) shadowIncorrect++;
    }
    
    const activeTotal = activeCorrect + activeIncorrect;
    const shadowTotal = shadowCorrect + shadowIncorrect;
    
    const activeAccuracy = activeTotal > 0 ? activeCorrect / activeTotal : 0;
    const shadowAccuracy = shadowTotal > 0 ? shadowCorrect / shadowTotal : 0;
    
    return {
      windowSize: predictions.length,
      activeCorrect,
      activeIncorrect,
      shadowCorrect,
      shadowIncorrect,
      activeAccuracy,
      shadowAccuracy,
      delta: shadowAccuracy - activeAccuracy,
    };
  }
  
  private calculateStability(values: number[]): number {
    if (values.length < 10) return 1; // High stability if not enough data
    
    // Calculate rolling average variance
    const windowSize = 10;
    const rollingAverages: number[] = [];
    
    for (let i = 0; i <= values.length - windowSize; i++) {
      const window = values.slice(i, i + windowSize);
      const avg = window.reduce((a, b) => a + b, 0) / windowSize;
      rollingAverages.push(avg);
    }
    
    if (rollingAverages.length < 2) return 1;
    
    // Calculate variance of rolling averages
    const mean = rollingAverages.reduce((a, b) => a + b, 0) / rollingAverages.length;
    const variance = rollingAverages.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / rollingAverages.length;
    
    // Stability = 1 - variance (bounded 0-1)
    return Math.max(0, Math.min(1, 1 - Math.sqrt(variance) * 2));
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PROMOTION CHECK (for PR4)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Check if shadow model is ready for promotion.
   * Returns decision and reasoning.
   */
  async checkPromotionReadiness(horizon: ExchangeHorizon): Promise<{
    ready: boolean;
    reason: string;
    metrics: {
      sampleCount: number;
      accuracyDelta: number;
      shadowAccuracy: number;
      activeAccuracy: number;
      stabilityOk: boolean;
    };
  }> {
    const metrics = await this.calculateMetrics(horizon);
    
    const sampleCount = metrics.resolvedPredictions;
    const minSamples = this.config.minSamplesForPromotion;
    const minImprovement = this.config.minImprovementForPromotion;
    
    // Check sample count
    if (sampleCount < minSamples) {
      return {
        ready: false,
        reason: `Not enough samples: ${sampleCount} < ${minSamples}`,
        metrics: {
          sampleCount,
          accuracyDelta: metrics.accuracyDelta,
          shadowAccuracy: metrics.shadowAccuracy,
          activeAccuracy: metrics.activeAccuracy,
          stabilityOk: metrics.shadowStability >= 0.5,
        },
      };
    }
    
    // Check if shadow is better
    if (metrics.accuracyDelta < minImprovement) {
      return {
        ready: false,
        reason: `Improvement too small: ${(metrics.accuracyDelta * 100).toFixed(2)}% < ${(minImprovement * 100).toFixed(2)}%`,
        metrics: {
          sampleCount,
          accuracyDelta: metrics.accuracyDelta,
          shadowAccuracy: metrics.shadowAccuracy,
          activeAccuracy: metrics.activeAccuracy,
          stabilityOk: metrics.shadowStability >= 0.5,
        },
      };
    }
    
    // Check stability
    if (metrics.shadowStability < 0.5) {
      return {
        ready: false,
        reason: `Shadow model unstable: stability=${metrics.shadowStability.toFixed(2)} < 0.5`,
        metrics: {
          sampleCount,
          accuracyDelta: metrics.accuracyDelta,
          shadowAccuracy: metrics.shadowAccuracy,
          activeAccuracy: metrics.activeAccuracy,
          stabilityOk: false,
        },
      };
    }
    
    return {
      ready: true,
      reason: `Shadow outperforms active by ${(metrics.accuracyDelta * 100).toFixed(2)}% over ${sampleCount} samples`,
      metrics: {
        sampleCount,
        accuracyDelta: metrics.accuracyDelta,
        shadowAccuracy: metrics.shadowAccuracy,
        activeAccuracy: metrics.activeAccuracy,
        stabilityOk: true,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let metricsInstance: ExchangeShadowMetricsService | null = null;

export function getExchangeShadowMetricsService(db: Db): ExchangeShadowMetricsService {
  if (!metricsInstance) {
    metricsInstance = new ExchangeShadowMetricsService(db);
  }
  return metricsInstance;
}

console.log('[Exchange ML] Shadow metrics service loaded');
