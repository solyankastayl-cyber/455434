/**
 * Decision Gate - P1.1
 * 
 * Combines ablation verdict + stability verdict to make final decision
 */
import type { AblationVerdict } from '../models/ml_ablation_report.model.js';
import type { StabilityVerdict, FinalDecision } from '../types/training_stability.types.js';

export class DecisionGate {
  /**
   * Make final decision based on ablation + stability
   * 
   * ACCEPT: IMPROVES + STABLE → use in production
   * EXPERIMENT_ONLY: IMPROVES + UNSTABLE → needs more work
   * IGNORE: NEUTRAL → no value added
   * REJECT: DEGRADES → harmful
   * INCONCLUSIVE: not enough data
   */
  static decide(
    ablationVerdict: AblationVerdict,
    stabilityVerdict?: StabilityVerdict
  ): FinalDecision {
    // If no stability data, only use ablation
    if (!stabilityVerdict || stabilityVerdict === 'INCONCLUSIVE') {
      if (ablationVerdict === 'IMPROVES') return 'EXPERIMENT_ONLY';
      if (ablationVerdict === 'DEGRADES') return 'REJECT';
      if (ablationVerdict === 'NEUTRAL') return 'IGNORE';
      return 'INCONCLUSIVE';
    }

    // Combined decision with stability
    if (ablationVerdict === 'IMPROVES') {
      return stabilityVerdict === 'STABLE' ? 'ACCEPT' : 'EXPERIMENT_ONLY';
    }

    if (ablationVerdict === 'DEGRADES') {
      return 'REJECT';
    }

    if (ablationVerdict === 'NEUTRAL') {
      return 'IGNORE';
    }

    return 'INCONCLUSIVE';
  }

  /**
   * Get human-readable explanation
   */
  static explain(decision: FinalDecision): string {
    switch (decision) {
      case 'ACCEPT':
        return 'Feature improves performance AND is stable → Recommended for production';
      case 'EXPERIMENT_ONLY':
        return 'Feature improves performance BUT is unstable → Needs more work or larger dataset';
      case 'IGNORE':
        return 'Feature has neutral impact → No value added, can be ignored';
      case 'REJECT':
        return 'Feature degrades performance → Should NOT be used';
      case 'INCONCLUSIVE':
        return 'Not enough data to make decision → Need more runs or larger dataset';
    }
  }

  /**
   * Get priority score for ranking (higher = more important)
   */
  static priority(decision: FinalDecision): number {
    switch (decision) {
      case 'ACCEPT': return 100;
      case 'EXPERIMENT_ONLY': return 50;
      case 'REJECT': return -100;
      case 'IGNORE': return 0;
      case 'INCONCLUSIVE': return -50;
    }
  }
}

export default DecisionGate;
