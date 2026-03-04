/**
 * BLOCK 1.5.3 — Alt ML Trainer (Logistic Regression)
 * ====================================================
 * Simple, explainable model: weights = feature contributions.
 */

import type { AltMlModel, AltMlSample } from './altml.types.js';

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

export interface TrainOptions {
  learningRate?: number;
  epochs?: number;
  l2Reg?: number;
  validationSplit?: number;
}

const DEFAULT_OPTIONS: TrainOptions = {
  learningRate: 0.1,
  epochs: 50,
  l2Reg: 0.001,
  validationSplit: 0.2,
};

/**
 * Train logistic regression model
 */
export function trainLogReg(
  samples: AltMlSample[],
  opts?: TrainOptions
): AltMlModel {
  const options = { ...DEFAULT_OPTIONS, ...opts };

  if (samples.length < 50) {
    throw new Error(`Insufficient samples for training: ${samples.length} (need >= 50)`);
  }

  const horizon = samples[0].horizon;
  const n = samples[0].features.length;

  // Initialize weights
  let w = new Array(n).fill(0);
  let b = 0;

  // Shuffle and split
  const shuffled = [...samples].sort(() => Math.random() - 0.5);
  const splitIdx = Math.floor(shuffled.length * (1 - options.validationSplit!));
  const trainSet = shuffled.slice(0, splitIdx);
  const valSet = shuffled.slice(splitIdx);

  // Training loop
  for (let epoch = 0; epoch < options.epochs!; epoch++) {
    const gradW = new Array(n).fill(0);
    let gradB = 0;

    for (const s of trainSet) {
      const z = dot(w, s.features) + b;
      const p = sigmoid(z);
      const err = p - s.label;

      for (let i = 0; i < n; i++) {
        gradW[i] += err * s.features[i];
      }
      gradB += err;
    }

    // Update with L2 regularization
    for (let i = 0; i < n; i++) {
      gradW[i] = gradW[i] / trainSet.length + options.l2Reg! * w[i];
      w[i] -= options.learningRate! * gradW[i];
    }
    gradB /= trainSet.length;
    b -= options.learningRate! * gradB;
  }

  // Calculate accuracy on validation set
  let correct = 0;
  for (const s of valSet) {
    const z = dot(w, s.features) + b;
    const p = sigmoid(z);
    const pred = p >= 0.5 ? 1 : 0;
    if (pred === s.label) correct++;
  }
  const accuracy = valSet.length > 0 ? correct / valSet.length : 0;

  // Winner rate in training data
  const winnerRate = samples.filter(s => s.label === 1).length / samples.length;

  return {
    version: `altml_logreg_v1_${Date.now()}`,
    trainedAt: Date.now(),
    horizon,
    featureCount: n,
    weights: w,
    bias: b,
    trainingSamples: samples.length,
    accuracy,
    winnerRate,
  };
}

/**
 * Evaluate model on test set
 */
export function evaluateModel(
  model: AltMlModel,
  testSet: AltMlSample[]
): {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
} {
  let tp = 0, fp = 0, tn = 0, fn = 0;

  for (const s of testSet) {
    const z = dot(model.weights, s.features) + model.bias;
    const p = sigmoid(z);
    const pred = p >= 0.5 ? 1 : 0;

    if (pred === 1 && s.label === 1) tp++;
    else if (pred === 1 && s.label === 0) fp++;
    else if (pred === 0 && s.label === 0) tn++;
    else fn++;
  }

  const accuracy = (tp + tn) / (tp + tn + fp + fn);
  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = 2 * precision * recall / (precision + recall) || 0;

  return { accuracy, precision, recall, f1 };
}

console.log('[Screener ML] Trainer loaded');
