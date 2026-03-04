/**
 * P10.2 — MetaRisk Scale Contract
 * 
 * Duration + Stability → Posture + Caps
 * Institutional aggression/defense layer.
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type Posture = 'DEFENSIVE' | 'NEUTRAL' | 'OFFENSIVE';

export interface MetaRiskComponents {
  durationBoost: number;   // +0..+0.08
  stabilityBoost: number;  // +0..+0.05
  flipPenalty: number;     // -0..-0.10
  guardDrag: number;       // -0..-0.40
  crossAssetAdj: number;   // -0.10..+0.05
  scenarioAdj: number;     // -0.25..+0.05 (TAIL/RISK/BASE)
}

export interface MetaRiskInputs {
  macro: { 
    regime: string; 
    daysInState: number; 
    stability: number; 
    flips30d: number; 
  };
  guard: { 
    level: string; 
    daysInState: number; 
    stability: number; 
    flips30d: number; 
  };
  crossAsset: { 
    regime: string; 
    daysInState: number; 
    stability: number; 
    flips30d: number; 
    confidence?: number; 
  };
  brainScenario?: { 
    scenario: string; 
    pTail: number; 
    pRisk: number; 
    tailRisk?: number; 
  };
}

export interface MetaRiskPack {
  asOf: string;
  metaRiskScale: number;   // clamp 0.60..1.10
  posture: Posture;
  maxOverrideCap: number;  // clamp 0.20..0.60
  components: MetaRiskComponents;
  reasons: string[];       // short machine reasons for evidence
  inputs: MetaRiskInputs;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const META_RISK_BOUNDS = {
  SCALE_MIN: 0.60,
  SCALE_MAX: 1.10,
  CAP_MIN: 0.20,
  CAP_MAX: 0.60,
};

export const POSTURE_THRESHOLDS = {
  OFFENSIVE_MIN: 1.03,
  DEFENSIVE_MAX: 0.92,
};

export const BASE_CAPS: Record<Posture, number> = {
  OFFENSIVE: 0.45,
  NEUTRAL: 0.35,
  DEFENSIVE: 0.25,
};

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Saturating ramp: clamp(x, 0, 1)
 */
