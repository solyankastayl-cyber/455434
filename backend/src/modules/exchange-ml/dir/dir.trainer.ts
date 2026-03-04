/**
 * Direction Model Trainer
 * =======================
 * 
 * Trains logistic regression model for direction prediction.
 * Target: UP / DOWN / NEUTRAL
 * 
 * Reuses the same training approach as Environment model,
 * but with different features and targets.
 */

import { DirLabel, Horizon } from '../contracts/exchange.types.js';
import { DirFeatureSnapshot } from '../contracts/exchange.types.js';
import { dirFeaturesToVector, DIR_FEATURE_NAMES } from './dir.feature-extractor.js';

// ═══════════════════════════════════════════════════════════════
// MODEL TYPES
// ═══════════════════════════════════════════════════════════════

export interface TrainedDirModel {
  kind: 'DIR';
  modelType: 'logistic' | 'tree';
  version: string;
  horizon: Horizon;
  trainedAt: number;
  trainingSize: number;
  accuracy: number;
  
  // Logistic regression weights
  weights: number[][]; // [class][feature+1] (includes bias)
  classes: DirLabel[];
  featureKeys: string[];
  
  // Performance metrics
  confusionMatrix: ConfusionMatrix;
  featureImportance: Record<string, number>;
  
  // Class distribution in training data
  classDistribution: Record<DirLabel, number>;
}

export interface ConfusionMatrix {
  matrix: Record<DirLabel, Record<DirLabel, number>>;
  total: number;
}

export interface TrainingExample {
  features: number[];
  label: DirLabel;
}

// ═══════════════════════════════════════════════════════════════
// TRAINING
// ═══════════════════════════════════════════════════════════════

export function trainDirLogistic(
  examples: TrainingExample[],
  horizon: Horizon,
  options: {
    learningRate?: number;
    iterations?: number;
    l2Lambda?: number; // L2 regularization
  } = {}
): TrainedDirModel {
  const {
    learningRate = 0.1,
    iterations = 200,
    l2Lambda = 0.01,
  } = options;
  
  const numFeatures = DIR_FEATURE_NAMES.length;
  const classes: DirLabel[] = ['UP', 'DOWN', 'NEUTRAL'];
  const numClasses = classes.length;
  
  // Initialize weights: [numClasses x (numFeatures + 1)] for bias
  const weights: number[][] = Array(numClasses)
    .fill(null)
    .map(() => Array(numFeatures + 1).fill(0).map(() => (Math.random() - 0.5) * 0.1));
  
  const labelToIndex: Record<DirLabel, number> = { UP: 0, DOWN: 1, NEUTRAL: 2 };
  
  // Class distribution
  const classDistribution: Record<DirLabel, number> = { UP: 0, DOWN: 0, NEUTRAL: 0 };
  for (const ex of examples) {
    classDistribution[ex.label]++;
  }
  
  // Calculate class weights for imbalanced data
  const totalSamples = examples.length;
  const classWeights = classes.map(c => {
    const count = classDistribution[c] || 1;
    return totalSamples / (numClasses * count);
  });
  
  // Training loop (gradient descent with L2 regularization)
  for (let iter = 0; iter < iterations; iter++) {
    for (const example of examples) {
      const x = [...example.features, 1]; // Add bias term
      const y = labelToIndex[example.label];
      const sampleWeight = classWeights[y];
      
      // Compute softmax probabilities
      const logits = weights.map(w => dotProduct(w, x));
      const probs = softmax(logits);
      
      // Update weights (gradient descent with L2)
      for (let c = 0; c < numClasses; c++) {
        const error = (probs[c] - (c === y ? 1 : 0)) * sampleWeight;
        for (let f = 0; f < x.length; f++) {
          const grad = error * x[f];
          const l2Term = f < numFeatures ? l2Lambda * weights[c][f] : 0;
          weights[c][f] -= learningRate * (grad + l2Term);
        }
      }
    }
    
    // Decay learning rate
    if (iter > 0 && iter % 50 === 0) {
      options.learningRate = learningRate * 0.9;
    }
  }
  
  // Evaluate model
  const { accuracy, confusionMatrix } = evaluateModel(
    examples,
    (features) => predictDirLogistic(features, weights, classes)
  );
  
  // Calculate feature importance
  const featureImportance: Record<string, number> = {};
  for (let f = 0; f < numFeatures; f++) {
    const avgWeight = weights.reduce((sum, w) => sum + Math.abs(w[f]), 0) / numClasses;
    featureImportance[DIR_FEATURE_NAMES[f]] = avgWeight;
  }
  
  // Normalize importance
  const maxImportance = Math.max(...Object.values(featureImportance));
  for (const key of Object.keys(featureImportance)) {
    featureImportance[key] /= maxImportance || 1;
  }
  
  return {
    kind: 'DIR',
    modelType: 'logistic',
    version: `dir_v1.${Date.now()}`,
    horizon,
    trainedAt: Date.now(),
    trainingSize: examples.length,
    accuracy,
    weights,
    classes,
    featureKeys: [...DIR_FEATURE_NAMES],
    confusionMatrix,
    featureImportance,
    classDistribution,
  };
}

