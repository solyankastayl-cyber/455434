/**
 * BLOCK 14 — ML Overlay Service
 * ===============================
 * 
 * ML as memory compressor, not decision maker.
 * Rule-based → what's possible
 * ML → what works more often
 */

import type { ClusterFeatures, MarketContext, ClusterPrediction } from '../ml/ml.types.js';
import { clusterOutcomeModel } from '../ml/cluster-outcome.model.js';
import { ML_GUARDS } from '../ml/ml.types.js';

// ═══════════════════════════════════════════════════════════════
// ML OVERLAY CONFIG
// ═══════════════════════════════════════════════════════════════

export const ML_OVERLAY_CONFIG = {
  // ML modifies, doesn't decide
  baseWeight: 0.7,           // Rule-based contribution
  mlWeight: 0.3,             // ML contribution (max 30%)
  
  // Guardrails
  minSamples: ML_GUARDS.minSamplesForTraining,
  minAgreementRate: ML_GUARDS.minAgreementRate,
  
  // Auto-disable conditions
  autoDisableOnDrift: true,
  autoDisableInRiskOff: true,
} as const;

// ═══════════════════════════════════════════════════════════════
// ML OVERLAY SERVICE
// ═══════════════════════════════════════════════════════════════

export class MLOverlayService {
  private enabled: boolean = true;
  private disableReason?: string;

  /**
   * Apply ML overlay to base score
   * 
   * AltContext.strength = baseStrength × (0.7 + 0.3 × altPatternConfidence)
   */
  async applyOverlay(
    baseScore: number,
    features: ClusterFeatures,
    context: MarketContext
  ): Promise<{
    finalScore: number;
    mlContribution: number;
    prediction: ClusterPrediction | null;
    applied: boolean;
    reason: string;
  }> {
    // Check if should apply
    if (!this.shouldApply(context)) {
      return {
        finalScore: baseScore,
        mlContribution: 0,
        prediction: null,
        applied: false,
        reason: this.disableReason ?? 'ML overlay disabled',
      };
    }

    // Get prediction
    const prediction = await clusterOutcomeModel.predict(features, context);

    // Check model health
    const health = clusterOutcomeModel.getHealth();
    if (health.status === 'FROZEN') {
      return {
        finalScore: baseScore,
        mlContribution: 0,
        prediction,
        applied: false,
        reason: 'Model frozen',
      };
    }

    // Calculate ML contribution
    const patternConfidence = prediction.patternConfidence;
    const mlBoost = ML_OVERLAY_CONFIG.baseWeight + ML_OVERLAY_CONFIG.mlWeight * patternConfidence;
    
    // Apply overlay
    const finalScore = baseScore * mlBoost;
    const mlContribution = (finalScore - baseScore) / Math.max(1, baseScore) * 100;

    return {
      finalScore: Math.min(100, Math.max(0, finalScore)),
      mlContribution,
      prediction,
      applied: true,
      reason: `ML confidence: ${(patternConfidence * 100).toFixed(0)}%`,
    };
  }

  /**
   * Check if ML should be applied
   */
  private shouldApply(context: MarketContext): boolean {
    if (!this.enabled) {
      return false;
    }

    // Check risk-off
    if (ML_OVERLAY_CONFIG.autoDisableInRiskOff && context.marketRegime === 'RISK_OFF') {
      this.disableReason = 'Risk-off regime';
      return false;
    }

    // Check model readiness
    if (!clusterOutcomeModel.isReady()) {
      this.disableReason = 'Model not ready';
      return false;
    }

    // Check model health
    const health = clusterOutcomeModel.getHealth();
    if (health.agreementRate < ML_OVERLAY_CONFIG.minAgreementRate) {
      this.disableReason = `Agreement rate too low: ${(health.agreementRate * 100).toFixed(0)}%`;
      return false;
    }

    this.disableReason = undefined;
    return true;
  }

  /**
   * Enable/disable overlay
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.disableReason = 'Manually disabled';
    }
  }

  /**
   * Get status
   */
  getStatus(): {
    enabled: boolean;
    modelReady: boolean;
    modelHealth: ReturnType<typeof clusterOutcomeModel.getHealth>;
    config: typeof ML_OVERLAY_CONFIG;
  } {
    return {
      enabled: this.enabled,
      modelReady: clusterOutcomeModel.isReady(),
      modelHealth: clusterOutcomeModel.getHealth(),
      config: ML_OVERLAY_CONFIG,
    };
  }
}

export const mlOverlayService = new MLOverlayService();

console.log('[Block14] ML Overlay Service loaded');
