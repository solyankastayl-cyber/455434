/**
 * P1.2 - Group Attribution Types
 * 
 * Quantifies the contribution of each feature group to model performance
 */

export type FeatureGroup = 'CEX' | 'CORRIDORS' | 'ZONES' | 'DEX';

export type GroupVerdict = 
  | 'CORE_POSITIVE'   // > +1.5% impact
  | 'WEAK_POSITIVE'   // +0.5% to +1.5%
  | 'NEUTRAL'         // ±0.5%
  | 'NEGATIVE'        // < -0.5%
  | 'UNSTABLE';       // high variance across seeds

export interface GroupAttribution {
  group: FeatureGroup;
  deltaF1: number;
  deltaAccuracy: number;
  deltaPrecision: number;
  deltaRecall: number;
  stability: 'STABLE' | 'UNSTABLE' | 'UNKNOWN';
  verdict: GroupVerdict;
  confidence: number;  // 0-1, based on variance + dataset size
  sampleSize: number;
  reasons: string[];
}

export interface AttributionRunRequest {
  task: 'market' | 'actor';
  network: string;
  matrixId?: string;  // Use specific matrix or latest
}

export interface AttributionResult {
  attributionId: string;
  task: string;
  network: string;
  matrixId: string;
  baseModelId: string;
  basePack: string;
  datasetId: string;
  groups: GroupAttribution[];
  summary: {
    totalGroups: number;
    corePositive: number;
    weakPositive: number;
    neutral: number;
    negative: number;
    unstable: number;
    topContributor: FeatureGroup | null;
    topContribution: number;
  };
  createdAt: Date;
}

/**
 * Mapping from variant pack to the group it measures
 * PACK_A_MINUS_X measures the impact of X
 */
export const VARIANT_TO_GROUP: Record<string, FeatureGroup> = {
  'PACK_A_MINUS_CEX': 'CEX',
  'PACK_A_MINUS_CORRIDORS': 'CORRIDORS',
  'PACK_A_MINUS_ZONES': 'ZONES',
  'PACK_A_MINUS_DEX': 'DEX',
};

/**
 * Thresholds for group verdict
 */
export const ATTRIBUTION_THRESHOLDS = {
  CORE_POSITIVE: 0.015,    // > +1.5%
  WEAK_POSITIVE: 0.005,    // > +0.5%
  NEUTRAL_UPPER: 0.005,    // ±0.5%
  NEUTRAL_LOWER: -0.005,
  NEGATIVE: -0.005,        // < -0.5%
  UNSTABLE_CV: 0.1,        // CV > 10% = unstable
  HIGH_CONFIDENCE: 0.8,
  LOW_CONFIDENCE: 0.5,
};
