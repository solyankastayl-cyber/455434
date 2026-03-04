/**
 * FORECAST SNAPSHOT TYPES
 * =======================
 * 
 * V3.4: Outcome Tracking - Snapshot persistence
 * 
 * Each forecast creates a snapshot at creation time.
 * After horizon passes, we evaluate WIN/LOSS.
 */

export type EvaluationStatus = 'PENDING' | 'RESOLVED';
export type EvaluationResult = 'WIN' | 'LOSS' | 'DRAW';

export type ForecastLayer = 'forecast' | 'exchange' | 'onchain' | 'sentiment';
export type ForecastHorizon = '1D' | '7D' | '30D';

/**
 * Snapshot stored when forecast is created
 * Immutable record of prediction
 */
export type ForecastSnapshot = {
  _id?: string;
  
  // Core identifiers
  symbol: string;
  layer: ForecastLayer;
  horizon: ForecastHorizon;
  
  // Timestamps
  createdAt: Date;
  resolveAt: Date;            // When to check result
  
  // Forecast data at creation time
  startPrice: number;
  targetPrice: number;
  expectedMovePct: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  confidence: number;
  
  // Evaluation (updated when resolved)
  evaluation: {
    status: EvaluationStatus;
    resolvedAt?: Date;
    realPrice?: number;       // Actual price at resolveAt
    result?: EvaluationResult;
    deviation?: number;       // % difference from target
  };
  
  // Metadata
  metadata?: {
    verdictId?: string;
    source?: string;
  };
};

/**
 * Outcome record after resolution
 * Separate collection for fast queries
 */
export type ForecastOutcome = {
  _id?: string;
  
  // Link to snapshot
  snapshotId: string;
  
  // Denormalized for queries
  symbol: string;
  layer: ForecastLayer;
  horizon: ForecastHorizon;
  
  // Timing
  createdAt: Date;            // When forecast was made
  resolvedAt: Date;           // When outcome was determined
  
  // Prediction vs Reality
  startPrice: number;
  targetPrice: number;
  realPrice: number;
  
  // Result
  result: EvaluationResult;
  directionCorrect: boolean;  // Did we get direction right?
  deviation: number;          // % error from target
  
  // Original confidence (for calibration analysis)
  confidence: number;
};

/**
 * Statistics for a layer/horizon combo
 */
export type OutcomeStats = {
  symbol: string;
  layer: ForecastLayer;
  horizon: ForecastHorizon;
  
  // Counts
  total: number;
  wins: number;
  losses: number;
  draws: number;
  
  // Rates
  winRate: number;            // wins / total
  directionAccuracy: number;  // correct direction / total
  
  // Error metrics
  avgDeviation: number;
  maxDeviation: number;
  
  // Calibration
  avgConfidence: number;
  calibrationScore: number;   // How well confidence matches win rate
  
  // Recent performance
  lastOutcomes: EvaluationResult[];
  streak: {
    type: 'WIN' | 'LOSS' | 'NONE';
    count: number;
  };
};

console.log('[ForecastSnapshotTypes] V3.4 Outcome Tracking types loaded');
