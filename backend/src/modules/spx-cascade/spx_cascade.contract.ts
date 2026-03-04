/**
 * SPX CASCADE CONTRACT — D1 Extended
 * 
 * Defines all types for DXY/AE → SPX cascade overlay.
 * Cascade NEVER changes SPX direction, only scales exposure.
 * 
 * @version SPX_CASCADE_V1.0
 */

// ═══════════════════════════════════════════════════════════════
// CASCADE INPUTS (read-only from DXY/AE)
// ═══════════════════════════════════════════════════════════════

export interface CascadeDxyInputs {
  /** DXY 30d tactical action: LONG/SHORT/HOLD */
  tacticalAction: 'LONG' | 'SHORT' | 'HOLD';
  /** DXY tactical confidence [0..1] */
  tacticalConfidence01: number;
  /** DXY regime mode: tactical/regime */
  regimeMode: 'tactical' | 'regime';
  /** DXY regime bias signed [-1..+1] */
  regimeBiasSigned: number;
  /** DXY guard level */
  guard: 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK';
}

export interface CascadeAeInputs {
  /** AE regime label */
  regime: string;
  /** AE regime confidence [0..1] */
  regimeConfidence01: number;
  /** Transition probabilities */
  transition: {
    pStress1w: number;
    pStress4w: number;
    selfTransition: number;
  };
  /** Regime duration stats */
  durations: {
    stressMedianW: number;
    liquidityMedianW: number;
    currentMedianW: number;
  };
  /** Novelty detection */
  novelty: {
    label: 'KNOWN' | 'RARE' | 'UNKNOWN';
    score: number;
  };
  /** Scenario probabilities */
  scenarios: {
    base: number;
    bull: number;
    bear: number;
  };
}

export interface CascadeInputs {
  dxy: CascadeDxyInputs;
  ae: CascadeAeInputs;
}

// ═══════════════════════════════════════════════════════════════
// CASCADE OVERLAY (computed)
// ═══════════════════════════════════════════════════════════════

export type AgreementType = 'ALIGNED' | 'CONFLICT' | 'NEUTRAL';
export type RiskModeType = 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
export type GuardActionType = 'NONE' | 'SCALE_DOWN' | 'BLOCK';

export interface CascadeOverlay {
  /** SPX vs macro agreement */
  agreement: AgreementType;
  /** Current risk mode from AE */
  riskMode: RiskModeType;
  /** Guard action derived from DXY/AE */
  guard: {
    level: 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK';
    action: GuardActionType;
  };
}

// ═══════════════════════════════════════════════════════════════
// CASCADE MULTIPLIERS — P2.4.4 Updated
// ═══════════════════════════════════════════════════════════════

export interface CascadeMultipliers {
  /** Final size multiplier [0..1] */
  sizeMultiplier: number;
  /** Confidence multiplier [0..1] */
  confidenceMultiplier: number;
  /** Threshold shift for entry (reduces false signals) */
  thresholdShift: number;
  /** Individual factor breakdown */
  factors: {
    mStress: number;
    mPersist: number;
    mNovel: number;
    mScenario: number;
    mLiquidity: number;  // P2.4.4: Fed liquidity multiplier (0.85..1.10)
    guardCap: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// CASCADE DECISION (adjusted)
// ═══════════════════════════════════════════════════════════════

export interface CascadeDecisionAdjusted {
  /** Original SPX action (NOT modified) */
  action: 'BUY' | 'HOLD' | 'REDUCE';
  /** Original confidence from SPX core */
  confidenceOriginal: number;
  /** Adjusted confidence after cascade */
  confidenceAdjusted: number;
  /** Size multiplier for position sizing */
  sizeMultiplier: number;
  /** Final exposure = confidenceAdjusted * sizeMultiplier */
  finalExposure01: number;
}

// ═══════════════════════════════════════════════════════════════
// CASCADE EXPLAIN
// ═══════════════════════════════════════════════════════════════

export interface CascadeExplain {
  /** One-line summary */
  headline: string;
  /** Key drivers */
  drivers: string[];
  /** Limits applied */
  limits: string[];
}

// ═══════════════════════════════════════════════════════════════
// FULL CASCADE PACK
// ═══════════════════════════════════════════════════════════════

export interface SpxCascadePack {
  version: string;
  inputs: CascadeInputs;
  overlay: CascadeOverlay;
  multipliers: CascadeMultipliers;
  decisionAdjusted: CascadeDecisionAdjusted;
  explain: CascadeExplain;
  computedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// SPX CORE INPUT (from existing SPX terminal)
// ═══════════════════════════════════════════════════════════════

export interface SpxCoreSignal {
  action: 'BUY' | 'HOLD' | 'REDUCE';
  confidence: number;
  horizon: string;
  forecastReturn: number;
  phase: string;
}
