/**
 * BLOCK 6.5 — Cluster Outcome Model
 * ===================================
 * 
 * Simple ML model: Logistic Regression / Gradient Boosting
 * Predicts probability of UP/FLAT/DOWN based on cluster features.
 */

import type {
  ClusterLearningSample,
  ClusterPrediction,
  ClusterFeatures,
  MarketContext,
  ModelHealth,
} from './ml.types.js';
import { ML_GUARDS } from './ml.types.js';
import { clusterFeatureBuilder } from './feature-builder.service.js';

// ═══════════════════════════════════════════════════════════════
// MODEL STATE
// ═══════════════════════════════════════════════════════════════

interface ModelWeights {
  coefficients: number[];
  intercept: number[];
  classes: ['UP', 'FLAT', 'DOWN'];
}

interface TrainingResult {
  success: boolean;
  accuracy: number;
  samples: number;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// CLUSTER OUTCOME MODEL
// ═══════════════════════════════════════════════════════════════

export class ClusterOutcomeModel {
  private weights: ModelWeights | null = null;
  private trainedAt: number = 0;
  private accuracy7d: number = 0;
  private sampleCount: number = 0;
  private frozen: boolean = false;

  // Feature stats for normalization
  private featureMeans: number[] = [];
  private featureStds: number[] = [];

  /**
   * Train model on historical samples
   */
  async train(samples: ClusterLearningSample[]): Promise<TrainingResult> {
    if (samples.length < ML_GUARDS.minSamplesForTraining) {
      return {
        success: false,
        accuracy: 0,
        samples: samples.length,
        error: `Need ${ML_GUARDS.minSamplesForTraining} samples, got ${samples.length}`,
      };
    }

    try {
      // Prepare data
      const X: number[][] = [];
      const y: number[] = [];

      for (const sample of samples) {
        const featureVec = clusterFeatureBuilder.toFeatureVector(sample.features);
        const contextVec = clusterFeatureBuilder.contextToVector(sample.marketContext);
        X.push([...featureVec, ...contextVec]);
        
        // Encode label
        y.push(sample.outcomeClass === 'UP' ? 2 : sample.outcomeClass === 'DOWN' ? 0 : 1);
      }

      // Calculate feature stats for normalization
      this.calculateFeatureStats(X);

      // Normalize
      const X_norm = X.map(row => this.normalizeRow(row));

      // Train using simple softmax regression
      this.weights = this.trainSoftmax(X_norm, y, 3);

      // Validate
      const predictions = X_norm.map(row => this.predictClass(row));
      const correct = predictions.filter((p, i) => p === y[i]).length;
      this.accuracy7d = correct / predictions.length;
      this.sampleCount = samples.length;
      this.trainedAt = Date.now();
      this.frozen = false;

      console.log(`[ClusterModel] Trained on ${samples.length} samples, accuracy: ${(this.accuracy7d * 100).toFixed(1)}%`);

      return {
        success: true,
        accuracy: this.accuracy7d,
        samples: samples.length,
      };
    } catch (error: any) {
      console.error('[ClusterModel] Training error:', error.message);
      return {
        success: false,
        accuracy: 0,
        samples: samples.length,
        error: error.message,
      };
    }
  }

  /**
   * Predict outcome probabilities
   */
  async predict(
    features: ClusterFeatures,
    context: MarketContext
  ): Promise<ClusterPrediction> {
    // If no model trained, return uniform
    if (!this.weights || this.frozen) {
      return {
        probUP: 0.33,
        probFLAT: 0.34,
        probDOWN: 0.33,
        confidence: 0,
        patternConfidence: 0,
      };
    }

    const featureVec = clusterFeatureBuilder.toFeatureVector(features);
    const contextVec = clusterFeatureBuilder.contextToVector(context);
    const fullVec = [...featureVec, ...contextVec];
    const normalized = this.normalizeRow(fullVec);

    const probs = this.softmax(this.computeLogits(normalized));
    
    // Confidence based on entropy
    const entropy = -probs.reduce((sum, p) => sum + (p > 0 ? p * Math.log(p) : 0), 0);
    const maxEntropy = Math.log(3);
    const confidence = 1 - (entropy / maxEntropy);

    // Pattern confidence based on sample count
    const patternConfidence = Math.min(1, Math.log(this.sampleCount + 1) / 6);

    return {
      probUP: probs[2],
      probFLAT: probs[1],
      probDOWN: probs[0],
      confidence,
      patternConfidence,
    };
  }

  /**
   * Get model health status
   */
  getHealth(): ModelHealth {
    if (!this.weights) {
      return {
        status: 'FROZEN',
        accuracy7d: 0,
        agreementRate: 0,
        sampleCount: 0,
        lastTrainedAt: 0,
        driftDetected: false,
      };
    }

    return {
      status: this.frozen ? 'FROZEN' : (this.accuracy7d >= 0.55 ? 'HEALTHY' : 'DEGRADED'),
      accuracy7d: this.accuracy7d,
      agreementRate: this.accuracy7d,
      sampleCount: this.sampleCount,
      lastTrainedAt: this.trainedAt,
      driftDetected: false,
    };
  }

