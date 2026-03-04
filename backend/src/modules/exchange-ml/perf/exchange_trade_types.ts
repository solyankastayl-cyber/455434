/**
 * Exchange Trade Types (Capital-Centric Performance)
 * ===================================================
 * 
 * Types for the Trade Quality Layer and Performance Dashboard.
 * 
 * Key insight: We track TRADE-level metrics, not ML-accuracy metrics.
 * The goal is to filter bad trades, not to improve model accuracy.
 */

// ═══════════════════════════════════════════════════════════════
// CORE TYPES
// ═══════════════════════════════════════════════════════════════

export type Horizon = '1D' | '7D' | '30D';

export type TradeSide = 'LONG' | 'SHORT';

export type RegimeTag = 'BULL' | 'BEAR' | 'CHOP' | 'UNKNOWN';

// ═══════════════════════════════════════════════════════════════
// TRADE DECISION (Entry)
// ═══════════════════════════════════════════════════════════════

export interface TradeDecision {
  ts: number;              // unix seconds (entry time)
  symbol: string;
  horizon: Horizon;
  side: TradeSide;         // LONG/SHORT
  entryPrice: number;
  expectedReturn: number;  // 0.075 = +7.5%
  confidence: number;      // adjusted (0..1)
  sizePct: number;         // 0..1 (equity fraction allocated)
  tags?: {
    regime?: RegimeTag;
    quality?: string[];    // reasons from quality gate
  };
}

// ═══════════════════════════════════════════════════════════════
// TRADE OUTCOME (Exit)
// ═══════════════════════════════════════════════════════════════

export interface TradeOutcome {
  tsResolved: number;      // unix seconds (exit time)
  exitPrice: number;
  ret: number;             // (exit-entry)/entry (raw return)
  pnlPct: number;          // ret * sizePct * (side sign) — actual PnL
  win: boolean;            // direction was correct
  rMultiple: number;       // pnl / risk (simplified reward/risk)
}

// ═══════════════════════════════════════════════════════════════
// COMPLETE TRADE RECORD
// ═══════════════════════════════════════════════════════════════

export interface TradeRecord extends TradeDecision, TradeOutcome {}

// ═══════════════════════════════════════════════════════════════
// PERFORMANCE WINDOW (Aggregate Metrics)
// ═══════════════════════════════════════════════════════════════

export interface PerfWindow {
  horizon: Horizon;
  days: number;
  trades: number;
  
  // Core capital metrics
  winRate: number;         // wins / (wins + losses)
  expectancy: number;      // avg pnlPct per trade (the "edge")
  avgR: number;            // avg rMultiple
  sharpeLike: number;      // mean/std * sqrt(n) — risk-adjusted returns
  maxDD: number;           // max drawdown (equity curve peak-to-trough)
  
  // Trading frequency
  holdRate: number;        // fraction of time NOT trading (1 - trades/possible)
  
  // Performance by market regime
  byRegime: Record<RegimeTag, {
    trades: number;
    winRate: number;
    expectancy: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════
// QUALITY GATE INPUT/OUTPUT
// ═══════════════════════════════════════════════════════════════

export interface QualityInput {
  horizon: Horizon;
  envState: 'USE' | 'WARNING' | 'IGNORE';
  dirProbUp: number;       // 0..1 (model probability for UP)
  dirProbDown: number;     // 0..1 (model probability for DOWN)
  confidence: number;      // adjusted (0..1)
  atrPct?: number;         // ATR/price (volatility)
  volSpike20?: number;     // volume spike ratio
  emaCrossDist?: number;   // EMA cross distance
  distToVWAP7?: number;    // VWAP distance
}

export interface QualityDecision {
  allowTrade: boolean;
  sizeMultiplier: number;  // 0..1 (position size adjustment)
  reasons: string[];       // explanation of decision
}

console.log('[Exchange ML] Trade types loaded');
