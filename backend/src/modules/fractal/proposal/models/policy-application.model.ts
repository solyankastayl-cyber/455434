/**
 * BLOCK 79 — PolicyApplication Mongo Model (Audit Trail)
 * 
 * Immutable audit log of all policy changes.
 * Supports rollback tracking.
 */

import mongoose from 'mongoose';

const PolicyApplicationSchema = new mongoose.Schema(
  {
    applicationId: { type: String, unique: true, required: true, index: true },
    proposalId: { type: String, required: true, index: true },
    
    appliedAt: { type: Date, required: true },
    appliedBy: { type: String, required: true },
    
    previousPolicyHash: { type: String, required: true },
    newPolicyHash: { type: String, required: true },
    
    reason: { type: String, default: '' },
    
    // For rollback tracking
    rollbackOf: { type: String, index: true },
    
    // Snapshot of deltas applied
    deltasApplied: { type: Object },
    
    // Metadata
    scope: {
      symbol: { type: String },
      preset: { type: String },
      role: { type: String },
    },
  },
  { 
    timestamps: true,
    collection: 'policy_applications'
  }
);

// Indexes
PolicyApplicationSchema.index({ appliedAt: -1 });
PolicyApplicationSchema.index({ proposalId: 1, appliedAt: -1 });

export const PolicyApplicationModel = mongoose.model('PolicyApplication', PolicyApplicationSchema);

export default PolicyApplicationModel;
