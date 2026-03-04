/**
 * BLOCK 27 — Strategy Evaluation & Survival Service
 * ==================================================
 * 
 * Manages strategy lifecycle based on performance.
 */

import type {
  Strategy,
  StrategyPerformance,
  SurvivalRules,
  SurvivalDecision,
  SESResponse,
} from './strategy-survival.types.js';
import {
  DEFAULT_SURVIVAL_RULES,
  calculateDecayRate,
  shouldPause,
  shouldDisable,
} from './strategy-survival.types.js';
import { v4 as uuidv4 } from 'uuid';

// ═══════════════════════════════════════════════════════════════
// STRATEGY SURVIVAL SERVICE
// ═══════════════════════════════════════════════════════════════

export class StrategySurvivalService {
  private strategies: Map<string, Strategy> = new Map();
  private performances: Map<string, StrategyPerformance> = new Map();
  private decisions: SurvivalDecision[] = [];
  private rules: SurvivalRules = { ...DEFAULT_SURVIVAL_RULES };

  /**
   * Register a new strategy
   */
  registerStrategy(
    name: string,
    description: string,
    patternIds: string[],
    sectors: string[] = [],
    regimes: string[] = []
  ): Strategy {
    const id = uuidv4();
    const now = Date.now();
    
    const strategy: Strategy = {
      id,
      name,
      description,
      patternIds,
      sectors,
      regimes,
      weightScheme: 'SCORE',
      maxPositions: 5,
      status: 'ACTIVE',
      createdAt: now,
      lastActivatedAt: now,
    };
    
    this.strategies.set(id, strategy);
    
    // Initialize performance
    this.performances.set(id, this.createEmptyPerformance(id));
    
    console.log(`[SES] Strategy registered: ${name} (${id})`);
    return strategy;
  }

  /**
   * Record trade outcome for strategy
   */
  recordOutcome(
    strategyId: string,
    returnPct: number,
    isWin: boolean
  ): void {
    const perf = this.performances.get(strategyId);
    if (!perf) return;
    
    perf.totalTrades++;
    if (isWin) perf.wins++;
    else if (returnPct < -1) perf.losses++;
    else perf.neutral++;
    
    // Update metrics
    perf.hitRate = perf.wins / perf.totalTrades;
    perf.totalReturn += returnPct;
    perf.avgReturn = perf.totalReturn / perf.totalTrades;
    
    // Update max drawdown (simplified)
    if (returnPct < 0 && Math.abs(returnPct) > perf.maxDrawdown) {
      perf.maxDrawdown = Math.abs(returnPct);
    }
    
    // Update expectancy
    const avgWin = perf.wins > 0 ? perf.totalReturn / perf.wins : 0;
    const avgLoss = perf.losses > 0 ? (perf.totalReturn - avgWin * perf.wins) / perf.losses : 0;
    perf.expectancy = perf.hitRate * Math.abs(avgWin) - (1 - perf.hitRate) * Math.abs(avgLoss);
    
    // Kelly fraction
    if (avgLoss !== 0) {
      const b = Math.abs(avgWin) / Math.abs(avgLoss);
      perf.kellyFraction = Math.max(0, (b * perf.hitRate - (1 - perf.hitRate)) / b);
    }
    
    // Update time buckets (simplified - would use actual timestamps)
    perf.performance7d = {
      hitRate: perf.hitRate,
      avgReturn: perf.avgReturn,
      trades: Math.min(perf.totalTrades, 10),
    };
    
    perf.performance30d = {
      hitRate: perf.hitRate,
      avgReturn: perf.avgReturn,
      trades: perf.totalTrades,
    };
    
    // Calculate decay
    perf.decayRate = calculateDecayRate(perf.performance7d, perf.performance30d);
    perf.isDecaying = perf.decayRate < -0.05;
    
    perf.lastTradeAt = Date.now();
    perf.lastUpdatedAt = Date.now();
  }

  /**
   * Evaluate all strategies
   */
  evaluate(): SESResponse {
    const recentDecisions: SurvivalDecision[] = [];
    
    for (const [strategyId, strategy] of this.strategies) {
      const perf = this.performances.get(strategyId);
      if (!perf) continue;
      
      const decision = this.evaluateStrategy(strategy, perf);
      if (decision) {
        recentDecisions.push(decision);
        this.applyDecision(decision);
      }
    }
    
    // Add to history
    this.decisions.push(...recentDecisions);
    if (this.decisions.length > 100) {
      this.decisions = this.decisions.slice(-100);
    }
    
    return this.buildResponse(recentDecisions);
  }

