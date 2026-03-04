/**
 * S10.7 — ML Service
 * 
 * Orchestrates ML operations:
 * - Backfill: Label historical observations
 * - Predict: Classify new observations
 * - Compare: Rules vs ML performance
 * - Train: ML models
 * - Freeze: Lock model for production (S10.7.3)
 * 
 * Phase 1: Rules-based only (S10.7.1)
 * Phase 2: ML comparison (S10.7.2)
 * Phase 3: ML freeze (S10.7.3)
 * Phase 4: Admin UI (S10.7.4)
 */

import { 
  MLLabel, 
  MLFeatures, 
  MLResult, 
  BackfillStats, 
  ModelStatus,
  DEFAULT_THRESHOLDS,
} from './ml.types.js';
import { extractFeatures, FEATURE_NAMES, featuresToVector } from './featureExtractor.js';
import { labelObservation, labelFromFeatures } from './labeler.js';
import { ExchangeObservationRow } from '../exchange/observation/observation.types.js';
import * as observationStorage from '../exchange/observation/observation.storage.js';
import { 
  TrainedModel, 
  trainLogisticRegression, 
  trainDecisionTree, 
  prepareTrainingData,
  predictWithModel,
} from './ml.trainer.js';
import {
  ComparisonResult,
  DisagreementCase,
  FeatureImportanceComparison,
  StabilityResult,
  compareRulesVsML,
  getDisagreementCases,
  compareFeatureImportance,
  checkStability,
} from './ml.comparison.js';
import {
  getRegistryState,
  getFrozenWeights,
  freezeModel,
  updateDriftCheck,
  isModelFrozen,
  calculateDriftMetrics,
  ModelRegistryState,
  DriftMetrics,
} from './model.registry.js';

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let modelStatus: ModelStatus = {
  modelType: 'rules',
  version: '1.0.0',
  trainedAt: null,
  trainingSize: 0,
  accuracy: null,
  featureImportance: null,
  classDistribution: null,
};

// Trained models cache
let logisticModel: TrainedModel | null = null;
let treeModel: TrainedModel | null = null;

// Baseline feature importance (for drift detection)
let baselineFeatureImportance: Record<string, number> = {};

// Prepared data cache (for comparison)
let preparedDataCache: Array<{
  id: string;
  features: MLFeatures;
  rulesLabel: MLLabel;
  regime: string;
  patternCount: number;
  hasConflict: boolean;
  timestamp: number;
}> = [];

// ═══════════════════════════════════════════════════════════════
// BACKFILL (Label historical data)
// ═══════════════════════════════════════════════════════════════

export async function backfillLabels(options: {
  symbol?: string;
  limit?: number;
  overwrite?: boolean;
}): Promise<BackfillStats> {
  const { symbol, limit = 500, overwrite = false } = options;
  
  const stats: BackfillStats = {
    totalProcessed: 0,
    labeled: { USE: 0, IGNORE: 0, WARNING: 0 },
    distribution: { USE: 0, IGNORE: 0, WARNING: 0 },
    warningReasons: {},
    errors: 0,
  };
  
  // Fetch observations
  const observations = await observationStorage.getObservations({
    symbol,
    limit,
  });
  
  for (const row of observations) {
    try {
      // Extract features
      const features = extractFeatures(row);
      
      // Label observation
      const labelResult = labelObservation(row);
      
      // Update observation in DB with ML fields
      await updateObservationML(row.id, features, labelResult.label);
      
      // Track stats
      stats.totalProcessed++;
      stats.labeled[labelResult.label]++;
      
      // Track warning reasons
      if (labelResult.label === 'WARNING') {
        for (const trigger of labelResult.triggers) {
          const key = trigger.split('=')[0];
          stats.warningReasons[key] = (stats.warningReasons[key] || 0) + 1;
        }
      }
    } catch (err) {
      console.error(`[S10.7] Backfill error for ${row.id}:`, err);
      stats.errors++;
    }
  }
  
  // Calculate distribution percentages
  const total = stats.totalProcessed || 1;
  stats.distribution = {
    USE: (stats.labeled.USE / total) * 100,
    IGNORE: (stats.labeled.IGNORE / total) * 100,
    WARNING: (stats.labeled.WARNING / total) * 100,
  };
  
  // Update model status
  modelStatus.classDistribution = stats.labeled;
  modelStatus.trainingSize = stats.totalProcessed;
  
  console.log(`[S10.7] Backfill complete: ${stats.totalProcessed} processed, ${stats.errors} errors`);
  console.log(`[S10.7] Distribution: USE=${stats.distribution.USE.toFixed(1)}%, IGNORE=${stats.distribution.IGNORE.toFixed(1)}%, WARNING=${stats.distribution.WARNING.toFixed(1)}%`);
  
  return stats;
}

