/**
 * S10.7.2 — ML Trainer
 * 
 * Simple ML models for environment classification:
 * - Logistic Regression (linear, interpretable)
 * - Decision Tree (non-linear interactions)
 * 
 * NOT for trading signals. Only for classifying market ENVIRONMENT.
 */

import { MLLabel, MLFeatures } from './ml.types.js';
import { featuresToVector, FEATURE_NAMES } from './featureExtractor.js';

// ═══════════════════════════════════════════════════════════════
// MODEL TYPES
// ═══════════════════════════════════════════════════════════════

export type ModelType = 'logistic' | 'tree';

export interface TrainedModel {
  type: ModelType;
  version: string;
  trainedAt: number;
  trainingSize: number;
  accuracy: number;
  
  // Model-specific parameters
  weights?: number[];           // For logistic regression
  tree?: DecisionNode;          // For decision tree
  
  // Performance
  confusionMatrix: ConfusionMatrix;
  featureImportance: Record<string, number>;
}

export interface ConfusionMatrix {
  // Predicted vs Actual
  matrix: Record<MLLabel, Record<MLLabel, number>>;
  total: number;
}

export interface DecisionNode {
  featureIndex?: number;
  threshold?: number;
  label?: MLLabel;
  left?: DecisionNode;
  right?: DecisionNode;
  confidence?: number;
}

// ═══════════════════════════════════════════════════════════════
// TRAINING DATA
// ═══════════════════════════════════════════════════════════════

interface TrainingExample {
  features: number[];
  label: MLLabel;
}

// ═══════════════════════════════════════════════════════════════
// LOGISTIC REGRESSION
// ═══════════════════════════════════════════════════════════════

export function trainLogisticRegression(
  examples: TrainingExample[],
  learningRate: number = 0.1,
  iterations: number = 100
): TrainedModel {
  const numFeatures = FEATURE_NAMES.length;
  const numClasses = 3; // USE, IGNORE, WARNING
  
  // Initialize weights: [numClasses x (numFeatures + 1)] for bias
  const weights: number[][] = Array(numClasses)
    .fill(null)
    .map(() => Array(numFeatures + 1).fill(0).map(() => (Math.random() - 0.5) * 0.1));
  
  const labelToIndex: Record<MLLabel, number> = { USE: 0, IGNORE: 1, WARNING: 2 };
  const indexToLabel: MLLabel[] = ['USE', 'IGNORE', 'WARNING'];
  
  // Training loop (gradient descent)
  for (let iter = 0; iter < iterations; iter++) {
    for (const example of examples) {
      const x = [...example.features, 1]; // Add bias term
      const y = labelToIndex[example.label];
      
      // Compute softmax probabilities
      const logits = weights.map(w => dotProduct(w, x));
      const probs = softmax(logits);
      
      // Update weights (gradient descent)
      for (let c = 0; c < numClasses; c++) {
        const error = probs[c] - (c === y ? 1 : 0);
        for (let f = 0; f < x.length; f++) {
          weights[c][f] -= learningRate * error * x[f];
        }
      }
    }
  }
  
  // Flatten weights for storage
  const flatWeights = weights.flat();
  
  // Calculate accuracy and confusion matrix
  const { accuracy, confusionMatrix } = evaluateModel(
    examples,
    (features) => predictLogistic(features, weights, indexToLabel)
  );
  
  // Calculate feature importance (absolute weight magnitude)
  const featureImportance: Record<string, number> = {};
  for (let f = 0; f < numFeatures; f++) {
    const avgWeight = weights.reduce((sum, w) => sum + Math.abs(w[f]), 0) / numClasses;
    featureImportance[FEATURE_NAMES[f]] = avgWeight;
  }
  
  // Normalize importance to 0..1
  const maxImportance = Math.max(...Object.values(featureImportance));
  for (const key of Object.keys(featureImportance)) {
    featureImportance[key] /= maxImportance || 1;
  }
  
  return {
    type: 'logistic',
    version: '1.0.0',
    trainedAt: Date.now(),
    trainingSize: examples.length,
    accuracy,
    weights: flatWeights,
    confusionMatrix,
    featureImportance,
  };
}

