/**
 * Engine Signal Model (Layer 1)
 * 
 * Stores aggregated signals detected by the Engine.
 * These are rule-based patterns, NOT ML predictions.
 * 
 * Signal Types:
 * - coordinated_accumulation: Multiple wallets accumulating same token
 * - smart_money_overlap: Smart money wallets active in same tokens
 * - unusual_volume_spike: Abnormal volume patterns
 * - cluster_activity: Wallet clusters acting together
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export type EngineSignalType = 
  | 'coordinated_accumulation'
  | 'smart_money_overlap'
  | 'unusual_volume_spike'
  | 'cluster_activity';

export type SignalStrength = 'weak' | 'moderate' | 'strong';

export interface IEngineSignal extends Document {
  _id: Types.ObjectId;
  
  // Signal identification
  signalId: string;
  signalType: EngineSignalType;
  
  // Target (what the signal is about)
  targetType: 'token' | 'wallet' | 'cluster';
  targetAddress: string;      // Token address, wallet address, or cluster ID
  targetSymbol?: string;      // Token symbol if applicable
  chainId: number;
  
  // Signal details
  strength: SignalStrength;
  score: number;              // 0-100 score
  
  // Evidence (explainable)
  evidence: {
    description: string;
    walletCount?: number;
    volumeUsd?: number;
    timeWindowHours: number;
    topWallets?: string[];
    overlap?: number;         // For smart_money_overlap
    tokens?: string[];        // For multi-token signals
  };
  
  // Rule that triggered this signal
  triggeredBy: {
    rule: string;
    threshold: number;
    actual: number;
  };
  
  // Time context
  detectedAt: Date;
  windowStart: Date;
  windowEnd: Date;
  expiresAt: Date;            // When signal becomes stale
  
  // Status
  status: 'active' | 'expired' | 'dismissed';
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

const EngineSignalSchema = new Schema<IEngineSignal>(
  {
    signalId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    signalType: {
      type: String,
      enum: ['coordinated_accumulation', 'smart_money_overlap', 'unusual_volume_spike', 'cluster_activity'],
      required: true,
      index: true,
    },
    
    targetType: {
      type: String,
      enum: ['token', 'wallet', 'cluster'],
      required: true,
    },
    targetAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    targetSymbol: {
      type: String,
      default: null,
    },
    chainId: {
      type: Number,
      required: true,
      default: 1,
    },
    
    strength: {
      type: String,
      enum: ['weak', 'moderate', 'strong'],
      required: true,
    },
    score: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    
    evidence: {
      description: { type: String, required: true },
      walletCount: { type: Number },
      volumeUsd: { type: Number },
      timeWindowHours: { type: Number, required: true },
      topWallets: [{ type: String }],
      overlap: { type: Number },
      tokens: [{ type: String }],
    },
    
    triggeredBy: {
      rule: { type: String, required: true },
      threshold: { type: Number, required: true },
      actual: { type: Number, required: true },
    },
    
    detectedAt: {
      type: Date,
      required: true,
      index: true,
    },
    windowStart: {
      type: Date,
      required: true,
    },
    windowEnd: {
      type: Date,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    
    status: {
      type: String,
      enum: ['active', 'expired', 'dismissed'],
      default: 'active',
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'engine_signals',
  }
);

// Compound indexes for queries
EngineSignalSchema.index({ signalType: 1, status: 1, detectedAt: -1 });
EngineSignalSchema.index({ targetAddress: 1, signalType: 1, status: 1 });
EngineSignalSchema.index({ status: 1, expiresAt: 1 });

export const EngineSignalModel = mongoose.model<IEngineSignal>('EngineSignal', EngineSignalSchema);
