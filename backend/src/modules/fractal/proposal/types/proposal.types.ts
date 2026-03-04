/**
 * BLOCK 79 — Proposal Types
 * 
 * Types for proposal lifecycle: DRAFT → PROPOSED → APPLIED/REJECTED
 */

export type ProposalStatus = 'DRAFT' | 'PROPOSED' | 'APPLIED' | 'REJECTED';

export type ProposalVerdict = 'HOLD' | 'TUNE' | 'ROLLBACK';

export type CohortSource = 'LIVE' | 'V2020' | 'V2014';

export interface ProposalScope {
  symbol: string;
  preset: string;
  role: string;
  focus: string;
}

export interface ProposalDeltas {
  tierWeights?: Record<string, number>;
  divergencePenalties?: Record<string, number>;
  phaseMultipliers?: Record<string, number>;
  thresholds?: Record<string, number>;
}

export interface ProposalSimulation {
  sharpeDelta: number;
  hitRateDelta: number;
  maxDdDelta: number;
  equityDelta: number;
  passed: boolean;
  notes: string[];
}

export interface ProposalGuardrails {
  liveSamplesOk: boolean;
  driftOk: boolean;
  crisisShareOk: boolean;
  calibrationOk: boolean;
  eligible: boolean;
  reasons: string[];
}

export interface PolicyProposal {
  proposalId: string;
  status: ProposalStatus;
  verdict: ProposalVerdict;
  source: CohortSource;
  scope: ProposalScope;
  
  learningVectorSnapshot: any;
  deltas: ProposalDeltas;
  simulation: ProposalSimulation;
  guardrails: ProposalGuardrails;
  
  createdAt: Date;
  createdBy: string;
  
  appliedAt?: Date;
  previousPolicyHash?: string;
  appliedPolicyHash?: string;
  rejectedAt?: Date;
  rejectedBy?: string;
  rejectedReason?: string;
}

export interface PolicyApplication {
  applicationId: string;
  proposalId: string;
  appliedAt: Date;
  appliedBy: string;
  previousPolicyHash: string;
  newPolicyHash: string;
  reason: string;
  rollbackOf?: string;
}

export interface ApplyResult {
  applicationId: string;
  previousHash: string;
  newHash: string;
  proposal: PolicyProposal;
}

export interface RollbackResult {
  applicationId: string;
  rollbackOf: string;
  previousHash: string;
  restoredHash: string;
}
