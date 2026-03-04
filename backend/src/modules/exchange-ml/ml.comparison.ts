/**
 * S10.7.2 — ML Comparison Engine
 * 
 * Compares Rules-based vs ML predictions:
 * - Agreement rate
 * - Disagreement analysis
 * - Feature importance
 * - Stability check
 */

import { MLLabel, MLFeatures, MLResult } from './ml.types.js';
import { TrainedModel, predictWithModel, ConfusionMatrix } from './ml.trainer.js';
import { labelFromFeatures } from './labeler.js';
import { FEATURE_NAMES } from './featureExtractor.js';

// ═══════════════════════════════════════════════════════════════
// COMPARISON RESULT
// ═══════════════════════════════════════════════════════════════

export interface ComparisonResult {
  totalSamples: number;
  
  // Agreement metrics
  agreementRate: number;           // 0..1 (% where rules == ml)
  disagreementCount: number;
  
  // Per-label agreement
  labelAgreement: Record<MLLabel, number>;
  
  // Confusion: rows = rules, cols = ml
  rulesVsMlMatrix: ConfusionMatrix;
  
  // Disagreement breakdown
  disagreements: {
    rulesWarningMlIgnore: number;  // ML reduces WARNING
    rulesIgnoreMlWarning: number;  // ML increases WARNING
    rulesWarningMlUse: number;     // ML promotes to USE
    rulesUseMlIgnore: number;      // ML demotes USE
    other: number;
  };
  
  // Model info
  modelType: string;
  modelAccuracy: number;
}

export interface DisagreementCase {
  observationId: string;
  timestamp: number;
  
  rulesLabel: MLLabel;
  mlLabel: MLLabel;
  mlConfidence: number;
  
  // Context
  regime: string;
  patternCount: number;
  hasConflict: boolean;
  
  // Key features that might explain disagreement
  keyFeatures: Array<{
    name: string;
    value: number;
  }>;
}

export interface FeatureImportanceComparison {
  feature: string;
  rulesWeight: number;      // Estimated importance in rules
  mlWeight: number;         // ML feature importance
  agreement: number;        // How much they agree on importance
}

// ═══════════════════════════════════════════════════════════════
// COMPARE RULES VS ML
// ═══════════════════════════════════════════════════════════════

