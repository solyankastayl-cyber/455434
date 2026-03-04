/**
 * Phase L: Overlay Gates
 * 
 * Safety gates for ML overlay activation
 */

import { OverlayConfig, ModelMetrics } from './overlay_types.js';

export interface GateCheckParams {
  config: Pick<OverlayConfig, 'maxDelta' | 'minRowsToEnable' | 'minAucToEnable'>;
  modelMetrics: ModelMetrics;
  pBase: number;
  pML: number;
}

export interface GateCheckResult {
  gated: boolean;
  reasons: string[];
}

/**
 * Check all overlay gates
 */
export function gateOverlay(params: GateCheckParams): GateCheckResult {
  const { config, modelMetrics, pBase, pML } = params;
  const reasons: string[] = [];

  // Gate 1: Minimum training rows
  const rows = Number(modelMetrics?.rows_train ?? 0);
  if (rows < config.minRowsToEnable) {
    reasons.push('INSUFFICIENT_TRAIN_ROWS');
  }

  // Gate 2: Minimum AUC
  const auc = Number(modelMetrics?.auc ?? 0);
  if (auc < config.minAucToEnable) {
    reasons.push('AUC_TOO_LOW');
  }

  // Gate 3: Max delta (don't let ML deviate too much)
  const delta = Math.abs(pML - pBase);
  if (delta > config.maxDelta) {
    reasons.push('DELTA_TOO_LARGE');
  }

  // Gate 4: Invalid ML probability
  if (isNaN(pML) || pML < 0 || pML > 1) {
    reasons.push('INVALID_ML_PROBABILITY');
  }

  return {
    gated: reasons.length > 0,
    reasons,
  };
}

/**
 * Check if model is ready for production
 */
export function isModelReady(metrics: ModelMetrics, minRows = 100, minAuc = 0.55): boolean {
  if (!metrics) return false;
  return metrics.rows_train >= minRows && metrics.auc >= minAuc;
}

/**
 * Get recommended mode based on metrics
 */
export function getRecommendedMode(metrics: ModelMetrics): string {
  if (!metrics || metrics.rows_train < 100) return 'OFF';
  if (metrics.auc < 0.55) return 'OFF';
  if (metrics.auc < 0.60) return 'SHADOW';
  if (metrics.auc < 0.65) return 'LIVE_LITE';
  if (metrics.auc < 0.70) return 'LIVE_MED';
  return 'LIVE_FULL';
}
