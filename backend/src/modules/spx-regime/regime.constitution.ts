/**
 * SPX REGIME ENGINE — Constitution Generator v2
 * 
 * BLOCK B6.14 — Regime-based guardrails with:
 * - Decade stability scoring (B6.14.1)
 * - Constitution building with eligibility gates (B6.14.2)
 * - Risk policies (ALLOW/CAUTION/BLOCK)
 * 
 * NOT alpha generation. Risk gates only.
 */

import { RegimeTag } from './regime.config.js';

// ===== B6.14.1 DECADE STABILITY =====

export interface DecadeStabilityCell {
  regimeTag: RegimeTag;
  horizon: string;
  decade: string;  // '1950s', '1960s', etc.
  samples: number;
  skillDown: number;
  skillUp: number;
  hitDown: number;
  hitUp: number;
}

export interface StabilityScore {
  regimeTag: RegimeTag;
  horizon: string;
  
  // Decade breakdown
  decadeStats: DecadeStabilityCell[];
  decadesWithData: number;      // How many decades have any data
  decadesWithMinSamples: number; // Decades with >= MIN_DECADE_SAMPLES
  
  // Stability metrics
  coverage: number;       // decadesWithMinSamples / totalDecades
  consistency: number;    // % of decades where skillDown > 0
  meanSkillDown: number;  // avg skill across decades
  stdSkillDown: number;   // dispersion
  
  // Final verdict
  stabilityGrade: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNPROVEN';
  confidenceUplift: boolean; // True if >= 3 decades and consistency >= 0.66
}

export interface DecadeStabilityResult {
  computedAt: string;
  horizons: string[];
  regimes: string[];
  cells: StabilityScore[];
}

// ===== B6.14.2 CONSTITUTION =====

export type PolicyAction = 'ALLOW' | 'CAUTION' | 'BLOCK';

export interface RegimePolicy {
  regimeTag: RegimeTag;
  
  // Status
  status: 'PROVEN' | 'MODERATE' | 'UNPROVEN' | 'NEGATIVE';
  
  // Filter policies
  shortFilterPolicy: PolicyAction;
  longFilterPolicy: PolicyAction;
  
  // Size caps (0.0 - 1.0)
  sizeCapShort: number;
  sizeCapLong: number;
  
  // Evidence
  samples: number;
  avgSkillDown: number;
  avgSkillUp: number;
  stabilityGrade: string;
  decadeCoverage: number;
  
  // Reasoning
  notes: string[];
}

export interface ConstitutionV2 {
  version: string;
  hash: string;
  generatedAt: string;
  preset: string;
  
  // Global settings
  minSamplesRule: number;
  minStabilityScore: number;
  
  // Per-regime policies
  policies: RegimePolicy[];
  
  // Summary stats
  summary: {
    totalRegimes: number;
    proven: number;
    moderate: number;
    unproven: number;
    negative: number;
  };
}

// ===== CONFIGURATION =====

export const CONSTITUTION_CONFIG = {
  // B6.14.1 Stability thresholds
  MIN_DECADE_SAMPLES: 30,        // Min samples per decade to count
  MIN_DECADES_COVERAGE: 3,      // Need data in at least 3 decades for PROVEN
  MIN_CONSISTENCY: 0.66,        // 66% decades must have skillDown > 0
  
  // B6.14.2 Constitution thresholds
  MIN_SAMPLES_RULE: 500,        // Min total samples to be PROVEN
  MIN_SAMPLES_MODERATE: 100,    // Min samples for MODERATE
  SKILL_THRESHOLD_HIGH: 0.03,   // +3% skill = strong evidence
  SKILL_THRESHOLD_LOW: 0.01,    // +1% skill = weak evidence
  SKILL_NEGATIVE: -0.02,        // -2% skill = model hurts
  
  // Size caps
  CAP_ALLOW: 1.0,
  CAP_CAUTION: 0.75,
  CAP_UNPROVEN: 0.85,
  CAP_BLOCK: 0.0,
  
  // Decades for analysis
  DECADES: ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'],
};

/**
 * Determine decade from date string
 */
export function getDecadeFromDate(dateStr: string): string {
  const year = parseInt(dateStr.substring(0, 4));
  const decadeStart = Math.floor(year / 10) * 10;
  return `${decadeStart}s`;
}

