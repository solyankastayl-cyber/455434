/**
 * Alert Group Mongoose Model (A3)
 * 
 * Persistence layer for AlertGroup lifecycle management
 */
import mongoose, { Schema, Document, Model } from 'mongoose';
import type { AlertGroup } from './alert_group.schema.js';

export interface IAlertGroup extends AlertGroup, Document {}

const AlertGroupMongoSchema = new Schema<IAlertGroup>(
  {
    groupId: { 
      type: String, 
      required: true, 
      unique: true,
      index: true,
    },
    
    // Grouping key components
    scope: { 
      type: String, 
      required: true,
      enum: ['token', 'wallet', 'actor'],
    },
    targetId: { 
      type: String, 
      required: true,
      index: true,
    },
    signalType: { 
      type: String, 
      required: true,
      enum: [
        'accumulation',
        'distribution',
        'large_move',
        'smart_money_entry',
        'smart_money_exit',
        'net_flow_spike',
        'activity_spike',
      ],
    },
    
    // Target metadata
    targetMeta: {
      symbol: { type: String },
      name: { type: String },
      chain: { type: String },
    },
    
    // Lifecycle
    status: { 
      type: String, 
      required: true,
      enum: ['active', 'cooling', 'resolved'],
      default: 'active',
      index: true,
    },
    priority: { 
      type: String, 
      required: true,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    
    // Timestamps
    startedAt: { type: Date, required: true },
    lastUpdatedAt: { type: Date, required: true },
    coolingStartedAt: { type: Date },
    resolvedAt: { type: Date },
    
    // Event tracking
    eventIds: [{ type: String }],
    eventCount: { type: Number, default: 1 },
    
    // Severity tracking
    peakSeverity: { type: Number, default: 0 },
    lastSeverity: { type: Number, default: 0 },
    
    // Human-readable reason
    reason: {
      summary: { type: String, required: true },
      context: { type: String, required: true },
    },
    
    // User association
    userId: { 
      type: String, 
      required: true,
      index: true,
    },
    ruleId: { type: String },
  },
  {
    timestamps: true,
    collection: 'alert_groups',
  }
);

// Compound index for groupKey lookup (CRITICAL for performance)
AlertGroupMongoSchema.index(
  { scope: 1, targetId: 1, signalType: 1, userId: 1, status: 1 },
  { name: 'groupKey_lookup' }
);

// Index for finding active groups that need lifecycle check
AlertGroupMongoSchema.index(
  { status: 1, lastUpdatedAt: 1 },
  { name: 'lifecycle_check' }
);

// Get or create the model
let AlertGroupModel: Model<IAlertGroup>;

try {
  AlertGroupModel = mongoose.model<IAlertGroup>('AlertGroup');
} catch {
  AlertGroupModel = mongoose.model<IAlertGroup>('AlertGroup', AlertGroupMongoSchema);
}

export { AlertGroupModel };
