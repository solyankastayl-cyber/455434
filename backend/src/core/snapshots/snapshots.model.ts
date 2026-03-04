/**
 * Profile Snapshots MongoDB Model (L10.4 - UI Performance)
 * 
 * Prebuilt JSON for fast UI loading.
 * Actor page, graph hover, alert modal - all load in 1 request.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Snapshot types
 */
export type SnapshotType = 'actor_card' | 'actor_full' | 'graph_node' | 'alert_modal';

/**
 * Profile Snapshot Document Interface
 */
export interface IProfileSnapshot extends Document {
  _id: Types.ObjectId;
  
  // Target
  subjectId: string;  // address | alertId
  subjectType: 'actor' | 'entity' | 'alert';
  
  // Snapshot type
  snapshotType: SnapshotType;
  
  // Payload (prebuilt JSON)
  payload: Record<string, unknown>;
  
  // Versioning
  version: number;
  
  // Expiration
  expiresAt: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

const ProfileSnapshotSchema = new Schema<IProfileSnapshot>(
  {
    subjectId: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    subjectType: {
      type: String,
      enum: ['actor', 'entity', 'alert'],
      required: true,
    },
    snapshotType: {
      type: String,
      enum: ['actor_card', 'actor_full', 'graph_node', 'alert_modal'],
      required: true,
      index: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    version: {
      type: Number,
      default: 1,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'profile_snapshots',
  }
);

// Unique: one snapshot per subject per type
ProfileSnapshotSchema.index(
  { subjectId: 1, snapshotType: 1 },
  { unique: true }
);

// TTL index for auto-expiration
ProfileSnapshotSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

export const ProfileSnapshotModel = mongoose.model<IProfileSnapshot>(
  'ProfileSnapshot',
  ProfileSnapshotSchema
);

/**
 * Default TTL per snapshot type (in seconds)
 */
export const SNAPSHOT_TTL: Record<SnapshotType, number> = {
  'actor_card': 5 * 60,      // 5 minutes
  'actor_full': 10 * 60,     // 10 minutes
  'graph_node': 2 * 60,      // 2 minutes
  'alert_modal': 30 * 60,    // 30 minutes
};
