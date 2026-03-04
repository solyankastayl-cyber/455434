/**
 * Fractal Auto-Promotion Service
 * 
 * CAPITAL-CENTRIC auto-promotion logic for Fractal models.
 * 
 * Key Principles:
 * 1. Promotion based on PatternMatchRate + Risk metrics (NOT raw accuracy)
 * 2. Multi-window sustained lift required (no single-spike promotions)
 * 3. Maximum drawdown constraint (hard gate)
 * 4. Stability score requirement (no unstable models promoted)
 * 5. Cooldown periods to prevent promotion storms
 * 
 * Adapted from Exchange module but for Fractal pattern matching.
 */

import { Db, Collection } from 'mongodb';
import {
  FractalHorizon,
  FRACTAL_AUTOPROMOTION_CONFIG,
  FRACTAL_SUSTAINED_LIFT_CONFIG,
  PromotionCheckResult,
  FractalModelEvent,
  FractalModelEventType,
} from './fractal_lifecycle.config.js';
import {
  FractalModelRegistryService,
  getFractalModelRegistryService,
} from './fractal_model_registry.service.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const MODEL_EVENTS_COLLECTION = 'fractal_model_events';
const SHADOW_METRICS_COLLECTION = 'fractal_shadow_metrics';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface ShadowMetricWindow {
  horizon: FractalHorizon;
  windowIndex: number;
  startDate: Date;
  endDate: Date;
  predictions: number;
  activeMetrics: {
    patternMatchRate: number;
    sharpeLike: number;
    maxDrawdown: number;
    stabilityScore: number;
  };
  shadowMetrics: {
    patternMatchRate: number;
    sharpeLike: number;
    maxDrawdown: number;
    stabilityScore: number;
  };
  lift: {
    patternMatchRateLift: number;
    sharpeLift: number;
  };
}

interface SustainedLiftResult {
  pass: boolean;
  windowsEvaluated: number;
  windowsPassed: number;
  windowDetails: {
    windowIndex: number;
    passed: boolean;
    predictions: number;
    patternMatchRateLift: number;
    sharpeLift: number;
  }[];
  reason: string;
}

// ═══════════════════════════════════════════════════════════════
// AUTO-PROMOTION SERVICE
// ═══════════════════════════════════════════════════════════════

export class FractalAutoPromotionService {
  private eventsCollection: Collection<FractalModelEvent>;
  private shadowMetricsCollection: Collection<ShadowMetricWindow>;
  private registryService: FractalModelRegistryService;
  
