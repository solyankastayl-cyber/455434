/**
 * Attribution Claims Model (Phase 15.5)
 * 
 * Source of Truth layer for Actor/Entity ↔ Address linkage
 * Answers:
 * 1. Which addresses belong to Actor/Entity?
 * 2. Why does the system think so? (evidence/reason)
 * 3. How confident is this? (confidence + status)
 */
import mongoose, { Schema, Document } from 'mongoose';

// Generate UUID-like ID
function generateId(): string {
  return 'claim_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// Claim status hierarchy
export type ClaimStatus = 'reference' | 'suspected' | 'confirmed' | 'rejected';
export type ClaimSource = 'manual' | 'import' | 'heuristic' | 'external';
export type SubjectType = 'actor' | 'entity';
export type SupportedChain = 'ethereum' | 'arbitrum' | 'base' | 'bsc' | 'solana' | 'polygon';

// Evidence types
export interface IEvidence {
  type: 'note' | 'url' | 'tx' | 'cluster' | 'pattern';
  value: string;
  weight?: number; // 0..1
  addedAt: Date;
}

// Main claim interface
export interface IAttributionClaim {
  _id: string;
  subjectType: SubjectType;
  subjectId: string; // actorId or entityId
  chain: SupportedChain;
  address: string; // lowercase
  status: ClaimStatus;
  confidence: number; // 0..1
  source: ClaimSource;
  reason: string; // human-readable
  evidence: IEvidence[];
  createdBy: string; // 'system' | userId | 'admin'
  createdAt: Date;
  updatedAt: Date;
}

// Status weight for sorting (higher = stronger claim)
export const STATUS_WEIGHTS: Record<ClaimStatus, number> = {
  'confirmed': 1.0,
  'suspected': 0.6,
  'reference': 0.5,
  'rejected': 0.0,
};

const EvidenceSchema = new Schema<IEvidence>({
  type: { 
    type: String, 
    enum: ['note', 'url', 'tx', 'cluster', 'pattern'],
    required: true 
  },
  value: { type: String, required: true },
  weight: { type: Number, min: 0, max: 1, default: 0.5 },
  addedAt: { type: Date, default: Date.now },
}, { _id: false });

const AttributionClaimSchema = new Schema<IAttributionClaim>({
  _id: { type: String, default: () => generateId() },
  subjectType: { 
    type: String, 
    enum: ['actor', 'entity'],
    required: true,
    index: true
  },
  subjectId: { type: String, required: true, index: true },
  chain: { 
    type: String, 
    enum: ['ethereum', 'arbitrum', 'base', 'bsc', 'solana', 'polygon'],
    default: 'ethereum',
    index: true
  },
  address: { 
    type: String, 
    required: true, 
    lowercase: true,
    index: true
  },
  status: { 
    type: String, 
    enum: ['reference', 'suspected', 'confirmed', 'rejected'],
    default: 'reference',
    index: true
  },
  confidence: { 
    type: Number, 
    min: 0, 
    max: 1, 
    default: 0.5,
    required: true
  },
  source: { 
    type: String, 
    enum: ['manual', 'import', 'heuristic', 'external'],
    default: 'manual'
  },
  reason: { type: String, required: true },
  evidence: [EvidenceSchema],
  createdBy: { type: String, default: 'system' },
}, { 
  timestamps: true,
  collection: 'attribution_claims'
});

// Unique compound index: one claim per subject+chain+address
AttributionClaimSchema.index(
  { subjectType: 1, subjectId: 1, chain: 1, address: 1 }, 
  { unique: true }
);

// Query index for reverse lookup
AttributionClaimSchema.index({ chain: 1, address: 1 });

// Query index for subject claims
AttributionClaimSchema.index({ subjectType: 1, subjectId: 1, status: 1 });

export const AttributionClaimModel = mongoose.model<IAttributionClaim>(
  'AttributionClaim', 
  AttributionClaimSchema
);
