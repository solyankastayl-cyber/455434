/**
 * ML FEATURE SCHEMA — FORMAL CONTRACT
 * ====================================
 * 
 * P1.7: Macro-aware ML Feature Freeze
 * 
 * This is the CANONICAL list of features that ML model can use.
 * Adding new features requires:
 * - New MLOps cycle
 * - Full regression test
 * - Shadow validation
 * 
 * @sealed v1.0
 */

// ═══════════════════════════════════════════════════════════════
// MACRO FEATURES (6 features)
// ═══════════════════════════════════════════════════════════════

export const MACRO_FEATURES = [
  'macro_regime_id',      // 0..7 — Market regime enum
  'btc_dom_trend',        // -1|0|1 — DOWN/FLAT/UP
  'stable_dom_trend',     // -1|0|1 — DOWN/FLAT/UP
  'fear_greed_bucket',    // 0..4 — EXTREME_FEAR to EXTREME_GREED
  'risk_level',           // 0..3 — LOW/MEDIUM/HIGH/EXTREME
  'macro_modifier',       // 0..1 — Confidence multiplier
] as const;

export type MacroFeature = typeof MACRO_FEATURES[number];

// ═══════════════════════════════════════════════════════════════
// BASE ML FEATURES (20 features)
// ═══════════════════════════════════════════════════════════════

export const BASE_ML_FEATURES = [
  // Exchange context (6)
  'exchange_verdict',     // -1|0|1 — BEARISH/NEUTRAL/BULLISH
  'exchange_confidence',  // 0..1
  'exchange_regime',      // enum as int
  'market_stress',        // 0..1
  'whale_risk',           // 0|0.5|1 — LOW/MID/HIGH
  'data_readiness',       // 0|0.5|1 — AVOID/RISKY/READY
  
  // Sentiment context (4)
  'sentiment_verdict',    // -1|0|1
  'sentiment_confidence', // 0..1
  'sentiment_alignment',  // 0|0.5|1 — CONFLICT/PARTIAL/ALIGNED
  'sentiment_source_count', // int (0..10)
  
  // Onchain context (3)
  'onchain_validation',   // 0|0.5|1 — CONTRADICTS/NO_DATA/CONFIRMS
  'onchain_confidence',   // 0..1
  'onchain_flow_bias',    // -1|0|1 — outflow/neutral/inflow
  
  // Meta-Brain output (4)
  'metabrain_verdict',    // -1|0|1
  'metabrain_confidence', // 0..1
  'metabrain_downgraded', // 0|1 — boolean
  'metabrain_conflicts',  // 0..1 — conflict intensity
  
  // Time features (3)
  'hour_of_day',          // 0..23
  'day_of_week',          // 0..6
  'is_weekend',           // 0|1
] as const;

export type BaseMLFeature = typeof BASE_ML_FEATURES[number];

// ═══════════════════════════════════════════════════════════════
// COMBINED FEATURE SCHEMA (26 total)
// ═══════════════════════════════════════════════════════════════

export const ML_FEATURE_SCHEMA = [
  ...BASE_ML_FEATURES,
  ...MACRO_FEATURES,
] as const;

export type MLFeature = typeof ML_FEATURE_SCHEMA[number];

export const ML_FEATURE_COUNT = ML_FEATURE_SCHEMA.length; // 26

// ═══════════════════════════════════════════════════════════════
// FEATURE RANGES (for validation)
// ═══════════════════════════════════════════════════════════════