  constructor(private db: Db) {
    this.eventsCollection = db.collection<FractalModelEvent>(MODEL_EVENTS_COLLECTION);
    this.shadowMetricsCollection = db.collection<ShadowMetricWindow>(SHADOW_METRICS_COLLECTION);
    this.registryService = getFractalModelRegistryService(db);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════
  
  async ensureIndexes(): Promise<void> {
    await this.eventsCollection.createIndex(
      { horizon: 1, timestamp: -1 },
      { name: 'idx_fractal_events_horizon_ts' }
    );
    
    await this.eventsCollection.createIndex(
      { type: 1, timestamp: -1 },
      { name: 'idx_fractal_events_type_ts' }
    );
    
    await this.shadowMetricsCollection.createIndex(
      { horizon: 1, endDate: -1 },
      { name: 'idx_fractal_shadow_horizon_date' }
    );
    
    console.log('[FractalAutoPromotion] Indexes ensured');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PROMOTION CHECK (Capital-Centric)
  // ═══════════════════════════════════════════════════════════════
  
  async checkPromotionEligibility(horizon: FractalHorizon): Promise<PromotionCheckResult> {
    const config = FRACTAL_AUTOPROMOTION_CONFIG.horizons[horizon];
    const globalConfig = FRACTAL_AUTOPROMOTION_CONFIG.global;
    
    // Get registry state
    const registry = await this.registryService.getRegistry(horizon);
    if (!registry?.shadowModelId) {
      return this.failResult('No shadow model available for promotion');
    }
    
    // Check cooldown
    const daysSincePromotion = registry.lastPromotionAt
      ? Math.floor((Date.now() - registry.lastPromotionAt.getTime()) / (24 * 60 * 60 * 1000))
      : Infinity;
    
    if (daysSincePromotion < globalConfig.minDaysBetweenPromotions) {
      return this.failResult(
        `Cooldown active: ${daysSincePromotion}/${globalConfig.minDaysBetweenPromotions} days since last promotion`
      );
    }
    
    // Get recent shadow metrics
    const recentMetrics = await this.getRecentShadowMetrics(horizon, config.windowDays);
    
    if (recentMetrics.length === 0) {
      return this.failResult('No shadow metrics available');
    }
    
    // Calculate aggregated metrics
    const totalPredictions = recentMetrics.reduce((sum, m) => sum + m.predictions, 0);
    const avgActiveMetrics = this.aggregateMetrics(recentMetrics.map(m => m.activeMetrics));
    const avgShadowMetrics = this.aggregateMetrics(recentMetrics.map(m => m.shadowMetrics));
    
    // Sample count check
    if (totalPredictions < config.minSamples) {
      return this.failResult(`Insufficient samples: ${totalPredictions}/${config.minSamples}`);
    }
    
    // Calculate lifts
    const patternMatchRateLift = avgShadowMetrics.patternMatchRate - avgActiveMetrics.patternMatchRate;
    const sharpeLift = avgShadowMetrics.sharpeLike - avgActiveMetrics.sharpeLike;
    
    // Build result
    const checks: PromotionCheckResult['checks'] = {
      sampleCount: {
        passed: totalPredictions >= config.minSamples,
        value: totalPredictions,
        required: config.minSamples,
      },
      winRateLift: {
        passed: patternMatchRateLift >= config.minWinRateLift,
        value: patternMatchRateLift,
        required: config.minWinRateLift,
      },
      sharpeLift: {
        passed: sharpeLift >= config.minSharpeLift,
        value: sharpeLift,
        required: config.minSharpeLift,
      },
      shadowDrawdown: {
        passed: avgShadowMetrics.maxDrawdown <= config.maxDDForPromo,
        value: avgShadowMetrics.maxDrawdown,
        maxAllowed: config.maxDDForPromo,
      },
      shadowStability: {
        passed: avgShadowMetrics.stabilityScore >= config.minStability,
        value: avgShadowMetrics.stabilityScore,
        minRequired: config.minStability,
      },
      cooldown: {
        passed: daysSincePromotion >= config.cooldownDays,
        daysSince: daysSincePromotion,
        required: config.cooldownDays,
      },
    };
    
    // All checks must pass
    const allPassed = Object.values(checks).every(c => 
      'passed' in c ? c.passed : !('triggered' in c) || !c.triggered
    );
    
    // Check sustained lift
    let sustainedLiftResult: SustainedLiftResult | null = null;
    if (allPassed) {
      sustainedLiftResult = await this.checkSustainedLift(horizon);
      if (!sustainedLiftResult.pass) {
        return {
          shouldPromote: false,
          reason: `Sustained lift check failed: ${sustainedLiftResult.reason}`,
          checks,
          activeWindow: avgActiveMetrics,
          shadowWindow: avgShadowMetrics,
        };
      }
    }
    
    return {
      shouldPromote: allPassed,
      reason: allPassed
        ? 'All promotion checks passed'
        : 'Some promotion checks failed',
      checks,
      activeWindow: avgActiveMetrics,
      shadowWindow: avgShadowMetrics,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SUSTAINED LIFT CHECK (Anti-Promotion Storm)
  // ═══════════════════════════════════════════════════════════════
  
  async checkSustainedLift(horizon: FractalHorizon): Promise<SustainedLiftResult> {
    const config = FRACTAL_SUSTAINED_LIFT_CONFIG;
    const windowDetails: SustainedLiftResult['windowDetails'] = [];
    
    const now = new Date();
    
    for (let i = 0; i < config.SUSTAINED_WINDOWS; i++) {
      const windowEnd = new Date(now.getTime() - i * config.WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const windowStart = new Date(windowEnd.getTime() - config.WINDOW_DAYS * 24 * 60 * 60 * 1000);
      
      const windowMetrics = await this.shadowMetricsCollection
        .find({
          horizon,
          endDate: { $gte: windowStart, $lte: windowEnd },
        })
        .toArray();
      
      const totalPredictions = windowMetrics.reduce((sum, m) => sum + m.predictions, 0);
      const avgLift = windowMetrics.length > 0
        ? windowMetrics.reduce((sum, m) => sum + m.lift.patternMatchRateLift, 0) / windowMetrics.length
        : 0;
      const avgSharpeLift = windowMetrics.length > 0
        ? windowMetrics.reduce((sum, m) => sum + m.lift.sharpeLift, 0) / windowMetrics.length
        : 0;
      
      const passed = totalPredictions >= config.MIN_PREDICTIONS_PER_WINDOW
        && avgLift >= config.MIN_WIN_RATE_LIFT
        && avgSharpeLift >= config.MIN_SHARPE_LIFT;
      
      windowDetails.push({
        windowIndex: i,
        passed,
        predictions: totalPredictions,
        patternMatchRateLift: avgLift,
        sharpeLift: avgSharpeLift,
      });
    }
    
    const windowsPassed = windowDetails.filter(w => w.passed).length;
    const pass = windowsPassed === config.SUSTAINED_WINDOWS;
    
    return {
      pass,
      windowsEvaluated: config.SUSTAINED_WINDOWS,
      windowsPassed,
      windowDetails,
      reason: pass
        ? `All ${config.SUSTAINED_WINDOWS} windows showed sustained lift`
        : `Only ${windowsPassed}/${config.SUSTAINED_WINDOWS} windows passed`,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // EXECUTE PROMOTION
  // ═══════════════════════════════════════════════════════════════
  
  async executePromotion(horizon: FractalHorizon): Promise<{
    success: boolean;
    promotedModelId?: string;
    previousModelId?: string;
    error?: string;
  }> {
    const registry = await this.registryService.getRegistry(horizon);
    if (!registry?.shadowModelId) {
      return { success: false, error: 'No shadow model to promote' };
    }
    
    const previousModelId = registry.activeModelId || undefined;
    
    const result = await this.registryService.promoteShadowToActive(horizon);
    
    if (result.success) {
      await this.logEvent({
        type: 'PROMOTED',
        horizon,
        fromModelId: previousModelId,
        toModelId: result.promotedModelId,
        reason: 'Auto-promotion: All checks passed',
        timestamp: new Date(),
        createdAt: new Date(),
      });
      
      console.log(`[FractalAutoPromotion] Promoted model for ${horizon}: ${previousModelId} -> ${result.promotedModelId}`);
    }
    
    return {
      success: result.success,
      promotedModelId: result.promotedModelId,
      previousModelId,
      error: result.error,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════
  
  private async getRecentShadowMetrics(horizon: FractalHorizon, days: number): Promise<ShadowMetricWindow[]> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.shadowMetricsCollection
      .find({
        horizon,
        endDate: { $gte: cutoff },
      })
      .sort({ endDate: -1 })
      .toArray() as Promise<ShadowMetricWindow[]>;
  }
  
  private aggregateMetrics(metrics: Array<{
    patternMatchRate: number;
    sharpeLike: number;
    maxDrawdown: number;
    stabilityScore: number;
  }>): {
    patternMatchRate: number;
    sharpeLike: number;
    maxDrawdown: number;
    stabilityScore: number;
  } {
    if (metrics.length === 0) {
      return { patternMatchRate: 0, sharpeLike: 0, maxDrawdown: 1, stabilityScore: 0 };
    }
    
    return {
      patternMatchRate: metrics.reduce((sum, m) => sum + m.patternMatchRate, 0) / metrics.length,
      sharpeLike: metrics.reduce((sum, m) => sum + m.sharpeLike, 0) / metrics.length,
      maxDrawdown: Math.max(...metrics.map(m => m.maxDrawdown)),
      stabilityScore: metrics.reduce((sum, m) => sum + m.stabilityScore, 0) / metrics.length,
    };
  }
  
  private failResult(reason: string): PromotionCheckResult {
    return {
      shouldPromote: false,
      reason,
      checks: {
        sampleCount: { passed: false, value: 0, required: 0 },
        winRateLift: { passed: false, value: 0, required: 0 },
        sharpeLift: { passed: false, value: 0, required: 0 },
        shadowDrawdown: { passed: false, value: 1, maxAllowed: 0 },
        shadowStability: { passed: false, value: 0, minRequired: 0 },
        cooldown: { passed: false, daysSince: 0, required: 0 },
      },
    };
  }
  
  async logEvent(event: FractalModelEvent): Promise<void> {
    await this.eventsCollection.insertOne(event as any);
  }
  
  async getRecentEvents(horizon: FractalHorizon, limit: number = 50): Promise<FractalModelEvent[]> {
    return this.eventsCollection
      .find({ horizon })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray() as Promise<FractalModelEvent[]>;
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let promotionServiceInstance: FractalAutoPromotionService | null = null;

export function getFractalAutoPromotionService(db: Db): FractalAutoPromotionService {
  if (!promotionServiceInstance) {
    promotionServiceInstance = new FractalAutoPromotionService(db);
  }
  return promotionServiceInstance;
}

console.log('[Fractal ML] Auto-promotion service loaded (Capital-Centric v1)');
