/**
 * Exchange Auto-Rollback Service (Capital-Centric v2)
 * ====================================================
 * 
 * COMPLETELY REWRITTEN to eliminate Rollback Storm.
 * 
 * Key changes:
 * - Decisions based on TradeWinRate, MaxDrawdown, StabilityScore
 * - NOT based on raw accuracy or drift
 * - Rollback cooldown: max 1 rollback per 14 days
 * - Multi-condition trigger: must meet MULTIPLE bad conditions
 * 
 * Rollback triggers (must meet multiple):
 * 1. STREAK_KILLER: consecutiveLosses >= 12 AND (drawdown > 12% OR winRate < 45%)
 * 2. CAPITAL_INSTABILITY: drawdown > 12% AND stability < 0.50 AND winRate < 45%
 */

import { Db } from 'mongodb';
import {
  AUTOROLLBACK_CONFIG,
  RollbackCheckResult,
} from './exchange_lifecycle.config.js';
import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';
import { getExchangeModelRegistryService } from '../training/exchange_model_registry.service.js';
import { getExchangeEventLoggerService } from './exchange_event_logger.service.js';
import {
  ExchangePerformanceTracker,
  TradeOutcome,
} from '../perf/exchange_performance_tracker.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface RollbackDeps {
  // Load resolved trades for performance calculation
  loadResolvedTrades: (params: {
    symbol: string;
    horizon: ExchangeHorizon;
    nowT: number;
    days: number;
    modelId: string;
  }) => Promise<TradeOutcome[]>;
  
  // Get last rollback timestamp
  getLastRollbackTime: (horizon: ExchangeHorizon) => Promise<Date | null>;
  
  // Current time provider (for simulation support)
  nowT: () => number;
}

