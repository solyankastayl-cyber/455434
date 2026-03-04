/**
 * SPX CASCADE RULES — D1 Extended + P2.4.4 Liquidity
 * 
 * Pure functions for cascade logic.
 * All calculations are deterministic.
 * 
 * KEY INVARIANTS:
 * - Cascade NEVER changes SPX direction
 * - Only scales size, confidence, threshold
 * - Guard always applied last
 * 
 * P2.4.4: Added liquidity regime multiplier
 */

import type {
  CascadeInputs,
  CascadeOverlay,
  CascadeMultipliers,
  AgreementType,
  RiskModeType,
  GuardActionType,
} from './spx_cascade.contract.js';

// P2.4.4: Import liquidity multiplier
import { getSpxLiquidityMultiplier } from '../liquidity-engine/liquidity.regime.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

/** Guard caps by level */
export const GUARD_CAPS = {
  NONE: 1.0,
  WARN: 0.75,
  CRISIS: 0.4,
  BLOCK: 0.0,
} as const;

/** Stress regimes that trigger additional haircut */
export const STRESS_REGIMES = [
  'RISK_OFF_STRESS',
  'STRESS',
  'CRISIS',
  'RISK_OFF',
];

/** Novelty threshold for RARE classification */
export const NOVELTY_RARE_THRESHOLD = 0.12;

/** Multiplier weights */
export const WEIGHTS = {
  /** Stress risk weight (1.2 = 5.8% stress → 7% haircut) */
  stressRiskWeight: 1.2,
  /** Additional haircut when in stress regime */
  stressRegimeHaircut: 0.85,
  /** Persistence weight (0.5 = 86% persist → 43% haircut) */
  persistenceWeight: 0.5,
  /** Novelty haircut when RARE */
  noveltyRareHaircut: 0.85,
  /** Scenario tilt weight */
  scenarioTiltWeight: 0.25,
  /** Threshold shift base */
  thresholdShiftBase: 0.005,
  /** Threshold shift per stress % */
  thresholdShiftPerStress: 0.01,
} as const;

// ═══════════════════════════════════════════════════════════════
// AGREEMENT LOGIC
// ═══════════════════════════════════════════════════════════════

/**
 * Determine agreement between SPX signal and macro regime.
 * 
 * ALIGNED: SPX action matches risk mode
 * CONFLICT: SPX action opposes risk mode
 * NEUTRAL: No clear opposition
 */
export function computeAgreement(
  spxAction: 'BUY' | 'HOLD' | 'REDUCE',
  riskMode: RiskModeType
): AgreementType {
  if (riskMode === 'NEUTRAL') return 'NEUTRAL';
  
  if (spxAction === 'BUY' && riskMode === 'RISK_OFF') return 'CONFLICT';
  if (spxAction === 'REDUCE' && riskMode === 'RISK_ON') return 'CONFLICT';
  if (spxAction === 'BUY' && riskMode === 'RISK_ON') return 'ALIGNED';
  if (spxAction === 'REDUCE' && riskMode === 'RISK_OFF') return 'ALIGNED';
  
  return 'NEUTRAL';
}

/**
 * Derive risk mode from AE regime.
 */
export function deriveRiskMode(aeRegime: string): RiskModeType {
  const regime = aeRegime.toUpperCase();
  
  if (STRESS_REGIMES.some(s => regime.includes(s))) {
    return 'RISK_OFF';
  }
  
  if (regime.includes('LIQUIDITY') || regime.includes('EXPANSION')) {
    return 'RISK_ON';
  }
  
  return 'NEUTRAL';
}

/**
 * Derive guard action from guard level.
 */
export function deriveGuardAction(
  guardLevel: 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK'
): GuardActionType {
  switch (guardLevel) {
    case 'BLOCK': return 'BLOCK';
    case 'CRISIS':
    case 'WARN': return 'SCALE_DOWN';
    default: return 'NONE';
  }
}

// ═══════════════════════════════════════════════════════════════
// MULTIPLIER CALCULATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate stress risk multiplier.
 * 
 * m_stress = 1 - 1.2 * pStress4w
 * If in stress regime: *= 0.85
 */
export function calcStressMultiplier(
  pStress4w: number,
  aeRegime: string
): number {
  // Clamp stress probability
  const stress = Math.max(0, Math.min(0.25, pStress4w));
  
  // Base multiplier
  let m = 1 - WEIGHTS.stressRiskWeight * stress;
  
  // Additional haircut if already in stress
  if (STRESS_REGIMES.some(s => aeRegime.toUpperCase().includes(s))) {
    m *= WEIGHTS.stressRegimeHaircut;
  }
  
  return Math.max(0.1, Math.min(1, m));
}

