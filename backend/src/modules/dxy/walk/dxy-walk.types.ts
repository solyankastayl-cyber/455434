/**
 * DXY WALK-FORWARD VALIDATION TYPES — A3.5
 * 
 * ISOLATION: DXY walk-forward contracts. No BTC/SPX imports.
 * 
 * Walk-forward validation tests synthetic/hybrid models on historical data
 * without future leakage, as if we were making predictions "back then".
 */

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const WALK_CONSTANTS = {
  WINDOW_LEN_DEFAULT: 180,      // A3.6 calibrated (was 120)
  TOPK_DEFAULT: 10,
  STEP_DAYS_DEFAULT: 7,
  THRESHOLD_DEFAULT: 0.01,     // A3.6 calibrated (was 0.001)
  WEIGHT_CLAMP_MAX_DEFAULT: 0.5,
  MAX_PROCESSED_PER_REQUEST: 2000,
} as const;

// A3.6 CALIBRATED CONFIG
export const DXY_CALIBRATED_CONFIG = {
  threshold: 0.01,
  weightMode: 'W2' as const,
  windowLen: 180,
  topK: 10,
  // Note: 30d horizon is production-validated, 90d needs more work
  validatedHorizons: [7, 14, 30],
} as const;

// ═══════════════════════════════════════════════════════════════
// A3.6 CALIBRATION — Weight Modes
// ═══════════════════════════════════════════════════════════════

/**
 * Weight calculation modes for HYBRID:
 * W0 - Baseline: w = similarity * (1 - entropy), clamp to weightClampMax
 * W1 - Lower clamp: w = similarity * (1 - entropy), clamp to 0.35
 * W2 - Non-linear: w = similarity^2 * (1 - entropy), clamp to weightClampMax
 * W3 - Strong entropy: w = similarity * (1 - 1.5*entropy), clamp to weightClampMax
 */
export type WeightMode = 'W0' | 'W1' | 'W2' | 'W3';

export const WEIGHT_MODE_DESCRIPTIONS: Record<WeightMode, string> = {
  W0: 'Baseline: sim*(1-ent), clamp 0.5',
  W1: 'Lower clamp: sim*(1-ent), clamp 0.35',
  W2: 'Non-linear: sim^2*(1-ent), clamp 0.5',
  W3: 'Strong entropy: sim*(1-1.5*ent), clamp 0.5',
};

// ═══════════════════════════════════════════════════════════════
// WALK-FORWARD SIGNAL
// ═══════════════════════════════════════════════════════════════

export type WalkMode = 'SYNTHETIC' | 'HYBRID';
export type WalkDirection = 'UP' | 'DOWN' | 'FLAT';

export interface DxyWalkSignal {
  asOf: Date;                  // Snapshot date
  mode: WalkMode;
  horizonDays: number;         // 7/14/30/90/180/365
  windowLen: number;
  topK: number;
  threshold: number;
  
  currentPrice: number;
  predictedReturn: number;     // decimal: 0.0123 = +1.23%
  predictedDirection: WalkDirection;
  
  similarity: number;          // 0..1
  entropy: number;             // 0..1
  replayWeight: number;        // 0..0.5
  
  matchDate: Date | null;      // Top match end date
  
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// WALK-FORWARD OUTCOME
// ═══════════════════════════════════════════════════════════════

export interface DxyWalkOutcome {
  asOf: Date;
  targetDate: Date;            // asOf + horizonDays (calendar)
  mode: WalkMode;
  horizonDays: number;
  
  entryPrice: number;
  exitPrice: number | null;
  actualReturn: number | null; // decimal
  
  hit: boolean | null;         // null until resolved
  resolvedAt: Date | null;
}

// ═══════════════════════════════════════════════════════════════
// WALK-FORWARD METRICS (aggregated)
// ═══════════════════════════════════════════════════════════════

export interface DxyWalkMetrics {
  mode: WalkMode;
  horizonDays: number;
  from: Date;
  to: Date;
  
  samples: number;
  actionable: number;          // UP or DOWN, not FLAT
  hitRate: number;
  avgReturn: number;
  avgPredictedReturn: number;
  bias: number;                // avgPredicted - avgActual
  
  avgReplayWeight: number;
  replayWeightStd: number;
  
  computedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// API REQUEST/RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════

export interface WalkRunParams {
  from: string;                // YYYY-MM-DD
  to: string;
  stepDays?: number;
  windowLen?: number;
  topK?: number;
  threshold?: number;
  weightMode?: WeightMode;     // A3.6: W0|W1|W2|W3
  weightClampMax?: number;     // A3.6: max replay weight (default 0.5)
  modes?: WalkMode[];
  horizons?: number[];
}

export interface WalkRunResult {
  ok: boolean;
  processed: number;
  createdSignals: number;
  createdOutcomes: number;
  skippedNoData: number;
  durationMs: number;
  errors?: Array<{ date: string; error: string }>;
}

export interface WalkResolveParams {
  from: string;
  to: string;
}

export interface WalkResolveResult {
  ok: boolean;
  attempted: number;
  resolved: number;
  skippedFuture: number;
  durationMs: number;
}

export interface WalkSummaryResult {
  ok: boolean;
  mode: WalkMode;
  horizonDays: number;
  from: string;
  to: string;
  
  samples: number;
  actionable: number;
  actionableRate: number;      // A3.6: actionable / samples
  hitRate: number;
  avgReturn: number;
  avgPredictedReturn: number;
  bias: number;
  
  avgReplayWeight: number;
  replayWeightStd: number;
  
  // A3.6: Equity metrics
  equityFinal: number;         // Final cumulative return
  equityMaxDD: number;         // Maximum drawdown
  
  computedAt: string;
}
