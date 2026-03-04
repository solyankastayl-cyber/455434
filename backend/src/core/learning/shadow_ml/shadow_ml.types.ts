/**
 * Shadow ML Types
 * 
 * ETAP 4: Type definitions for Shadow ML integration.
 */

import type { Horizon, DriftLevel } from '../learning.types.js';

// ==================== PREDICTION ====================

export interface ShadowPrediction {
  snapshotId: string;
  tokenAddress: string;
  symbol: string;
  horizon: Horizon;
  
  // ML outputs
  p_success: number;        // 0-1
  ml_confidence: number;    // 0-100
  confidence_modifier: number; // 0.4-1.2
  
  // Context
  drift_level: DriftLevel;
  bucket: string;
  rules_confidence: number;
  
  // Final adjusted confidence
  final_confidence: number;
  
  // Metadata
  model_id: string;
  predicted_at: Date;
}

// ==================== EVALUATION ====================

export interface ShadowEvalMetrics {
  precision: number;
  recall: number;
  f1: number;
  pr_auc?: number;
  brier_score?: number;
  ece?: number;
  precision_at_10?: number;
  precision_at_20?: number;
}

export interface ShadowEvalComparison {
  rules_precision: number;
  ml_precision: number;
  precision_lift: number;
  rules_f1: number;
  ml_f1: number;
  ml_better: boolean;
  sample_count: number;
}

export interface ShadowEvalReport {
  horizon: Horizon;
  model_id: string;
  metrics: ShadowEvalMetrics;
  comparison: ShadowEvalComparison;
  gates_passed: boolean;
  evaluated_at: Date;
}

// ==================== TRAINING ====================

export interface TrainResult {
  success: boolean;
  model_id: string;
  horizon: Horizon;
  metrics: ShadowEvalMetrics;
  sample_count: number;
  trained_at: string;
  message: string;
}

// ==================== CALIBRATION ====================

export interface ConfidenceCalibration {
  rules_confidence: number;
  drift_modifier: number;
  ml_modifier: number;
  final_confidence: number;
}

// ==================== ML SERVICE STATUS ====================

export interface MLServiceStatus {
  available: boolean;
  models: {
    '7d': { ready: boolean; model_id?: string; metrics?: ShadowEvalMetrics };
    '30d': { ready: boolean; model_id?: string; metrics?: ShadowEvalMetrics };
  };
  last_train?: string;
  last_predict?: string;
}
