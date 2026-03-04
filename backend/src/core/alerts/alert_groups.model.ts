/**
 * Alert Groups MongoDB Model (A1 - Deduplication)
 * 
 * Purpose: Group similar alerts to reduce noise
 * Window-based grouping: groups alerts within time window
 * Auto-resolve: groups auto-resolve after 2x window of inactivity
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export type AlertGroupStatus = 'active' | 'resolved';
export type AlertGroupScope = 'strategy' | 'actor' | 'entity' | 'token' | 'wallet';

export interface IAlertGroup extends Document {
  groupId: string;
  ruleId: Types.ObjectId;
  signalType: string;
  targetId: string;
  scope: AlertGroupScope;
  
  // Timing
  firstTriggeredAt: Date;
  lastTriggeredAt: Date;
  windowMinutes: number;
  
  // Grouping stats
  eventCount: number;
  status: AlertGroupStatus;
  
  // Context
  targetMeta?: {
    symbol?: string;
    name?: string;
    chain?: string;
  };
  
  // Explainability (A2)
  why?: string;
  evidence?: Array<{
    metric: string;
    value: number;
    delta?: number;
    baseline?: number;
  }>;
  
  // Metadata
  userId: string;
  resolvedAt?: Date;
  resolvedBy?: 'auto' | 'user';
  
  createdAt: Date;
  updatedAt: Date;
}

const AlertGroupSchema = new Schema<IAlertGroup>(
  {
    groupId: {
      type: String,
      required: true,
      index: true,
      unique: true,
    },
    ruleId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    signalType: {
      type: String,
      required: true,
      index: true,
    },
    targetId: {
      type: String,
      required: true,
      index: true,
    },
    scope: {
      type: String,
      enum: ['strategy', 'actor', 'entity', 'token', 'wallet'],
      required: true,
      index: true,
    },
    firstTriggeredAt: {
      type: Date,
      required: true,
      index: true,
    },
    lastTriggeredAt: {
      type: Date,
      required: true,
      index: true,
    },
    windowMinutes: {
      type: Number,
      default: 60,
    },
    eventCount: {
      type: Number,
      default: 1,
    },
    status: {
      type: String,
      enum: ['active', 'resolved'],
      default: 'active',
      index: true,
    },
    targetMeta: {
      symbol: String,
      name: String,
      chain: String,
    },
    why: String,
    evidence: [
      {
        metric: String,
        value: Number,
        delta: Number,
        baseline: Number,
      },
    ],
    userId: {
      type: String,
      required: true,
      index: true,
    },
    resolvedAt: Date,
    resolvedBy: {
      type: String,
      enum: ['auto', 'user'],
    },
  },
  {
    timestamps: true,
    collection: 'alert_groups',
  }
);

// Compound indexes for efficient queries
AlertGroupSchema.index({ userId: 1, status: 1, lastTriggeredAt: -1 });
AlertGroupSchema.index({ userId: 1, signalType: 1, targetId: 1 });
AlertGroupSchema.index({ ruleId: 1, status: 1 });

// Auto-resolve stale groups (method)
AlertGroupSchema.methods.shouldAutoResolve = function (): boolean {
  if (this.status === 'resolved') return false;
  
  const inactivityThreshold = this.windowMinutes * 2 * 60 * 1000; // 2x window
  const timeSinceLastTrigger = Date.now() - this.lastTriggeredAt.getTime();
  
  return timeSinceLastTrigger > inactivityThreshold;
};

export const AlertGroupModel = mongoose.model<IAlertGroup>('AlertGroup', AlertGroupSchema);

/**
 * Alert Group Events - Individual events within a group
 */
export interface IAlertGroupEvent extends Document {
  eventId: string;
  groupId: string;
  ruleId: Types.ObjectId;
  alertEventId: string; // Original alert event ID
  
  triggeredAt: Date;
  signalType: string;
  targetId: string;
  
  // Event-specific data
  metadata?: {
    threshold?: number;
    actualValue?: number;
    deviation?: number;
    confidence?: number;
  };
  
  userId: string;
  createdAt: Date;
}

const AlertGroupEventSchema = new Schema<IAlertGroupEvent>(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    groupId: {
      type: String,
      required: true,
      index: true,
    },
    ruleId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    alertEventId: {
      type: String,
      required: true,
      index: true,
    },
    triggeredAt: {
      type: Date,
      required: true,
      index: true,
    },
    signalType: {
      type: String,
      required: true,
    },
    targetId: {
      type: String,
      required: true,
    },
    metadata: {
      threshold: Number,
      actualValue: Number,
      deviation: Number,
      confidence: Number,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'alert_group_events',
  }
);

// Index for fetching events by group
AlertGroupEventSchema.index({ groupId: 1, triggeredAt: -1 });

export const AlertGroupEventModel = mongoose.model<IAlertGroupEvent>(
  'AlertGroupEvent',
  AlertGroupEventSchema
);
