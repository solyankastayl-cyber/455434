/**
 * ETAP 7.1 — Confidence Types
 * 
 * Type definitions for Signal Confidence calculation.
 * NO ML. Pure rules-based.
 */

export type ConfidenceLabel = 'HIGH' | 'MEDIUM' | 'LOW' | 'HIDDEN';

export interface ConfidenceBreakdown {
  coverage: number;     // 0-100
  actors: number;       // 0-100
  flow: number;         // 0-100
  temporal: number;     // 0-100
  evidence: number;     // 0-100
}

export interface ConfidenceResult {
  score: number;                    // 0-100
  label: ConfidenceLabel;
  breakdown: ConfidenceBreakdown;
  reasons: string[];                // Max 6, facts only
}

// Weights for confidence formula (FIXED)
export const CONFIDENCE_WEIGHTS = {
  coverage: 0.30,
  actors: 0.25,
  flow: 0.20,
  temporal: 0.15,
  evidence: 0.10,
} as const;

// Label thresholds
export const CONFIDENCE_THRESHOLDS = {
  HIGH: 80,       // >= 80
  MEDIUM: 60,     // 60-79
  LOW: 40,        // 40-59
  // < 40 = HIDDEN
} as const;

// Actor structural weight info (P0.1)
export interface ActorWeightInfo {
  actorId: string;
  actorType: string;                  // exchange, market_maker, fund, whale, trader
  sourceLevel: string;                // verified, attributed, behavioral
  isExchangeOrMM: boolean;            // Exchange or Market Maker
  flowSharePct: number;               // 0-1 share of total flow
  connectivityDegree: number;         // Number of counterparties (normalized 0-1)
  historicalActivity: number;         // 0-1 based on tx count history
  weight: number;                     // Calculated weight 0-1
}

// Input for confidence calculation
export interface ConfidenceInput {
  // From signal
  signalType: string;
  severity: string;
  window: string;
  primaryActorId: string;
  secondaryActorId?: string;
  entityIds: string[];
  
  // From signal.evidence
  evidenceMetrics: Record<string, unknown>;
  
  // From snapshot
  snapshotCoverage: number;          // 0-100 (already percentage)
  actorSources: Array<'verified' | 'attributed' | 'behavioral'>;
  actorCoverages: number[];          // 0-100
  
  // P0.1: Actor weights (structural)
  actorWeights?: ActorWeightInfo[];  // Detailed actor weight info
  
  // From signal metrics
  netFlowUsd?: number;
  inflowUsd?: number;
  outflowUsd?: number;
  density?: number;
  
  // Cross-window info
  has7dSupport?: boolean;            // Signal pattern also exists in 7d
}
