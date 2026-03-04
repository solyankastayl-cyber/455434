/**
 * BLOCK 79 — PolicyProposal Mongo Model
 * 
 * Stores proposals for policy changes with full lifecycle tracking.
 */

import mongoose from 'mongoose';

const PolicyProposalSchema = new mongoose.Schema(
  {
    proposalId: { type: String, unique: true, required: true, index: true },
    status: { 
      type: String, 
      required: true, 
      enum: ['DRAFT', 'PROPOSED', 'APPLIED', 'REJECTED'],
      default: 'DRAFT'
    },
    verdict: { 
      type: String, 
      required: true, 
      enum: ['HOLD', 'TUNE', 'ROLLBACK'] 
    },
    source: { 
      type: String, 
      required: true, 
      enum: ['LIVE', 'V2020', 'V2014'] 
    },
    
    scope: {
      symbol: { type: String, default: 'BTC' },
      preset: { type: String, default: 'balanced' },
      role: { type: String, default: 'ACTIVE' },
      focus: { type: String, default: '30d' },
    },
    
    learningVectorSnapshot: { type: Object },
    
    deltas: {
      tierWeights: { type: Object },
      divergencePenalties: { type: Object },
      phaseMultipliers: { type: Object },
      thresholds: { type: Object },
    },
    
    simulation: {
      sharpeDelta: { type: Number, default: 0 },
      hitRateDelta: { type: Number, default: 0 },
      maxDdDelta: { type: Number, default: 0 },
      equityDelta: { type: Number, default: 0 },
      passed: { type: Boolean, default: false },
      notes: [{ type: String }],
    },
    
    guardrails: {
      liveSamplesOk: { type: Boolean, default: false },
      driftOk: { type: Boolean, default: true },
      crisisShareOk: { type: Boolean, default: true },
      calibrationOk: { type: Boolean, default: true },
      eligible: { type: Boolean, default: false },
      reasons: [{ type: String }],
    },
    
    createdBy: { type: String, default: 'SYSTEM' },
    
    appliedAt: { type: Date },
    previousPolicyHash: { type: String },
    appliedPolicyHash: { type: String },
    
    rejectedAt: { type: Date },
    rejectedBy: { type: String },
    rejectedReason: { type: String },
  },
  { 
    timestamps: true,
    collection: 'policy_proposals'
  }
);

// Indexes for efficient queries
PolicyProposalSchema.index({ createdAt: -1 });
PolicyProposalSchema.index({ status: 1, createdAt: -1 });
PolicyProposalSchema.index({ 'scope.symbol': 1, 'scope.preset': 1, status: 1 });
PolicyProposalSchema.index({ source: 1, status: 1 });

export const PolicyProposalModel = mongoose.model('PolicyProposal', PolicyProposalSchema);

export default PolicyProposalModel;
