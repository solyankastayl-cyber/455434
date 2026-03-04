/**
 * PHASE 1.4 — History Types
 * ==========================
 * 
 * Types for historical data storage and truth evaluation.
 */

// ═══════════════════════════════════════════════════════════════
// PRICE BAR
// ═══════════════════════════════════════════════════════════════

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
export type DataSource = 'BINANCE_USDM' | 'BYBIT_USDTPERP' | 'MOCK';

export interface PriceBar {
  symbol: string;
  tf: Timeframe;
  ts: number;         // candle open time (unix ms)
  o: number;          // open
  h: number;          // high
  l: number;          // low
  c: number;          // close
  v?: number;         // volume
  source: DataSource;
}

// ═══════════════════════════════════════════════════════════════
// VERDICT HISTORY
// ═══════════════════════════════════════════════════════════════

export type VerdictLabel = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'INCONCLUSIVE' | 'NO_DATA';

export interface VerdictHistoryRecord {
  symbol: string;
  ts: number;              // verdict time (t0)
  verdict: VerdictLabel;
  confidence: number;
  source: 'META_BRAIN' | 'EXCHANGE';
}

// ═══════════════════════════════════════════════════════════════
// TRUTH RECORD
// ═══════════════════════════════════════════════════════════════

export type TruthOutcome = 'CONFIRMED' | 'DIVERGED' | 'NO_DATA';
export type PriceDirection = 'UP' | 'DOWN' | 'FLAT';

export interface TruthRecord {
  symbol: string;
  tf: Timeframe;
  
  // Verdict info (t0)
  verdictTs: number;
  verdict: VerdictLabel;
  confidence: number;
  
  // Evaluation info (t1)
  evaluationTs: number;
  horizonBars: number;
  threshold: number;
  
  // Outcome
  priceAtT0: number;
  priceAtT1: number;
  priceChangePct: number;
  priceDirection: PriceDirection;
  outcome: TruthOutcome;
  
  // Metadata
  reason: string;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// BACKFILL TYPES
// ═══════════════════════════════════════════════════════════════

export type BackfillStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface BackfillRequest {
  symbol: string;
  tf: Timeframe;
  days: number;
}

export interface BackfillRun {
  runId: string;
  symbol: string;
  tf: Timeframe;
  days: number;
  from: number;
  to: number;
  status: BackfillStatus;
  progress: {
    barsSaved: number;
    truthRecordsSaved: number;
    lastTs: number | null;
  };
  error: string | null;
  startedAt: number;
  completedAt: number | null;
}

// ═══════════════════════════════════════════════════════════════
// TRUTH STATS
// ═══════════════════════════════════════════════════════════════

export interface TruthStats {
  symbol: string;
  tf: Timeframe;
  total: number;
  confirmed: number;
  diverged: number;
  noData: number;
  confirmRate: number;
  divergeRate: number;
  avgConfidence: number;
  avgMagnitude: number;
  byVerdict: {
    BULLISH: { total: number; confirmed: number; diverged: number };
    BEARISH: { total: number; confirmed: number; diverged: number };
    NEUTRAL: { total: number; confirmed: number; diverged: number };
  };
}

console.log('[Phase 1.4] History Types loaded');
