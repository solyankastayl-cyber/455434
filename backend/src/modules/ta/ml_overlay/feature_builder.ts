/**
 * Phase L: Feature Builder
 * 
 * Builds feature vector for ML model input
 */

import { FEATURE_ORDER, CATEGORICAL_DOMAINS } from './feature_schema.js';

export interface FeatureInput {
  score: number;
  calibratedProbability: number;

  marketRegime: string;
  volRegime: string;

  rrToT1: number;
  rrToT2: number;
  riskPct: number;
  rewardPct: number;

  ma20Slope: number;
  ma50Slope: number;
  maAlignment: number;

  atrPercentile: number;
  compression: number;

  patternCount: number;
  confluenceScore: number;
  confluenceFactors: number;
  trendAlignment: number;
}

/**
 * One-hot encode a categorical value
 */
function oneHot(value: string, domain: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of domain) {
    out[v] = value === v ? 1 : 0;
  }
  return out;
}

/**
 * Build feature map from input
 */
export function buildFeatureMap(input: FeatureInput): Record<string, number> {
  // One-hot encode categoricals
  const mr = oneHot(input.marketRegime, CATEGORICAL_DOMAINS.marketRegime);
  const vr = oneHot(input.volRegime, CATEGORICAL_DOMAINS.volRegime);

  return {
    score: input.score,
    calibratedProbability: input.calibratedProbability,

    rrToT1: input.rrToT1,
    rrToT2: input.rrToT2,
    riskPct: input.riskPct,
    rewardPct: input.rewardPct,

    ma20Slope: input.ma20Slope,
    ma50Slope: input.ma50Slope,
    maAlignment: input.maAlignment,

    atrPercentile: input.atrPercentile,
    compression: input.compression,

    patternCount: input.patternCount,
    confluenceScore: input.confluenceScore,
    confluenceFactors: input.confluenceFactors,
    trendAlignment: input.trendAlignment,

    // One-hot encoded categoricals
    marketRegime_TREND_UP: mr.TREND_UP,
    marketRegime_TREND_DOWN: mr.TREND_DOWN,
    marketRegime_RANGE: mr.RANGE,
    marketRegime_TRANSITION: mr.TRANSITION,

    volRegime_LOW: vr.LOW,
    volRegime_NORMAL: vr.NORMAL,
    volRegime_HIGH: vr.HIGH,
    volRegime_EXTREME: vr.EXTREME,
  };
}

/**
 * Convert feature map to ordered vector
 */
export function featureMapToVector(
  featureMap: Record<string, number>,
  featureOrder: string[] = FEATURE_ORDER
): number[] {
  return featureOrder.map(key => {
    const val = featureMap[key];
    return typeof val === 'number' && !isNaN(val) ? val : 0;
  });
}

/**
 * Build complete feature vector from input
 */
export function buildFeatureVector(input: FeatureInput): number[] {
  const featureMap = buildFeatureMap(input);
  return featureMapToVector(featureMap);
}

/**
 * Extract features from scenario/run data
 */
export function extractOverlayFeatures(scenario: any, run: any): FeatureInput {
  const snapshot = run?.snapshot || run?.contextSnapshot || {};
  const features = run?.features || run?.featurePack || {};
  const riskPack = scenario?.riskPack || {};
  const metrics = riskPack?.metrics || {};

  // MA alignment conversion
  let maAlignment = 0;
  const maAlignmentRaw = features.maAlignment || snapshot.maAlignment || 'MIXED';
  if (maAlignmentRaw === 'BULL' || maAlignmentRaw === 'BULLISH') maAlignment = 1;
  else if (maAlignmentRaw === 'BEAR' || maAlignmentRaw === 'BEARISH') maAlignment = -1;

  return {
    score: scenario.score || 0,
    calibratedProbability: scenario.probability || 0,

    marketRegime: snapshot.marketRegime || 'TRANSITION',
    volRegime: snapshot.volRegime || 'NORMAL',

    rrToT1: metrics.rrToT1 || riskPack.rrToT1 || 0,
    rrToT2: metrics.rrToT2 || riskPack.rrToT2 || 0,
    riskPct: metrics.riskPct || riskPack.riskPct || 0,
    rewardPct: metrics.rewardPct || riskPack.rewardPct || 0,

    ma20Slope: features.maSlope20 || snapshot.maSlope20 || 0,
    ma50Slope: features.maSlope50 || snapshot.maSlope50 || 0,
    maAlignment,

    atrPercentile: features.atrPercentile || snapshot.atrPercentile || 0.5,
    compression: features.compression || snapshot.compression || 0,

    patternCount: scenario.components?.length || scenario.patterns?.length || 0,
    confluenceScore: scenario.confluence?.score || scenario.confluenceScore || 0,
    confluenceFactors: scenario.confluence?.factors?.length || 0,
    trendAlignment: features.trendAlignment || 0,
  };
}
