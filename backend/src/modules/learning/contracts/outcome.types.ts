/**
 * PHASE 5.1 — Outcome Tracking Types
 * ===================================
 * Contracts for tracking decision outcomes
 */

// ═══════════════════════════════════════════════════════════════
// OUTCOME TYPES
// ═══════════════════════════════════════════════════════════════

export type OutcomeStatus = 'PENDING' | 'CALCULATED' | 'SKIPPED' | 'ERROR';

export interface HorizonOutcome {
  horizon: '1h' | '4h' | '24h';
  priceAtHorizon: number | null;
  changePct: number | null;
  directionCorrect: boolean | null;
  calculatedAt: number | null;
}

// ═══════════════════════════════════════════════════════════════
// DECISION OUTCOME (core contract)
// ═══════════════════════════════════════════════════════════════

export interface DecisionOutcome {
  // Reference to the original decision
  decisionId: string;
  symbol: string;
  decisionTimestamp: number;
  
  // The decision that was made
  action: 'BUY' | 'SELL' | 'AVOID';
  confidence: number;
  verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  
  // Price at decision time
  priceAtDecision: number;
  
  // Outcomes at different horizons
  horizons: HorizonOutcome[];
  
  // Aggregated result
  directionCorrect: boolean | null;  // Best horizon result
  bestPnlPct: number | null;         // Best PnL across horizons
  worstPnlPct: number | null;        // Worst PnL across horizons
  
  // Status tracking
  status: OutcomeStatus;
  errorMessage?: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

// ═══════════════════════════════════════════════════════════════
// OUTCOME JOB TYPES
// ═══════════════════════════════════════════════════════════════

export interface OutcomeJobResult {
  runId: string;
  startedAt: number;
  completedAt: number;
  
  decisions: {
    pending: number;
    processed: number;
    calculated: number;
    skipped: number;
    errors: number;
  };
  
  errors: Array<{
    decisionId: string;
    error: string;
  }>;
}

export interface OutcomeJobRequest {
  symbol?: string;       // Optional: filter by symbol
  limit?: number;        // Max decisions to process (default: 100)
  forceRecalc?: boolean; // Recalculate even if already done
}

// ═══════════════════════════════════════════════════════════════
// OUTCOME STATS
// ═══════════════════════════════════════════════════════════════

export interface OutcomeStats {
  symbol: string | 'ALL';
  period: '24h' | '7d' | '30d' | 'all';
  
  total: number;
  calculated: number;
  pending: number;
  skipped: number;
  errors: number;
  
  // Accuracy metrics
  accuracy: {
    overall: number | null;       // % of correct directions
    byAction: {
      BUY: { total: number; correct: number; accuracy: number | null };
      SELL: { total: number; correct: number; accuracy: number | null };
      AVOID: { total: number; correct: number; accuracy: number | null };
    };
    byHorizon: {
      '1h': { total: number; correct: number; accuracy: number | null };
      '4h': { total: number; correct: number; accuracy: number | null };
      '24h': { total: number; correct: number; accuracy: number | null };
    };
  };
  
  // PnL metrics (for BUY/SELL only)
  pnl: {
    avgPnlPct: number | null;
    medianPnlPct: number | null;
    bestPnlPct: number | null;
    worstPnlPct: number | null;
  };
  
  generatedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// PRICE RESOLVER TYPES
// ═══════════════════════════════════════════════════════════════

export interface HistoricalPrice {
  symbol: string;
  timestamp: number;
  price: number;
  source: 'BYBIT' | 'BINANCE' | 'CACHE' | 'MOCK';
}

export interface PriceResolverConfig {
  useCache: boolean;
  cacheTtlMs: number;
  maxRetries: number;
  fallbackToMock: boolean;
}

// ═══════════════════════════════════════════════════════════════
// HORIZONS CONFIGURATION (LOCKED v1)
// ═══════════════════════════════════════════════════════════════

export const OUTCOME_HORIZONS = ['1h', '4h', '24h'] as const;
export type OutcomeHorizon = typeof OUTCOME_HORIZONS[number];

export const HORIZON_MS: Record<OutcomeHorizon, number> = {
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

// Minimum time before we can calculate outcome
export const MIN_HORIZON_MS = HORIZON_MS['1h'];

// Maximum age for pending decisions to be processed
export const MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

console.log('[Phase 5.1] Outcome Types loaded');
