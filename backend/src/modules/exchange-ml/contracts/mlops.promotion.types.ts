/**
 * MLOps Promotion Types
 * 
 * Central contracts for ML promotion, policy, and regime-aware calibration.
 * 
 * GOLDEN RULES (LOCKED):
 * - ML NEVER changes action (BUY/SELL/AVOID)
 * - ML can ONLY modify confidence (and optionally ranking)
 * - Macro blocks override ML
 * - ACTIVE_SAFE applies only on LIVE data
 */

// ═══════════════════════════════════════════════════════════════
// MODEL & MODE STATES
// ═══════════════════════════════════════════════════════════════

export type ModelState = 'ACTIVE' | 'CANDIDATE' | 'RETIRED';

export type MlMode = 'OFF' | 'SHADOW' | 'ACTIVE_SAFE';

export type PromotionScope = 'CONFIDENCE' | 'RANKING';

export type DataMode = 'LIVE' | 'CACHED' | 'MIXED' | 'MOCK';

// ═══════════════════════════════════════════════════════════════
// REGIME & RISK (aligned with macro-intel)
// ═══════════════════════════════════════════════════════════════

export type RegimeId =
  | 'BTC_FLIGHT_TO_SAFETY'
  | 'PANIC_SELL_OFF'
  | 'BTC_LEADS_ALT_FOLLOW'
  | 'BTC_MAX_PRESSURE'
  | 'ALT_ROTATION'
  | 'FULL_RISK_OFF'
  | 'ALT_SEASON'
  | 'CAPITAL_EXIT';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

// ═══════════════════════════════════════════════════════════════
// MACRO BLOCKS
// ═══════════════════════════════════════════════════════════════

export interface MacroBlocks {
  /** Active block codes (e.g., "MACRO_PANIC", "STRONG_BLOCKED") */
  codes: string[];
  /** If true, Meta-Brain must block BUY/SELL or downgrade strength */
  blocked: boolean;
}

// ═══════════════════════════════════════════════════════════════
// MACRO CONTEXT (lite version for ML)
// ═══════════════════════════════════════════════════════════════

export interface MacroContextLite {
  regimeId: RegimeId;
  risk: RiskLevel;
  fearGreed?: number;        // 0-100
  btcDom?: number;           // %
  stableDom?: number;        // %
  macroModifier: number;     // 0-1+ (usually <=1)
  blocks: MacroBlocks;
}

// ═══════════════════════════════════════════════════════════════
// ML CALIBRATION OUTPUT
// ═══════════════════════════════════════════════════════════════

export interface MlCalibrationOutput {
  /** Calibrated probability (0-1) */
  pCalibrated: number;
  /** Drift state */
  drift?: {
    state: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
    score: number;
  };
  /** Model ID used */
  modelId?: string;
}

// ═══════════════════════════════════════════════════════════════
// PROMOTION POLICY (configurable via admin)
// ═══════════════════════════════════════════════════════════════

export interface PromotionPolicy {
  version: string;
  
  // Hard rules (LOCKED)
  applyOnlyWhenLive: true;
  neverFlipDecision: true;
  respectMacroBlocks: true;
  
  // Per-regime max confidence caps
  maxConfidenceByRegime: Record<RegimeId, number>;
  
  // ML modifier bounds
  mlModifierBounds: {
    min: number;  // e.g., 0.7
    max: number;  // e.g., 1.1
  };
  
  // Optional: only allow lowering confidence
  onlyLowerConfidence?: boolean;
  
  // Optional: disable ML on AVOID
  noMlOnAvoid?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// PROMOTION STATE
// ═══════════════════════════════════════════════════════════════

export interface PromotionState {
  mode: MlMode;
  scope: PromotionScope[];
  activeModelId?: string;
  candidateModelId?: string;
  previousActiveModelId?: string;
  policy: PromotionPolicy;
  updatedAt: string;
  updatedBy?: string;
}

// ═══════════════════════════════════════════════════════════════
// ML APPLY INPUT/OUTPUT
// ═══════════════════════════════════════════════════════════════

export interface MlApplyInput {
  dataMode: DataMode;
  symbol: string;
  baseAction: 'BUY' | 'SELL' | 'AVOID';
  baseConfidence: number;  // 0-1
  macro: MacroContextLite;
  ml?: MlCalibrationOutput;
}

export interface MlApplyOutput {
  applied: boolean;
  mlModifier: number;
  macroModifier: number;
  cappedConfidence: number;
  finalConfidence: number;
  capApplied?: number;
  reasonCodes: string[];
  modelId?: string;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT POLICY
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_REGIME_CAPS: Record<RegimeId, number> = {
  BTC_FLIGHT_TO_SAFETY: 0.65,
  PANIC_SELL_OFF: 0.50,
  BTC_LEADS_ALT_FOLLOW: 0.70,
  BTC_MAX_PRESSURE: 0.55,
  ALT_ROTATION: 0.65,
  FULL_RISK_OFF: 0.50,
  ALT_SEASON: 0.70,
  CAPITAL_EXIT: 0.45,
};

export const DEFAULT_PROMOTION_POLICY: PromotionPolicy = {
  version: 'policy:v1.0',
  applyOnlyWhenLive: true,
  neverFlipDecision: true,
  respectMacroBlocks: true,
  maxConfidenceByRegime: DEFAULT_REGIME_CAPS,
  mlModifierBounds: { min: 0.7, max: 1.1 },
  onlyLowerConfidence: true,
  noMlOnAvoid: false,
};

export const DEFAULT_PROMOTION_STATE: PromotionState = {
  mode: 'SHADOW',
  scope: ['CONFIDENCE'],
  policy: DEFAULT_PROMOTION_POLICY,
  updatedAt: new Date().toISOString(),
};

console.log('[MLOps] Promotion types loaded');
