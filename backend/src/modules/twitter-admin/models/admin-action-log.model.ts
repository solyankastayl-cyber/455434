/**
 * A.3.0 - Admin Action Log Model
 * 
 * Audit trail for all admin actions
 * Even if not writing logs now, the structure is ready
 */

import mongoose, { Schema, Document, Types } from 'mongoose';

export type AdminActionType = 
  | 'USER_DISABLE'
  | 'USER_ENABLE'
  | 'USER_COOLDOWN'
  | 'ACCOUNT_DISABLE'
  | 'ACCOUNT_ENABLE'
  | 'SESSION_INVALIDATE'
  | 'SESSION_DEACTIVATE'
  | 'LIMITS_UPDATE';

export type AdminTargetType = 
  | 'USER'
  | 'ACCOUNT'
  | 'SESSION';

export interface IAdminActionLog extends Document {
  _id: Types.ObjectId;
  actorAdminId: string;
  actionType: AdminActionType;
  targetType: AdminTargetType;
  targetId: string;
  targetUserId: string; // Always include affected user
  payload?: Record<string, any>;
  reason?: string;
  createdAt: Date;
}

const AdminActionLogSchema = new Schema<IAdminActionLog>(
  {
    actorAdminId: {
      type: String,
      required: true,
      index: true,
    },
    actionType: {
      type: String,
      required: true,
      enum: [
        'USER_DISABLE',
        'USER_ENABLE', 
        'USER_COOLDOWN',
        'ACCOUNT_DISABLE',
        'ACCOUNT_ENABLE',
        'SESSION_INVALIDATE',
        'SESSION_DEACTIVATE',
        'LIMITS_UPDATE',
      ],
    },
    targetType: {
      type: String,
      required: true,
      enum: ['USER', 'ACCOUNT', 'SESSION'],
    },
    targetId: {
      type: String,
      required: true,
    },
    targetUserId: {
      type: String,
      required: true,
      index: true,
    },
    payload: {
      type: Schema.Types.Mixed,
    },
    reason: String,
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    collection: 'admin_action_logs',
  }
);

// Compound index for querying by target user
AdminActionLogSchema.index({ targetUserId: 1, createdAt: -1 });

export const AdminActionLogModel = mongoose.model<IAdminActionLog>(
  'AdminActionLog',
  AdminActionLogSchema
);
