/**
 * Negative Sample Types
 * 
 * EPIC 8: Negative Sample Pipeline
 * Types for teaching ML when signals DON'T work
 */

// 4 negative types
export type NegativeType = 
  | 'STRUCTURAL'   // Pattern exists, no price reaction
  | 'NOISE'        // Flow spike with no continuation
  | 'EXHAUSTION'   // Late entry after run-up
  | 'REVERSAL';    // Accumulation then distribution

export type LabelReason = 
  | 'pattern_without_price_reaction'
  | 'isolated_flow_noise'
  | 'late_signal_exhaustion'
  | 'distribution_after_signal'
  | 'confirmed_positive'
  | 'insufficient_data';

export interface NegativeSample {
  sampleId: string;
  tokenAddress: string;
  signalId?: string;
  
  // Label
  label: 0 | 1;
  labelReason: LabelReason;
  negativeType?: NegativeType;
  
  // Price metrics
  priceMetrics: {
    futureReturn24h: number;
    futureReturn7d: number;
    pastReturn7d: number;
    maxAdverseExcursion: number;  // MAE
    maxFavorableExcursion: number; // MFE
  };
  
  // Temporal context (from EPIC 7)
  temporalContext: {
    deltaNetFlow24h: number;
    deltaNetFlow3d: number;
    deltaNetFlow7d: number;
    slope7d: number;
    acceleration7d: number;
    consistency: number;
    regime: string;
  };
  
  // Signal context
  signalContext: {
    signalType: string;
    signalStrength: number;
    hasSmartMoney: boolean;
    hasAccumulation: boolean;
  };
  
  // Metadata
  horizon: '7d' | '14d';
  signalTimestamp: Date;
  createdAt: Date;
  runId: string;
  gateVersion: string;
}

export interface NegativeRunConfig {
  horizon: '7d' | '14d';
  window: '7d' | '14d';
  maxCandidates: number;
  targetSamples: number;
  dryRun?: boolean;
}

export interface NegativeRunStats {
  runId: string;
  horizon: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  
  // Counts
  candidatesFound: number;
  samplesGenerated: number;
  positiveCount: number;
  negativeCount: number;
  insufficientCount: number;
  
  // By type
  byType: {
    STRUCTURAL: number;
    NOISE: number;
    EXHAUSTION: number;
    REVERSAL: number;
  };
  
  // Ratios
  negPosRatio: number;
  typeDistribution: Record<NegativeType, number>;
  
  // Issues
  limitedTypes: NegativeType[];
  reasons: string[];
}

export interface NegativeCandidate {
  tokenAddress: string;
  signalId?: string;
  signalTimestamp: Date;
  signalType: string;
  signalStrength: number;
  
  // Will be filled during processing
  priceData?: {
    priceAtSignal: number;
    price24h: number;
    price7d: number;
    maxPrice: number;
    minPrice: number;
  };
  
  temporalFeatures?: Record<string, number | string>;
}

// Quotas for balanced negative distribution
export interface TypeQuotas {
  STRUCTURAL: { min: number; max: number };
  NOISE: { min: number; max: number };
  EXHAUSTION: { min: number; max: number };
  REVERSAL: { min: number; max: number };
}

export const DEFAULT_QUOTAS: TypeQuotas = {
  STRUCTURAL: { min: 0.30, max: 0.40 },
  NOISE: { min: 0.20, max: 0.30 },
  EXHAUSTION: { min: 0.15, max: 0.25 },
  REVERSAL: { min: 0.15, max: 0.25 },
};

// Minimum negative:positive ratio
export const MIN_NEG_POS_RATIO = 3.0;
