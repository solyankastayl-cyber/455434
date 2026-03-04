/**
 * S10.7.3 — Model Registry
 * 
 * Manages frozen ML model state:
 * - MIRROR_MODE: ML mirrors rules, used for drift detection
 * - FROZEN: Weights cannot be changed without new version
 * 
 * ML is a diagnostic tool, NOT a decision maker.
 */

import { MLLabel } from './ml.types.js';
import { TrainedModel } from './ml.trainer.js';
import { FEATURE_NAMES } from './featureExtractor.js';

// ═══════════════════════════════════════════════════════════════
// MODEL STATUS TYPES
// ═══════════════════════════════════════════════════════════════

export type ModelMode = 'MIRROR_MODE' | 'ACTIVE_MODE' | 'DISABLED';
export type ModelStatus = 'FROZEN' | 'TRAINING' | 'UNFROZEN';
export type DriftStatus = 'NO_DRIFT' | 'SOFT_DRIFT' | 'HARD_DRIFT';
export type HealthStatus = 'STABLE' | 'WATCH' | 'DRIFT';

// ═══════════════════════════════════════════════════════════════
// REGISTRY STATE
// ═══════════════════════════════════════════════════════════════

export interface ModelRegistryState {
  version: string;
  mode: ModelMode;
  status: ModelStatus;
  
  // Performance metrics
  agreementRate: number;
  samplesCount: number;
  lastTrainedAt: number | null;
  lastDriftCheckAt: number | null;
  
  // Model info
  modelType: 'logistic' | 'tree';
  featureCount: number;
  featureSet: string[];
  
  // Health
  healthStatus: HealthStatus;
  driftStatus: DriftStatus;
  
  // Constraints
  canInfluenceDecision: boolean;
  canRetrain: boolean;
}

// ═══════════════════════════════════════════════════════════════
// FROZEN WEIGHTS
// ═══════════════════════════════════════════════════════════════

export interface FrozenWeights {
  version: string;
  modelType: 'logistic' | 'tree';
  frozenAt: number;
  
  // Logistic regression weights
  weights?: number[];
  
  // Decision tree structure
  tree?: any;
  
  // Thresholds
  thresholds: {
    warningThreshold: number;
    useThreshold: number;
  };
  
  // Feature mapping
  featureOrder: string[];
}

// ═══════════════════════════════════════════════════════════════
// REGISTRY SINGLETON
// ═══════════════════════════════════════════════════════════════

let registryState: ModelRegistryState = {
  version: 'v1',
  mode: 'MIRROR_MODE',
  status: 'UNFROZEN',
  agreementRate: 0,
  samplesCount: 0,
  lastTrainedAt: null,
  lastDriftCheckAt: null,
  modelType: 'logistic',
  featureCount: FEATURE_NAMES.length,
  featureSet: [...FEATURE_NAMES],
  healthStatus: 'STABLE',
  driftStatus: 'NO_DRIFT',
  canInfluenceDecision: false,
  canRetrain: false,
};

let frozenWeights: FrozenWeights | null = null;

// ═══════════════════════════════════════════════════════════════
// REGISTRY API
// ═══════════════════════════════════════════════════════════════

export function getRegistryState(): ModelRegistryState {
  return { ...registryState };
}

export function getFrozenWeights(): FrozenWeights | null {
  return frozenWeights ? { ...frozenWeights } : null;
}

export function freezeModel(model: TrainedModel, agreementRate: number): void {
  const now = Date.now();
  
  // Update registry
  registryState = {
    ...registryState,
    version: 'v1',
    mode: 'MIRROR_MODE',
    status: 'FROZEN',
    agreementRate,
    samplesCount: model.trainingSize,
    lastTrainedAt: model.trainedAt,
    lastDriftCheckAt: now,
    modelType: model.type,
    healthStatus: 'STABLE',
    driftStatus: 'NO_DRIFT',
    canInfluenceDecision: false,
    canRetrain: false,
  };
  
  // Store frozen weights
  frozenWeights = {
    version: 'v1',
    modelType: model.type,
    frozenAt: now,
    weights: model.weights,
    tree: model.tree,
    thresholds: {
      warningThreshold: 0.5,
      useThreshold: 0.65,
    },
    featureOrder: [...FEATURE_NAMES],
  };
  
  console.log(`[S10.7.3] Model FROZEN: ${model.type} v1, agreement=${agreementRate.toFixed(2)}%, samples=${model.trainingSize}`);
}

export function updateDriftCheck(
  newAgreementRate: number,
  newSamplesCount: number
): void {
  const now = Date.now();
  const previousRate = registryState.agreementRate;
  const drift = Math.abs(newAgreementRate - previousRate);
  
  // Determine drift status
  let driftStatus: DriftStatus = 'NO_DRIFT';
  let healthStatus: HealthStatus = 'STABLE';
  
  if (drift >= 0.15) {
    driftStatus = 'HARD_DRIFT';
    healthStatus = 'DRIFT';
  } else if (drift >= 0.05) {
    driftStatus = 'SOFT_DRIFT';
    healthStatus = 'WATCH';
  }
  
  registryState = {
    ...registryState,
    agreementRate: newAgreementRate,
    samplesCount: newSamplesCount,
    lastDriftCheckAt: now,
    driftStatus,
    healthStatus,
  };
  
  if (driftStatus !== 'NO_DRIFT') {
    console.log(`[S10.7.3] Drift detected: ${driftStatus}, agreement changed from ${previousRate.toFixed(2)}% to ${newAgreementRate.toFixed(2)}%`);
  }
}

export function isModelFrozen(): boolean {
  return registryState.status === 'FROZEN';
}

export function getModelVersion(): string {
  return registryState.version;
}

// ═══════════════════════════════════════════════════════════════
// DRIFT METRICS
// ═══════════════════════════════════════════════════════════════

export interface DriftMetrics {
  currentAgreement: number;
  baselineAgreement: number;
  agreementDelta: number;
  driftStatus: DriftStatus;
  healthStatus: HealthStatus;
  lastCheckAt: number | null;
  samplesAnalyzed: number;
  featureDrift: Record<string, number>;
}

export function calculateDriftMetrics(
  currentFeatureImportance: Record<string, number>,
  baselineFeatureImportance: Record<string, number>
): DriftMetrics {
  // Calculate feature-level drift
  const featureDrift: Record<string, number> = {};
  
  for (const feature of FEATURE_NAMES) {
    const current = currentFeatureImportance[feature] || 0;
    const baseline = baselineFeatureImportance[feature] || 0;
    featureDrift[feature] = Math.abs(current - baseline);
  }
  
  return {
    currentAgreement: registryState.agreementRate,
    baselineAgreement: 1.0, // Initial baseline is 100%
    agreementDelta: 1.0 - registryState.agreementRate,
    driftStatus: registryState.driftStatus,
    healthStatus: registryState.healthStatus,
    lastCheckAt: registryState.lastDriftCheckAt,
    samplesAnalyzed: registryState.samplesCount,
    featureDrift,
  };
}

console.log('[S10.7.3] Model Registry loaded');
