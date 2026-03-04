/**
 * Deduplication Event Model (A1)
 * 
 * Purpose: Store dedup state to avoid noise
 * Tracks: first_seen, repeated, suppressed
 */
import mongoose, { Schema, Document } from 'mongoose';

export type DedupStatus = 'first_seen' | 'repeated' | 'suppressed';

export interface IDedupEvent extends Document {
  dedupKey: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  count: number;
  status: DedupStatus;
  lastEventId: string;
  
  // Metadata
  signalType: string;
  targetId: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const DedupEventSchema = new Schema<IDedupEvent>(
  {
    dedupKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    firstSeenAt: {
      type: Date,
      required: true,
      index: true,
    },
    lastSeenAt: {
      type: Date,
      required: true,
      index: true,
    },
    count: {
      type: Number,
      default: 1,
    },
    status: {
      type: String,
      enum: ['first_seen', 'repeated', 'suppressed'],
      required: true,
      index: true,
    },
    lastEventId: {
      type: String,
      required: true,
    },
    signalType: {
      type: String,
      required: true,
    },
    targetId: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'dedup_events',
  }
);

// Compound index for efficient window queries
DedupEventSchema.index({ dedupKey: 1, lastSeenAt: -1 });

// TTL index - auto-delete old dedup records after 7 days
DedupEventSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export const DedupEventModel = mongoose.model<IDedupEvent>('DedupEvent', DedupEventSchema);
