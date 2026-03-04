/**
 * Phase 3.0: Execution Simulator - Domain Types
 * 
 * Core contracts for simulation. These types ensure ML training
 * is based on realistic trade execution, not just signal detection.
 */

// ═══════════════════════════════════════════════════════════════
// PRIMITIVES
// ═══════════════════════════════════════════════════════════════

export type OrderSide = 'LONG' | 'SHORT';
export type OrderType = 'MARKET' | 'STOP_MARKET' | 'LIMIT';
export type OrderStatus = 'OPEN' | 'FILLED' | 'CANCELLED' | 'EXPIRED';

export type PositionStatus = 'NONE' | 'OPEN' | 'CLOSED';
export type ExitReason = 'STOP' | 'TARGET1' | 'TARGET2' | 'TIMEOUT' | 'NO_ENTRY';

export type EntryType = 'MARKET' | 'BREAKOUT_TRIGGER' | 'LIMIT_PULLBACK';

// ═══════════════════════════════════════════════════════════════
// CANDLE
// ═══════════════════════════════════════════════════════════════

export interface SimCandle {
  ts: number;       // Unix seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ═══════════════════════════════════════════════════════════════
// RUN SPECIFICATION
// ═══════════════════════════════════════════════════════════════

export interface SimRunSpec {
  runId: string;
  symbol: string;
  tf: string;
  fromTs: number;
  toTs: number;
  warmupBars: number;
  stepBars: number;
  seed: number;
  mode: 'TOP1' | 'TOP3' | 'PORTFOLIO';
  createdAt: Date;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  finishedAt?: Date;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// ORDER
// ═══════════════════════════════════════════════════════════════

export interface SimOrder {
  orderId: string;
  runId: string;
  stepId: string;
  scenarioId: string;

  symbol: string;
  tf: string;

  side: OrderSide;
  type: OrderType;
  status: OrderStatus;

  createdTs: number;
  expiresAfterBars: number;
  barsOpen: number;

  // Prices
  triggerPrice?: number;   // For STOP_MARKET
  limitPrice?: number;     // For LIMIT

  filledPrice?: number;
  filledTs?: number;

  meta: {
    entryType: EntryType;
    reason: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// POSITION
// ═══════════════════════════════════════════════════════════════

export interface SimPosition {
  positionId: string;
  runId: string;
  scenarioId: string;

  symbol: string;
  tf: string;
  side: OrderSide;

  // Entry
  entryTs: number;
  entryPrice: number;
  entryOrderId: string;

  // Risk levels
  stopPrice: number;
  target1Price?: number;
  target2Price?: number;
  timeoutBars: number;

  // Status
  status: PositionStatus;
  exitTs?: number;
  exitPrice?: number;
  exitReason?: ExitReason;

  // Duration
  barsInTrade: number;

  // Performance (measured in % from entry)
  mfePct: number;          // Maximum Favorable Excursion
  maePct: number;          // Maximum Adverse Excursion

  // PnL in R-multiple
  rMultiple?: number;

  // Costs
  feesPaid: number;
  slippagePaid: number;

  // Audit
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// RISK PACK (from Decision Engine)
// ═══════════════════════════════════════════════════════════════

export interface SimRiskPack {
  entryType: EntryType;
  entryPrice?: number;
  stopPrice: number;
  target1Price?: number;
  target2Price?: number;
  entryTimeoutBars: number;
  tradeTimeoutBars: number;
}

// ═══════════════════════════════════════════════════════════════
// SCENARIO (input from Decision Engine)
// ═══════════════════════════════════════════════════════════════

export interface SimScenario {
  scenarioId: string;
  symbol: string;
  tf: string;
  side: OrderSide;
  risk: SimRiskPack;
  probability: number;
  patternType?: string;
}

// ═══════════════════════════════════════════════════════════════
// EVENT LOG
// ═══════════════════════════════════════════════════════════════

export type SimEventType = 
  | 'RUN_START'
  | 'STEP_START'
  | 'ORDER_CREATED'
  | 'ORDER_FILLED'
  | 'ORDER_EXPIRED'
  | 'POSITION_OPENED'
  | 'POSITION_UPDATED'
  | 'POSITION_CLOSED'
  | 'RUN_COMPLETE';

export interface SimEvent {
  eventId: string;
  runId: string;
  stepId: string;
  type: SimEventType;
  ts: number;
  data: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════

export interface SimSummary {
  runId: string;
  symbol: string;
  tf: string;
  
  // Counts
  totalSteps: number;
  totalTrades: number;
  wins: number;
  losses: number;
  timeouts: number;
  noEntries: number;
  
  // Performance
  winRate: number;
  avgR: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdownR: number;
  
  // R distribution
  totalRWins: number;
  totalRLosses: number;
  avgWinR: number;
  avgLossR: number;
  
  // Time
  avgBarsInTrade: number;
  avgBarsToWin: number;
  avgBarsToLoss: number;
  
  // Costs
  totalFees: number;
  totalSlippage: number;
  
  // By pattern (optional)
  byPatternType?: Record<string, {
    trades: number;
    winRate: number;
    avgR: number;
  }>;
}
