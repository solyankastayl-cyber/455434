/**
 * Signal Timeline MongoDB Model
 * 
 * All signals in context, not just a list.
 * Shows evolution of signal patterns.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Signal Timeline Event Document
 */
export interface ISignalTimelineEvent extends Document {
  _id: Types.ObjectId;
  
  address: string;
  chain: string;
  
  timestamp: Date;
  
  // Signal info
  signalType: string;
  severity: number;
  confidence: number;
  
  // Context
  context: {
    strategy?: string;
    phase?: string;
    relatedSignals?: string[];  // IDs of related signals
  };
  
  // Human-readable
  title: string;
  description: string;
  
  // Source
  signalId: string;
  
  // Alert info (if converted to alert)
  alertTriggered: boolean;
  alertId?: string;
  
  createdAt: Date;
}

const SignalTimelineEventSchema = new Schema<ISignalTimelineEvent>(
  {
    address: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    chain: {
      type: String,
      default: 'ethereum',
    },
    timestamp: {
      type: Date,
      required: true,
      index: true,
    },
    signalType: {
      type: String,
      required: true,
      index: true,
    },
    severity: {
      type: Number,
      required: true,
    },
    confidence: {
      type: Number,
      required: true,
    },
    context: {
      strategy: String,
      phase: String,
      relatedSignals: [String],
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    signalId: {
      type: String,
      required: true,
      index: true,
    },
    alertTriggered: {
      type: Boolean,
      default: false,
    },
    alertId: String,
  },
  {
    timestamps: true,
    collection: 'signal_timeline',
  }
);

// Indexes
SignalTimelineEventSchema.index({ address: 1, timestamp: -1 });
SignalTimelineEventSchema.index({ address: 1, signalType: 1, timestamp: -1 });
SignalTimelineEventSchema.index({ signalId: 1 }, { unique: true });

export const SignalTimelineModel = mongoose.model<ISignalTimelineEvent>(
  'SignalTimelineEvent',
  SignalTimelineEventSchema
);
