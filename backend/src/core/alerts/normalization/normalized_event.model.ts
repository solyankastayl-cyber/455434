/**
 * Normalized Alert Event Model (A0)
 * 
 * Purpose: Store normalized events for A1 (dedup) and A2 (severity)
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface INormalizedAlertEvent extends Document {
  // Identity
  eventId: string;
  ruleId: string;
  userId: string;
  
  // What happened
  signalType: string;
  scope: 'strategy' | 'actor' | 'entity' | 'token' | 'wallet';
  targetId: string;
  targetMeta?: {
    symbol?: string;
    name?: string;
    chain?: string;
  };
  
  // When
  triggeredAt: Date;
  
  // How much (normalized metrics)
  metrics: {
    value: number;
    threshold: number;
    baseline: number;
    deviation: number;
    direction: 'in' | 'out';
  };
  
  // Quality
  confidence: number;
  
  // Context
  marketContext?: {
    regime?: 'trend' | 'range' | 'volatility';
    sentiment?: 'bullish' | 'neutral' | 'bearish';
  };
  
  // Raw data
  rawSignal?: any;
  
  createdAt: Date;
}

const NormalizedAlertEventSchema = new Schema<INormalizedAlertEvent>(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    ruleId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    signalType: {
      type: String,
      required: true,
      index: true,
    },
    scope: {
      type: String,
      enum: ['strategy', 'actor', 'entity', 'token', 'wallet'],
      required: true,
    },
    targetId: {
      type: String,
      required: true,
      index: true,
    },
    targetMeta: {
      symbol: String,
      name: String,
      chain: String,
    },
    triggeredAt: {
      type: Date,
      required: true,
      index: true,
    },
    metrics: {
      value: {
        type: Number,
        required: true,
      },
      threshold: {
        type: Number,
        required: true,
      },
      baseline: {
        type: Number,
        required: true,
      },
      deviation: {
        type: Number,
        required: true,
      },
      direction: {
        type: String,
        enum: ['in', 'out'],
        required: true,
      },
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    marketContext: {
      regime: {
        type: String,
        enum: ['trend', 'range', 'volatility'],
      },
      sentiment: {
        type: String,
        enum: ['bullish', 'neutral', 'bearish'],
      },
    },
    rawSignal: Schema.Types.Mixed,
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'normalized_alert_events',
  }
);

// Compound indexes for queries
NormalizedAlertEventSchema.index({ userId: 1, signalType: 1, targetId: 1, triggeredAt: -1 });
NormalizedAlertEventSchema.index({ userId: 1, triggeredAt: -1 });

export const NormalizedAlertEventModel = mongoose.model<INormalizedAlertEvent>(
  'NormalizedAlertEvent',
  NormalizedAlertEventSchema
);
