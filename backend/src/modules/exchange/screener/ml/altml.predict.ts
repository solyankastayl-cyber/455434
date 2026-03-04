/**
 * BLOCK 1.5.5 — Alt ML Predict + Explain
 * ========================================
 * Prediction with explainability.
 */

import type { AltMlModel, AltMlPrediction } from './altml.types.js';
import { FEATURE_NAMES } from '../pattern.space.js';

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
}

/**
 * Predict winner probability for a single vector
 */
export function predictProba(
  model: AltMlModel,
  features: number[]
): { p: number; contributions: number[] } {
  // Calculate logit
  let z = model.bias;
  for (let i = 0; i < model.weights.length; i++) {
    z += model.weights[i] * features[i];
  }

  const p = sigmoid(z);

  // Contribution of each feature = w_i * x_i
  const contributions = model.weights.map((w, i) => w * features[i]);

  return { p, contributions };
}

/**
 * Full prediction with explainability
 */
export function predict(
  model: AltMlModel,
  symbol: string,
  features: number[]
): AltMlPrediction {
  const { p, contributions } = predictProba(model, features);

  // Sort contributions by absolute value
  const sortedContribs = contributions
    .map((c, i) => ({
      feature: FEATURE_NAMES[i] ?? `Feature_${i}`,
      value: features[i],
      contribution: c,
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  // Confidence based on probability distance from 0.5
  const confidence = Math.abs(p - 0.5) * 2;

  return {
    symbol,
    pWinner: Math.round(p * 1000) / 1000,
    score: Math.round(p * 100 * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    topContributions: sortedContribs.slice(0, 5).map(c => ({
      feature: c.feature,
      value: Math.round(c.value * 100) / 100,
      contribution: Math.round(c.contribution * 1000) / 1000,
    })),
  };
}

/**
 * Batch prediction
 */
export function predictBatch(
  model: AltMlModel,
  items: Array<{ symbol: string; features: number[] }>
): AltMlPrediction[] {
  return items
    .map(item => predict(model, item.symbol, item.features))
    .sort((a, b) => b.pWinner - a.pWinner);
}

console.log('[Screener ML] Predict loaded');