// ═══════════════════════════════════════════════════════════════
// PREDICT (Classify new observation)
// ═══════════════════════════════════════════════════════════════

export function predict(row: ExchangeObservationRow): MLResult {
  const features = extractFeatures(row);
  const rulesResult = labelObservation(row);
  
  // Phase 1: Rules-based prediction
  // Phase 2 will add actual ML model
  const label = rulesResult.label;
  
  // Simulate confidence based on features
  const confidence = calculateConfidence(features, label);
  
  return {
    label,
    confidence,
    probabilities: calculateProbabilities(features, label),
    topFeatures: getTopFeatures(features, label),
    rulesLabel: rulesResult.label,
    rulesMatch: true, // Rules == prediction in Phase 1
  };
}

export function predictFromFeatures(features: MLFeatures): MLResult {
  const rulesResult = labelFromFeatures(features);
  const label = rulesResult.label;
  const confidence = calculateConfidence(features, label);
  
  return {
    label,
    confidence,
    probabilities: calculateProbabilities(features, label),
    topFeatures: getTopFeatures(features, label),
    rulesLabel: rulesResult.label,
    rulesMatch: true,
  };
}

// ═══════════════════════════════════════════════════════════════
// MODEL STATUS
// ═══════════════════════════════════════════════════════════════

export function getModelStatus(): ModelStatus {
  return { ...modelStatus };
}

// ═══════════════════════════════════════════════════════════════
// FEATURE EXTRACTION (exposed for API)
// ═══════════════════════════════════════════════════════════════

export function getFeatures(row: ExchangeObservationRow): MLFeatures {
  return extractFeatures(row);
}

export { FEATURE_NAMES };

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

async function updateObservationML(
  id: string,
  features: MLFeatures,
  label: MLLabel
): Promise<void> {
  // In production, this would update the MongoDB document
  // For now, we track in memory (or could extend storage)
  // The actual update would be:
  // await observationStorage.updateOne({ id }, { $set: { mlFeatures: features, mlLabel: label } });
  
  // Placeholder - in S10.7.2 we'll add proper persistence
}

function calculateConfidence(features: MLFeatures, label: MLLabel): number {
  switch (label) {
    case 'WARNING':
      // High confidence if stress is high
      return Math.min(0.95, 0.7 + features.marketStress * 0.25);
    
    case 'USE':
      // High confidence if readability is high
      return Math.min(0.95, 0.6 + features.readability * 0.35);
    
    case 'IGNORE':
      // Moderate confidence for IGNORE
      return 0.5 + (1 - features.readability) * 0.3;
    
    default:
      return 0.5;
  }
}

function calculateProbabilities(
  features: MLFeatures, 
  predictedLabel: MLLabel
): { USE: number; IGNORE: number; WARNING: number } {
  const base = 0.1;
  
  // Simple probability estimation based on features
  const warningProb = Math.min(0.9, base + features.marketStress * 0.6 + features.cascadeActive * 0.3);
  const useProb = Math.min(0.9, base + features.readability * 0.5 + features.regimeConfidence * 0.3);
  const ignoreProb = Math.max(0.05, 1 - warningProb - useProb);
  
  // Normalize
  const total = warningProb + useProb + ignoreProb;
  
  return {
    WARNING: warningProb / total,
    USE: useProb / total,
    IGNORE: ignoreProb / total,
  };
}