// ═══════════════════════════════════════════════════════════════
// AUTO-ROLLBACK SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExchangeAutoRollbackService {
  private perf = new ExchangePerformanceTracker();
  
  constructor(
    private db: Db,
    private deps?: RollbackDeps
  ) {}
  
  // ═══════════════════════════════════════════════════════════════
  // MAIN EVALUATION METHOD
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Evaluate if active model should be rolled back.
   * Uses CAPITAL-CENTRIC metrics only.
   */
  async evaluateRollback(
    horizon: ExchangeHorizon,
    symbol: string = 'BTC'
  ): Promise<RollbackCheckResult> {
    const config = AUTOROLLBACK_CONFIG.horizons[horizon];
    const globalConfig = AUTOROLLBACK_CONFIG.global;
    
    const registryService = getExchangeModelRegistryService(this.db);
    const eventLogger = getExchangeEventLoggerService(this.db);
    
    // Get active model
    const registry = await registryService.getRegistry(horizon);
    
    if (!registry?.activeModelId) {
      return this.noRollbackResult('No active model', 'NONE');
    }
    
    // Check if there's a previous model to rollback to
    if (!registry.prevModelId) {
      return this.noRollbackResult('No previous model to rollback to', 'NONE');
    }
    
    // 1️⃣ COOLDOWN CHECK: Prevents rollback storm
    const lastRollback = await eventLogger.getLastRollback(horizon);
    const nowMs = this.deps?.nowT ? this.deps.nowT() * 1000 : Date.now();
    
    let daysSinceLastRollback = Infinity;
    if (lastRollback) {
      daysSinceLastRollback = (nowMs - lastRollback.timestamp.getTime()) / (1000 * 60 * 60 * 24);
    }
    
    const cooldownPassed = daysSinceLastRollback >= globalConfig.cooldownDays;
    
    // 2️⃣ LOAD PERFORMANCE DATA
    const nowT = this.deps?.nowT ? this.deps.nowT() : Math.floor(Date.now() / 1000);
    
    let trades: TradeOutcome[] = [];
    if (this.deps?.loadResolvedTrades) {
      trades = await this.deps.loadResolvedTrades({
        symbol,
        horizon,
        nowT,
        days: config.windowDays,
        modelId: registry.activeModelId,
      });
    } else {
      // Fallback: load from shadow recorder
      trades = await this.loadTradesFromShadowRecorder(horizon, config.windowDays, registry.activeModelId);
    }
    
    // 3️⃣ COMPUTE PERFORMANCE WINDOW
    const window = this.perf.computeWindow({
      horizon,
      symbol,
      windowDays: config.windowDays,
      nowT,
      trades,
    });
    
    // 4️⃣ BUILD CHECK RESULT
    const checks: RollbackCheckResult['checks'] = {
      sampleCount: {
        sufficient: window.sampleCount >= config.minSamples,
        value: window.sampleCount,
        required: config.minSamples,
      },
      winRate: {
        triggered: window.tradeWinRate < config.winRateFloor,
        value: window.tradeWinRate,
        floor: config.winRateFloor,
      },
      drawdown: {
        triggered: window.maxDrawdown > config.maxDrawdownCeil,
        value: window.maxDrawdown,
        ceiling: config.maxDrawdownCeil,
      },
      stability: {
        triggered: window.stabilityScore < config.minStability,
        value: window.stabilityScore,
        floor: config.minStability,
      },
      consecutiveLosses: {
        triggered: window.consecutiveLossMax >= config.maxConsecutiveLosses,
        value: window.consecutiveLossMax,
        threshold: config.maxConsecutiveLosses,
      },
      cooldown: {
        passed: cooldownPassed,
        daysSince: daysSinceLastRollback,
        required: globalConfig.cooldownDays,
      },
    };
    
    const currentWindow = {
      tradeWinRate: window.tradeWinRate,
      sharpeLike: window.sharpeLike,
      maxDrawdown: window.maxDrawdown,
      stabilityScore: window.stabilityScore,
      consecutiveLossMax: window.consecutiveLossMax,
    };
    
    // 5️⃣ GUARD: Not enough samples
    if (!checks.sampleCount.sufficient) {
      return {
        shouldRollback: false,
        reason: `Insufficient samples: ${window.sampleCount} < ${config.minSamples}`,
        severity: 'NONE',
        checks,
        currentWindow,
      };
    }
    
    // 6️⃣ GUARD: Cooldown not passed
    if (!cooldownPassed) {
      return {
        shouldRollback: false,
        reason: `Cooldown active: ${daysSinceLastRollback.toFixed(1)} days < ${globalConfig.cooldownDays} days`,
        severity: 'WARNING',
        checks,
        currentWindow,
      };
    }
    
    // 7️⃣ ROLLBACK CONDITIONS (must meet multiple)
    
    // Condition 1: STREAK_KILLER
    // consecutiveLosses >= threshold AND (drawdown bad OR winRate bad)
    if (checks.consecutiveLosses.triggered && (checks.drawdown.triggered || checks.winRate.triggered)) {
      return {
        shouldRollback: true,
        reason: `STREAK_KILLER: ${window.consecutiveLossMax} consecutive losses, ` +
                `DD=${(window.maxDrawdown * 100).toFixed(1)}%, ` +
                `WinRate=${(window.tradeWinRate * 100).toFixed(1)}%`,
        severity: 'CRITICAL',
        checks,
        currentWindow,
      };
    }
    
    // Condition 2: CAPITAL_INSTABILITY
    // drawdown bad AND stability bad AND winRate bad
    if (checks.drawdown.triggered && checks.stability.triggered && checks.winRate.triggered) {
      return {
        shouldRollback: true,
        reason: `CAPITAL_INSTABILITY: WinRate=${(window.tradeWinRate * 100).toFixed(1)}%, ` +
                `DD=${(window.maxDrawdown * 100).toFixed(1)}%, ` +
                `Stability=${window.stabilityScore.toFixed(2)}`,
        severity: 'CRITICAL',
        checks,
        currentWindow,
      };
    }
    
    // 8️⃣ WARNING: Metrics degrading but not critical
    if (checks.winRate.triggered || checks.drawdown.triggered) {
      return {
        shouldRollback: false,
        reason: `WARNING: Metrics degrading - WinRate=${(window.tradeWinRate * 100).toFixed(1)}%, ` +
                `DD=${(window.maxDrawdown * 100).toFixed(1)}%`,
        severity: 'WARNING',
        checks,
        currentWindow,
      };
    }
    
    // All checks passed - no rollback needed
    return {
      shouldRollback: false,
      reason: 'HEALTHY: All metrics within acceptable range',
      severity: 'NONE',
      checks,
      currentWindow,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // EXECUTE ROLLBACK
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Execute rollback if checks trigger.
   */
  async executeRollback(
    horizon: ExchangeHorizon,
    symbol: string = 'BTC'
  ): Promise<{
    rolledBack: boolean;
    result: RollbackCheckResult;
    rolledBackTo?: string;
  }> {
    const result = await this.evaluateRollback(horizon, symbol);
    
    if (!result.shouldRollback) {
      return { rolledBack: false, result };
    }
    
    const registryService = getExchangeModelRegistryService(this.db);
    const eventLogger = getExchangeEventLoggerService(this.db);
    
    // Get current state
    const registry = await registryService.getRegistry(horizon);
    const fromModelId = registry!.activeModelId!;
    const toModelId = registry!.prevModelId!;
    
    // Execute rollback
    const rollbackResult = await registryService.rollbackToPrevious(horizon);
    
    if (!rollbackResult.success) {
      return {
        rolledBack: false,
        result: {
          ...result,
          shouldRollback: false,
          reason: `Rollback failed: ${rollbackResult.error}`,
        },
      };
    }
    
    // Log the event
    await eventLogger.logRollback({
      horizon,
      fromModelId,
      toModelId,
      reason: result.reason,
      metrics: {
        ...result.currentWindow,
        severity: result.severity,
      },
    });
    
    console.log(
      `[AutoRollback] ⚠️ ${horizon} rolled back: ${fromModelId} -> ${toModelId} ` +
      `(${result.reason})`
    );
    
    return {
      rolledBack: true,
      result,
      rolledBackTo: toModelId,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // EVALUATE ALL HORIZONS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Evaluate all horizons.
   */
  async evaluateAllHorizons(symbol: string = 'BTC'): Promise<Record<ExchangeHorizon, RollbackCheckResult>> {
    const horizons: ExchangeHorizon[] = ['1D', '7D', '30D'];
    const results: Record<ExchangeHorizon, RollbackCheckResult> = {} as any;
    
    for (const horizon of horizons) {
      results[horizon] = await this.evaluateRollback(horizon, symbol);
    }
    
    return results;
  }
  
  /**
   * Execute rollback for all horizons that need it.
   */
  async executeAllRollbacks(symbol: string = 'BTC'): Promise<{
    results: Record<ExchangeHorizon, { rolledBack: boolean; reason: string; severity: string }>;
    totalRolledBack: number;
  }> {
    const horizons: ExchangeHorizon[] = ['1D', '7D', '30D'];
    const results: Record<ExchangeHorizon, { rolledBack: boolean; reason: string; severity: string }> = {} as any;
    let totalRolledBack = 0;
    
    for (const horizon of horizons) {
      const result = await this.executeRollback(horizon, symbol);
      results[horizon] = {
        rolledBack: result.rolledBack,
        reason: result.result.reason,
        severity: result.result.severity,
      };
      if (result.rolledBack) totalRolledBack++;
    }
    
    return { results, totalRolledBack };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════
  
  private noRollbackResult(reason: string, severity: RollbackCheckResult['severity']): RollbackCheckResult {
    return {
      shouldRollback: false,
      reason,
      severity,
      checks: {
        sampleCount: { sufficient: false, value: 0, required: 0 },
        winRate: { triggered: false, value: 0, floor: 0 },
        drawdown: { triggered: false, value: 0, ceiling: 0 },
        stability: { triggered: false, value: 0, floor: 0 },
        consecutiveLosses: { triggered: false, value: 0, threshold: 0 },
        cooldown: { passed: true, daysSince: Infinity, required: 0 },
      },
    };
  }
  
  /**
   * Fallback: load trades from shadow recorder if no deps provided.
   */
  private async loadTradesFromShadowRecorder(
    horizon: ExchangeHorizon,
    _windowDays: number,
    modelId: string
  ): Promise<TradeOutcome[]> {
    try {
      const { getExchangeShadowRecorderService } = await import('../shadow/exchange_shadow_recorder.service.js');
      const recorderService = getExchangeShadowRecorderService(this.db);
      
      const predictions = await recorderService.getRecentPredictions({
        horizon,
        resolvedOnly: true,
        limit: 500,
      });
      
      // Convert to TradeOutcome format
      return predictions
        .filter(p => p.activeModelId === modelId && p.actualLabel !== 'NEUTRAL')
        .map(p => ({
          t: Math.floor(new Date(p.resolvedAt || p.createdAt).getTime() / 1000),
          horizon,
          symbol: p.symbol || 'BTC',
          // Use a default return since ShadowPrediction doesn't have actualReturn
          // In production, this should come from the actual price data
          returnPct: p.activeCorrect ? 0.01 : -0.01,
          result: p.activeCorrect ? 'WIN' : 'LOSS' as const,
          modelId: p.activeModelId || modelId,
        }));
    } catch (error) {
      console.warn('[AutoRollback] Could not load from shadow recorder:', error);
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let rollbackInstance: ExchangeAutoRollbackService | null = null;

export function getExchangeAutoRollbackService(db: Db, deps?: RollbackDeps): ExchangeAutoRollbackService {
  if (!rollbackInstance) {
    rollbackInstance = new ExchangeAutoRollbackService(db, deps);
  }
  return rollbackInstance;
}

// Reset instance (for testing)
export function resetExchangeAutoRollbackService(): void {
  rollbackInstance = null;
}

console.log('[Exchange ML] Auto-rollback service loaded (Capital-Centric v2)');
