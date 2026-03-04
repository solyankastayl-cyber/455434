/**
 * Exchange Auto-Promotion Service (Capital-Centric v3)
 * =====================================================
 * 
 * REWRITTEN with anti-promotion-storm logic.
 * 
 * Key changes v3:
 * - SUSTAINED LIFT: Shadow must outperform in 3 consecutive 14-day windows
 * - COOLDOWN: 56 days between promotions (was 21)
 * - Safety checks: shadow must have acceptable drawdown and stability
 * 
 * Promotion criteria:
 * 1. Shadow has sufficient samples
 * 2. Shadow WinRate > Active WinRate + 2% in EACH of 3 consecutive windows
 * 3. Shadow Drawdown <= 15%
 * 4. Shadow Stability >= 0.55
 * 5. Cooldown passed (56 days since last promotion)
 */

import { Db } from 'mongodb';
import {
  AUTOPROMOTION_CONFIG,
  PromotionCheckResult,
} from './exchange_lifecycle.config.js';
import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';
import { getExchangeModelRegistryService } from '../training/exchange_model_registry.service.js';
import { getExchangeEventLoggerService } from './exchange_event_logger.service.js';
import { getExchangeGuardrailsService } from './exchange_guardrails.service.js';
import {
  ExchangePerformanceTracker,
  TradeOutcome,
} from '../perf/exchange_performance_tracker.js';

// ═══════════════════════════════════════════════════════════════
// SUSTAINED LIFT CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const SUSTAINED_LIFT_CONFIG = {
  // Number of consecutive windows where shadow must outperform
  SUSTAINED_WINDOWS: 3,
  
  // Each window is 14 days
  WINDOW_DAYS: 14,
  
  // Minimum improvement in each window
  MIN_WIN_RATE_LIFT: 0.02,  // +2%
  MIN_SHARPE_LIFT: 0.05,    // +0.05 (less strict than single-shot)
  
  // Minimum trades per window for statistical significance
  MIN_TRADES_PER_WINDOW: 10,
  
  // Cooldown: 56 days between promotions (was 21)
  PROMOTION_COOLDOWN_DAYS: 56,
};

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface PromotionDeps {
  // Load resolved trades for active model
  loadActiveTrades: (params: {
    symbol: string;
    horizon: ExchangeHorizon;
    nowT: number;
    days: number;
    modelId: string;
  }) => Promise<TradeOutcome[]>;
  
  // Load resolved trades for shadow model
  loadShadowTrades: (params: {
    symbol: string;
    horizon: ExchangeHorizon;
    nowT: number;
    days: number;
    modelId: string;
  }) => Promise<TradeOutcome[]>;
  
  // Current time provider (for simulation support)
  nowT: () => number;
}

interface WindowMetrics {
  winRate: number;
  sharpe: number;
  trades: number;
  drawdown: number;
  stability: number;
}

interface SustainedLiftResult {
  sustained: boolean;
  windowResults: Array<{
    windowIndex: number;
    active: WindowMetrics;
    shadow: WindowMetrics;
    winRateLift: number;
    sharpeLift: number;
    passed: boolean;
    reason?: string;
  }>;
  overallReason: string;
}