/**
 * Calculate standard deviation
 */
function calcStd(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Grade stability based on metrics
 */
export function gradeStability(
  decadesWithMinSamples: number,
  consistency: number,
  totalSamples: number
): 'HIGH' | 'MEDIUM' | 'LOW' | 'UNPROVEN' {
  // Must have enough decades and samples
  if (decadesWithMinSamples < 2 || totalSamples < CONSTITUTION_CONFIG.MIN_SAMPLES_MODERATE) {
    return 'UNPROVEN';
  }
  
  // HIGH: Good coverage + consistent positive skill
  if (
    decadesWithMinSamples >= CONSTITUTION_CONFIG.MIN_DECADES_COVERAGE &&
    consistency >= CONSTITUTION_CONFIG.MIN_CONSISTENCY &&
    totalSamples >= CONSTITUTION_CONFIG.MIN_SAMPLES_RULE
  ) {
    return 'HIGH';
  }
  
  // MEDIUM: Some evidence
  if (
    decadesWithMinSamples >= 2 &&
    consistency >= 0.5 &&
    totalSamples >= CONSTITUTION_CONFIG.MIN_SAMPLES_MODERATE
  ) {
    return 'MEDIUM';
  }
  
  // LOW: Weak evidence
  if (decadesWithMinSamples >= 1 && totalSamples >= CONSTITUTION_CONFIG.MIN_SAMPLES_MODERATE) {
    return 'LOW';
  }
  
  return 'UNPROVEN';
}

/**
 * Determine policy action based on skill and stability
 */
export function determinePolicy(
  avgSkill: number,
  stabilityGrade: string,
  status: string
): PolicyAction {
  // Negative skill = BLOCK
  if (avgSkill < CONSTITUTION_CONFIG.SKILL_NEGATIVE) {
    return 'BLOCK';
  }
  
  // Unproven = CAUTION regardless of skill
  if (status === 'UNPROVEN' || stabilityGrade === 'UNPROVEN') {
    return 'CAUTION';
  }
  
  // Negative status = CAUTION or BLOCK
  if (status === 'NEGATIVE') {
    return avgSkill < 0 ? 'BLOCK' : 'CAUTION';
  }
  
  // High skill + good stability = ALLOW
  if (avgSkill >= CONSTITUTION_CONFIG.SKILL_THRESHOLD_HIGH && stabilityGrade === 'HIGH') {
    return 'ALLOW';
  }
  
  // Moderate skill or stability = CAUTION
  if (avgSkill >= CONSTITUTION_CONFIG.SKILL_THRESHOLD_LOW && stabilityGrade !== 'LOW') {
    return 'CAUTION';
  }
  
  // Default = CAUTION
  return 'CAUTION';
}

/**
 * Calculate size cap based on policy and crisis overlay
 */
export function calculateSizeCap(
  policy: PolicyAction,
  isCrisisRegime: boolean = false,
  isFastVShape: boolean = false
): number {
  let cap = CONSTITUTION_CONFIG.CAP_CAUTION;
  
  switch (policy) {
    case 'ALLOW':
      cap = CONSTITUTION_CONFIG.CAP_ALLOW;
      break;
    case 'CAUTION':
      cap = CONSTITUTION_CONFIG.CAP_CAUTION;
      break;
    case 'BLOCK':
      return CONSTITUTION_CONFIG.CAP_BLOCK;
  }
  
  // B6.14.2: Crisis Typology Overlay - downgrade one level
  if (isFastVShape) {
    cap = Math.min(cap, CONSTITUTION_CONFIG.CAP_CAUTION);
    // Further reduce for dangerous fast V-shapes
    cap *= 0.9;
  }
  
  if (isCrisisRegime) {
    cap *= 0.85;
  }
  
  return Math.round(cap * 100) / 100;
}

/**
 * Generate hash for constitution versioning
 */
export function generateConstitutionHash(policies: RegimePolicy[]): string {
  const str = policies.map(p => `${p.regimeTag}:${p.shortFilterPolicy}:${p.sizeCapShort}`).join('|');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export default {
  CONSTITUTION_CONFIG,
  getDecadeFromDate,
  gradeStability,
  determinePolicy,
  calculateSizeCap,
  generateConstitutionHash,
};
