import mongoose, { Schema, Document } from 'mongoose';
import type { OwnerType } from './_types.js';

/**
 * UserTwitterAccount - Phase 1.3: Session Selection
 * 
 * Добавлены поля для MANUAL режима выбора:
 * - isPreferred: закреплённый аккаунт пользователя
 * - priority: тай-брейкер для AUTO режима
 */
export interface IUserTwitterAccount extends Document {
  ownerType: OwnerType;
  ownerUserId?: string;
  username: string;
  displayName?: string;
  verified?: boolean;
  enabled: boolean;
  
  /** Phase 1.3: MANUAL mode - закреплённый аккаунт */
  isPreferred?: boolean;
  /** Phase 1.3: Priority для AUTO mode (выше = приоритетнее) */
  priority?: number;
  
  preferredSlotId?: string;
  requestsInWindow: number;
  windowStartedAt?: Date;
  
  // Phase 4.2: Auto-Cooldown
  cooldownUntil?: Date;
  cooldownReason?: string;
  cooldownCount: number;
  
  createdAt: Date;
  updatedAt: Date;
}

const UserTwitterAccountSchema = new Schema<IUserTwitterAccount>(
  {
    ownerType: {
      type: String,
      required: true,
      enum: ['USER', 'SYSTEM'],
    },
    ownerUserId: String,
    username: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    displayName: String,
    verified: {
      type: Boolean,
      default: false,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    
    // Phase 1.3: Session Selection
    isPreferred: {
      type: Boolean,
      default: false,
    },
    priority: {
      type: Number,
      default: 0,
    },
    
    preferredSlotId: String,
    requestsInWindow: {
      type: Number,
      default: 0,
    },
    windowStartedAt: Date,
    
    // Phase 4.2: Auto-Cooldown
    cooldownUntil: Date,
    cooldownReason: String,
    cooldownCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Indexes
UserTwitterAccountSchema.index({ ownerType: 1, ownerUserId: 1 });
UserTwitterAccountSchema.index(
  { ownerType: 1, ownerUserId: 1, username: 1 },
  { unique: true }
);

export const UserTwitterAccountModel = mongoose.model<IUserTwitterAccount>(
  'UserTwitterAccount',
  UserTwitterAccountSchema,
  'user_twitter_accounts'
);