  /**
   * Evaluate single strategy
   */
  private evaluateStrategy(
    strategy: Strategy,
    perf: StrategyPerformance
  ): SurvivalDecision | null {
    // Check for retirement
    const daysSinceLastTrade = (Date.now() - perf.lastTradeAt) / (24 * 60 * 60 * 1000);
    if (daysSinceLastTrade > this.rules.retirementAge && strategy.status !== 'RETIRED') {
      return this.createDecision(
        strategy.id,
        'RETIRE',
        strategy.status,
        'RETIRED',
        'retirementAge',
        daysSinceLastTrade,
        this.rules.retirementAge,
        [`No trades for ${daysSinceLastTrade.toFixed(0)} days`]
      );
    }
    
    // Skip if already disabled/retired
    if (strategy.status === 'DISABLED' || strategy.status === 'RETIRED') {
      // Check for reactivation (if enough good recent trades)
      if (perf.performance7d.trades >= this.rules.recoveryTrades &&
          perf.performance7d.hitRate >= this.rules.minHitRate) {
        return this.createDecision(
          strategy.id,
          'REACTIVATE',
          strategy.status,
          'ACTIVE',
          'recoveryTrades',
          perf.performance7d.trades,
          this.rules.recoveryTrades,
          ['Recovery criteria met']
        );
      }
      return null;
    }
    
    // Check for disable
    if (shouldDisable(perf, this.rules)) {
      return this.createDecision(
        strategy.id,
        'DISABLE',
        strategy.status,
        'DISABLED',
        'minExpectancy',
        perf.expectancy,
        this.rules.minExpectancy,
        [`Negative expectancy: ${perf.expectancy.toFixed(2)}`],
        'Accumulate more data or adjust pattern selection'
      );
    }
    
    // Check for pause
    const pauseCheck = shouldPause(perf, this.rules);
    if (pauseCheck.should && strategy.status === 'ACTIVE') {
      return this.createDecision(
        strategy.id,
        'PAUSE',
        strategy.status,
        'PAUSED',
        'minHitRate', // Could be different based on reason
        perf.hitRate,
        this.rules.minHitRate,
        [pauseCheck.reason],
        'Monitor for improvement before reactivating'
      );
    }
    
    // Check for unpause (paused strategy improving)
    if (strategy.status === 'PAUSED' && !pauseCheck.should && perf.totalTrades >= this.rules.minTrades) {
      return this.createDecision(
        strategy.id,
        'REACTIVATE',
        strategy.status,
        'ACTIVE',
        'minHitRate',
        perf.hitRate,
        this.rules.minHitRate,
        ['Performance recovered']
      );
    }
    
    return null;
  }

  private createDecision(
    strategyId: string,
    decision: SurvivalDecision['decision'],
    previousStatus: Strategy['status'],
    newStatus: Strategy['status'],
    triggerRule: keyof SurvivalRules,
    triggerValue: number,
    threshold: number,
    reasons: string[],
    recoveryPath?: string
  ): SurvivalDecision {
    return {
      strategyId,
      timestamp: Date.now(),
      decision,
      previousStatus,
      newStatus,
      triggerRule,
      triggerValue,
      threshold,
      reasons,
      recoveryPath,
    };
  }

  private applyDecision(decision: SurvivalDecision): void {
    const strategy = this.strategies.get(decision.strategyId);
    if (!strategy) return;
    
    strategy.status = decision.newStatus;
    
    if (decision.newStatus === 'ACTIVE') {
      strategy.lastActivatedAt = Date.now();
      strategy.pauseReason = undefined;
    } else if (decision.newStatus === 'PAUSED' || decision.newStatus === 'DISABLED') {
      strategy.lastDisabledAt = Date.now();
      strategy.pauseReason = decision.reasons[0];
    }
    
    console.log(`[SES] Strategy ${strategy.name}: ${decision.previousStatus} -> ${decision.newStatus}`);
  }

