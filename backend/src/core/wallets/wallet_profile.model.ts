/**
 * Wallet Profile Mongoose Model (B1)
 * 
 * Persistence layer for wallet profiles
 */
import mongoose, { Schema, Document, Model } from 'mongoose';
import type { WalletProfile, ProfileUpdateEvent } from './wallet_profile.schema.js';

// ============================================
// Wallet Profile Model
// ============================================

export interface IWalletProfile extends WalletProfile, Document {}

const WalletProfileMongoSchema = new Schema<IWalletProfile>(
  {
    // Identity
    address: { 
      type: String, 
      required: true,
      index: true,
    },
    chain: { 
      type: String, 
      default: 'Ethereum',
    },
    
    // Profile metadata
    profileId: { 
      type: String, 
      required: true, 
      unique: true,
      index: true,
    },
    updatedAt: { type: Date, default: Date.now },
    snapshotVersion: { type: Number, default: 1 },
    
    // Activity metrics
    activity: {
      firstSeen: { type: Date, required: true },
      lastSeen: { type: Date, required: true },
      activeDays: { type: Number, default: 0 },
      txCount: { type: Number, default: 0 },
      avgTxPerDay: { type: Number },
    },
    
    // Flow metrics
    flows: {
      totalIn: { type: Number, default: 0 },
      totalOut: { type: Number, default: 0 },
      netFlow: { type: Number, default: 0 },
      avgTxSize: { type: Number, default: 0 },
      maxTxSize: { type: Number },
    },
    
    // Behavior metrics
    behavior: {
      dominantAction: { 
        type: String, 
        enum: ['buy', 'sell', 'bridge', 'lp', 'mixed'],
        default: 'mixed',
      },
      burstinessScore: { type: Number, default: 0.5 },
      holdingPeriodAvg: { type: Number },
      diversificationScore: { type: Number },
    },
    
    // Token interactions
    tokens: {
      interactedCount: { type: Number, default: 0 },
      topTokens: [{
        address: { type: String },
        symbol: { type: String },
        name: { type: String },
        buyVolume: { type: Number, default: 0 },
        sellVolume: { type: Number, default: 0 },
        netVolume: { type: Number, default: 0 },
        txCount: { type: Number, default: 0 },
        firstInteraction: { type: Date },
        lastInteraction: { type: Date },
      }],
    },
    
    // Tags
    tags: [{
      type: String,
      enum: [
        'active', 'dormant', 'new',
        'high-volume', 'low-volume', 'whale',
        'trader', 'holder', 'flipper', 'degen',
        'bridge-user', 'cex-like', 'contract', 'multisig',
      ],
    }],
    
    // Confidence
    confidence: { type: Number, default: 0.5 },
    
    // Summary
    summary: {
      headline: { type: String },
      description: { type: String },
    },
  },
  {
    timestamps: true,
    collection: 'wallet_profiles',
  }
);

// Compound index for chain + address lookup
WalletProfileMongoSchema.index(
  { chain: 1, address: 1 },
  { name: 'chain_address_lookup', unique: true }
);

// Index for tag-based queries
WalletProfileMongoSchema.index(
  { tags: 1 },
  { name: 'tags_lookup' }
);

// Index for finding profiles that need refresh
WalletProfileMongoSchema.index(
  { updatedAt: 1 },
  { name: 'refresh_lookup' }
);

// ============================================
// Profile Update Event Model (for tracking)
// ============================================

export interface IProfileUpdateEvent extends ProfileUpdateEvent, Document {}

const ProfileUpdateEventMongoSchema = new Schema<IProfileUpdateEvent>(
  {
    profileId: { type: String, required: true, index: true },
    address: { type: String, required: true },
    
    updateType: { 
      type: String, 
      enum: ['created', 'refreshed', 'tags_changed'],
      required: true,
    },
    
    previousTags: [{ type: String }],
    newTags: [{ type: String }],
    
    timestamp: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'profile_update_events',
  }
);

// ============================================
// Model Initialization
// ============================================

let WalletProfileModel: Model<IWalletProfile>;
let ProfileUpdateEventModel: Model<IProfileUpdateEvent>;

try {
  WalletProfileModel = mongoose.model<IWalletProfile>('WalletProfile');
} catch {
  WalletProfileModel = mongoose.model<IWalletProfile>(
    'WalletProfile', 
    WalletProfileMongoSchema
  );
}

try {
  ProfileUpdateEventModel = mongoose.model<IProfileUpdateEvent>('ProfileUpdateEvent');
} catch {
  ProfileUpdateEventModel = mongoose.model<IProfileUpdateEvent>(
    'ProfileUpdateEvent', 
    ProfileUpdateEventMongoSchema
  );
}

export { WalletProfileModel, ProfileUpdateEventModel };
