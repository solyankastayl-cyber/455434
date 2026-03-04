/**
 * U1.3 - Signal Quality Types
 * 
 * Defines types for the Signal Quality Engine.
 * Quality is NOT confidence - it's a trust/reliability score.
 */

export type SignalQuality = 'HIGH' | 'MEDIUM' | 'LOW';

export type StabilityVerdict =
  | 'STABLE'
  | 'UNSTABLE'
  | 'INSUFFICIENT_DATA';

export type AttributionVerdict =
  | 'CORE_POSITIVE'
  | 'WEAK_POSITIVE'
  | 'NEUTRAL'
  | 'NEGATIVE'
  | 'UNSTABLE';

export type IndexerMode =
  | 'FULL'
  | 'STANDARD'
  | 'LIMITED'
  | 'DEGRADED';

export interface SignalQualityInput {
  stability: StabilityVerdict;
  attribution: AttributionVerdict;
  indexerMode: IndexerMode;
  driverAgreementScore: number; // 0..1
}

export interface SignalQualityResult {
  quality: SignalQuality;
  reasons: string[];
  factors: {
    stability: StabilityVerdict;
    attribution: AttributionVerdict;
    indexerMode: IndexerMode;
    driverAgreement: number;
  };
}
