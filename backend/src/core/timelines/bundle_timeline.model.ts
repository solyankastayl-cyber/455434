/**
 * Bundle Timeline MongoDB Model
 * 
 * Shows accumulation → flow → distribution patterns.
 * Where it started, where it intensified, where it broke.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Bundle Timeline Event Document
 */
export interface IBundleTimelineEvent extends Document {
  _id: Types.ObjectId;
  
  address: string;
  chain: string;
  
  timestamp: Date;
  
  // Bundle info
  bundleType: string;  // accumulation | distribution | wash | rotation
  bundleId: string;
  
  // Metrics at this point
  volumeUsd: number;
  transferCount: number;
  confidence: number;
  
  // Phase in the bundle lifecycle
  phase: 'started' | 'intensified' | 'peaked' | 'declining' | 'completed' | 'broken';
  
  // Human-readable
  description: string;
  
  // Actors involved
  actors: string[];
  
  createdAt: Date;
}

const BundleTimelineEventSchema = new Schema<IBundleTimelineEvent>(
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
    bundleType: {
      type: String,
      required: true,
      index: true,
    },
    bundleId: {
      type: String,
      required: true,
      index: true,
    },
    volumeUsd: {
      type: Number,
      default: 0,
    },
    transferCount: {
      type: Number,
      default: 0,
    },
    confidence: {
      type: Number,
      default: 0,
    },
    phase: {
      type: String,
      enum: ['started', 'intensified', 'peaked', 'declining', 'completed', 'broken'],
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    actors: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'bundle_timeline',
  }
);

// Indexes
BundleTimelineEventSchema.index({ address: 1, timestamp: -1 });
BundleTimelineEventSchema.index({ bundleId: 1, timestamp: -1 });
BundleTimelineEventSchema.index({ bundleType: 1, timestamp: -1 });

export const BundleTimelineModel = mongoose.model<IBundleTimelineEvent>(
  'BundleTimelineEvent',
  BundleTimelineEventSchema
);

/**
 * Generate bundle phase description
 */
export function generateBundlePhaseDescription(
  bundleType: string,
  phase: string,
  volumeUsd: number,
  transferCount: number
): string {
  const typeName = bundleType.replace(/_/g, ' ');
  const volumeK = volumeUsd >= 1000 ? `$${(volumeUsd / 1000).toFixed(1)}K` : `$${volumeUsd.toFixed(0)}`;
  
  switch (phase) {
    case 'started':
      return `${typeName} pattern started with ${transferCount} transfers (${volumeK} volume)`;
    case 'intensified':
      return `${typeName} activity intensified - volume increased to ${volumeK}`;
    case 'peaked':
      return `${typeName} reached peak activity at ${volumeK} across ${transferCount} transfers`;
    case 'declining':
      return `${typeName} activity declining - momentum slowing`;
    case 'completed':
      return `${typeName} pattern completed normally - ${volumeK} total volume`;
    case 'broken':
      return `${typeName} pattern broken - unexpected activity disrupted the pattern`;
    default:
      return `${typeName} event: ${phase}`;
  }
}