function predictLogistic(
  features: number[],
  weights: number[][],
  indexToLabel: MLLabel[]
): { label: MLLabel; confidence: number; probabilities: Record<MLLabel, number> } {
  const x = [...features, 1];
  const logits = weights.map(w => dotProduct(w, x));
  const probs = softmax(logits);
  
  const maxIdx = probs.indexOf(Math.max(...probs));
  
  return {
    label: indexToLabel[maxIdx],
    confidence: probs[maxIdx],
    probabilities: {
      USE: probs[0],
      IGNORE: probs[1],
      WARNING: probs[2],
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// DECISION TREE
// ═══════════════════════════════════════════════════════════════

export function trainDecisionTree(
  examples: TrainingExample[],
  maxDepth: number = 5
): TrainedModel {
  const tree = buildTree(examples, 0, maxDepth);
  
  // Calculate accuracy and confusion matrix
  const { accuracy, confusionMatrix } = evaluateModel(
    examples,
    (features) => predictTree(features, tree)
  );
  
  // Calculate feature importance from tree
  const featureImportance = calculateTreeImportance(tree, examples.length);
  
  return {
    type: 'tree',
    version: '1.0.0',
    trainedAt: Date.now(),
    trainingSize: examples.length,
    accuracy,
    tree,
    confusionMatrix,
    featureImportance,
  };
}

function buildTree(
  examples: TrainingExample[],
  depth: number,
  maxDepth: number
): DecisionNode {
  // Base cases
  if (examples.length === 0) {
    return { label: 'IGNORE', confidence: 0 };
  }
  
  // Check if all same label
  const labels = examples.map(e => e.label);
  const uniqueLabels = [...new Set(labels)];
  if (uniqueLabels.length === 1) {
    return { label: uniqueLabels[0], confidence: 1 };
  }
  
  // Max depth reached - return majority
  if (depth >= maxDepth || examples.length < 5) {
    return getMajorityNode(examples);
  }
  
  // Find best split
  const bestSplit = findBestSplit(examples);
  if (!bestSplit) {
    return getMajorityNode(examples);
  }
  
  const { featureIndex, threshold, leftExamples, rightExamples } = bestSplit;
  
  return {
    featureIndex,
    threshold,
    left: buildTree(leftExamples, depth + 1, maxDepth),
    right: buildTree(rightExamples, depth + 1, maxDepth),
  };
}

function findBestSplit(examples: TrainingExample[]): {
  featureIndex: number;
  threshold: number;
  leftExamples: TrainingExample[];
  rightExamples: TrainingExample[];
} | null {
  let bestGini = Infinity;
  let bestSplit = null;
  
  for (let f = 0; f < FEATURE_NAMES.length; f++) {
    // Get unique values for this feature
    const values = [...new Set(examples.map(e => e.features[f]))].sort((a, b) => a - b);
    
    for (let i = 0; i < values.length - 1; i++) {
      const threshold = (values[i] + values[i + 1]) / 2;
      
      const leftExamples = examples.filter(e => e.features[f] <= threshold);
      const rightExamples = examples.filter(e => e.features[f] > threshold);
      
      if (leftExamples.length === 0 || rightExamples.length === 0) continue;
      
      const gini = (
        (leftExamples.length / examples.length) * giniImpurity(leftExamples) +
        (rightExamples.length / examples.length) * giniImpurity(rightExamples)
      );
      
      if (gini < bestGini) {
        bestGini = gini;
        bestSplit = { featureIndex: f, threshold, leftExamples, rightExamples };
      }
    }
  }
  
  return bestSplit;
}

function giniImpurity(examples: TrainingExample[]): number {
  const counts: Record<MLLabel, number> = { USE: 0, IGNORE: 0, WARNING: 0 };
  for (const e of examples) {
    counts[e.label]++;
  }
  
  const total = examples.length;
  let impurity = 1;
  for (const label of ['USE', 'IGNORE', 'WARNING'] as MLLabel[]) {
    const p = counts[label] / total;
    impurity -= p * p;
  }
  
  return impurity;
}

function getMajorityNode(examples: TrainingExample[]): DecisionNode {
  const counts: Record<MLLabel, number> = { USE: 0, IGNORE: 0, WARNING: 0 };
  for (const e of examples) {
    counts[e.label]++;
  }
  
  let maxLabel: MLLabel = 'IGNORE';
  let maxCount = 0;
  for (const [label, count] of Object.entries(counts) as [MLLabel, number][]) {
    if (count > maxCount) {
      maxCount = count;
      maxLabel = label;
    }
  }
  
  return { label: maxLabel, confidence: maxCount / examples.length };
}

function predictTree(
  features: number[],
  node: DecisionNode
): { label: MLLabel; confidence: number; probabilities: Record<MLLabel, number> } {
  // Leaf node
  if (node.label !== undefined) {
    const conf = node.confidence || 0.5;
    return {
      label: node.label,
      confidence: conf,
      probabilities: {
        USE: node.label === 'USE' ? conf : (1 - conf) / 2,
        IGNORE: node.label === 'IGNORE' ? conf : (1 - conf) / 2,
        WARNING: node.label === 'WARNING' ? conf : (1 - conf) / 2,
      },
    };
  }
  
  // Internal node
  const featureValue = features[node.featureIndex!];
  if (featureValue <= node.threshold!) {
    return predictTree(features, node.left!);
  } else {
    return predictTree(features, node.right!);
  }
}

function calculateTreeImportance(tree: DecisionNode, totalSamples: number): Record<string, number> {
  const importance: Record<string, number> = {};
  for (const name of FEATURE_NAMES) {
    importance[name] = 0;
  }
  
  function traverse(node: DecisionNode, samples: number) {
    if (node.label !== undefined || !node.featureIndex) return;
    
    // Add importance based on samples at this split
    importance[FEATURE_NAMES[node.featureIndex]] += samples / totalSamples;
    
    if (node.left) traverse(node.left, samples / 2);
    if (node.right) traverse(node.right, samples / 2);
  }
  
  traverse(tree, totalSamples);
  
  // Normalize
  const maxVal = Math.max(...Object.values(importance));
  if (maxVal > 0) {
    for (const key of Object.keys(importance)) {
      importance[key] /= maxVal;
    }
  }
  
  return importance;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map(l => Math.exp(l - maxLogit));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sumExps);
}

function evaluateModel(
  examples: TrainingExample[],
  predictor: (features: number[]) => { label: MLLabel; confidence: number; probabilities: Record<MLLabel, number> }
): { accuracy: number; confusionMatrix: ConfusionMatrix } {
  const matrix: Record<MLLabel, Record<MLLabel, number>> = {
    USE: { USE: 0, IGNORE: 0, WARNING: 0 },
    IGNORE: { USE: 0, IGNORE: 0, WARNING: 0 },
    WARNING: { USE: 0, IGNORE: 0, WARNING: 0 },
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

// ═══════════════════════════════════════════════════════════════
// EXPORT PREDICTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export function predictWithModel(
  model: TrainedModel,
  features: MLFeatures
): { label: MLLabel; confidence: number; probabilities: Record<MLLabel, number> } {
  const featureVector = featuresToVector(features);
  
  if (model.type === 'logistic' && model.weights) {
    // Reconstruct weights matrix
    const numFeatures = FEATURE_NAMES.length + 1;
    const weights: number[][] = [];
    for (let c = 0; c < 3; c++) {
      weights.push(model.weights.slice(c * numFeatures, (c + 1) * numFeatures));
    }
    return predictLogistic(featureVector, weights, ['USE', 'IGNORE', 'WARNING']);
  }
  
  if (model.type === 'tree' && model.tree) {
    return predictTree(featureVector, model.tree);
  }
  
  // Fallback
  return { label: 'IGNORE', confidence: 0.5, probabilities: { USE: 0.33, IGNORE: 0.34, WARNING: 0.33 } };
}

// ═══════════════════════════════════════════════════════════════
// PREPARE TRAINING DATA
// ═══════════════════════════════════════════════════════════════

export function prepareTrainingData(
  observations: Array<{ features: MLFeatures; label: MLLabel }>
): TrainingExample[] {
  return observations.map(obs => ({
    features: featuresToVector(obs.features),
    label: obs.label,
  }));
}

console.log('[S10.7.2] ML Trainer loaded');