  private buildResponse(recentDecisions: SurvivalDecision[]): SESResponse {
    const strategies = Array.from(this.strategies.values());
    const performances = Array.from(this.performances.values());
    
    const activeCount = strategies.filter(s => s.status === 'ACTIVE').length;
    const pausedCount = strategies.filter(s => s.status === 'PAUSED').length;
    const disabledCount = strategies.filter(s => s.status === 'DISABLED').length;
    const retiredCount = strategies.filter(s => s.status === 'RETIRED').length;
    
    // Top performers
    const qualified = performances.filter(p => p.totalTrades >= 10);
    qualified.sort((a, b) => b.expectancy - a.expectancy);
    
    const topStrategies = qualified.slice(0, 5).map(p => {
      const strategy = this.strategies.get(p.strategyId)!;
      return {
        id: p.strategyId,
        name: strategy?.name ?? 'Unknown',
        hitRate: p.hitRate,
        expectancy: p.expectancy,
      };
    });
    
    const bottomStrategies = [...qualified]
      .sort((a, b) => a.expectancy - b.expectancy)
      .slice(0, 5)
      .map(p => {
        const strategy = this.strategies.get(p.strategyId)!;
        return {
          id: p.strategyId,
          name: strategy?.name ?? 'Unknown',
          hitRate: p.hitRate,
          expectancy: p.expectancy,
          status: strategy?.status ?? 'DISABLED',
        };
      });
    
    // System health
    let systemHealth: SESResponse['systemHealth'] = 'HEALTHY';
    let healthReason = 'All systems nominal';
    
    if (activeCount === 0) {
      systemHealth = 'CRITICAL';
      healthReason = 'No active strategies';
    } else if (disabledCount > activeCount) {
      systemHealth = 'WARNING';
      healthReason = 'More disabled than active strategies';
    } else if (recentDecisions.filter(d => d.decision === 'DISABLE').length > 0) {
      systemHealth = 'WARNING';
      healthReason = 'Recent strategy disablement';
    }
    
    return {
      ok: true,
      asOf: Date.now(),
      activeStrategies: activeCount,
      pausedStrategies: pausedCount,
      disabledStrategies: disabledCount,
      retiredStrategies: retiredCount,
      recentDecisions,
      topStrategies,
      bottomStrategies,
      systemHealth,
      healthReason,
    };
  }

  private createEmptyPerformance(strategyId: string): StrategyPerformance {
    const now = Date.now();
    return {
      strategyId,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      neutral: 0,
      hitRate: 0,
      avgReturn: 0,
      totalReturn: 0,
      maxDrawdown: 0,
      sharpe: 0,
      sortino: 0,
      expectancy: 0,
      kellyFraction: 0,
      performance7d: { hitRate: 0, avgReturn: 0, trades: 0 },
      performance30d: { hitRate: 0, avgReturn: 0, trades: 0 },
      isDecaying: false,
      decayRate: 0,
      firstTradeAt: now,
      lastTradeAt: now,
      lastUpdatedAt: now,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC METHODS
  // ═══════════════════════════════════════════════════════════════

  getStrategy(id: string): Strategy | null {
    return this.strategies.get(id) ?? null;
  }

  getStrategies(): Strategy[] {
    return Array.from(this.strategies.values());
  }

  getActiveStrategies(): Strategy[] {
    return this.getStrategies().filter(s => s.status === 'ACTIVE');
  }

  getPerformance(strategyId: string): StrategyPerformance | null {
    return this.performances.get(strategyId) ?? null;
  }

  getDecisionHistory(limit: number = 20): SurvivalDecision[] {
    return this.decisions.slice(-limit);
  }

  setRules(rules: Partial<SurvivalRules>): void {
    this.rules = { ...this.rules, ...rules };
  }

  getRules(): SurvivalRules {
    return { ...this.rules };
  }

  /**
   * Manually pause a strategy
   */
  pauseStrategy(id: string, reason: string): boolean {
    const strategy = this.strategies.get(id);
    if (!strategy || strategy.status === 'RETIRED') return false;
    
    strategy.status = 'PAUSED';
    strategy.pauseReason = reason;
    strategy.lastDisabledAt = Date.now();
    return true;
  }

  /**
   * Manually activate a strategy
   */
  activateStrategy(id: string): boolean {
    const strategy = this.strategies.get(id);
    if (!strategy || strategy.status === 'RETIRED') return false;
    
    strategy.status = 'ACTIVE';
    strategy.lastActivatedAt = Date.now();
    strategy.pauseReason = undefined;
    return true;
  }
}

export const strategySurvivalService = new StrategySurvivalService();

console.log('[Block27] Strategy Survival Service loaded');
