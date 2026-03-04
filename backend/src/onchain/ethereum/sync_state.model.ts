/**
 * Sync State Model
 * Tracks indexing progress to resume from last position
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface ISyncState extends Document {
  key: string;
  lastBlock: number;
  lastProcessedAt: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const SyncStateSchema = new Schema<ISyncState>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    lastBlock: {
      type: Number,
      required: true,
    },
    lastProcessedAt: {
      type: Date,
      default: Date.now,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'sync_states',
  }
);

export const SyncStateModel = mongoose.model<ISyncState>('SyncState', SyncStateSchema);