/**
 * Calculate persistence multiplier.
 * 
 * Higher persistence of stress regime → lower multiplier
 * m_persist = 1 - 0.5 * persistence
 */
export function calcPersistenceMultiplier(
  selfTransition: number,
  aeRegime: string
): number {
  // Only apply persistence haircut for stress regimes
  if (!STRESS_REGIMES.some(s => aeRegime.toUpperCase().includes(s))) {
    return 1.0;
  }
  
  const persistence = Math.max(0, Math.min(1, selfTransition));
  const m = 1 - WEIGHTS.persistenceWeight * persistence;
  
  return Math.max(0.3, Math.min(1, m));
}

/**
 * Calculate novelty multiplier.
 * 
 * RARE → 0.85
 * KNOWN → 1.0
 */
export function calcNoveltyMultiplier(noveltyScore: number): number {
  if (noveltyScore > NOVELTY_RARE_THRESHOLD) {
    return WEIGHTS.noveltyRareHaircut;
  }
  return 1.0;
}

/**
 * Calculate scenario tilt multiplier.
 * 
 * bearProb > bullProb → reduce exposure
 * m_scenario = 1 - 0.25 * max(bear - bull, 0)
 */
export function calcScenarioMultiplier(
  bearProb: number,
  bullProb: number
): number {
  const tilt = Math.max(0, Math.min(0.5, bearProb - bullProb));
  const m = 1 - WEIGHTS.scenarioTiltWeight * tilt;
  
  return Math.max(0.5, Math.min(1, m));
}

/**
 * P2.4.4: Calculate liquidity regime multiplier.
 * 
 * Fed liquidity impacts SPX exposure:
 * - EXPANSION → 1.10 (boost)
 * - NEUTRAL → 1.00 (no change)
 * - CONTRACTION → 0.85 (reduce)
 * 
 * This is async but we provide a sync wrapper with cached value.
 */
export const LIQUIDITY_MULTIPLIERS_SPX = {
  EXPANSION: 1.10,
  NEUTRAL: 1.00,
  CONTRACTION: 0.85,
} as const;

// Cached liquidity multiplier (updated async)
let cachedLiquidityMultiplier = { value: 1.0, regime: 'NEUTRAL', updatedAt: 0 };

/**
 * Get cached liquidity multiplier (sync).
 * Cache is refreshed every 5 minutes.
 */
export function getCachedLiquidityMultiplier(): { value: number; regime: string } {
  return { value: cachedLiquidityMultiplier.value, regime: cachedLiquidityMultiplier.regime };
}

/**
 * Refresh liquidity multiplier cache (async).
 */
export async function refreshLiquidityMultiplierCache(): Promise<void> {
  try {
    const result = await getSpxLiquidityMultiplier();
    cachedLiquidityMultiplier = {
      value: result.multiplier,
      regime: result.regime,
      updatedAt: Date.now(),
    };
  } catch (e) {
    console.warn('[SPX Cascade] Liquidity multiplier unavailable:', (e as Error).message);
  }
}

/**
 * Calculate liquidity multiplier (sync, uses cache).
 */
export function calcLiquidityMultiplier(): number {
  // Refresh cache in background if stale (>5 min)
  if (Date.now() - cachedLiquidityMultiplier.updatedAt > 5 * 60 * 1000) {
    refreshLiquidityMultiplierCache().catch(() => {});
  }
  
  return cachedLiquidityMultiplier.value;
}

/**
 * Calculate threshold shift.
 * 
 * Reduces entry frequency during stress/conflict.
 */
export function calcThresholdShift(
  agreement: AgreementType,
  guardLevel: 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK',
  pStress4w: number
): number {
  let shift = 0;
  
  // Add shift for conflict or crisis
  if (agreement === 'CONFLICT' || guardLevel === 'CRISIS' || guardLevel === 'BLOCK') {
    shift = WEIGHTS.thresholdShiftBase + WEIGHTS.thresholdShiftPerStress * pStress4w;
  } else if (guardLevel === 'WARN') {
    shift = WEIGHTS.thresholdShiftBase * 0.5;
  }
  
  return Math.max(0, Math.min(0.03, shift));
}

// ═══════════════════════════════════════════════════════════════
// MAIN OVERLAY COMPUTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Compute overlay from cascade inputs.
 */
export function computeOverlay(
  inputs: CascadeInputs,
  spxAction: 'BUY' | 'HOLD' | 'REDUCE'
): CascadeOverlay {
  const riskMode = deriveRiskMode(inputs.ae.regime);
  const agreement = computeAgreement(spxAction, riskMode);
  const guardAction = deriveGuardAction(inputs.dxy.guard);
  
  return {
    agreement,
    riskMode,
    guard: {
      level: inputs.dxy.guard,
      action: guardAction,
    },
  };
}

