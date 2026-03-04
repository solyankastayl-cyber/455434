/**
 * P8.0-B2 — Quantile Mixture Service (MoE)
 * 
 * Mixture-of-Experts approach:
 * - Each "expert" = linear quantile regression for one regime
 * - Training: SGD with pinball loss, deterministic seed
 * - Inference: mix expert predictions by regime probabilities
 * 
 * q_mix = Σ_r p(r) * q_r
 */

import {
  Horizon,
  HORIZONS,
  HorizonForecast,
  enforceQuantileMonotonicity,
  clampReturn,
} from '../contracts/quantile_forecast.contract.js';
import {
  DatasetSample,
  TrainedModelWeights,
  QuantileWeights,
  ExpertHorizonWeights,
} from '../contracts/quantile_train.contract.js';
import { FEATURE_COUNT } from '../contracts/feature_vector.contract.js';
import { computeTailRiskFromQuantiles } from './tail_risk.service.js';

// ═══════════════════════════════════════════════════════════════
// SEEDED RANDOM (deterministic training)
// ═══════════════════════════════════════════════════════════════

class SeededRandom {
  private state: number;
  
  constructor(seed: number) {
    this.state = seed;
  }
  
  next(): number {
    // xorshift32
    this.state ^= this.state << 13;
    this.state ^= this.state >> 17;
    this.state ^= this.state << 5;
    return ((this.state >>> 0) / 4294967296);
  }
  
  gaussian(): number {
    const u1 = this.next();
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  }
}

// ═══════════════════════════════════════════════════════════════
// PINBALL LOSS + SGD
// ═══════════════════════════════════════════════════════════════

/**
 * Pinball (quantile) loss
 * L(y, yhat, tau) = tau * max(y - yhat, 0) + (1 - tau) * max(yhat - y, 0)
 */
function pinballLoss(y: number, yhat: number, tau: number): number {
  const error = y - yhat;
  return error >= 0 ? tau * error : (tau - 1) * error;
}

/**
 * Gradient of pinball loss w.r.t. yhat
 * d/d(yhat) = -tau if y > yhat, else (1 - tau)
 */
function pinballGradient(y: number, yhat: number, tau: number): number {
  return y > yhat ? -tau : (1 - tau);
}

/**
 * Linear prediction: yhat = X.dot(w) + b
 */
function predict(features: number[], weights: QuantileWeights): number {
  let sum = weights.b;
  for (let i = 0; i < features.length && i < weights.w.length; i++) {
    sum += features[i] * weights.w[i];
  }
  return sum;
}

// ═══════════════════════════════════════════════════════════════
// QUANTILE MIXTURE SERVICE
// ═══════════════════════════════════════════════════════════════

export class QuantileMixtureService {
  
  /**
   * Train MoE model from dataset samples
   */
  train(
    samples: DatasetSample[],
    params: {
      asset: string;
      horizons: Horizon[];
      quantiles: number[];
      regimeExperts: string[];
      minSamplesPerExpert: number;
      smoothing: number;
      seed: number;
    }
  ): TrainedModelWeights {
    const startTime = Date.now();
    const rng = new SeededRandom(params.seed);
    
    const { horizons, regimeExperts, minSamplesPerExpert } = params;
    
    // Group samples by expert regime
    const expertSamples: Record<string, DatasetSample[]> = {};
    for (const expert of regimeExperts) {
      expertSamples[expert] = samples.filter(s => s.expertRegime === expert);
    }
    
    // Determine which experts have enough samples
    const droppedExperts: string[] = [];
    const activeExperts: string[] = [];
    const perExpert: Record<string, number> = {};
    
    for (const expert of regimeExperts) {
      const count = expertSamples[expert].length;
      perExpert[expert] = count;
      
      if (count < minSamplesPerExpert) {
        droppedExperts.push(expert);
        console.log(`[MoE] Expert ${expert} dropped: ${count} < ${minSamplesPerExpert} samples`);
      } else {
        activeExperts.push(expert);
      }
    }
    
    if (activeExperts.length === 0) {
      throw new Error('No experts have enough samples for training');
    }
    
    // Train each expert for each horizon and quantile
    const experts: Record<string, Record<Horizon, ExpertHorizonWeights>> = {};
    
    for (const expert of activeExperts) {
      experts[expert] = {} as Record<Horizon, ExpertHorizonWeights>;
      const eSamples = expertSamples[expert];
      
      for (const horizon of horizons) {
        // Extract labels for this horizon
        const X = eSamples.map(s => s.features);
        const y = eSamples.map(s => s.labels[horizon]);
        
        // Train quantile regressions
        const q05Weights = this.trainQuantileRegression(X, y, 0.05, rng, params.smoothing);
        const q50Weights = this.trainQuantileRegression(X, y, 0.50, rng, params.smoothing);
        const q95Weights = this.trainQuantileRegression(X, y, 0.95, rng, params.smoothing);
        
        experts[expert][horizon] = { q05: q05Weights, q50: q50Weights, q95: q95Weights };
      }
      
      console.log(`[MoE] Expert ${expert} trained: ${eSamples.length} samples, ${horizons.length} horizons`);
    }
    
    // For dropped experts, copy NEUTRAL weights as fallback
    const fallbackExpert = activeExperts.includes('NEUTRAL') ? 'NEUTRAL' : activeExperts[0];
    for (const expert of droppedExperts) {
      experts[expert] = JSON.parse(JSON.stringify(experts[fallbackExpert]));
    }
    
    return {
      modelVersion: 'qv1_moe',
      asset: params.asset,
      trainedAt: new Date().toISOString(),
      seed: params.seed,
      smoothing: params.smoothing,
      featureCount: FEATURE_COUNT,
      horizons,
      experts,
      droppedExperts,
      stats: {
        totalSamples: samples.length,
        perExpert,
        trainingTimeMs: Date.now() - startTime,
      },
    };
  }
  