export function compareRulesVsML(
  data: Array<{
    id: string;
    features: MLFeatures;
    rulesLabel: MLLabel;
    regime: string;
    patternCount: number;
    hasConflict: boolean;
    timestamp: number;
  }>,
  model: TrainedModel
): ComparisonResult {
  const matrix: Record<MLLabel, Record<MLLabel, number>> = {
    USE: { USE: 0, IGNORE: 0, WARNING: 0 },
    IGNORE: { USE: 0, IGNORE: 0, WARNING: 0 },
    WARNING: { USE: 0, IGNORE: 0, WARNING: 0 },
  };
  
  let agreements = 0;
  const labelAgreement: Record<MLLabel, number> = { USE: 0, IGNORE: 0, WARNING: 0 };
  const labelCounts: Record<MLLabel, number> = { USE: 0, IGNORE: 0, WARNING: 0 };
  
  const disagreements = {
    rulesWarningMlIgnore: 0,
    rulesIgnoreMlWarning: 0,
    rulesWarningMlUse: 0,
    rulesUseMlIgnore: 0,
    other: 0,
  };
  
  for (const item of data) {
    const mlPrediction = predictWithModel(model, item.features);
    const mlLabel = mlPrediction.label;
    const rulesLabel = item.rulesLabel;
    
    // Update confusion matrix (rules = rows, ml = cols)
    matrix[rulesLabel][mlLabel]++;
    labelCounts[rulesLabel]++;
    
    if (rulesLabel === mlLabel) {
      agreements++;
      labelAgreement[rulesLabel]++;
    } else {
      // Track disagreement type
      if (rulesLabel === 'WARNING' && mlLabel === 'IGNORE') {
        disagreements.rulesWarningMlIgnore++;
      } else if (rulesLabel === 'IGNORE' && mlLabel === 'WARNING') {
        disagreements.rulesIgnoreMlWarning++;
      } else if (rulesLabel === 'WARNING' && mlLabel === 'USE') {
        disagreements.rulesWarningMlUse++;
      } else if (rulesLabel === 'USE' && mlLabel === 'IGNORE') {
        disagreements.rulesUseMlIgnore++;
      } else {
        disagreements.other++;
      }
    }
  }
  
  // Calculate per-label agreement rate
  for (const label of ['USE', 'IGNORE', 'WARNING'] as MLLabel[]) {
    labelAgreement[label] = labelCounts[label] > 0 
      ? labelAgreement[label] / labelCounts[label] 
      : 0;
  }
  
  return {
    totalSamples: data.length,
    agreementRate: data.length > 0 ? agreements / data.length : 0,
    disagreementCount: data.length - agreements,
    labelAgreement,
    rulesVsMlMatrix: { matrix, total: data.length },
    disagreements,
    modelType: model.type,
    modelAccuracy: model.accuracy,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET DISAGREEMENT CASES
// ═══════════════════════════════════════════════════════════════

export function getDisagreementCases(
  data: Array<{
    id: string;
    features: MLFeatures;
    rulesLabel: MLLabel;
    regime: string;
    patternCount: number;
    hasConflict: boolean;
    timestamp: number;
  }>,
  model: TrainedModel,
  limit: number = 20
): DisagreementCase[] {
  const cases: DisagreementCase[] = [];
  
  for (const item of data) {
    const mlPrediction = predictWithModel(model, item.features);
    
    if (mlPrediction.label !== item.rulesLabel) {
      cases.push({
        observationId: item.id,
        timestamp: item.timestamp,
        rulesLabel: item.rulesLabel,
        mlLabel: mlPrediction.label,
        mlConfidence: mlPrediction.confidence,
        regime: item.regime,
        patternCount: item.patternCount,
        hasConflict: item.hasConflict,
        keyFeatures: getTopFeatures(item.features),
      });
      
      if (cases.length >= limit) break;
    }
  }
  
  return cases;
}

// ═══════════════════════════════════════════════════════════════
// COMPARE FEATURE IMPORTANCE
// ═══════════════════════════════════════════════════════════════

export function compareFeatureImportance(
  model: TrainedModel
): FeatureImportanceComparison[] {
  // Rules-based "importance" (hardcoded based on labeler logic)
  const rulesImportance: Record<string, number> = {
    cascadeActive: 0.95,
    liquidationIntensity: 0.9,
    marketStress: 0.85,
    regimeIsSqueeze: 0.8,
    regimeIsExhaustion: 0.75,
    conflictCount: 0.7,
    regimeConfidence: 0.65,
    readability: 0.6,
    imbalancePressure: 0.5,
    flowDominance: 0.4,
    absorptionStrength: 0.35,
    volumeRatio: 0.3,
    oiDelta: 0.25,
    flowBias: 0.2,
    volumeDelta: 0.15,
    oiVolumeDivergence: 0.1,
    patternCount: 0.1,
    bullishRatio: 0.05,
    bearishRatio: 0.05,
    regimeIsExpansion: 0.05,
  };
  
  const result: FeatureImportanceComparison[] = [];
  
  for (const feature of FEATURE_NAMES) {
    const rulesWeight = rulesImportance[feature] || 0;
    const mlWeight = model.featureImportance[feature] || 0;
    
    // Agreement = 1 - |diff|
    const agreement = 1 - Math.abs(rulesWeight - mlWeight);
    
    result.push({
      feature,
      rulesWeight,
      mlWeight,
      agreement,
    });
  }
  
  // Sort by ML importance
  result.sort((a, b) => b.mlWeight - a.mlWeight);
  
  return result;
}

// ═══════════════════════════════════════════════════════════════
// STABILITY CHECK
// ═══════════════════════════════════════════════════════════════

export interface StabilityResult {
  // How stable is ML vs noise?
  mlStability: number;           // 0..1 (% of samples that don't flip with small noise)
  rulesStability: number;        // Rules are deterministic, should be ~1
  
  // Which features cause most instability?
  unstableFeatures: string[];
}

export function checkStability(
  data: Array<{ features: MLFeatures }>,
  model: TrainedModel,
  noiseLevel: number = 0.05
): StabilityResult {
  let mlStable = 0;
  let rulesStable = 0;
  const featureFlips: Record<string, number> = {};
  
  for (const item of data) {
    const originalMl = predictWithModel(model, item.features).label;
    const originalRules = labelFromFeatures(item.features).label;
    
    // Add noise to each feature
    const noisyFeatures = { ...item.features };
    let mlFlipped = false;
    let rulesFlipped = false;
    
    for (const [key, value] of Object.entries(item.features) as [keyof MLFeatures, number][]) {
      // Add small noise
      const noise = (Math.random() - 0.5) * 2 * noiseLevel;
      (noisyFeatures as any)[key] = Math.max(0, Math.min(1, value + noise));
      
      // Check if this causes a flip
      const noisyMl = predictWithModel(model, noisyFeatures).label;
      if (noisyMl !== originalMl) {
        mlFlipped = true;
        featureFlips[key] = (featureFlips[key] || 0) + 1;
      }
      
      const noisyRules = labelFromFeatures(noisyFeatures).label;
      if (noisyRules !== originalRules) {
        rulesFlipped = true;
      }
      
      // Reset
      (noisyFeatures as any)[key] = value;
    }
    
    if (!mlFlipped) mlStable++;
    if (!rulesFlipped) rulesStable++;
  }
  
  // Find most unstable features
  const unstableFeatures = Object.entries(featureFlips)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([f]) => f);
  
  return {
    mlStability: data.length > 0 ? mlStable / data.length : 1,
    rulesStability: data.length > 0 ? rulesStable / data.length : 1,
    unstableFeatures,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function getTopFeatures(features: MLFeatures): Array<{ name: string; value: number }> {
  const entries = Object.entries(features) as [string, number][];
  
  return entries
    .filter(([name]) => ['marketStress', 'readability', 'cascadeActive', 'liquidationIntensity', 'regimeConfidence', 'conflictCount'].includes(name))
    .map(([name, value]) => ({ name, value }));
}

console.log('[S10.7.2] ML Comparison Engine loaded');
