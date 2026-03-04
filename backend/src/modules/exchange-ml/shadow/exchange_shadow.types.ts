/**
 * Exchange Auto-Learning Loop - PR3: Shadow Prediction Types
 * 
 * Types for shadow mode evaluation:
 * - Shadow predictions recording
 * - Comparison metrics
 * - Statistics tracking
 */

import { ExchangeHorizon, LabelResult } from '../dataset/exchange_dataset.types.js';

// ═══════════════════════════════════════════════════════════════
// SHADOW PREDICTION RECORD
// ═══════════════════════════════════════════════════════════════

export interface ShadowPrediction {
  _id?: string;
  
  // Reference
  sampleId: string;
  horizon: ExchangeHorizon;
  symbol: string;
  
  // Models
  activeModelId: string;
  shadowModelId: string;
  activeModelVersion: number;
  shadowModelVersion: number;
  
  // Predictions (probability of WIN)
  activePrediction: number;
  shadowPrediction: number;
  
  // Classification (based on threshold)
  activeClass: 'WIN' | 'LOSS';
  shadowClass: 'WIN' | 'LOSS';
  
  // Resolution (filled after label resolves)
  resolved: boolean;
  actualLabel: LabelResult | null;
  activeCorrect: boolean | null;
  shadowCorrect: boolean | null;
  resolvedAt: Date | null;
  
  // Metadata
  createdAt: Date;
  inferenceLatencyMs: number;
}

// ═══════════════════════════════════════════════════════════════
// SHADOW COMPARISON METRICS
// ═══════════════════════════════════════════════════════════════

export interface ShadowComparisonMetrics {
  horizon: ExchangeHorizon;
  
  // Models being compared
  activeModelId: string | null;
  shadowModelId: string | null;
  
  // Sample counts
  totalPredictions: number;
  resolvedPredictions: number;
  pendingPredictions: number;
  
  // Active model performance
  activeAccuracy: number;
  activeWinRate: number;
  activePrecision: number;
  activeRecall: number;
  
  // Shadow model performance
  shadowAccuracy: number;
  shadowWinRate: number;
  shadowPrecision: number;
  shadowRecall: number;
  
  // Comparison
  accuracyDelta: number;         // shadow - active
  winRateDelta: number;
  
  // Agreement
  agreementRate: number;         // How often they predict same class
  
  // Stability (variance in rolling window)
  activeStability: number;
  shadowStability: number;
  
  // Time range
  oldestPrediction: Date | null;
  newestPrediction: Date | null;
  
  // Computed at
  computedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// SHADOW WINDOW STATS (Rolling window)
// ═══════════════════════════════════════════════════════════════

export interface ShadowWindowStats {
  windowSize: number;
  
  activeCorrect: number;
  activeIncorrect: number;
  shadowCorrect: number;
  shadowIncorrect: number;
  
  activeAccuracy: number;
  shadowAccuracy: number;
  delta: number;
}

// ═══════════════════════════════════════════════════════════════
// SHADOW CONFIG
// ═══════════════════════════════════════════════════════════════

export interface ShadowConfig {
  // Enabled flag
  enabled: boolean;
  
  // Prediction thresholds
  winThreshold: number;          // Default: 0.6
  
  // Window sizes for rolling metrics
  shortWindowSize: number;       // Default: 50
  longWindowSize: number;        // Default: 200
  
  // Minimum predictions before comparing
  minPredictionsForComparison: number;  // Default: 30
  
  // Promotion thresholds (for PR4)
  minImprovementForPromotion: number;   // Default: 0.02 (2%)
  minSamplesForPromotion: number;       // Default: 100
}

export const DEFAULT_SHADOW_CONFIG: ShadowConfig = {
  enabled: true,
  winThreshold: 0.6,
  shortWindowSize: 50,
  longWindowSize: 200,
  minPredictionsForComparison: 30,
  minImprovementForPromotion: 0.02,
  minSamplesForPromotion: 100,
};

// ═══════════════════════════════════════════════════════════════
// INFERENCE RESULT
// ═══════════════════════════════════════════════════════════════

export interface CrossHorizonBiasInfo {
  applied: boolean;
  modifier: number;
  originalConfidence: number;
  adjustedConfidence: number;
  breakdown: {
    fromParentHorizon?: {
      parentHorizon: string;
      parentBias: number;
      parentSampleCount: number;
      parentConfidence: number;
      weightedInfluence: number;
    };
    stabilityPenalty?: {
      ownStability: number;
      penalty: number;
    };
    insufficientData?: boolean;
  };
}

export interface InferenceResult {
  // Primary prediction (always from active)
  prediction: number;            // Probability of WIN
  predictedClass: 'WIN' | 'LOSS';
  modelId: string;
  modelVersion: number;
  
  // Shadow info (if available)
  hasShadow: boolean;
  shadowPrediction?: number;
  shadowClass?: 'WIN' | 'LOSS';
  shadowModelId?: string;
  
  // Cross-Horizon Bias adjustment (if applied)
  crossHorizonBias?: CrossHorizonBiasInfo;
  
  // Performance
  latencyMs: number;
}

console.log('[Exchange ML] Shadow types loaded');
