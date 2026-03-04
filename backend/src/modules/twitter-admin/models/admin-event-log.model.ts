/**
 * A.3.4 - Admin Event Log Model
 * 
 * System events for admin monitoring:
 * - User onboarding events
 * - Policy violations
 * - System alerts
 */

import mongoose, { Schema, Document, Types } from 'mongoose';

export type AdminEventType = 
  | 'USER_CREATED_TWITTER_ACCOUNT'
  | 'USER_SYNCED_SESSION'
  | 'POLICY_VIOLATION'
  | 'USER_DISABLED_BY_POLICY'
  | 'USER_ENABLED_BY_ADMIN'
  | 'PARSER_DOWN'
  | 'PARSER_UP'
  | 'SESSION_INVALIDATED'
  | 'COOLDOWN_APPLIED';

export interface IAdminEventLog extends Document {
  _id: Types.ObjectId;
  eventType: AdminEventType;
  userId?: string;
  details: {
    twitter?: string;
    sessionVersion?: number;
    reason?: string;
    action?: string;
    metrics?: any;
    [key: string]: any;
  };
  createdAt: Date;
}

const AdminEventLogSchema = new Schema<IAdminEventLog>(
  {
    eventType: {
      type: String,
      required: true,
      enum: [
        'USER_CREATED_TWITTER_ACCOUNT',
        'USER_SYNCED_SESSION',
        'POLICY_VIOLATION',
        'USER_DISABLED_BY_POLICY',
        'USER_ENABLED_BY_ADMIN',
        'PARSER_DOWN',
        'PARSER_UP',
        'SESSION_INVALIDATED',
        'COOLDOWN_APPLIED',
      ],
      index: true,
    },
    userId: {
      type: String,
      index: true,
    },
    details: {
      type: Schema.Types.Mixed,
      default: {},
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    collection: 'admin_event_logs',
  }
);

// Index for recent events
AdminEventLogSchema.index({ createdAt: -1 });

export const AdminEventLogModel = mongoose.model<IAdminEventLog>(
  'AdminEventLog',
  AdminEventLogSchema
);

/**
 * Helper to log admin events
 */
export async function logAdminEvent(
  eventType: AdminEventType,
  userId: string | undefined,
  details: Record<string, any>
): Promise<void> {
  try {
    await AdminEventLogModel.create({
      eventType,
      userId,
      details,
    });
    console.log(`[AdminEventLog] ${eventType}:`, userId || 'system', JSON.stringify(details));
  } catch (err) {
    console.error('[AdminEventLog] Failed to log event:', err);
  }
}
