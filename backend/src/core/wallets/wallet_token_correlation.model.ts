/**
 * Wallet Token Correlation Mongoose Model (B2)
 * 
 * ARCHITECTURAL RULES:
 * - scoreComponents for transparent influence breakdown
 * - roleContext for contextual role interpretation
 * - hasDrivers for empty state handling
 */
import mongoose, { Schema, Document, Model } from 'mongoose';
import type { WalletTokenCorrelation, AlertGroupDrivers } from './wallet_token_correlation.schema.js';

export interface IWalletTokenCorrelation extends WalletTokenCorrelation, Document {}
export interface IAlertGroupDrivers extends AlertGroupDrivers, Document {}

// Score Components Schema
const ScoreComponentsSubSchema = new Schema({
  volumeShare: { type: Number, required: true },
  activityFrequency: { type: Number, required: true },
  timingWeight: { type: Number, required: true },
}, { _id: false });

const WalletTokenCorrelationMongoSchema = new Schema<IWalletTokenCorrelation>(
  {
    correlationId: { 
      type: String, 
      required: true, 
      unique: true,
      index: true,
    },
    walletAddress: { 
      type: String, 
      required: true,
      index: true,
    },
    tokenAddress: { 
      type: String, 
      required: true,
      index: true,
    },
    chain: { 
      type: String, 
      default: 'Ethereum',
    },
    
    // Role (contextual)
    role: { 
      type: String, 
      required: true,
      enum: ['buyer', 'seller', 'mixed'],
    },
    roleContext: {
      type: String,
      required: true,
      enum: ['accumulation', 'distribution', 'net_flow', 'alert_group', 'signal_window'],
      default: 'net_flow',
    },
    
    // Influence
    influenceScore: { 
      type: Number, 
      required: true,
      min: 0,
      max: 1,
    },
    
    // NEW: Transparent score breakdown
    scoreComponents: ScoreComponentsSubSchema,
    
    // Metrics
    netFlow: { type: Number, required: true },
    totalVolume: { type: Number, required: true },
    txCount: { type: Number, required: true },
    volumeShare: { type: Number, required: true },
    activityFrequency: { type: Number, required: true },
    
    // Timing
    timeRelation: { 
      type: String, 
      required: true,
      enum: ['before_signal', 'during_signal', 'after_signal'],
    },
    timingWeight: { type: Number, required: true },
    
    // Period
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    
    // Confidence
    confidence: { type: Number, required: true },
    
    // Metadata
    walletMeta: {
      tags: [{ type: String }],
      headline: { type: String },
    },
    tokenMeta: {
      symbol: { type: String },
      name: { type: String },
    },
    
    // Timestamps
    calculatedAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: 'wallet_token_correlations',
  }
);

// Compound indexes for fast lookups
WalletTokenCorrelationMongoSchema.index(
  { tokenAddress: 1, influenceScore: -1 },
  { name: 'token_top_drivers' }
);

WalletTokenCorrelationMongoSchema.index(
  { walletAddress: 1, tokenAddress: 1 },
  { name: 'wallet_token_pair' }
);

WalletTokenCorrelationMongoSchema.index(
  { tokenAddress: 1, periodEnd: -1 },
  { name: 'token_recent' }
);

// Alert Group Drivers Schema
const AlertGroupDriversMongoSchema = new Schema<IAlertGroupDrivers>(
  {
    groupId: { 
      type: String, 
      required: true, 
      unique: true,
      index: true,
    },
    drivers: [{
      walletAddress: { type: String, required: true },
      influenceScore: { type: Number, required: true },
      scoreComponents: ScoreComponentsSubSchema,  // NEW
      role: { type: String, enum: ['buyer', 'seller', 'mixed'] },
      roleContext: { type: String, enum: ['accumulation', 'distribution', 'net_flow', 'alert_group', 'signal_window'] },
      confidence: { type: Number, required: true },
    }],
    driverSummary: { type: String, required: true },
    hasDrivers: { type: Boolean, required: true, default: true },  // NEW: Empty state flag
    calculatedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: 'alert_group_drivers',
  }
);

// Get or create models
let WalletTokenCorrelationModel: Model<IWalletTokenCorrelation>;
let AlertGroupDriversModel: Model<IAlertGroupDrivers>;

try {
  WalletTokenCorrelationModel = mongoose.model<IWalletTokenCorrelation>('WalletTokenCorrelation');
} catch {
  WalletTokenCorrelationModel = mongoose.model<IWalletTokenCorrelation>(
    'WalletTokenCorrelation', 
    WalletTokenCorrelationMongoSchema
  );
}

try {
  AlertGroupDriversModel = mongoose.model<IAlertGroupDrivers>('AlertGroupDrivers');
} catch {
  AlertGroupDriversModel = mongoose.model<IAlertGroupDrivers>(
    'AlertGroupDrivers', 
    AlertGroupDriversMongoSchema
  );
}

export { WalletTokenCorrelationModel, AlertGroupDriversModel };
