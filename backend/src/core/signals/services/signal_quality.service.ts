/**
 * U1.3 - Signal Quality Service
 * 
 * Evaluates signal reliability based on:
 * - Training stability (P1.1)
 * - Group attribution consensus (P1.2)
 * - Indexer state (D1-D4)
 * - Driver agreement (A-F alignment)
 * 
 * This is NOT confidence - it's a TRUST score.
 */
import type {
  SignalQuality,
  SignalQualityInput,
  SignalQualityResult,
  StabilityVerdict,
  AttributionVerdict,
  IndexerMode,
} from '../types/signal_quality.types.js';

export class SignalQualityService {
  /**
   * Evaluate signal quality from multiple factors
   */
  static evaluate(input: SignalQualityInput): SignalQualityResult {
    const {
      stability,
      attribution,
      indexerMode,
      driverAgreementScore,
    } = input;

    const reasons: string[] = [];

    // ❌ Hard stops → LOW
    if (stability === 'UNSTABLE') {
      reasons.push('Training unstable');
      return this.result('LOW', reasons, input);
    }

    if (attribution === 'NEGATIVE') {
      reasons.push('Core features negative impact');
      return this.result('LOW', reasons, input);
    }

    if (attribution === 'UNSTABLE') {
      reasons.push('Attribution unstable');
      return this.result('LOW', reasons, input);
    }

    if (indexerMode === 'DEGRADED') {
      reasons.push('Indexer degraded');
      return this.result('LOW', reasons, input);
    }

    // ⚠️ Limited data → MEDIUM cap
    if (indexerMode === 'LIMITED') {
      reasons.push('Limited data mode');
    }

    if (stability === 'INSUFFICIENT_DATA') {
      reasons.push('Insufficient stability data');
    }

    // Check if capped at MEDIUM
    const cappedAtMedium = 
      indexerMode === 'LIMITED' || 
      stability === 'INSUFFICIENT_DATA';

    // 🟡 Mixed signals → MEDIUM
    if (attribution === 'WEAK_POSITIVE' || attribution === 'NEUTRAL') {
      reasons.push('Weak attribution signal');
    }

    if (driverAgreementScore < 0.6) {
      reasons.push('Drivers conflicting');
    }

    const hasMixedSignals = 
      attribution === 'WEAK_POSITIVE' ||
      attribution === 'NEUTRAL' ||
      driverAgreementScore < 0.6;

    if (cappedAtMedium || hasMixedSignals) {
      return this.result('MEDIUM', reasons, input);
    }

    // ✅ High quality conditions
    const isHighQuality =
      stability === 'STABLE' &&
      (attribution === 'CORE_POSITIVE' || attribution === 'WEAK_POSITIVE') &&
      driverAgreementScore >= 0.7 &&
      (indexerMode === 'FULL' || indexerMode === 'STANDARD');

    if (isHighQuality) {
      reasons.push('All quality factors positive');
      return this.result('HIGH', reasons, input);
    }

    // Default fallback
    reasons.push('Mixed quality factors');
    return this.result('MEDIUM', reasons, input);
  }

  /**
   * Quick evaluate - returns just the quality
   */
  static evaluateQuick(input: SignalQualityInput): SignalQuality {
    return this.evaluate(input).quality;
  }

  /**
   * Get quality from separate inputs (convenience method)
   */
  static fromFactors(
    stability: StabilityVerdict,
    attribution: AttributionVerdict,
    indexerMode: IndexerMode,
    driverAgreement: number
  ): SignalQuality {
    return this.evaluateQuick({
      stability,
      attribution,
      indexerMode,
      driverAgreementScore: driverAgreement,
    });
  }

  /**
   * Build result object
   */
  private static result(
    quality: SignalQuality,
    reasons: string[],
    input: SignalQualityInput
  ): SignalQualityResult {
    return {
      quality,
      reasons: reasons.length > 0 ? reasons : ['Default assessment'],
      factors: {
        stability: input.stability,
        attribution: input.attribution,
        indexerMode: input.indexerMode,
        driverAgreement: input.driverAgreementScore,
      },
    };
  }
}

export default SignalQualityService;
