/**
 * Outcome Types — Universal contract for pattern outcome evaluation
 * 
 * Phase 5: Outcome Engine
 */

// ═══════════════════════════════════════════════════════════════
// Outcome Result Types
// ═══════════════════════════════════════════════════════════════

export type OutcomeResult = 'WIN' | 'LOSS' | 'TIMEOUT' | 'SKIPPED' | 'PENDING';

export type TradeDirection = 'LONG' | 'SHORT';

// ═══════════════════════════════════════════════════════════════
// Trade Plan — Required input for outcome evaluation
// ═══════════════════════════════════════════════════════════════

export type TradePlan = {
  direction: TradeDirection;
  entry: number;
  stop: number;
  target: number;
  timeoutBars: number;  // how many bars until timeout (e.g., 30 for 30D)
};

// ═══════════════════════════════════════════════════════════════
// Outcome Record — Stored in ta_outcomes collection
// ═══════════════════════════════════════════════════════════════

export type OutcomeRecord = {
  // Links
  runId: string;
  patternId: string;
  asset: string;

  // Trade plan (copy)
  tradePlan: TradePlan;

  // Outcome
  result: OutcomeResult;
  
  // Exit details
  exitTs?: number;
  exitPrice?: number;
  exitBar?: number;      // bars since entry
  exitReason?: 'TARGET_HIT' | 'STOP_HIT' | 'TIMEOUT' | 'N/A';

  // Excursion metrics
  mfe: number;           // Max Favorable Excursion (absolute)
  mfePct: number;        // MFE as percentage of entry
  mae: number;           // Max Adverse Excursion (absolute, usually negative for LONG)
  maePct: number;        // MAE as percentage of entry

  // Return
  returnAbs?: number;    // exit - entry (for LONG), entry - exit (for SHORT)
  returnPct?: number;    // return as percentage

  // Timestamps
  entryTs: number;       // when pattern was detected (run ts)
  evaluatedAt: Date;
  
  // Horizon
  horizon: string;       // e.g., "30D"
  barsEvaluated: number; // how many bars were checked
};

// ═══════════════════════════════════════════════════════════════
// Outcome Evaluation Input
// ═══════════════════════════════════════════════════════════════

export type OutcomeEvalInput = {
  tradePlan: TradePlan;
  candles: Array<{ ts: number; open: number; high: number; low: number; close: number }>;
  entryTs: number;       // timestamp when trade was signaled
  tieBreak?: 'LOSS_FIRST' | 'WIN_FIRST';  // default: LOSS_FIRST (conservative)
};

// ═══════════════════════════════════════════════════════════════
// Outcome Evaluation Output
// ═══════════════════════════════════════════════════════════════

export type OutcomeEvalResult = {
  result: OutcomeResult;
  
  exitTs?: number;
  exitPrice?: number;
  exitBar?: number;
  exitReason?: 'TARGET_HIT' | 'STOP_HIT' | 'TIMEOUT' | 'N/A';
  
  mfe: number;
  mfePct: number;
  mae: number;
  maePct: number;
  
  returnAbs?: number;
  returnPct?: number;
  
  barsEvaluated: number;
};

// ═══════════════════════════════════════════════════════════════
// Performance Summary
// ═══════════════════════════════════════════════════════════════

export type PerformanceSummary = {
  asset: string;
  timeframe: string;
  since: Date;
  until: Date;
  
  totalPatterns: number;
  evaluated: number;
  pending: number;
  skipped: number;
  
  wins: number;
  losses: number;
  timeouts: number;
  
  winRate: number;       // wins / (wins + losses)
  winRateAll: number;    // wins / evaluated
  
  avgReturnPct: number;
  avgWinPct: number;
  avgLossPct: number;
  
  avgMfePct: number;
  avgMaePct: number;
  
  profitFactor: number;  // (avgWin * wins) / (avgLoss * losses)
  expectancy: number;    // winRate * avgWin - (1 - winRate) * avgLoss
  
  byPatternType: Record<string, {
    count: number;
    wins: number;
    losses: number;
    winRate: number;
  }>;
};
