/**
 * BLOCK 77.2 — Proposal Types
 * 
 * Policy proposal types for Adaptive Weight Learning.
 * All changes go through DRY_RUN → PROPOSE → APPLY via Governance.
 */

// ═══════════════════════════════════════════════════════════════
// PROPOSAL STATUS
// ═══════════════════════════════════════════════════════════════

export type ProposalStatus = 'DRY_RUN' | 'PROPOSED' | 'REJECTED' | 'APPLIED' | 'EXPIRED';

export type ProposalVerdict = 'TUNE' | 'HOLD' | 'ROLLBACK';

export type ProposalRisk = 'LOW' | 'MED' | 'HIGH';

// ═══════════════════════════════════════════════════════════════
// POLICY DELTA (SINGLE CHANGE)
// ═══════════════════════════════════════════════════════════════

export interface PolicyDelta {
  path: string;           // e.g., "tierWeights.TIMING"
  from: number;
  to: number;
  reason: string;
  evidence: string[];     // references to metrics/rules
  confidence: number;     // 0-1 confidence of proposal
  category: 'TIER_WEIGHT' | 'DIVERGENCE_PENALTY' | 'PHASE_MULTIPLIER' | 'THRESHOLD';
}

// ═══════════════════════════════════════════════════════════════
// EXPECTED IMPACT
// ═══════════════════════════════════════════════════════════════

export interface ExpectedImpact {
  sharpeDelta: number;
  maxDDDelta: number;
  hitRateDelta: number;
  expectancyDelta: number;
  tradesChange: number;   // % change in trade count
}

// ═══════════════════════════════════════════════════════════════
// GUARDRAILS RESULT
// ═══════════════════════════════════════════════════════════════

export interface GuardrailsResult {
  eligible: boolean;
  reasons: string[];
  checks: {
    minSamples: { pass: boolean; value: number; required: number };
    crisisShare: { pass: boolean; value: number; max: number };
    calibrationError: { pass: boolean; value: number; max: number };
    equityDrift: { pass: boolean; value: number; min: number };
    maxDrift: { pass: boolean; value: number; max: number };
  };
}

// ═══════════════════════════════════════════════════════════════
// SIMULATION RESULT
// ═══════════════════════════════════════════════════════════════

export interface SimulationResult {
  method: 'FORWARD_REPLAY' | 'MONTE_CARLO' | 'BOOTSTRAP';
  passed: boolean;
  notes: string[];
  metrics: {
    baseSharpe: number;
    candidateSharpe: number;
    baseMaxDD: number;
    candidateMaxDD: number;
    baseHitRate: number;
    candidateHitRate: number;
    baseTrades: number;
    candidateTrades: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// POLICY PROPOSAL (MAIN OUTPUT)
// ═══════════════════════════════════════════════════════════════

export interface PolicyProposal {
  id: string;
  asof: string;
  symbol: string;
  windowDays: number;
  status: ProposalStatus;
  
  // Summary
  headline: {
    verdict: ProposalVerdict;
    risk: ProposalRisk;
    expectedImpact: ExpectedImpact;
    summary: string;
  };
  
  // Changes
  deltas: PolicyDelta[];
  
  // Validation
  guardrails: GuardrailsResult;
  simulation: SimulationResult;
  
  // Current policy snapshot (for rollback)
  currentPolicy: {
    tierWeights: Record<string, number>;
    divergencePenalties: Record<string, number>;
    phaseMultipliers: Record<string, number>;
    thresholds: Record<string, number>;
  };
  
  // Proposed policy
  proposedPolicy: {
    tierWeights: Record<string, number>;
    divergencePenalties: Record<string, number>;
    phaseMultipliers: Record<string, number>;
    thresholds: Record<string, number>;
  };
  
  // Audit
  audit: {
    createdBy: string;
    createdAt: string;
    proposedBy?: string;
    proposedAt?: string;
    appliedBy?: string;
    appliedAt?: string;
    rejectedBy?: string;
    rejectedAt?: string;
    rejectionReason?: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// PROPOSAL INPUT
// ═══════════════════════════════════════════════════════════════

export interface ProposalInput {
  symbol: string;
  windowDays: number;
  preset?: string;
  role?: string;
}

// ═══════════════════════════════════════════════════════════════
// PROPOSAL CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const PROPOSAL_LIMITS = {
  // Max weight change per proposal
  maxTierWeightDelta: 0.10,       // 10pp max
  maxDivergencePenaltyDelta: 0.10, // 10pp max
  maxPhaseMultiplierDelta: 0.10,   // 0.10 max
  maxThresholdDelta: 0.05,         // 5pp max
  
  // Weight bounds
  minStructureWeight: 0.40,        // Structure >= 40%
  maxTimingWeight: 0.30,           // Timing <= 30%
  
  // Phase multiplier bounds
  minPhaseMultiplier: 0.50,
  maxPhaseMultiplier: 1.20,
  
  // Simulation thresholds
  minSharpeDegrade: -0.05,
  maxDDIncrease: 0.005,            // 0.5pp
  minHitRateDegrade: -0.02,        // 2pp
  minTradesRatio: 0.70,            // at least 70% of base trades
};
