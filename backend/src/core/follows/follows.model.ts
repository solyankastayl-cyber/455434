/**
 * Follows MongoDB Model
 * 
 * Foundation for:
 * - Watchlist 2.0 (not just "watching" but "following")
 * - Alerts 2.0 (receive only important signals)
 * - Copy Intelligence (not trades, but signals)
 * 
 * Users can follow: actors, entities, strategies, tokens
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Follow target types
 */
export type FollowType = 'actor' | 'entity' | 'strategy' | 'token';

/**
 * Delivery methods
 */
export type DeliveryMethod = 'inApp' | 'email' | 'telegram' | 'webhook';

/**
 * Follow settings
 */
export interface FollowSettings {
  minSeverity: number;       // 0-100, only receive signals above this
  minConfidence: number;     // 0-1, only receive signals above this
  allowedTypes: string[];    // Allowed signal types (empty = all)
  window: '7d' | '30d' | '90d';
  delivery: DeliveryMethod[];
  muted: boolean;            // Temporarily mute notifications
}

/**
 * Follow Document Interface
 */
export interface IFollow extends Document {
  _id: Types.ObjectId;
  
  // User identification
  userId: string;  // Can be anonymous/session ID initially
  
  // Target
  followType: FollowType;
  targetId: string;  // Address / entityId / strategyType / tokenAddress
  
  // Settings
  settings: FollowSettings;
  
  // Metadata
  label?: string;  // User's custom label
  notes?: string;  // User's notes
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Follow Settings Schema
 */
const FollowSettingsSchema = new Schema<FollowSettings>(
  {
    minSeverity: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    minConfidence: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    allowedTypes: {
      type: [String],
      default: [],
    },
    window: {
      type: String,
      enum: ['7d', '30d', '90d'],
      default: '7d',
    },
    delivery: {
      type: [String],
      enum: ['inApp', 'email', 'telegram', 'webhook'],
      default: ['inApp'],
    },
    muted: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

/**
 * Follow Schema
 */
const FollowSchema = new Schema<IFollow>(
  {
    // User
    userId: {
      type: String,
      required: true,
      index: true,
    },
    
    // Target
    followType: {
      type: String,
      enum: ['actor', 'entity', 'strategy', 'token'],
      required: true,
      index: true,
    },
    targetId: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    
    // Settings
    settings: {
      type: FollowSettingsSchema,
      required: true,
      default: () => ({}),
    },
    
    // Metadata
    label: {
      type: String,
    },
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
    collection: 'follows',
  }
);

// ========== INDEXES ==========

// Unique: one follow per user per target
FollowSchema.index(
  { userId: 1, followType: 1, targetId: 1 },
  { unique: true }
);

// For user's follow list
FollowSchema.index({ userId: 1, createdAt: -1 });

// For finding followers of a target
FollowSchema.index({ followType: 1, targetId: 1 });

// For strategy type follows
FollowSchema.index({ followType: 1, targetId: 1, 'settings.muted': 1 });

export const FollowModel = mongoose.model<IFollow>('Follow', FollowSchema);

/**
 * Default follow settings
 */
export function getDefaultFollowSettings(): FollowSettings {
  return {
    minSeverity: 30,
    minConfidence: 0.5,
    allowedTypes: [],
    window: '7d',
    delivery: ['inApp'],
    muted: false,
  };
}
