/**
 * BLOCK 36.0 — Fractal Presets & Version Control
 * 
 * v1_final is FROZEN and CERTIFIED STABLE:
 * - Passed OOS walk-forward (2014-2026)
 * - Passed Slippage ×3 stress (Sharpe 0.66)
 * - Passed Parameter perturbation (4/5 robust)
 * - windowLen=60 is HARD-FIXED (design constant, not tunable)
 * 
 * v2 presets can be added here without affecting v1.
 */

export const FRACTAL_VERSION = {
  V1: 1,
  V2: 2,
} as const;

export type FractalVersionType = typeof FRACTAL_VERSION[keyof typeof FRACTAL_VERSION];

/**
 * v1_final — IMMUTABLE CERTIFIED CONFIG
 * DO NOT MODIFY without full re-certification
 */
export const V1_FINAL_CONFIG = {
  // === HARD-FIXED (design constants) ===
  windowLen: 60 as const,  // IMMUTABLE - defines pattern scale
  
  // === TUNABLE (allowed ranges documented) ===
  minSimilarity: 0.40,     // range: [0.36..0.44]
  minMatches: 6,           // range: [5..7]
  horizonDays: 14,         // range: [12..16]
  baselineLookbackDays: 720, // range: [650..790]
  
  // === MODE FLAGS ===
  similarityMode: 'raw_returns' as const,
  useRelative: true,
  bullTrendShortBlock: true,
  
  // === V1 DOES NOT USE (v2 features) ===
  ageDecayEnabled: false,
  ageDecayLambda: 0,
  regimeConditioned: false,
  
  // === 36.3: V1 does not use dynamic floor/dispersion ===
  useDynamicFloor: false,
  dynamicQuantile: 0.15,
  useTemporalDispersion: false,
  maxMatchesPerYear: 10,
} as const;

/**
 * v2_experimental — New features for testing
 * BLOCK 36.1-36.3: Age Decay + Regime + Dynamic Floor + Dispersion
 */
export const V2_EXPERIMENTAL_CONFIG = {
  ...V1_FINAL_CONFIG,
  
  // === V2 FEATURES (36.1-36.2) ===
  ageDecayEnabled: true,
  ageDecayLambda: 0.12,  // half-life ~5.8 years
  regimeConditioned: true,
  regimeFallbackEnabled: true,
  
  // === V2 FEATURES (36.3) ===
  useDynamicFloor: true,
  dynamicQuantile: 0.15,     // top 15% of candidates
  useTemporalDispersion: true,
  maxMatchesPerYear: 3,      // anti-clustering
};

/**
 * BLOCK 36.10: Entropy Guard Default Config
 * Dynamic position scaling based on horizon signal entropy
 */
export const V2_ENTROPY_GUARD_DEFAULT = {
  enabled: true,
  alphaStrength: 0.55,
  alphaConf: 0.45,
  warnEntropy: 0.55,
  hardEntropy: 0.75,
  minScale: 0.25,
  dominancePenaltyEnabled: true,
  dominanceHard: 0.70,
  dominancePenalty: 0.20,
  emaEnabled: true,
  emaAlpha: 0.25,
};

/**
 * v2_with_entropy — V2 with Entropy Guard enabled
 * BLOCK 36.10: For production use after sweep optimization
 */
export const V2_WITH_ENTROPY_CONFIG = {
  ...V2_EXPERIMENTAL_CONFIG,
  entropyGuard: V2_ENTROPY_GUARD_DEFAULT,
};

/**
 * BLOCK 37.1 — Multi-Representation Similarity Config
 */
export const V2_MULTI_REP_CONFIG = {
  ...V2_EXPERIMENTAL_CONFIG,
  
  // 37.1: Multi-rep similarity
  similarityMode: 'multi_rep' as const,
  multiRep: {
    enabled: true,
    reps: ['ret', 'vol', 'dd'] as const,
    repWeights: { ret: 0.50, vol: 0.30, dd: 0.20 },
    volLookback: 14,
    zscoreWithinWindow: false,
    l2Normalize: true,
  },
};

/**
 * BLOCK 37.2 — Two-Stage Retrieval Config
 */
export const V2_TWO_STAGE_CONFIG = {
  ...V2_MULTI_REP_CONFIG,
  
  // 37.2: Two-stage retrieval
  twoStage: {
    enabled: true,
    stage1Mode: 'ret_fast' as const,
    stage1TopK: 600,
    stage1MinSim: 0.10,
    stage2TopN: 120,
    stage2MinSim: 0.35,
  },
};

