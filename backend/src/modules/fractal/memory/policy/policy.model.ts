/**
 * BLOCK 75.4 — Policy Model
 * 
 * Stores policy proposals and revisions for adaptive weight adjustment.
 * Governance layer: changes proposed but only applied manually.
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { TierType } from '../snapshot/prediction-snapshot.model.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type PolicyStatus = 'PROPOSED' | 'APPROVED' | 'APPLIED' | 'REJECTED';

export interface TierWeightConfig {
  TIMING: number;
  TACTICAL: number;
  STRUCTURE: number;
}

export interface HorizonWeightConfig {
  '7d': number;
  '14d': number;
  '30d': number;
  '90d': number;
  '180d': number;
  '365d': number;
}

export interface RegimeMultiplierConfig {
  CRISIS: { structureBoost: number; timingPenalty: number };
  HIGH: { structureBoost: number; timingPenalty: number };
  NORMAL: { structureBoost: number; timingPenalty: number };
  LOW: { structureBoost: number; timingPenalty: number };
}

export interface DivergencePenaltyConfig {
  A: number;
  B: number;
  C: number;
  D: number;
  F: number;
}

export interface PhaseGradeMultiplierConfig {
  A: number;
  B: number;
  C: number;
  D: number;
  F: number;
}

export interface PolicyConfig {
  tierWeights: TierWeightConfig;
  horizonWeights: HorizonWeightConfig;
  regimeMultipliers: RegimeMultiplierConfig;
  divergencePenalties: DivergencePenaltyConfig;
  phaseGradeMultipliers: PhaseGradeMultiplierConfig;
}

export interface PolicyDiff {
  field: string;
  oldValue: number;
  newValue: number;
  changePercent: number;
  reason: string;
}

export interface PolicyProposalDocument extends Document {
  symbol: 'BTC';
  version: string;           // e.g., "v2.1.1"
  status: PolicyStatus;
  
  // Evidence window
  windowRange: {
    from: string;
    to: string;
    resolvedCount: number;
    regimesCovered: string[];
  };
  
  // Current vs Proposed
  currentConfig: PolicyConfig;
  proposedConfig: PolicyConfig;
  
  // Diffs
  diffs: PolicyDiff[];
  
  // Guardrails
  guardrailsPass: boolean;
  guardrailViolations: string[];
  
  // Attribution evidence
  evidenceSummary: {
    tierAccuracy: Record<TierType, number>;
    dominantTier: TierType;
    topInsights: string[];
  };
  
  // Audit
  proposedAt: Date;
  proposedBy: string;
  appliedAt?: Date;
  appliedBy?: string;
  rejectedAt?: Date;
  rejectedBy?: string;
  rejectionReason?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════

const PolicyConfigSchema = new Schema({
  tierWeights: {
    TIMING: { type: Number, required: true },
    TACTICAL: { type: Number, required: true },
    STRUCTURE: { type: Number, required: true }
  },
  horizonWeights: {
    '7d': { type: Number, required: true },
    '14d': { type: Number, required: true },
    '30d': { type: Number, required: true },
    '90d': { type: Number, required: true },
    '180d': { type: Number, required: true },
    '365d': { type: Number, required: true }
  },
  regimeMultipliers: {
    CRISIS: { structureBoost: Number, timingPenalty: Number },
    HIGH: { structureBoost: Number, timingPenalty: Number },
    NORMAL: { structureBoost: Number, timingPenalty: Number },
    LOW: { structureBoost: Number, timingPenalty: Number }
  },
  divergencePenalties: {
    A: { type: Number, default: 0 },
    B: { type: Number, default: 0.02 },
    C: { type: Number, default: 0.05 },
    D: { type: Number, default: 0.10 },
    F: { type: Number, default: 0.20 }
  },
  phaseGradeMultipliers: {
    A: { type: Number, default: 1.2 },
    B: { type: Number, default: 1.1 },
    C: { type: Number, default: 1.0 },
    D: { type: Number, default: 0.9 },
    F: { type: Number, default: 0.7 }
  }
}, { _id: false });

const PolicyDiffSchema = new Schema({
  field: { type: String, required: true },
  oldValue: { type: Number, required: true },
  newValue: { type: Number, required: true },
  changePercent: { type: Number, required: true },
  reason: { type: String, required: true }
}, { _id: false });

const PolicyProposalSchema = new Schema<PolicyProposalDocument>(
  {
    symbol: { type: String, enum: ['BTC'], required: true },
    version: { type: String, required: true },
    status: { 
      type: String, 
      enum: ['PROPOSED', 'APPROVED', 'APPLIED', 'REJECTED'], 
      required: true 
    },
    
    windowRange: {
      from: { type: String, required: true },
      to: { type: String, required: true },
      resolvedCount: { type: Number, required: true },
      regimesCovered: [{ type: String }]
    },
    
    currentConfig: { type: PolicyConfigSchema, required: true },
    proposedConfig: { type: PolicyConfigSchema, required: true },
    
    diffs: [PolicyDiffSchema],
    
    guardrailsPass: { type: Boolean, required: true },
    guardrailViolations: [{ type: String }],
    
    evidenceSummary: {
      tierAccuracy: { type: Schema.Types.Mixed },
      dominantTier: { type: String },
      topInsights: [{ type: String }]
    },
    
    proposedAt: { type: Date, required: true },
    proposedBy: { type: String, required: true },
    appliedAt: { type: Date },
    appliedBy: { type: String },
    rejectedAt: { type: Date },
    rejectedBy: { type: String },
    rejectionReason: { type: String }
  },
  { timestamps: true }
);

PolicyProposalSchema.index({ symbol: 1, status: 1 });
PolicyProposalSchema.index({ symbol: 1, version: 1 }, { unique: true });
PolicyProposalSchema.index({ proposedAt: -1 });

export const PolicyProposalModel = 
  mongoose.models.FractalPolicyProposal ||
  mongoose.model<PolicyProposalDocument>('FractalPolicyProposal', PolicyProposalSchema);
