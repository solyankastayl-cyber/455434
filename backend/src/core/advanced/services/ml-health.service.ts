/**
 * Advanced ML Health Service
 * Aggregates readiness, shadow performance, safety
 */

import { SelfLearningConfigModel } from '../../self_learning/self_learning_config.model.js';
import type { AdvancedMLHealthDTO } from '../dto/ml-health.dto.js';

export class AdvancedMLHealthService {
  async getMLHealth(): Promise<AdvancedMLHealthDTO> {
    const config = await SelfLearningConfigModel.findOne({}).lean();

    const readiness = this.getReadiness(config);
    const shadowPerformance = this.getShadowPerformance(config);
    const safety = this.getSafety();
    const actions = this.getActions(readiness.status, config);

    return {
      readiness,
      shadowPerformance,
      safety,
      actions,
    };
  }

  private getReadiness(config: any) {
    const blockingReasons: string[] = [];

    // Check dataset samples (mock threshold)
    const MIN_SAMPLES = 1000;
    const samples = config?.datasetSamples || 0;
    if (samples < MIN_SAMPLES) {
      blockingReasons.push(`Insufficient samples (${samples} / ${MIN_SAMPLES})`);
    }

    // Check time span
    const MIN_DAYS = 7;
    const days = config?.datasetTimeSpanDays || 0;
    if (days < MIN_DAYS) {
      blockingReasons.push(`Low time span (${days} / ${MIN_DAYS} days)`);
    }

    const status = blockingReasons.length === 0 ? 'READY' : 'NOT_READY';

    return { status, blockingReasons };
  }

  private getShadowPerformance(config: any) {
    // Check if shadow evaluation exists
    const hasShadowEval = config?.shadowEvaluationExists;

    if (!hasShadowEval) {
      return { comparisonAvailable: false };
    }

    // Mock shadow metrics
    const precisionLift = 5.2; // ML precision - Rules precision
    const fpDelta = -2.1; // ML FP - Rules FP (negative is good)

    const FP_LIMIT = 5;
    let verdict: 'OUTPERFORMS' | 'DEGRADED' | 'INCONCLUSIVE';

    if (Math.abs(fpDelta) > FP_LIMIT) {
      verdict = 'DEGRADED';
    } else if (precisionLift > 0) {
      verdict = 'OUTPERFORMS';
    } else {
      verdict = 'INCONCLUSIVE';
    }

    return {
      comparisonAvailable: true,
      precisionLift,
      fpDelta,
      verdict,
    };
  }

  private getSafety() {
    // TODO: Check AuditLog for rollbacks
    return {
      killSwitch: 'ARMED' as const,
      lastRollbackReason: undefined,
      ruleOverrides: 0,
    };
  }

  private getActions(readinessStatus: string, config: any) {
    const mlMode = config?.selfLearningEnabled
      ? config?.activeModelPointers?.['7d']
        ? 'ACTIVE'
        : 'SHADOW'
      : 'RULES_ONLY';

    return {
      canRetrain: readinessStatus === 'READY',
      canRunShadowEval: (config?.datasetSamples || 0) > 0,
      canDisableML: mlMode !== 'RULES_ONLY',
    };
  }
}

export const advancedMLHealthService = new AdvancedMLHealthService();