  /**
   * Freeze model (when accuracy drops)
   */
  freeze(reason: string): void {
    this.frozen = true;
    console.log(`[ClusterModel] Frozen: ${reason}`);
  }

  /**
   * Unfreeze after retraining
   */
  unfreeze(): void {
    this.frozen = false;
  }

  /**
   * Check if model is usable
   */
  isReady(): boolean {
    return this.weights !== null && !this.frozen;
  }

  // ═══════════════════════════════════════════════════════════════
  // INTERNAL ML METHODS
  // ═══════════════════════════════════════════════════════════════

  private trainSoftmax(
    X: number[][],
    y: number[],
    numClasses: number,
    learningRate = 0.1,
    iterations = 1000
  ): ModelWeights {
    const numFeatures = X[0].length;
    
    // Initialize weights
    const coefficients = Array(numClasses * numFeatures).fill(0).map(() => (Math.random() - 0.5) * 0.1);
    const intercept = Array(numClasses).fill(0);

    // Mini-batch gradient descent
    const batchSize = Math.min(64, X.length);

    for (let iter = 0; iter < iterations; iter++) {
      // Shuffle and take batch
      const indices = this.shuffle(Array.from({ length: X.length }, (_, i) => i)).slice(0, batchSize);
      
      const gradCoef = Array(numClasses * numFeatures).fill(0);
      const gradInt = Array(numClasses).fill(0);

      for (const idx of indices) {
        const x = X[idx];
        const label = y[idx];
        
        // Forward pass
        const logits = Array(numClasses).fill(0);
        for (let c = 0; c < numClasses; c++) {
          logits[c] = intercept[c];
          for (let f = 0; f < numFeatures; f++) {
            logits[c] += coefficients[c * numFeatures + f] * x[f];
          }
        }
        
        const probs = this.softmax(logits);
        
        // Backward pass
        for (let c = 0; c < numClasses; c++) {
          const target = c === label ? 1 : 0;
          const error = probs[c] - target;
          
          gradInt[c] += error;
          for (let f = 0; f < numFeatures; f++) {
            gradCoef[c * numFeatures + f] += error * x[f];
          }
        }
      }

      // Update weights
      const scale = learningRate / batchSize;
      for (let i = 0; i < coefficients.length; i++) {
        coefficients[i] -= scale * gradCoef[i];
      }
      for (let i = 0; i < intercept.length; i++) {
        intercept[i] -= scale * gradInt[i];
      }
    }

    return {
      coefficients,
      intercept,
      classes: ['UP', 'FLAT', 'DOWN'],
    };
  }

  private computeLogits(x: number[]): number[] {
    if (!this.weights) return [0, 0, 0];
    
    const numFeatures = x.length;
    const logits = [...this.weights.intercept];
    
    for (let c = 0; c < 3; c++) {
      for (let f = 0; f < numFeatures; f++) {
        logits[c] += this.weights.coefficients[c * numFeatures + f] * x[f];
      }
    }
    
    return logits;
  }

  private predictClass(x: number[]): number {
    const logits = this.computeLogits(x);
    return logits.indexOf(Math.max(...logits));
  }

  private softmax(logits: number[]): number[] {
    const maxLogit = Math.max(...logits);
    const expLogits = logits.map(l => Math.exp(l - maxLogit));
    const sum = expLogits.reduce((a, b) => a + b, 0);
    return expLogits.map(e => e / sum);
  }

  private calculateFeatureStats(X: number[][]): void {
    const numFeatures = X[0].length;
    this.featureMeans = Array(numFeatures).fill(0);
    this.featureStds = Array(numFeatures).fill(1);

    for (let f = 0; f < numFeatures; f++) {
      const values = X.map(row => row[f]);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
      
      this.featureMeans[f] = mean;
      this.featureStds[f] = Math.sqrt(variance) || 1;
    }
  }

  private normalizeRow(row: number[]): number[] {
    if (this.featureMeans.length === 0) return row;
    return row.map((v, i) => (v - this.featureMeans[i]) / this.featureStds[i]);
  }

  private shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC GETTERS
  // ═══════════════════════════════════════════════════════════════

  getStats(): {
    totalSamples: number;
    isTrained: boolean;
    accuracy: number;
    trainedAt: number;
    isFrozen: boolean;
  } {
    return {
      totalSamples: this.sampleCount,
      isTrained: this.weights !== null,
      accuracy: this.accuracy7d,
      trainedAt: this.trainedAt,
      isFrozen: this.frozen,
    };
  }
}

export const clusterOutcomeModel = new ClusterOutcomeModel();

console.log('[Block6] Cluster Outcome Model loaded');
