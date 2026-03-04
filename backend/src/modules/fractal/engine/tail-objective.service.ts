/**
 * BLOCK 39.3 — Tail-Aware Weight Objective Service
 * 
 * Optimizes horizon weights with tail risk penalties:
 * - P95 DD penalty
 * - Worst DD penalty
 * - Low trade count penalty
 * - Stability bonus
 */

import {
  TailAwareObjectiveConfig,
  TailAwareObjectiveResult,
  DEFAULT_TAIL_OBJECTIVE_CONFIG,
} from '../contracts/institutional.contracts.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface ObjectiveInputs {
  sharpe: number;           // Sharpe ratio
  cagr: number;             // CAGR (decimal, e.g., 0.25 = 25%)
  p95dd: number;            // P95 drawdown (decimal, e.g., 0.35 = 35%)
  worstdd: number;          // Worst drawdown (decimal)
  dominance: number;        // Single horizon dominance (0..1)
  stability: number;        // Pattern stability score (0..1)
  tradeCount: number;       // Number of trades
}

// ═══════════════════════════════════════════════════════════════
// Objective Computation
// ═══════════════════════════════════════════════════════════════

/**
 * Compute tail-aware objective score
 * Higher is better
 */
export function computeTailAwareObjective(
  inputs: ObjectiveInputs,
  cfg: TailAwareObjectiveConfig = DEFAULT_TAIL_OBJECTIVE_CONFIG
): TailAwareObjectiveResult {
  const w = cfg.weights;
  
  // Sharpe contribution (positive)
  const sharpeContrib = w.sharpe * inputs.sharpe;
  
  // CAGR contribution (positive)
  const cagrContrib = w.cagr * inputs.cagr;
  
  // P95 DD penalty (negative weight means penalty)
  const p95ddPenalty = w.p95dd * inputs.p95dd;  // negative * positive = negative
  
  // Worst DD penalty
  const worstddPenalty = w.worstdd * inputs.worstdd;
  
  // Dominance penalty (if single horizon dominates)
  const dominancePenalty = w.dominance * Math.max(0, inputs.dominance - 0.45);
  
  // Stability bonus
  const stabilityBonus = w.stability * inputs.stability;
  
  // Trade count penalty
  let tradeCountPenalty = 0;
  if (inputs.tradeCount < cfg.targetTrades) {
    const shortfall = (cfg.targetTrades - inputs.tradeCount) / cfg.targetTrades;
    tradeCountPenalty = w.tradeCount * shortfall;
  }
  
  // Total score
  const score = 
    sharpeContrib +
    cagrContrib +
    p95ddPenalty +
    worstddPenalty +
    dominancePenalty +
    stabilityBonus +
    tradeCountPenalty;
  
  return {
    score: Math.round(score * 10000) / 10000,
    components: {
      sharpeContrib: Math.round(sharpeContrib * 10000) / 10000,
      cagrContrib: Math.round(cagrContrib * 10000) / 10000,
      p95ddPenalty: Math.round(p95ddPenalty * 10000) / 10000,
      worstddPenalty: Math.round(worstddPenalty * 10000) / 10000,
      dominancePenalty: Math.round(dominancePenalty * 10000) / 10000,
      stabilityBonus: Math.round(stabilityBonus * 10000) / 10000,
      tradeCountPenalty: Math.round(tradeCountPenalty * 10000) / 10000,
    },
    meetsMinTrades: inputs.tradeCount >= cfg.minTrades,
  };
}

// ═══════════════════════════════════════════════════════════════
// Weight Certification
// ═══════════════════════════════════════════════════════════════

export interface CertificationCriteria {
  minSharpe: number;        // 0.3
  maxP95DD: number;         // 0.40
  maxWorstDD: number;       // 0.50
  minTrades: number;        // 25
  minPassRate: number;      // 0.60
  minStability: number;     // 0.50
}

export const DEFAULT_CERTIFICATION_CRITERIA: CertificationCriteria = {
  minSharpe: 0.3,
  maxP95DD: 0.40,
  maxWorstDD: 0.50,
  minTrades: 25,
  minPassRate: 0.60,
  minStability: 0.50,
};

/**
 * Check if weights meet certification criteria
 */
export function certifyWeights(
  inputs: ObjectiveInputs & { passRate: number },
  criteria: CertificationCriteria = DEFAULT_CERTIFICATION_CRITERIA
): {
  certified: boolean;
  failures: string[];
  score: number;
} {
  const failures: string[] = [];
  
  if (inputs.sharpe < criteria.minSharpe) {
    failures.push(`SHARPE_LOW (${inputs.sharpe} < ${criteria.minSharpe})`);
  }
  if (inputs.p95dd > criteria.maxP95DD) {
    failures.push(`P95DD_HIGH (${inputs.p95dd} > ${criteria.maxP95DD})`);
  }
  if (inputs.worstdd > criteria.maxWorstDD) {
    failures.push(`WORSTDD_HIGH (${inputs.worstdd} > ${criteria.maxWorstDD})`);
  }
  if (inputs.tradeCount < criteria.minTrades) {
    failures.push(`TRADES_LOW (${inputs.tradeCount} < ${criteria.minTrades})`);
  }
  if (inputs.passRate < criteria.minPassRate) {
    failures.push(`PASSRATE_LOW (${inputs.passRate} < ${criteria.minPassRate})`);
  }
  if (inputs.stability < criteria.minStability) {
    failures.push(`STABILITY_LOW (${inputs.stability} < ${criteria.minStability})`);
  }
  
  // Compute overall score
  const objectiveResult = computeTailAwareObjective(inputs);
  
  return {
    certified: failures.length === 0,
    failures,
    score: objectiveResult.score,
  };
}
