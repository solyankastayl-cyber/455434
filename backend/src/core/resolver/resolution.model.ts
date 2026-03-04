/**
 * Universal Resolver Model (Phase 15.5.2 - Maturity Update)
 * 
 * Input → Type → Normalized ID + Context
 */
import mongoose, { Schema, Document } from 'mongoose';

export type ResolvedType = 'actor' | 'token' | 'entity' | 'tx' | 'signal' | 'ens' | 'unknown';

// Resolution lifecycle status (NOT outcome)
export type ResolutionStatus = 
  | 'pending'            // Waiting to start analysis
  | 'analyzing'          // Analysis in progress
  | 'completed'          // ✅ TERMINAL - analysis finished
  | 'failed';            // ❌ TERMINAL - analysis failed

// Note: 'insufficient_data' is an OUTCOME, not a lifecycle state.
// Use resolution.reason or resolution.available to express data quality.

export type SuggestionType = 
  | 'scan_address' 
  | 'view_as_raw_wallet' 
  | 'wait_for_indexing'
  | 'connect_ens_provider'
  | 'check_token_contract'
  | 'view_on_etherscan';

export interface IResolution extends Document {
  input: string;                    // Original input
  type: ResolvedType;               // Resolved type
  subtype?: string;                 // Subtype: exchange, fund, protocol, whale, etc
  normalizedId: string;             // Canonical identifier
  resolvedAddress?: string;         // P2.2: Actual address (for ENS inputs)
  chain: string;                    // ethereum, polygon, etc
  
  // Confidence & Reasoning
  confidence: number;               // 0-1
  reason: string;                   // Human-readable explanation
  suggestions: SuggestionType[];    // Actionable next steps
  
  // Resolution status
  status: ResolutionStatus;
  
  // Available data
  available: {
    profile: boolean;
    market: boolean;
    signals: boolean;
    trust: boolean;
    reputation: boolean;
    transfers: boolean;
    relations: boolean;
  };
  
  // Metadata
  label?: string;                   // Human readable name
  verified?: boolean;
  
  // ENS metadata (P2.2)
  ens?: {
    name: string;
    confidence: number;
    source?: 'forward' | 'reverse';
  };
  
  // Bootstrap tracking
  bootstrapQueued?: boolean;
  bootstrapQueuedAt?: Date;
  
  // Cache info
  resolvedAt: Date;
  expiresAt: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

const ResolutionSchema = new Schema<IResolution>(
  {
    input: {
      type: String,
      required: true,
      index: true,
    },
    
    type: {
      type: String,
      enum: ['actor', 'token', 'entity', 'tx', 'signal', 'ens', 'unknown'],
      required: true,
      index: true,
    },
    
    subtype: {
      type: String,
      enum: ['exchange', 'fund', 'protocol', 'whale', 'trader', 'market_maker', 'contract', 'eoa', null],
    },
    
    normalizedId: {
      type: String,
      required: true,
      index: true,
    },
    
    resolvedAddress: {
      type: String,
      index: true,
    },
    
    chain: {
      type: String,
      default: 'ethereum',
    },
    
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    
    reason: {
      type: String,
      required: true,
    },
    
    suggestions: [{
      type: String,
      enum: ['scan_address', 'view_as_raw_wallet', 'wait_for_indexing', 'connect_ens_provider', 'check_token_contract', 'view_on_etherscan'],
    }],
    
    status: {
      type: String,
      enum: ['pending', 'analyzing', 'completed', 'failed'],
      default: 'pending',
    },
    
    available: {
      profile: { type: Boolean, default: false },
      market: { type: Boolean, default: false },
      signals: { type: Boolean, default: false },
      trust: { type: Boolean, default: false },
      reputation: { type: Boolean, default: false },
      transfers: { type: Boolean, default: false },
      relations: { type: Boolean, default: false },
    },
    
    label: String,
    verified: Boolean,
    
    // ENS metadata (P2.2)
    ens: {
      name: String,
      confidence: Number,
      source: {
        type: String,
        enum: ['forward', 'reverse'],
      },
    },
    
    bootstrapQueued: { type: Boolean, default: false },
    bootstrapQueuedAt: Date,
    
    resolvedAt: {
      type: Date,
      required: true,
    },
    
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'resolutions',
  }
);

// Compound index for cache lookup
ResolutionSchema.index({ input: 1, expiresAt: 1 });
ResolutionSchema.index({ status: 1, bootstrapQueued: 1 });

export const ResolutionModel = mongoose.model<IResolution>(
  'Resolution',
  ResolutionSchema
);

/**
 * Resolution cache TTL (1 hour for resolved, 5 min for pending)
 */
export const RESOLUTION_CACHE_TTL = 60 * 60 * 1000;
export const RESOLUTION_PENDING_TTL = 5 * 60 * 1000;