// ═══════════════════════════════════════════════════════════════
// PREDICTION
// ═══════════════════════════════════════════════════════════════

export function predictDirLogistic(
  features: number[],
  weights: number[][],
  classes: DirLabel[]
): { label: DirLabel; confidence: number; proba: Record<DirLabel, number> } {
  const x = [...features, 1]; // Add bias
  const logits = weights.map(w => dotProduct(w, x));
  const probs = softmax(logits);
  
  const proba: Record<DirLabel, number> = {
    UP: probs[0] ?? 0,
    DOWN: probs[1] ?? 0,
    NEUTRAL: probs[2] ?? 0,
  };
  
  const maxIdx = probs.indexOf(Math.max(...probs));
  
  return {
    label: classes[maxIdx],
    confidence: probs[maxIdx],
    proba,
  };
}

export function predictWithDirModel(
  model: TrainedDirModel,
  features: DirFeatureSnapshot
): { label: DirLabel; confidence: number; proba: Record<DirLabel, number> } {
  const featureVector = dirFeaturesToVector(features);
  return predictDirLogistic(featureVector, model.weights, model.classes);
}

// ═══════════════════════════════════════════════════════════════
// PREPARE TRAINING DATA
// ═══════════════════════════════════════════════════════════════

export function prepareDirTrainingData(
  samples: Array<{ features: DirFeatureSnapshot; label: DirLabel }>
): TrainingExample[] {
  return samples.map(s => ({
    features: dirFeaturesToVector(s.features),
    label: s.label,
  }));
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, val, i) => sum + val * (b[i] ?? 0), 0);
}

function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map(l => Math.exp(l - maxLogit));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / (sumExps || 1));
}

function evaluateModel(
  examples: TrainingExample[],
  predictor: (features: number[]) => { label: DirLabel; confidence: number; proba: Record<DirLabel, number> }
): { accuracy: number; confusionMatrix: ConfusionMatrix } {
  const matrix: Record<DirLabel, Record<DirLabel, number>> = {
    UP: { UP: 0, DOWN: 0, NEUTRAL: 0 },
    DOWN: { UP: 0, DOWN: 0, NEUTRAL: 0 },
    NEUTRAL: { UP: 0, DOWN: 0, NEUTRAL: 0 },
  };
  
  let correct = 0;
  for (const example of examples) {
    const prediction = predictor(example.features);
    matrix[example.label][prediction.label]++;
    if (prediction.label === example.label) correct++;
  }
  
  return {
    accuracy: examples.length > 0 ? correct / examples.length : 0,
    confusionMatrix: { matrix, total: examples.length },
  };
}

console.log('[Exchange ML] Direction trainer loaded');