export const FEATURE_RANGES: Record<MLFeature, { min: number; max: number; type: 'int' | 'float' | 'enum' }> = {
  // Base features
  exchange_verdict: { min: -1, max: 1, type: 'enum' },
  exchange_confidence: { min: 0, max: 1, type: 'float' },
  exchange_regime: { min: 0, max: 7, type: 'enum' },
  market_stress: { min: 0, max: 1, type: 'float' },
  whale_risk: { min: 0, max: 1, type: 'enum' },
  data_readiness: { min: 0, max: 1, type: 'enum' },
  
  sentiment_verdict: { min: -1, max: 1, type: 'enum' },
  sentiment_confidence: { min: 0, max: 1, type: 'float' },
  sentiment_alignment: { min: 0, max: 1, type: 'enum' },
  sentiment_source_count: { min: 0, max: 10, type: 'int' },
  
  onchain_validation: { min: 0, max: 1, type: 'enum' },
  onchain_confidence: { min: 0, max: 1, type: 'float' },
  onchain_flow_bias: { min: -1, max: 1, type: 'enum' },
  
  metabrain_verdict: { min: -1, max: 1, type: 'enum' },
  metabrain_confidence: { min: 0, max: 1, type: 'float' },
  metabrain_downgraded: { min: 0, max: 1, type: 'enum' },
  metabrain_conflicts: { min: 0, max: 1, type: 'float' },
  
  hour_of_day: { min: 0, max: 23, type: 'int' },
  day_of_week: { min: 0, max: 6, type: 'int' },
  is_weekend: { min: 0, max: 1, type: 'enum' },
  
  // Macro features
  macro_regime_id: { min: 0, max: 7, type: 'enum' },
  btc_dom_trend: { min: -1, max: 1, type: 'enum' },
  stable_dom_trend: { min: -1, max: 1, type: 'enum' },
  fear_greed_bucket: { min: 0, max: 4, type: 'enum' },
  risk_level: { min: 0, max: 3, type: 'enum' },
  macro_modifier: { min: 0, max: 1, type: 'float' },
};

// ═══════════════════════════════════════════════════════════════
// VALIDATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export interface FeatureValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate that a feature name is in the schema
 */
export function isValidFeature(name: string): name is MLFeature {
  return ML_FEATURE_SCHEMA.includes(name as MLFeature);
}

/**
 * Validate a feature value against its range
 */
export function validateFeatureValue(
  name: MLFeature,
  value: number
): { valid: boolean; error?: string } {
  const range = FEATURE_RANGES[name];
  if (!range) {
    return { valid: false, error: `Unknown feature: ${name}` };
  }
  
  if (value < range.min || value > range.max) {
    return { 
      valid: false, 
      error: `${name} value ${value} out of range [${range.min}, ${range.max}]` 
    };
  }
  
  if (range.type === 'int' && !Number.isInteger(value)) {
    return { valid: false, error: `${name} must be integer, got ${value}` };
  }
  
  return { valid: true };
}

/**
 * Validate a complete feature vector
 */
export function validateFeatureVector(
  features: Record<string, number>
): FeatureValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check for unknown features
  for (const name of Object.keys(features)) {
    if (!isValidFeature(name)) {
      errors.push(`Unknown feature: ${name} — not in ML_FEATURE_SCHEMA`);
    }
  }
  
  // Check for missing features
  for (const required of ML_FEATURE_SCHEMA) {
    if (!(required in features)) {
      warnings.push(`Missing feature: ${required}`);
    }
  }
  
  // Validate values
  for (const [name, value] of Object.entries(features)) {
    if (isValidFeature(name)) {
      const result = validateFeatureValue(name, value);
      if (!result.valid) {
        errors.push(result.error!);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Reject any features not in schema (strict mode)
 * Throws if invalid feature found
 */
export function enforceFeatureSchema(features: Record<string, number>): void {
  const validation = validateFeatureVector(features);
  
  if (!validation.valid) {
    throw new Error(
      `ML Feature Schema violation:\n` +
      validation.errors.map(e => `  - ${e}`).join('\n')
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// SCHEMA INFO
// ═══════════════════════════════════════════════════════════════

export function getSchemaInfo(): {
  version: string;
  totalFeatures: number;
  baseFeatures: number;
  macroFeatures: number;
  sealed: boolean;
  features: readonly string[];
} {
  return {
    version: 'v1.0',
    totalFeatures: ML_FEATURE_COUNT,
    baseFeatures: BASE_ML_FEATURES.length,
    macroFeatures: MACRO_FEATURES.length,
    sealed: true,
    features: ML_FEATURE_SCHEMA,
  };
}

console.log('[ML] Feature schema loaded:', getSchemaInfo());
