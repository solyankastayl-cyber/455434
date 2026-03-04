/**
 * S1.2 - Strategy Backtest Types
 * 
 * Backtesting evaluates strategy quality on historical signals
 * WITHOUT execution, orders, or balances.
 */

export type BacktestVerdict =
  | 'GOOD'
  | 'MIXED'
  | 'BAD'
  | 'INSUFFICIENT_DATA';

export type BacktestWindow = '7d' | '14d' | '30d';

export interface BacktestMetrics {
  /** Total signals in window */
  totalSignals: number;
  /** Signals with BUY/SELL decision (not NEUTRAL) */
  actionableSignals: number;
  /** % of correct directional predictions */
  hitRate: number;
  /** % of false positive signals */
  falsePositiveRate: number;
  /** Average price move after signal (%) */
  avgMoveAfterSignal: number;
  /** Maximum drawdown observed (%) */
  maxDrawdown: number;
  /** Signals per day */
  signalFrequency: number;
}

export interface BacktestInput {
  strategyId: string;
  network: 'ethereum' | 'bnb';
  window: BacktestWindow;
}

export interface BacktestResult {
  strategyId: string;
  strategyName: string;
  network: 'ethereum' | 'bnb';
  window: BacktestWindow;
  
  metrics: BacktestMetrics;
  verdict: BacktestVerdict;
  reasons: string[];
  
  /** Window boundaries */
  windowStart: Date;
  windowEnd: Date;
  
  createdAt: Date;
}

/**
 * Historical signal snapshot for backtesting
 */
export interface SignalSnapshot {
  network: string;
  decision: 'BUY' | 'SELL' | 'NEUTRAL';
  quality: 'HIGH' | 'MEDIUM' | 'LOW';
  drivers: Record<string, { state: string; strength: string }>;
  timestamp: number;
  /** Price at signal time (for move calculation) */
  priceAtSignal?: number;
  /** Price after signal (e.g., 24h later) */
  priceAfter?: number;
}