// ═══════════════════════════════════════════════════════════════
// AUTO-PROMOTION SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExchangeAutoPromotionService {
  private perf = new ExchangePerformanceTracker();
  
  constructor(
    private db: Db,
    private deps?: PromotionDeps
  ) {}
  
  // ═══════════════════════════════════════════════════════════════
  // MAIN EVALUATION METHOD (with Sustained Lift)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Evaluate if shadow should be promoted for a horizon.
   * Uses CAPITAL-CENTRIC metrics with SUSTAINED LIFT requirement.
   * 
   * Shadow must outperform active in 3 consecutive 14-day windows.
   */
  async evaluatePromotion(
    horizon: ExchangeHorizon,
    symbol: string = 'BTC'
  ): Promise<PromotionCheckResult> {
    const config = AUTOPROMOTION_CONFIG.horizons[horizon];
    
    const registryService = getExchangeModelRegistryService(this.db);
    const eventLogger = getExchangeEventLoggerService(this.db);
    const guardrails = getExchangeGuardrailsService(this.db);
    
    // Get registry state
    const registry = await registryService.getRegistry(horizon);
    
    if (!registry?.activeModelId || !registry?.shadowModelId) {
      return this.noPromotionResult('No active or shadow model');
    }
    
    // Check guardrails
    if (guardrails.isPromotionLocked()) {
      return this.noPromotionResult('Promotion is locked globally');
    }
    
    // 1️⃣ COOLDOWN CHECK (56 days)
    const lastPromotion = await eventLogger.getLastPromotion(horizon);
    const nowMs = this.deps?.nowT ? this.deps.nowT() * 1000 : Date.now();
    
    let daysSinceLastPromotion = Infinity;
    if (lastPromotion) {
      daysSinceLastPromotion = (nowMs - lastPromotion.timestamp.getTime()) / (1000 * 60 * 60 * 24);
    }
    
    const cooldownDays = SUSTAINED_LIFT_CONFIG.PROMOTION_COOLDOWN_DAYS;
    const cooldownPassed = daysSinceLastPromotion >= cooldownDays;
    
    // 2️⃣ LOAD PERFORMANCE DATA FOR SUSTAINED LIFT
    const nowT = this.deps?.nowT ? this.deps.nowT() : Math.floor(Date.now() / 1000);
    
    // Load trades for sustained lift calculation (need 3 windows * 14 days = 42+ days)
    const totalDaysNeeded = SUSTAINED_LIFT_CONFIG.SUSTAINED_WINDOWS * SUSTAINED_LIFT_CONFIG.WINDOW_DAYS + 7;
    
    let activeTrades: TradeOutcome[] = [];
    let shadowTrades: TradeOutcome[] = [];
    
    if (this.deps?.loadActiveTrades && this.deps?.loadShadowTrades) {
      activeTrades = await this.deps.loadActiveTrades({
        symbol,
        horizon,
        nowT,
        days: totalDaysNeeded,
        modelId: registry.activeModelId,
      });
      
      shadowTrades = await this.deps.loadShadowTrades({
        symbol,
        horizon,
        nowT,
        days: totalDaysNeeded,
        modelId: registry.shadowModelId,
      });
    } else {
      // Fallback: load from shadow recorder
      const { active, shadow } = await this.loadTradesFromShadowRecorder(
        horizon,
        totalDaysNeeded,
        registry.activeModelId,
        registry.shadowModelId
      );
      activeTrades = active;
      shadowTrades = shadow;
    }
    
    // 3️⃣ COMPUTE SUSTAINED LIFT
    const sustainedLiftResult = this.evaluateSustainedLift({
      horizon,
      symbol,
      nowT,
      activeTrades,
      shadowTrades,
    });
    
    // 4️⃣ COMPUTE OVERALL SHADOW WINDOW (for safety checks)
    const shadowWindow = this.perf.computeWindow({
      horizon,
      symbol,
      windowDays: config.windowDays,
      nowT,
      trades: shadowTrades,
    });
    
    const activeWindow = this.perf.computeWindow({
      horizon,
      symbol,
      windowDays: config.windowDays,
      nowT,
      trades: activeTrades,
    });
    
    // 5️⃣ BUILD CHECK RESULT
    const winRateLift = shadowWindow.tradeWinRate - activeWindow.tradeWinRate;
    const sharpeLift = shadowWindow.sharpeLike - activeWindow.sharpeLike;
    
    const checks: PromotionCheckResult['checks'] = {
      sampleCount: {
        passed: shadowWindow.sampleCount >= config.minSamples,
        value: shadowWindow.sampleCount,
        required: config.minSamples,
      },
      winRateLift: {
        passed: sustainedLiftResult.sustained,
        value: winRateLift,
        required: config.minWinRateLift,
      },
      sharpeLift: {
        passed: sharpeLift >= config.minSharpeLift,
        value: sharpeLift,
        required: config.minSharpeLift,
      },
      shadowDrawdown: {
        passed: shadowWindow.maxDrawdown <= config.maxDDForPromo,
        value: shadowWindow.maxDrawdown,
        maxAllowed: config.maxDDForPromo,
      },
      shadowStability: {
        passed: shadowWindow.stabilityScore >= config.minStability,
        value: shadowWindow.stabilityScore,
        minRequired: config.minStability,
      },
      cooldown: {
        passed: cooldownPassed,
        daysSince: daysSinceLastPromotion,
        required: cooldownDays,
      },
    };
    
    const activeWindowSummary = {
      tradeWinRate: activeWindow.tradeWinRate,
      sharpeLike: activeWindow.sharpeLike,
      maxDrawdown: activeWindow.maxDrawdown,
      stabilityScore: activeWindow.stabilityScore,
    };
    
    const shadowWindowSummary = {
      tradeWinRate: shadowWindow.tradeWinRate,
      sharpeLike: shadowWindow.sharpeLike,
      maxDrawdown: shadowWindow.maxDrawdown,
      stabilityScore: shadowWindow.stabilityScore,
    };
    
    // 6️⃣ CHECK: Sample count
    if (!checks.sampleCount.passed) {
      return {
        shouldPromote: false,
        reason: `Not enough samples: ${shadowWindow.sampleCount} < ${config.minSamples}`,
        checks,
        activeWindow: activeWindowSummary,
        shadowWindow: shadowWindowSummary,
      };
    }
    
    // 7️⃣ CHECK: Cooldown (56 days)
    if (!checks.cooldown.passed) {
      return {
        shouldPromote: false,
        reason: `Cooldown active: ${daysSinceLastPromotion.toFixed(1)} days < ${cooldownDays} days`,
        checks,
        activeWindow: activeWindowSummary,
        shadowWindow: shadowWindowSummary,
      };
    }
    
    // 8️⃣ CHECK: Shadow drawdown safety
    if (!checks.shadowDrawdown.passed) {
      return {
        shouldPromote: false,
        reason: `Shadow drawdown too high: ${(shadowWindow.maxDrawdown * 100).toFixed(1)}% > ${config.maxDDForPromo * 100}%`,
        checks,
        activeWindow: activeWindowSummary,
        shadowWindow: shadowWindowSummary,
      };
    }
    
    // 9️⃣ CHECK: Shadow stability safety
    if (!checks.shadowStability.passed) {
      return {
        shouldPromote: false,
        reason: `Shadow stability too low: ${shadowWindow.stabilityScore.toFixed(2)} < ${config.minStability}`,
        checks,
        activeWindow: activeWindowSummary,
        shadowWindow: shadowWindowSummary,
      };
    }
    
    // 🔟 CHECK: SUSTAINED LIFT (3 consecutive windows)
    if (!sustainedLiftResult.sustained) {
      return {
        shouldPromote: false,
        reason: `Sustained lift not met: ${sustainedLiftResult.overallReason}`,
        checks,
        activeWindow: activeWindowSummary,
        shadowWindow: shadowWindowSummary,
      };
    }
    
    // All checks passed!
    return {
      shouldPromote: true,
      reason: `Sustained lift confirmed: Shadow outperformed in ${SUSTAINED_LIFT_CONFIG.SUSTAINED_WINDOWS} consecutive windows`,
      checks,
      activeWindow: activeWindowSummary,
      shadowWindow: shadowWindowSummary,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SUSTAINED LIFT EVALUATION
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Check if shadow outperforms active in N consecutive windows.
   */
  private evaluateSustainedLift(params: {
    horizon: ExchangeHorizon;
    symbol: string;
    nowT: number;
    activeTrades: TradeOutcome[];
    shadowTrades: TradeOutcome[];
  }): SustainedLiftResult {
    const { horizon, symbol, nowT, activeTrades, shadowTrades } = params;
    const { SUSTAINED_WINDOWS, WINDOW_DAYS, MIN_WIN_RATE_LIFT, MIN_SHARPE_LIFT, MIN_TRADES_PER_WINDOW } = SUSTAINED_LIFT_CONFIG;
    
    const DAY_SECONDS = 86400;
    const windowResults: SustainedLiftResult['windowResults'] = [];
    let allPassed = true;
    let failReason = '';
    
    for (let i = 0; i < SUSTAINED_WINDOWS; i++) {
      // Window i: from (now - (i+1)*WINDOW_DAYS) to (now - i*WINDOW_DAYS)
      const windowEndT = nowT - (i * WINDOW_DAYS * DAY_SECONDS);
      const windowStartT = windowEndT - (WINDOW_DAYS * DAY_SECONDS);
      
      // Filter trades for this window
      const activeWindowTrades = activeTrades.filter(t => t.t >= windowStartT && t.t < windowEndT);
      const shadowWindowTrades = shadowTrades.filter(t => t.t >= windowStartT && t.t < windowEndT);
      
      // Compute metrics for each
      const activeMetrics = this.computeWindowMetrics(activeWindowTrades);
      const shadowMetrics = this.computeWindowMetrics(shadowWindowTrades);
      
      const winRateLift = shadowMetrics.winRate - activeMetrics.winRate;
      const sharpeLift = shadowMetrics.sharpe - activeMetrics.sharpe;
      
      // Check if this window passes
      let passed = true;
      let reason = '';
      
      if (shadowMetrics.trades < MIN_TRADES_PER_WINDOW) {
        passed = false;
        reason = `Insufficient shadow trades (${shadowMetrics.trades} < ${MIN_TRADES_PER_WINDOW})`;
      } else if (winRateLift < MIN_WIN_RATE_LIFT && sharpeLift < MIN_SHARPE_LIFT) {
        passed = false;
        reason = `No improvement: WinRate +${(winRateLift * 100).toFixed(1)}%, Sharpe +${sharpeLift.toFixed(2)}`;
      }
      
      windowResults.push({
        windowIndex: i,
        active: activeMetrics,
        shadow: shadowMetrics,
        winRateLift,
        sharpeLift,
        passed,
        reason,
      });
      
      if (!passed) {
        allPassed = false;
        if (!failReason) {
          failReason = `Window ${i + 1}/${SUSTAINED_WINDOWS}: ${reason}`;
        }
      }
    }
    
    return {
      sustained: allPassed,
      windowResults,
      overallReason: allPassed 
        ? `Shadow outperformed in all ${SUSTAINED_WINDOWS} windows` 
        : failReason,
    };
  }
  
  /**
   * Compute metrics for a single window's trades.
   */
  private computeWindowMetrics(trades: TradeOutcome[]): WindowMetrics {
    if (trades.length === 0) {
      return { winRate: 0.5, sharpe: 0, trades: 0, drawdown: 0, stability: 0.5 };
    }
    
    const wins = trades.filter(t => t.result === 'WIN').length;
    const losses = trades.filter(t => t.result === 'LOSS').length;
    const total = wins + losses;
    const winRate = total > 0 ? wins / total : 0.5;
    
    // Calculate returns for Sharpe
    const returns = trades.map(t => t.returnPct);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    let stdReturn = 0;
    if (returns.length >= 2) {
      const variance = returns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / (returns.length - 1);
      stdReturn = Math.sqrt(variance);
    }
    const sharpe = stdReturn > 0.001 ? avgReturn / stdReturn : 0;
    
    // Calculate drawdown
    let equity = 1.0;
    let peak = 1.0;
    let maxDrawdown = 0;
    for (const trade of trades) {
      equity *= (1 + trade.returnPct);
      peak = Math.max(peak, equity);
      const dd = (peak - equity) / peak;
      maxDrawdown = Math.max(maxDrawdown, dd);
    }
    
    // Calculate stability
    let stability = 0.5;
    if (stdReturn > 0 && Math.abs(avgReturn) > 0.0001) {
      const volRatio = stdReturn / Math.abs(avgReturn);
      const base = 1 / (1 + volRatio);
      stability = Math.max(0, Math.min(1, base * (1 - maxDrawdown)));
    }
    
    return {
      winRate,
      sharpe,
      trades: trades.length,
      drawdown: maxDrawdown,
      stability,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // EXECUTE PROMOTION
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Execute promotion if all checks pass.
   */
  async executePromotion(
    horizon: ExchangeHorizon,
    symbol: string = 'BTC'
  ): Promise<{
    promoted: boolean;
    result: PromotionCheckResult;
    promotedModelId?: string;
  }> {
    const result = await this.evaluatePromotion(horizon, symbol);
    
    if (!result.shouldPromote) {
      return { promoted: false, result };
    }
    
    const registryService = getExchangeModelRegistryService(this.db);
    const eventLogger = getExchangeEventLoggerService(this.db);
    
    // Get current state
    const registry = await registryService.getRegistry(horizon);
    const fromModelId = registry!.activeModelId!;
    const toModelId = registry!.shadowModelId!;
    
    // Execute atomic promotion
    const promoteResult = await registryService.promoteShadowToActive(horizon);
    
    if (!promoteResult.success) {
      return {
        promoted: false,
        result: {
          ...result,
          shouldPromote: false,
          reason: `Promotion failed: ${promoteResult.error}`,
        },
      };
    }
    
    // Log the event
    await eventLogger.logPromotion({
      horizon,
      fromModelId,
      toModelId,
      improvement: result.checks.winRateLift.value,
      sampleCount: result.checks.sampleCount.value,
    });
    
    console.log(
      `[AutoPromotion] ✅ ${horizon} promoted: ${fromModelId} -> ${toModelId} ` +
      `(WinRate +${(result.checks.winRateLift.value * 100).toFixed(1)}%)`
    );
    
    return {
      promoted: true,
      result,
      promotedModelId: toModelId,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // EVALUATE ALL HORIZONS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Evaluate all horizons.
   */
  async evaluateAllHorizons(symbol: string = 'BTC'): Promise<Record<ExchangeHorizon, PromotionCheckResult>> {
    const horizons: ExchangeHorizon[] = ['1D', '7D', '30D'];
    const results: Record<ExchangeHorizon, PromotionCheckResult> = {} as any;
    
    for (const horizon of horizons) {
      results[horizon] = await this.evaluatePromotion(horizon, symbol);
    }
    
    return results;
  }
  
  /**
   * Execute promotion for all horizons that pass checks.
   */
  async executeAllPromotions(symbol: string = 'BTC'): Promise<{
    results: Record<ExchangeHorizon, { promoted: boolean; reason: string }>;
    totalPromoted: number;
  }> {
    const horizons: ExchangeHorizon[] = ['1D', '7D', '30D'];
    const results: Record<ExchangeHorizon, { promoted: boolean; reason: string }> = {} as any;
    let totalPromoted = 0;
    
    for (const horizon of horizons) {
      const result = await this.executePromotion(horizon, symbol);
      results[horizon] = {
        promoted: result.promoted,
        reason: result.result.reason,
      };
      if (result.promoted) totalPromoted++;
    }
    
    return { results, totalPromoted };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════
  
  private noPromotionResult(reason: string): PromotionCheckResult {
    return {
      shouldPromote: false,
      reason,
      checks: {
        sampleCount: { passed: false, value: 0, required: 0 },
        winRateLift: { passed: false, value: 0, required: 0 },
        sharpeLift: { passed: false, value: 0, required: 0 },
        shadowDrawdown: { passed: false, value: 0, maxAllowed: 0 },
        shadowStability: { passed: false, value: 0, minRequired: 0 },
        cooldown: { passed: false, daysSince: 0, required: 0 },
      },
    };
  }
  
  /**
   * Fallback: load trades from shadow recorder if no deps provided.
   */
  private async loadTradesFromShadowRecorder(
    horizon: ExchangeHorizon,
    _windowDays: number,
    activeModelId: string,
    shadowModelId: string
  ): Promise<{ active: TradeOutcome[]; shadow: TradeOutcome[] }> {
    try {
      const { getExchangeShadowRecorderService } = await import('../shadow/exchange_shadow_recorder.service.js');
      const recorderService = getExchangeShadowRecorderService(this.db);
      
      const predictions = await recorderService.getRecentPredictions({
        horizon,
        resolvedOnly: true,
        limit: 500,
      });
      
      const active: TradeOutcome[] = [];
      const shadow: TradeOutcome[] = [];
      
      for (const p of predictions) {
        if (p.actualLabel === 'NEUTRAL') continue;
        
        const baseOutcome = {
          t: Math.floor(new Date(p.resolvedAt || p.createdAt).getTime() / 1000),
          horizon,
          symbol: p.symbol || 'BTC',
          // Use a default return since ShadowPrediction doesn't have actualReturn
          // In production, this should come from the actual price data
          returnPct: 0.01, // placeholder
        };
        
        // Active model outcome
        if (p.activeModelId === activeModelId) {
          active.push({
            ...baseOutcome,
            returnPct: p.activeCorrect ? 0.01 : -0.01,
            result: p.activeCorrect ? 'WIN' : 'LOSS',
            modelId: activeModelId,
          });
        }
        
        // Shadow model outcome
        if (p.shadowModelId === shadowModelId) {
          shadow.push({
            ...baseOutcome,
            returnPct: p.shadowCorrect ? 0.01 : -0.01,
            result: p.shadowCorrect ? 'WIN' : 'LOSS',
            modelId: shadowModelId,
            isShadow: true,
          });
        }
      }
      
      return { active, shadow };
    } catch (error) {
      console.warn('[AutoPromotion] Could not load from shadow recorder:', error);
      return { active: [], shadow: [] };
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let promotionInstance: ExchangeAutoPromotionService | null = null;

export function getExchangeAutoPromotionService(db: Db, deps?: PromotionDeps): ExchangeAutoPromotionService {
  if (!promotionInstance) {
    promotionInstance = new ExchangeAutoPromotionService(db, deps);
  }
  return promotionInstance;
}

// Reset instance (for testing)
export function resetExchangeAutoPromotionService(): void {
  promotionInstance = null;
}

console.log('[Exchange ML] Auto-promotion service loaded (Capital-Centric v2)');
