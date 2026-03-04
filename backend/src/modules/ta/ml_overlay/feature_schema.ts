/**
 * Phase L: Feature Schema
 * 
 * Strict feature ordering for ML model compatibility
 */

// Feature order must match Python training exactly
export const FEATURE_ORDER: string[] = [
  'score',
  'calibratedProbability',
  'rrToT1',
  'rrToT2',
  'riskPct',
  'rewardPct',
  'ma20Slope',
  'ma50Slope',
  'maAlignment',
  'atrPercentile',
  'compression',
  'patternCount',
  'confluenceScore',
  'confluenceFactors',
  'trendAlignment',
  // One-hot encoded categoricals
  'marketRegime_TREND_UP',
  'marketRegime_TREND_DOWN',
  'marketRegime_RANGE',
  'marketRegime_TRANSITION',
  'volRegime_LOW',
  'volRegime_NORMAL',
  'volRegime_HIGH',
  'volRegime_EXTREME',
];

// Categorical encoding rules
export const CATEGORICAL_DOMAINS = {
  marketRegime: ['TREND_UP', 'TREND_DOWN', 'RANGE', 'TRANSITION'] as const,
  volRegime: ['LOW', 'NORMAL', 'HIGH', 'EXTREME'] as const,
};

/**
 * Get feature schema for model compatibility
 */
export function getFeatureSchema() {
  return {
    feature_order: FEATURE_ORDER,
    categorical: CATEGORICAL_DOMAINS,
    total_features: FEATURE_ORDER.length,
  };
}

/**
 * Validate feature vector length
 */
export function validateFeatureVector(vector: number[]): boolean {
  return vector.length === FEATURE_ORDER.length;
}