function getTopFeatures(
  features: MLFeatures, 
  label: MLLabel
): Array<{ name: string; value: number; contribution: number }> {
  const allFeatures = [
    { name: 'marketStress', value: features.marketStress },
    { name: 'readability', value: features.readability },
    { name: 'regimeConfidence', value: features.regimeConfidence },
    { name: 'cascadeActive', value: features.cascadeActive },
    { name: 'liquidationIntensity', value: features.liquidationIntensity },
    { name: 'conflictCount', value: features.conflictCount },
    { name: 'flowDominance', value: features.flowDominance },
    { name: 'volumeRatio', value: features.volumeRatio },
  ];
  
  // Sort by absolute contribution to the label
  const sorted = allFeatures
    .map(f => ({
      ...f,
      contribution: calculateContribution(f.name, f.value, label),
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  
  return sorted.slice(0, 5);
}

function calculateContribution(name: string, value: number, label: MLLabel): number {
  // Simplified feature importance by label
  const weights: Record<MLLabel, Record<string, number>> = {
    WARNING: {
      marketStress: 0.8,
      cascadeActive: 0.9,
      liquidationIntensity: 0.7,
      conflictCount: 0.5,
      regimeConfidence: -0.3,
    },
    USE: {
      readability: 0.8,
      regimeConfidence: 0.7,
      marketStress: -0.6,
      cascadeActive: -0.9,
      conflictCount: -0.5,
    },
    IGNORE: {
      readability: -0.4,
      regimeConfidence: -0.3,
      marketStress: 0.2,
    },
  };
  
  const weight = weights[label]?.[name] || 0;
  return value * weight;
}

// ═══════════════════════════════════════════════════════════════
// S10.7.2 — TRAINING ML MODELS
// ═══════════════════════════════════════════════════════════════

export async function trainModels(options: {
  symbol?: string;
  limit?: number;
}): Promise<{
  logistic: TrainedModel;
  tree: TrainedModel;
  dataSize: number;
}> {
  const { symbol, limit = 500 } = options;
  
  // Fetch observations
  const observations = await observationStorage.getObservations({ symbol, limit });
  
  // Prepare training data
  const trainingData: Array<{ features: MLFeatures; label: MLLabel }> = [];
  preparedDataCache = [];
  
  for (const row of observations) {
    const features = extractFeatures(row);
    const labelResult = labelObservation(row);
    
    trainingData.push({ features, label: labelResult.label });
    
    preparedDataCache.push({
      id: row.id,
      features,
      rulesLabel: labelResult.label,
      regime: row.regime?.type || 'NEUTRAL',
      patternCount: row.patternCount || 0,
      hasConflict: row.hasConflict || false,
      timestamp: row.timestamp,
    });
  }
  
  // Prepare for trainer
  const examples = prepareTrainingData(trainingData);
  
  // Train both models
  console.log(`[S10.7.2] Training Logistic Regression on ${examples.length} samples...`);
  logisticModel = trainLogisticRegression(examples, 0.1, 200);
  
  console.log(`[S10.7.2] Training Decision Tree on ${examples.length} samples...`);
  treeModel = trainDecisionTree(examples, 5);
  
  // Update status with best model
  modelStatus = {
    modelType: 'logistic',
    version: '1.0.0',
    trainedAt: Date.now(),
    trainingSize: examples.length,
    accuracy: logisticModel.accuracy,
    featureImportance: logisticModel.featureImportance,
    classDistribution: {
      USE: trainingData.filter(d => d.label === 'USE').length,
      IGNORE: trainingData.filter(d => d.label === 'IGNORE').length,
      WARNING: trainingData.filter(d => d.label === 'WARNING').length,
    },
  };
  
  console.log(`[S10.7.2] Training complete. Logistic acc: ${logisticModel.accuracy.toFixed(3)}, Tree acc: ${treeModel.accuracy.toFixed(3)}`);
  
  return {
    logistic: logisticModel,
    tree: treeModel,
    dataSize: examples.length,
  };
}

// ═══════════════════════════════════════════════════════════════
// S10.7.2 — COMPARISON
// ═══════════════════════════════════════════════════════════════

export async function getComparison(modelType: 'logistic' | 'tree' = 'logistic'): Promise<ComparisonResult | null> {
  const model = modelType === 'logistic' ? logisticModel : treeModel;
  
  if (!model || preparedDataCache.length === 0) {
    // Train first if no models
    await trainModels({ limit: 200 });
  }
  
  const activeModel = modelType === 'logistic' ? logisticModel : treeModel;
  if (!activeModel) return null;
  
  return compareRulesVsML(preparedDataCache, activeModel);
}

export async function getDisagreements(
  modelType: 'logistic' | 'tree' = 'logistic',
  limit: number = 20
): Promise<DisagreementCase[]> {
  const model = modelType === 'logistic' ? logisticModel : treeModel;
  
  if (!model || preparedDataCache.length === 0) {
    await trainModels({ limit: 200 });
  }
  
  const activeModel = modelType === 'logistic' ? logisticModel : treeModel;
  if (!activeModel) return [];
  
  return getDisagreementCases(preparedDataCache, activeModel, limit);
}

export async function getFeatureImportanceComparison(
  modelType: 'logistic' | 'tree' = 'logistic'
): Promise<FeatureImportanceComparison[]> {
  const model = modelType === 'logistic' ? logisticModel : treeModel;
  
  if (!model) {
    await trainModels({ limit: 200 });
  }
  
  const activeModel = modelType === 'logistic' ? logisticModel : treeModel;
  if (!activeModel) return [];
  
  return compareFeatureImportance(activeModel);
}

export async function getStabilityCheck(
  modelType: 'logistic' | 'tree' = 'logistic'
): Promise<StabilityResult | null> {
  const model = modelType === 'logistic' ? logisticModel : treeModel;
  
  if (!model || preparedDataCache.length === 0) {
    await trainModels({ limit: 200 });
  }
  
  const activeModel = modelType === 'logistic' ? logisticModel : treeModel;
  if (!activeModel) return null;
  
  const dataForStability = preparedDataCache.map(d => ({ features: d.features }));
  return checkStability(dataForStability, activeModel);
}

// ═══════════════════════════════════════════════════════════════
// S10.7.2 — CONFUSION MATRIX
// ═══════════════════════════════════════════════════════════════

export async function getConfusionMatrix(modelType: 'logistic' | 'tree' = 'logistic'): Promise<{
  model: { type: string; accuracy: number; confusionMatrix: any };
  rulesVsML: any;
} | null> {
  const model = modelType === 'logistic' ? logisticModel : treeModel;
  
  if (!model) {
    await trainModels({ limit: 200 });
  }
  
  const activeModel = modelType === 'logistic' ? logisticModel : treeModel;
  if (!activeModel) return null;
  
  const comparison = await getComparison(modelType);
  
  return {
    model: {
      type: activeModel.type,
      accuracy: activeModel.accuracy,
      confusionMatrix: activeModel.confusionMatrix,
    },
    rulesVsML: comparison?.rulesVsMlMatrix || null,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET TRAINED MODELS
// ═══════════════════════════════════════════════════════════════

export function getTrainedModels(): {
  logistic: TrainedModel | null;
  tree: TrainedModel | null;
} {
  return { logistic: logisticModel, tree: treeModel };
}

// ═══════════════════════════════════════════════════════════════
// S10.7.3 — FREEZE MODEL
// ═══════════════════════════════════════════════════════════════

export async function freezeCurrentModel(modelType: 'logistic' | 'tree' = 'logistic'): Promise<{
  success: boolean;
  registry: ModelRegistryState;
  message: string;
}> {
  const model = modelType === 'logistic' ? logisticModel : treeModel;
  
  if (!model) {
    // Train first
    await trainModels({ limit: 200 });
  }
  
  const activeModel = modelType === 'logistic' ? logisticModel : treeModel;
  if (!activeModel) {
    return {
      success: false,
      registry: getRegistryState(),
      message: 'No model available to freeze',
    };
  }
  
  // Get agreement rate
  const comparison = await getComparison(modelType);
  const agreementRate = comparison?.agreementRate || 1.0;
  
  // Freeze the model
  freezeModel(activeModel, agreementRate);
  
  // Store baseline feature importance
  baselineFeatureImportance = { ...activeModel.featureImportance };
  
  return {
    success: true,
    registry: getRegistryState(),
    message: `Model ${modelType} v1 frozen successfully in MIRROR_MODE`,
  };
}

export function getMLRegistryState(): ModelRegistryState {
  return getRegistryState();
}

export function getMLFrozenWeights() {
  return getFrozenWeights();
}

export function checkIfFrozen(): boolean {
  return isModelFrozen();
}

// ═══════════════════════════════════════════════════════════════
// S10.7.4 — DRIFT DETECTION
// ═══════════════════════════════════════════════════════════════

export async function getDriftMetrics(): Promise<DriftMetrics> {
  const model = logisticModel;
  
  const currentImportance = model?.featureImportance || {};
  
  return calculateDriftMetrics(currentImportance, baselineFeatureImportance);
}

export async function runDriftCheck(modelType: 'logistic' | 'tree' = 'logistic'): Promise<{
  previousAgreement: number;
  currentAgreement: number;
  driftDetected: boolean;
  driftStatus: string;
}> {
  const registry = getRegistryState();
  const previousAgreement = registry.agreementRate;
  
  // Recalculate agreement with fresh data
  const comparison = await getComparison(modelType);
  const currentAgreement = comparison?.agreementRate || previousAgreement;
  
  // Update drift check
  updateDriftCheck(currentAgreement, comparison?.totalSamples || 0);
  
  const newRegistry = getRegistryState();
  
  return {
    previousAgreement,
    currentAgreement,
    driftDetected: newRegistry.driftStatus !== 'NO_DRIFT',
    driftStatus: newRegistry.driftStatus,
  };
}

// ═══════════════════════════════════════════════════════════════
// S10.7.4 — ADMIN SUMMARY
// ═══════════════════════════════════════════════════════════════

export interface AdminSummary {
  registry: ModelRegistryState;
  models: {
    logistic: { accuracy: number; trainingSize: number } | null;
    tree: { accuracy: number; trainingSize: number } | null;
  };
  lastComparison: {
    agreementRate: number;
    disagreementCount: number;
    labelDistribution: Record<MLLabel, number>;
  } | null;
  drift: DriftMetrics;
  featureImportance: FeatureImportanceComparison[];
}

export async function getAdminSummary(): Promise<AdminSummary> {
  const registry = getRegistryState();
  const comparison = await getComparison('logistic');
  const drift = await getDriftMetrics();
  const featureImportance = await getFeatureImportanceComparison('logistic');
  
  return {
    registry,
    models: {
      logistic: logisticModel ? {
        accuracy: logisticModel.accuracy,
        trainingSize: logisticModel.trainingSize,
      } : null,
      tree: treeModel ? {
        accuracy: treeModel.accuracy,
        trainingSize: treeModel.trainingSize,
      } : null,
    },
    lastComparison: comparison ? {
      agreementRate: comparison.agreementRate,
      disagreementCount: comparison.disagreementCount,
      labelDistribution: comparison.rulesVsMlMatrix.matrix.WARNING,
    } : null,
    drift,
    featureImportance: featureImportance.slice(0, 10),
  };
}

console.log('[S10.7] ML Service initialized');