/**
 * Compute all multipliers.
 * P2.4.4: Added mLiquidity factor
 */
export function computeMultipliers(
  inputs: CascadeInputs,
  overlay: CascadeOverlay
): CascadeMultipliers {
  // Individual factors
  const mStress = calcStressMultiplier(
    inputs.ae.transition.pStress4w,
    inputs.ae.regime
  );
  
  const mPersist = calcPersistenceMultiplier(
    inputs.ae.transition.selfTransition,
    inputs.ae.regime
  );
  
  const mNovel = calcNoveltyMultiplier(inputs.ae.novelty.score);
  
  const mScenario = calcScenarioMultiplier(
    inputs.ae.scenarios.bear,
    inputs.ae.scenarios.bull
  );
  
  // P2.4.4: Liquidity multiplier
  const mLiquidity = calcLiquidityMultiplier();
  
  // Guard cap
  const guardCap = GUARD_CAPS[overlay.guard.level];
  
  // Confidence multiplier (before guard) — P2.4.4: includes liquidity
  const confidenceMultiplier = mStress * mPersist * mNovel * mScenario * mLiquidity;
  
  // Size multiplier (after guard cap)
  const sizeMultiplier = Math.min(guardCap, confidenceMultiplier);
  
  // Threshold shift
  const thresholdShift = calcThresholdShift(
    overlay.agreement,
    overlay.guard.level,
    inputs.ae.transition.pStress4w
  );
  
  return {
    sizeMultiplier,
    confidenceMultiplier,
    thresholdShift,
    factors: {
      mStress,
      mPersist,
      mNovel,
      mScenario,
      mLiquidity,  // P2.4.4
      guardCap,
    },
  };
}

/**
 * Generate explanation.
 * P2.4.4: Added liquidity driver
 */
export function generateExplain(
  inputs: CascadeInputs,
  overlay: CascadeOverlay,
  multipliers: CascadeMultipliers
): { headline: string; drivers: string[]; limits: string[] } {
  const drivers: string[] = [];
  const limits: string[] = [
    'Direction not modified',
    'Only exposure scaled',
  ];
  
  // Build drivers
  const isStress = STRESS_REGIMES.some(s => 
    inputs.ae.regime.toUpperCase().includes(s)
  );
  
  if (isStress) {
    drivers.push(`AE regime = ${inputs.ae.regime}`);
  }
  
  if (inputs.ae.transition.pStress4w > 0.05) {
    drivers.push(`pStress4w = ${(inputs.ae.transition.pStress4w * 100).toFixed(1)}%`);
  }
  
  if (inputs.ae.novelty.label === 'RARE') {
    drivers.push(`Novelty = ${inputs.ae.novelty.label}`);
  }
  
  if (overlay.guard.level !== 'NONE') {
    drivers.push(`Guard = ${overlay.guard.level}`);
  }
  
  if (inputs.ae.scenarios.bear > inputs.ae.scenarios.bull + 0.1) {
    drivers.push(`Bear scenario dominant (${(inputs.ae.scenarios.bear * 100).toFixed(0)}%)`);
  }
  
  // P2.4.4: Liquidity driver
  const liquidityInfo = getCachedLiquidityMultiplier();
  if (liquidityInfo.regime !== 'NEUTRAL') {
    drivers.push(`Fed Liquidity = ${liquidityInfo.regime} (×${liquidityInfo.value.toFixed(2)})`);
  }
  
  // Headline
  let headline = 'Normal conditions → standard SPX exposure';
  
  if (overlay.guard.level === 'BLOCK') {
    headline = 'BLOCK guard active → SPX exposure blocked';
  } else if (overlay.guard.level === 'CRISIS') {
    headline = 'CRISIS guard → SPX exposure capped at 40%';
  } else if (isStress) {
    headline = 'Stress regime detected → SPX exposure reduced';
  } else if (liquidityInfo.regime === 'CONTRACTION') {
    headline = 'Liquidity contraction → SPX exposure reduced';
  } else if (overlay.agreement === 'CONFLICT') {
    headline = 'Macro/SPX conflict → reduced confidence';
  } else if (liquidityInfo.regime === 'EXPANSION' && multipliers.sizeMultiplier > 0.9) {
    headline = 'Liquidity expansion → SPX exposure boosted';
  } else if (multipliers.sizeMultiplier > 0.9) {
    headline = 'Favorable conditions → full SPX exposure';
  }
  
  return { headline, drivers, limits };
}