  /**
   * Predict using MoE: mix expert predictions by regime probabilities
   */
  predictMoE(
    weights: TrainedModelWeights,
    features: number[],
    regimeProbs: Record<string, number>
  ): Record<Horizon, HorizonForecast> {
    const result: Record<string, HorizonForecast> = {};
    
    // Normalize regime probs, redistributing dropped experts
    const normalizedProbs = this.normalizeProbs(regimeProbs, weights.droppedExperts);
    
    for (const horizon of weights.horizons) {
      let q05Mix = 0;
      let q50Mix = 0;
      let q95Mix = 0;
      let meanMix = 0;
      let totalProb = 0;
      
      for (const [regime, prob] of Object.entries(normalizedProbs)) {
        if (prob <= 0) continue;
        
        const expertWeights = weights.experts[regime];
        if (!expertWeights || !expertWeights[horizon]) continue;
        
        const ehw = expertWeights[horizon];
        const q05 = predict(features, ehw.q05);
        const q50 = predict(features, ehw.q50);
        const q95 = predict(features, ehw.q95);
        
        q05Mix += prob * q05;
        q50Mix += prob * q50;
        q95Mix += prob * q95;
        meanMix += prob * (q05 + q50 + q95) / 3; // Approximate mean
        totalProb += prob;
      }
      
      // Normalize if probs don't sum to 1
      if (totalProb > 0 && Math.abs(totalProb - 1) > 0.01) {
        q05Mix /= totalProb;
        q50Mix /= totalProb;
        q95Mix /= totalProb;
        meanMix /= totalProb;
      }
      
      // Clamp
      q05Mix = clampReturn(q05Mix, horizon);
      q50Mix = clampReturn(q50Mix, horizon);
      q95Mix = clampReturn(q95Mix, horizon);
      meanMix = clampReturn(meanMix, horizon);
      
      // Enforce monotonicity
      [q05Mix, q50Mix, q95Mix] = enforceQuantileMonotonicity(q05Mix, q50Mix, q95Mix);
      
      // Tail risk
      const tailRisk = computeTailRiskFromQuantiles(q05Mix, q50Mix, horizon);
      
      result[horizon] = {
        mean: Math.round(meanMix * 10000) / 10000,
        q05: Math.round(q05Mix * 10000) / 10000,
        q50: Math.round(q50Mix * 10000) / 10000,
        q95: Math.round(q95Mix * 10000) / 10000,
        tailRisk: Math.round(tailRisk * 100) / 100,
      };
    }
    
    return result as Record<Horizon, HorizonForecast>;
  }
  
  // ─────────────────────────────────────────────────────────────
  // TRAINING: Linear Quantile Regression with SGD
  // ─────────────────────────────────────────────────────────────
  
  private trainQuantileRegression(
    X: number[][],
    y: number[],
    tau: number,
    rng: SeededRandom,
    smoothing: number
  ): QuantileWeights {
    const n = X.length;
    const dim = FEATURE_COUNT;
    
    // Initialize weights with small random values
    const w = new Array(dim).fill(0).map(() => rng.gaussian() * 0.001);
    let b = 0;
    
    // SGD parameters
    const epochs = 200;
    const lr0 = 0.01;
    const l2Reg = smoothing * 0.001; // L2 regularization
    
    for (let epoch = 0; epoch < epochs; epoch++) {
      const lr = lr0 / (1 + epoch * 0.01); // Learning rate decay
      
      // Shuffle indices
      const indices = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      
      for (const idx of indices) {
        const xi = X[idx];
        const yi = y[idx];
        
        // Prediction
        const yhat = predict(xi, { w, b });
        
        // Gradient
        const grad = pinballGradient(yi, yhat, tau);
        
        // Update weights
        for (let j = 0; j < dim; j++) {
          const xij = xi[j] || 0;
          w[j] -= lr * (grad * xij + l2Reg * w[j]);
        }
        b -= lr * grad;
      }
    }
    
    return { w, b };
  }
  
  /**
   * Normalize regime probabilities, redistributing dropped experts
   */
  private normalizeProbs(
    probs: Record<string, number>,
    droppedExperts: string[]
  ): Record<string, number> {
    const result: Record<string, number> = {};
    let droppedMass = 0;
    let activeMass = 0;
    
    for (const [regime, prob] of Object.entries(probs)) {
      if (droppedExperts.includes(regime)) {
        droppedMass += prob;
      } else {
        result[regime] = prob;
        activeMass += prob;
      }
    }
    
    // Redistribute dropped mass proportionally
    if (droppedMass > 0 && activeMass > 0) {
      for (const regime of Object.keys(result)) {
        result[regime] += (result[regime] / activeMass) * droppedMass;
      }
    }
    
    return result;
  }
}

// Singleton
let instance: QuantileMixtureService | null = null;

export function getQuantileMixtureService(): QuantileMixtureService {
  if (!instance) {
    instance = new QuantileMixtureService();
  }
  return instance;
}
