/**
 * BTC CASCADE CONTRACT — D2
 * 
 * Defines all types for DXY/AE/SPX → BTC cascade overlay.
 * Cascade NEVER changes BTC direction, only scales exposure.
 * 
 * BTC has tighter caps than SPX (more volatile asset).
 * 
 * @version BTC_CASCADE_V1.0
 */

// ═══════════════════════════════════════════════════════════════
// GUARD LEVELS
// ═══════════════════════════════════════════════════════════════

export type GuardLevel = 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK';

export interface BtcGuardInfo {
  level: GuardLevel;
  cap: number;
}

// ═══════════════════════════════════════════════════════════════
// CASCADE INPUTS
// ═══════════════════════════════════════════════════════════════

export interface BtcCascadeInputs {
  /** Stress probability 4 weeks (from AE transition matrix) */
  pStress4w: number;
  /** Bear scenario probability (from AE scenarios) */
  bearProb: number;
  /** Bull scenario probability (from AE scenarios) */
  bullProb: number;
  /** Novelty label (from AE novelty) */
  noveltyLabel: 'NORMAL' | 'RARE' | 'UNSEEN';
  /** Novelty score */
  noveltyScore: number;
  /** SPX adjusted size multiplier (from SPX cascade) */
  spxAdj: number;
  /** AE regime label */
  aeRegime: string;
  /** AE regime confidence */
  aeRegimeConfidence: number;
}

// ═══════════════════════════════════════════════════════════════
// CASCADE MULTIPLIERS — P2.4.4 Updated
// ═══════════════════════════════════════════════════════════════

export interface BtcCascadeMultipliers {
  /** Stress multiplier: 1 - 1.5 * pStress4w */
  mStress: number;
  /** Scenario multiplier: bear>=0.4 → 0.8, bull>=0.4 → 1.05 */
  mScenario: number;
  /** Novelty multiplier: RARE/UNSEEN → 0.85 */
  mNovel: number;
  /** SPX coupling: spxAdj<0.4 → 0.75, >0.8 → 1.05 */
  mSPX: number;
  /** P2.4.4: Liquidity multiplier: EXPANSION → 1.20, CONTRACTION → 0.75 */
  mLiquidity: number;
  /** Raw total before guard cap */
  mTotalRaw: number;
  /** Final total after guard cap */
  mTotal: number;
}

// ═══════════════════════════════════════════════════════════════
// CASCADE DECISION (adjusted)
// ═══════════════════════════════════════════════════════════════

export interface BtcDecisionAdjusted {
  /** Original BTC size (NOT modified) */
  sizeBase: number;
  /** Adjusted size after cascade */
  sizeAdjusted: number;
  /** Original BTC confidence */
  confidenceBase: number;
  /** Adjusted confidence after cascade */
  confidenceAdjusted: number;
}

// ═══════════════════════════════════════════════════════════════
// FULL CASCADE PACK
// ═══════════════════════════════════════════════════════════════

export interface BtcCascadePack {
  version: string;
  guard: BtcGuardInfo;
  inputs: BtcCascadeInputs;
  multipliers: BtcCascadeMultipliers;
  decisionAdjusted: BtcDecisionAdjusted;
  notes: string[];
  warnings: string[];
  computedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// BTC CORE INPUT (from existing BTC terminal)
// ═══════════════════════════════════════════════════════════════

export interface BtcCoreSignal {
  action: 'LONG' | 'SHORT' | 'HOLD';
  size: number;
  confidence: number;
  horizon: string;
}