export function sat(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Clamp value to [min, max]
 */
export function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

/**
 * Round to 3 decimal places
 */
export function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT CALCULATORS
// ═══════════════════════════════════════════════════════════════

/**
 * 2.1 DurationBoost — depends on macro regime + duration
 * Logic: regime matters, but "how long it holds" matters more
 */
export function calcDurationBoost(macroRegime: string, daysInState: number): number {
  switch (macroRegime) {
    case 'EASING':
      // +0.08 * sat((days - 30) / 90) — 30d warmup, full by ~120d
      return round3(+0.08 * sat((daysInState - 30) / 90));
    case 'NEUTRAL':
    case 'NEUTRAL_MIXED':
      // +0.03 * sat((days - 45) / 120) — less and later
      return round3(+0.03 * sat((daysInState - 45) / 120));
    case 'TIGHTENING':
      // -0.06 * sat((days - 14) / 60)
      return round3(-0.06 * sat((daysInState - 14) / 60));
    case 'STRESS':
      // -0.10 * sat((days - 7) / 30)
      return round3(-0.10 * sat((daysInState - 7) / 30));
    case 'RISK_ON':
      return round3(+0.05 * sat((daysInState - 30) / 90));
    case 'RISK_OFF':
      return round3(-0.08 * sat((daysInState - 14) / 60));
    default:
      return 0;
  }
}

/**
 * 2.2 StabilityBoost — regime stability reward
 * stabilityBoost = +0.05 * sat((stability - 0.65) / 0.25)
 */
export function calcStabilityBoost(stability: number): number {
  return round3(+0.05 * sat((stability - 0.65) / 0.25));
}

/**
 * 2.3 FlipPenalty — penalty for "flapping"
 * flipPenalty = -0.10 * sat(flips30d / 6)
 */
export function calcFlipPenalty(flips30d: number): number {
  return round3(-0.10 * sat(flips30d / 6));
}

/**
 * 2.4 GuardDrag — hard risk control
 */
export function calcGuardDrag(guardLevel: string): number {
  switch (guardLevel) {
    case 'BLOCK': return -0.40;
    case 'CRISIS': return -0.25;
    case 'WARN': return -0.10;
    case 'NONE':
    default: return 0;
  }
}

/**
 * 2.5 CrossAssetAdj — market synchronization regime
 */
export function calcCrossAssetAdj(crossAssetRegime: string): number {
  switch (crossAssetRegime) {
    case 'RISK_ON_SYNC': return +0.03;
    case 'MIXED': return 0;
    case 'DECOUPLED': return -0.05;
    case 'FLIGHT_TO_QUALITY': return -0.10;
    case 'RISK_OFF_SYNC': return -0.08;
    default: return 0;
  }
}

/**
 * 2.6 ScenarioAdj — from Brain scenario (BASE/RISK/TAIL)
 */
export function calcScenarioAdj(scenario: string): number {
  switch (scenario) {
    case 'TAIL': return -0.25;
    case 'RISK': return -0.12;
    case 'BASE': return +0.02;
    default: return 0;
  }
}

// ═══════════════════════════════════════════════════════════════
// POSTURE + CAP CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * 3.1 Posture classification
 */
export function calcPosture(
  guardLevel: string, 
  scenario: string, 
  metaRiskScale: number
): Posture {
  // Guard/scenario dominance: BLOCK/CRISIS or TAIL → DEFENSIVE
  if (guardLevel === 'BLOCK' || guardLevel === 'CRISIS') {
    return 'DEFENSIVE';
  }
  if (scenario === 'TAIL') {
    return 'DEFENSIVE';
  }
  
  // Scale-based classification
  if (metaRiskScale >= POSTURE_THRESHOLDS.OFFENSIVE_MIN) {
    return 'OFFENSIVE';
  }
  if (metaRiskScale <= POSTURE_THRESHOLDS.DEFENSIVE_MAX) {
    return 'DEFENSIVE';
  }
  
  return 'NEUTRAL';
}

/**
 * 3.2 maxOverrideCap calculation
 */
export function calcMaxOverrideCap(
  posture: Posture, 
  scenario: string, 
  flips30d: number
): number {
  // Base cap by posture
  let baseCap = BASE_CAPS[posture];
  
  // TAIL scenario allows higher cap (but only for risk-down)
  if (scenario === 'TAIL') {
    baseCap = 0.60;
  }
  
  // High flips reduce cap
  baseCap = baseCap - 0.10 * sat(flips30d / 6);
  
  return round3(clamp(baseCap, META_RISK_BOUNDS.CAP_MIN, META_RISK_BOUNDS.CAP_MAX));
}

// ═══════════════════════════════════════════════════════════════
// FULL CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate complete MetaRiskPack
 */
export function calculateMetaRisk(inputs: MetaRiskInputs, asOf: string): MetaRiskPack {
  const reasons: string[] = [];
  
  // Extract inputs
  const macroRegime = inputs.macro.regime;
  const macroDays = inputs.macro.daysInState;
  const macroStability = inputs.macro.stability;
  const macroFlips = inputs.macro.flips30d;
  
  const guardLevel = inputs.guard.level;
  const guardDays = inputs.guard.daysInState;
  
  const crossAssetRegime = inputs.crossAsset.regime;
  
  const scenario = inputs.brainScenario?.scenario || 'BASE';
  
  // Calculate components
  const durationBoost = calcDurationBoost(macroRegime, macroDays);
  const stabilityBoost = calcStabilityBoost(macroStability);
  const flipPenalty = calcFlipPenalty(macroFlips);
  const guardDrag = calcGuardDrag(guardLevel);
  const crossAssetAdj = calcCrossAssetAdj(crossAssetRegime);
  const scenarioAdj = calcScenarioAdj(scenario);
  
  // Build reasons
  if (durationBoost > 0) reasons.push(`DURATION_BOOST:${macroRegime}@${macroDays}d`);
  if (durationBoost < 0) reasons.push(`DURATION_DRAG:${macroRegime}@${macroDays}d`);
  if (stabilityBoost > 0.01) reasons.push(`STABILITY_BOOST:${macroStability.toFixed(2)}`);
  if (flipPenalty < -0.01) reasons.push(`FLIP_PENALTY:${macroFlips}flips`);
  if (guardDrag < 0) reasons.push(`GUARD_DRAG:${guardLevel}`);
  if (crossAssetAdj !== 0) reasons.push(`CROSS_ASSET:${crossAssetRegime}`);
  if (scenarioAdj !== 0) reasons.push(`SCENARIO:${scenario}`);
  
  // Calculate raw scale
  const metaRiskScaleRaw = 1.0 + durationBoost + stabilityBoost + flipPenalty + guardDrag + crossAssetAdj + scenarioAdj;
  const metaRiskScale = round3(clamp(metaRiskScaleRaw, META_RISK_BOUNDS.SCALE_MIN, META_RISK_BOUNDS.SCALE_MAX));
  
  // Calculate posture and cap
  const posture = calcPosture(guardLevel, scenario, metaRiskScale);
  const maxOverrideCap = calcMaxOverrideCap(posture, scenario, macroFlips);
  
  reasons.push(`POSTURE:${posture}`);
  
  return {
    asOf,
    metaRiskScale,
    posture,
    maxOverrideCap,
    components: {
      durationBoost,
      stabilityBoost,
      flipPenalty,
      guardDrag,
      crossAssetAdj,
      scenarioAdj,
    },
    reasons,
    inputs,
  };
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

export function validateMetaRiskPack(pack: MetaRiskPack): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!pack.asOf) errors.push('Missing asOf');
  if (pack.metaRiskScale < META_RISK_BOUNDS.SCALE_MIN || pack.metaRiskScale > META_RISK_BOUNDS.SCALE_MAX) {
    errors.push(`metaRiskScale out of bounds: ${pack.metaRiskScale}`);
  }
  if (!['DEFENSIVE', 'NEUTRAL', 'OFFENSIVE'].includes(pack.posture)) {
    errors.push(`Invalid posture: ${pack.posture}`);
  }
  if (pack.maxOverrideCap < META_RISK_BOUNDS.CAP_MIN || pack.maxOverrideCap > META_RISK_BOUNDS.CAP_MAX) {
    errors.push(`maxOverrideCap out of bounds: ${pack.maxOverrideCap}`);
  }
  
  return { valid: errors.length === 0, errors };
}
