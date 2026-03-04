/**
 * Entity Address Model
 * 
 * Связь между entity и конкретными адресами
 * 
 * Confidence Levels (EPIC 1):
 * - verified: Etherscan labels, public disclosures, ENS
 * - attributed: Correlation-based (≥X tx with verified, volume overlap)
 * - weak: Low correlation, NOT used in aggregates
 */
import mongoose, { Schema, Document } from 'mongoose';

export type AddressRole = 
  | 'hot'       // Hot wallet
  | 'cold'      // Cold storage
  | 'deposit'   // Deposit contract
  | 'treasury'  // Treasury
  | 'contract'  // Smart contract
  | 'unknown';  // Не определено

export type AddressConfidence = 
  | 'verified'   // Source of truth: Etherscan, public disclosure, ENS
  | 'attributed' // Safe expansion: correlation-based
  | 'weak';      // Exploration only, NOT in aggregates

export type AddressSource =
  | 'etherscan_label'    // From Etherscan tags
  | 'public_disclosure'  // Official blog, docs, GitHub
  | 'ens'                // ENS domain
  | 'correlation'        // Derived from tx correlation
  | 'manual'             // Manually added
  | 'unknown';

export interface IEntityAddress extends Document {
  entityId: string;          // Reference to Entity
  chain: string;             // 'ethereum', 'polygon', etc.
  address: string;           // Wallet/contract address (lowercase)
  
  role: AddressRole;         // Address role
  
  // EPIC 1: Attribution Confidence
  confidence: AddressConfidence;  // verified | attributed | weak
  source: AddressSource;          // Where this attribution came from
  sourceUrl?: string;             // Link to proof (Etherscan, blog post, etc.)
  
  // Correlation metrics (for attributed/weak)
  correlationScore?: number;      // 0-100, how strongly correlated
  correlationTxCount?: number;    // Number of tx with verified addresses
  correlationVolumeOverlap?: number; // % volume overlap
  
  // Activity
  firstSeen: Date;
  lastSeen: Date;
  lastTxHash?: string;       // Last transaction hash
  
  // Legacy (kept for backward compatibility)
  labelConfidence: number;   // 0-100, internal use only
  
  // Metadata
  tags?: string[];           // ['verified', 'high_volume', etc.]
  notes?: string;            // Admin notes
  
  createdAt: Date;
  updatedAt: Date;
}

const EntityAddressSchema = new Schema<IEntityAddress>(
  {
    entityId: { type: String, required: true, index: true },
    chain: { type: String, required: true, index: true },
    address: { type: String, required: true, lowercase: true, index: true },
    
    role: { 
      type: String, 
      enum: ['hot', 'cold', 'deposit', 'treasury', 'contract', 'unknown'],
      default: 'unknown'
    },
    
    // EPIC 1: Attribution
    confidence: {
      type: String,
      enum: ['verified', 'attributed', 'weak'],
      default: 'weak',
      index: true,
    },
    source: {
      type: String,
      enum: ['etherscan_label', 'public_disclosure', 'ens', 'correlation', 'manual', 'unknown'],
      default: 'unknown',
    },
    sourceUrl: { type: String },
    
    // Correlation metrics
    correlationScore: { type: Number, min: 0, max: 100 },
    correlationTxCount: { type: Number },
    correlationVolumeOverlap: { type: Number },
    
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    lastTxHash: { type: String },
    
    labelConfidence: { type: Number, default: 50, min: 0, max: 100 },
    
    tags: [{ type: String }],
    notes: { type: String },
  },
  { 
    timestamps: true,
    collection: 'entity_addresses'
  }
);

// Compound index for unique address per entity per chain
EntityAddressSchema.index({ entityId: 1, chain: 1, address: 1 }, { unique: true });
EntityAddressSchema.index({ address: 1, chain: 1 });
EntityAddressSchema.index({ entityId: 1, confidence: 1 }); // For filtering by confidence

export const EntityAddressModel = mongoose.model<IEntityAddress>('EntityAddress', EntityAddressSchema);
