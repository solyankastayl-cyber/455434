/**
 * ANALYTICS PACK V2
 * 
 * Risk metrics, outcomes, phase, forward eval.
 * Replaces "SPX-style" blocks that showed NaN/0.
 */

import { RiskLevel, GuardLevel, PhaseType, HorizonDays } from '../index.types.js';

// ═══════════════════════════════════════════════════════════════
// EXPECTED OUTCOMES
// ═══════════════════════════════════════════════════════════════

export interface ExpectedOutcomes {
  lower: number;                // percentile 10 return (%)
  base: number;                 // percentile 50 return (%)
  upper: number;                // percentile 90 return (%)
  samples: number;              // number of historical samples
  fallbackUsed: boolean;        // if true, using fallback estimation
}

// ═══════════════════════════════════════════════════════════════
// RISK METRICS
// ═══════════════════════════════════════════════════════════════

export interface RiskMetrics {
  level: RiskLevel;
  typicalPullbackPct: number;   // expected drawdown
  worstCasePct: number;         // VaR-like tail risk
  positionSize: number;         // 0..1 recommended allocation
  guard: GuardLevel;
  guardReason?: string;
}

// ═══════════════════════════════════════════════════════════════
// MARKET PHASE
// ═══════════════════════════════════════════════════════════════

export interface MarketPhase {
  phase: PhaseType;
  confidence: number;           // 0..1
  evidence: string[];           // reasons for this phase
  durationDays?: number;        // how long in this phase
}

// ═══════════════════════════════════════════════════════════════
// FORWARD EVALUATION (backtested performance)
// ═══════════════════════════════════════════════════════════════

export interface ForwardEvaluation {
  hitRate?: number;             // % of correct direction calls
  avgReturn?: number;           // average return of signals
  bias?: number;                // systematic over/under prediction
  trades?: number;              // number of historical trades
  
  byHorizon?: Array<{
    horizonDays: HorizonDays;
    hitRate?: number;
    avgReturn?: number;
  }>;
  
  isValid: boolean;             // if trades < minTrades, invalid
  minTradesRequired: number;
}

// ═══════════════════════════════════════════════════════════════
// DATA CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface DataContext {
  matches: number;              // total historical matches
  coverageYears: number;        // years of data coverage
  quality: number;              // 0..100
  lastUpdateAt: string;
}

// ═══════════════════════════════════════════════════════════════
// ANALYTICS PACK V2 (full contract)
// ═══════════════════════════════════════════════════════════════

export interface AnalyticsPackV2 {
  expectedOutcomes?: ExpectedOutcomes;
  risk?: RiskMetrics;
  phase?: MarketPhase;
  forwardEval?: ForwardEvaluation;
  context: DataContext;
  
  // Validation for UI rendering
  validation: {
    hasOutcomes: boolean;
    hasRisk: boolean;
    hasPhase: boolean;
    hasForwardEval: boolean;
  };
}
