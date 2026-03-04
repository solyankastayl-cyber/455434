/**
 * BLOCK 27 — Strategy Evaluation & Survival Types
 * ================================================
 * 
 * Track and manage strategy lifecycle.
 */

import type { Venue } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// STRATEGY
// ═══════════════════════════════════════════════════════════════

export interface Strategy {
  id: string;
  name: string;
  description: string;
  
  // Components
  patternIds: string[];
  sectors: string[];
  regimes: string[];
  
  // Config
  weightScheme: string;
  maxPositions: number;
  
  // Status
  status: 'ACTIVE' | 'PAUSED' | 'DISABLED' | 'RETIRED';
  pauseReason?: string;
  
  // Lifecycle
  createdAt: number;
  lastActivatedAt: number;
  lastDisabledAt?: number;
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY PERFORMANCE
// ═══════════════════════════════════════════════════════════════

export interface StrategyPerformance {
  strategyId: string;
  
  // Core metrics
  totalTrades: number;
  wins: number;
  losses: number;
  neutral: number;
  
  hitRate: number;
  avgReturn: number;
  totalReturn: number;
  
  // Risk metrics
  maxDrawdown: number;
  sharpe: number;
  sortino: number;
  
  // Expectancy
  expectancy: number;
  kellyFraction: number;
  
  // Time-bucketed
  performance7d: {
    hitRate: number;
    avgReturn: number;
    trades: number;
  };
  
  performance30d: {
    hitRate: number;
    avgReturn: number;
    trades: number;
  };
  
  // Decay detection
  isDecaying: boolean;
  decayRate: number;        // Negative = decaying
  
  // Timestamps
  firstTradeAt: number;
  lastTradeAt: number;
  lastUpdatedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// SURVIVAL RULES
// ═══════════════════════════════════════════════════════════════

export interface SurvivalRules {
  minTrades: number;              // Min trades before evaluation
  minHitRate: number;             // Below = pause
  minExpectancy: number;          // Below 0 = disable
  maxDrawdown: number;            // Above = pause
  decayThreshold: number;         // Decay rate below = pause
  recoveryTrades: number;         // Trades needed to reactivate
  retirementAge: number;          // Days without trades = retire
}

export const DEFAULT_SURVIVAL_RULES: SurvivalRules = {
  minTrades: 20,
  minHitRate: 0.40,
  minExpectancy: 0,
  maxDrawdown: 25,
  decayThreshold: -0.1,
  recoveryTrades: 10,
  retirementAge: 30,
};

// ═══════════════════════════════════════════════════════════════
// SURVIVAL DECISION
// ═══════════════════════════════════════════════════════════════

export interface SurvivalDecision {
  strategyId: string;
  timestamp: number;
  
  // Decision
  decision: 'KEEP' | 'PAUSE' | 'DISABLE' | 'REACTIVATE' | 'RETIRE';
  previousStatus: Strategy['status'];
  newStatus: Strategy['status'];
  
  // Reasons
  triggerRule: keyof SurvivalRules;
  triggerValue: number;
  threshold: number;
  reasons: string[];
  
  // Recommendations
  recoveryPath?: string;
}

// ═══════════════════════════════════════════════════════════════
// SES RESPONSE
// ═══════════════════════════════════════════════════════════════

export interface SESResponse {
  ok: boolean;
  asOf: number;
  
  // Strategies
  activeStrategies: number;
  pausedStrategies: number;
  disabledStrategies: number;
  retiredStrategies: number;
  
  // Recent decisions
  recentDecisions: SurvivalDecision[];
  
  // Top/bottom performers
  topStrategies: Array<{
    id: string;
    name: string;
    hitRate: number;
    expectancy: number;
  }>;
  
  bottomStrategies: Array<{
    id: string;
    name: string;
    hitRate: number;
    expectancy: number;
    status: Strategy['status'];
  }>;
  
  // Health
  systemHealth: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  healthReason: string;
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export function calculateDecayRate(
  recent7d: { hitRate: number; avgReturn: number },
  recent30d: { hitRate: number; avgReturn: number }
): number {
  // Compare 7d to 30d performance
  // Positive = improving, Negative = decaying
  const hitRateChange = recent7d.hitRate - recent30d.hitRate;
  const returnChange = recent7d.avgReturn - recent30d.avgReturn;
  
  return (hitRateChange + returnChange / 10) / 2;
}

export function shouldPause(
  perf: StrategyPerformance,
  rules: SurvivalRules
): { should: boolean; reason: string } {
  if (perf.totalTrades < rules.minTrades) {
    return { should: false, reason: 'Insufficient trades for evaluation' };
  }
  
  if (perf.hitRate < rules.minHitRate) {
    return { should: true, reason: `Hit rate ${(perf.hitRate * 100).toFixed(0)}% below minimum ${rules.minHitRate * 100}%` };
  }
  
  if (perf.maxDrawdown > rules.maxDrawdown) {
    return { should: true, reason: `Drawdown ${perf.maxDrawdown.toFixed(0)}% exceeds limit ${rules.maxDrawdown}%` };
  }
  
  if (perf.decayRate < rules.decayThreshold) {
    return { should: true, reason: `Performance decaying at ${(perf.decayRate * 100).toFixed(0)}%` };
  }
  
  return { should: false, reason: 'Healthy' };
}

export function shouldDisable(
  perf: StrategyPerformance,
  rules: SurvivalRules
): boolean {
  if (perf.totalTrades < rules.minTrades) return false;
  return perf.expectancy < rules.minExpectancy;
}

console.log('[Block27] Strategy Evaluation & Survival Types loaded');