/**
 * BLOCK 37.3 — Phase-Aware Diversity Config
 */
export const V2_PHASE_DIVERSITY_CONFIG = {
  ...V2_TWO_STAGE_CONFIG,
  
  // 37.3: Phase diversity
  phaseDiversity: {
    enabled: true,
    maxPerPhase: 3,
    maxTotal: 25,
    preferSamePhase: true,
  },
  phaseClassifier: {
    maFast: 20,
    maSlow: 200,
    volLookback: 14,
    ddLookback: 90,
    trendUpSlope: 0.0005,
    trendDownSlope: -0.0005,
    volHighZ: 1.0,
    ddCapitulation: 0.35,
    ddMarkdown: 0.20,
    overExtBubble: 2.6,
  },
};

/**
 * BLOCK 37.x — Full Institutional Core Config
 * Combines: Multi-rep + Two-stage + Phase diversity
 */
export const V2_INSTITUTIONAL_CORE_CONFIG = {
  ...V2_PHASE_DIVERSITY_CONFIG,
  version: '2.1' as const,
};

/**
 * Preset registry
 */
export const FRACTAL_PRESETS = {
  v1_final: V1_FINAL_CONFIG,
  v2_experimental: V2_EXPERIMENTAL_CONFIG,
  v2_with_entropy: V2_WITH_ENTROPY_CONFIG,  // BLOCK 36.10
  // BLOCK 37.x - Institutional Core
  v2_multi_rep: V2_MULTI_REP_CONFIG,
  v2_two_stage: V2_TWO_STAGE_CONFIG,
  v2_phase_diversity: V2_PHASE_DIVERSITY_CONFIG,
  v2_institutional: V2_INSTITUTIONAL_CORE_CONFIG,
} as const;

export type FractalPresetKey = keyof typeof FRACTAL_PRESETS;

/**
 * Get preset config by key (returns a mutable copy)
 */
export function getPreset(key: FractalPresetKey) {
  const preset = FRACTAL_PRESETS[key];
  if (!preset) {
    throw new Error(`Unknown preset: ${key}`);
  }
  return { ...preset } as typeof V1_FINAL_CONFIG | typeof V2_EXPERIMENTAL_CONFIG;
}

/**
 * GUARD: Prevent accidental modification of v1_final immutable params
 */
export function validatePresetOverrides(
  presetKey: FractalPresetKey,
  overrides?: Partial<typeof V1_FINAL_CONFIG>
): void {
  if (presetKey === 'v1_final' && overrides) {
    // windowLen is IMMUTABLE for v1_final
    if (overrides.windowLen !== undefined && overrides.windowLen !== 60) {
      throw new Error(
        `v1_final is FROZEN: windowLen is immutable (must be 60). ` +
        `Attempted: ${overrides.windowLen}. ` +
        `Use v2_experimental preset for different windowLen.`
      );
    }
    
    // Warn if trying to change certified params outside safe ranges
    if (overrides.minSimilarity !== undefined) {
      if (overrides.minSimilarity < 0.36 || overrides.minSimilarity > 0.44) {
        console.warn(`[PRESET] v1_final: minSimilarity ${overrides.minSimilarity} outside certified range [0.36..0.44]`);
      }
    }
    if (overrides.minMatches !== undefined) {
      if (overrides.minMatches < 5 || overrides.minMatches > 7) {
        console.warn(`[PRESET] v1_final: minMatches ${overrides.minMatches} outside certified range [5..7]`);
      }
    }
  }
}

/**
 * Apply overrides to preset (with validation)
 */
export function applyPresetOverrides(
  presetKey: FractalPresetKey,
  overrides?: Partial<typeof V1_FINAL_CONFIG>
) {
  validatePresetOverrides(presetKey, overrides);
  const base = getPreset(presetKey);
  return { ...base, ...overrides };
}

/**
 * Certification metadata for v1
 */
export const V1_CERTIFICATION = {
  version: 'v1.0',
  certifiedDate: '2026-02-16',
  tests: {
    oosWalkForward: { passed: true, sharpe: 0.664, maxDD: 0.33 },
    slippageStress: { passed: true, x3Sharpe: 0.659 },
    paramPerturbation: { passed: true, robustParams: 4, totalParams: 5 },
    blockBootstrap: { passed: true, p95MaxDD: 0.393 },
  },
  immutableParams: ['windowLen'],
  tunableRanges: {
    minSimilarity: [0.36, 0.44],
    minMatches: [5, 7],
    horizonDays: [12, 16],
    baselineLookbackDays: [650, 790],
  },
};
