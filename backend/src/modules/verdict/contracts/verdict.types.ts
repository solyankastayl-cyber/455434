/**
 * VERDICT ENGINE TYPES
 * ====================
 * 
 * Core contracts for the Verdict Engine.
 * The engine orchestrates: Model outputs → Rules → Meta-Brain → Calibration → Final Verdict
 * 
 * Block 1: Added health state tracking for Evolution credibility weighting.
 */

export type Horizon = "1D" | "7D" | "30D";
export type Action = "BUY" | "SELL" | "HOLD";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

// Block 1: Health state type
export type HealthState = "HEALTHY" | "DEGRADED" | "CRITICAL";

export type ModelOutput = {
  horizon: Horizon;
  expectedReturn: number;  // +0.07 = +7%
  confidenceRaw: number;   // 0..1
  modelId: string;
  featuresHash?: string;
};

export type MarketSnapshot = {
  symbol: string;
  ts: string;              // ISO
  price: number;
  volatility?: number;     // optional
  liquidityScore?: number; // optional
  regime?: string;         // label
  macro?: Record<string, any>;
};

export type VerdictConstraints = {
  maxRisk?: RiskLevel;
  allowShort?: boolean;
  maxPositionPct?: number; // 0..100
};

export type VerdictContext = {
  snapshot: MarketSnapshot;
  outputs: ModelOutput[];
  constraints?: VerdictConstraints;
  metaBrain?: { invariantsEnabled: boolean };
};

export type RuleResult = {
  id: string;
  severity: "INFO" | "WARN" | "BLOCK";
  message: string;
  adjust?: {
    confidenceMul?: number; // multiply confidence
    returnMul?: number;     // multiply expectedReturn
    riskBump?: number;      // +1 bump risk
  };
  overrideAction?: Action;
};

export type VerdictAdjustment = {
  stage: "RULES" | "META_BRAIN" | "CALIBRATION";
  key: string;
  deltaConfidence?: number;
  deltaReturn?: number;
  notes?: string;
};

// Block 1: Health snapshot at verdict time
export type VerdictHealthSnapshot = {
  state: HealthState;
  modifier: number;       // 1.0 / 0.6 / 0.3
  ece?: number;           // Expected Calibration Error from Shadow Monitor
  divergence?: number;    // Model divergence metric
  criticalStreak?: number; // Consecutive critical readings
  notes?: string;
};

export type Verdict = {
  verdictId: string;

  symbol: string;
  ts: string;

  horizon: Horizon;
  action: Action;

  expectedReturn: number; // adjusted
  confidence: number;     // adjusted 0..1
  risk: RiskLevel;

  positionSizePct?: number; // optional v1

  raw: {
    expectedReturn: number;
    confidence: number;
    horizon: Horizon;
    modelId: string;
  };

  adjustments: VerdictAdjustment[];
  appliedRules: Array<{ id: string; severity: "INFO" | "WARN" | "BLOCK"; message: string }>;

  modelId: string;
  regime?: string;

  // Block 1: Health state at verdict time (for Evolution)
  health?: VerdictHealthSnapshot;
};

console.log('[Verdict] Types loaded');
