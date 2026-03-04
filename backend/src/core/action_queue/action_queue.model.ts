/**
 * Action Queue Model (Phase 13.2)
 * 
 * Managed action execution layer.
 * Actions are queued, deduplicated, and executed with state tracking.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export type ActionSourceType = 'signal' | 'strategy_signal' | 'alert' | 'decision' | 'playbook' | 'manual';
export type ActionStatus = 'queued' | 'ready' | 'executed' | 'failed' | 'skipped' | 'expired' | 'cancelled';
export type ActionType = 
  | 'watch' 
  | 'follow' 
  | 'unfollow'
  | 'add_to_watchlist' 
  | 'remove_from_watchlist'
  | 'create_alert_rule' 
  | 'notify'
  | 'paper_entry'
  | 'paper_exit'
  | 'simulate_copy'
  | 'open_entity';

export interface IActionQueue extends Document {
  _id: Types.ObjectId;
  
  // Ownership
  userId: string;
  
  // Source
  source: {
    type: ActionSourceType;
    id: string;
    playbookId?: string;
  };
  
  // Action details
  actionType: ActionType;
  target: {
    type: 'actor' | 'token' | 'entity' | 'strategy';
    id: string;
    label?: string;
  };
  payload: Record<string, any>;
  priority: number;               // 1-5 (1=highest)
  
  // State
  status: ActionStatus;
  statusReason?: string;
  
  // Timing
  scheduledAt: Date;
  executedAt?: Date;
  expiresAt?: Date;
  
  // Deduplication
  dedupKey: string;               // userId + sourceType + actionType + target.id
  
  // Human-readable explanation
  explanation: string;
  
  // Execution result
  result?: Record<string, any>;
  error?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const ActionSourceSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['signal', 'strategy_signal', 'alert', 'decision', 'playbook', 'manual'],
      required: true,
    },
    id: { type: String, required: true },
    playbookId: String,
  },
  { _id: false }
);

const ActionTargetSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['actor', 'token', 'entity', 'strategy'],
      required: true,
    },
    id: { type: String, required: true },
    label: String,
  },
  { _id: false }
);

const ActionQueueSchema = new Schema<IActionQueue>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    
    source: {
      type: ActionSourceSchema,
      required: true,
    },
    
    actionType: {
      type: String,
      enum: ['watch', 'follow', 'unfollow', 'add_to_watchlist', 'remove_from_watchlist', 'create_alert_rule', 'notify', 'paper_entry', 'paper_exit', 'simulate_copy', 'open_entity'],
      required: true,
      index: true,
    },
    
    target: {
      type: ActionTargetSchema,
      required: true,
    },
    
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
    
    priority: {
      type: Number,
      min: 1,
      max: 5,
      default: 3,
    },
    
    status: {
      type: String,
      enum: ['queued', 'ready', 'executed', 'failed', 'skipped', 'expired', 'cancelled'],
      default: 'queued',
      index: true,
    },
    statusReason: String,
    
    scheduledAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    executedAt: Date,
    expiresAt: Date,
    
    dedupKey: {
      type: String,
      required: true,
      index: true,
    },
    
    explanation: {
      type: String,
      required: true,
    },
    
    result: Schema.Types.Mixed,
    error: String,
    
    // Skip/Failure tracking (п.6.2)
    skipReason: {
      type: String,
      enum: ['cooldown', 'tier_block', 'dedup', 'invalid_target', 'missing_data', 'max_positions', 'disabled'],
    },
    failureReason: String,
  },
  {
    timestamps: true,
    collection: 'action_queue',
  }
);

// Indexes
ActionQueueSchema.index({ userId: 1, status: 1, scheduledAt: 1 });
ActionQueueSchema.index({ status: 1, scheduledAt: 1, priority: 1 });
ActionQueueSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

export const ActionQueueModel = mongoose.model<IActionQueue>('ActionQueue', ActionQueueSchema);

/**
 * Generate dedup key - includes ALL relevant identifiers (п.1.1)
 * Format: userId:playbookId:sourceType:sourceId:actionType:targetId
 */
export function generateDedupKey(
  userId: string,
  playbookId: string | undefined,
  sourceType: string,
  sourceId: string,
  actionType: string,
  targetId: string
): string {
  const pbId = playbookId || 'manual';
  return `${userId}:${pbId}:${sourceType}:${sourceId}:${actionType}:${targetId}`.toLowerCase();
}

/**
 * Legacy dedup key generator (for backwards compatibility)
 * @deprecated Use generateDedupKey with playbookId instead
 */
export function generateSimpleDedupKey(
  userId: string,
  sourceType: string,
  actionType: string,
  targetId: string
): string {
  return `${userId}:${sourceType}:${actionType}:${targetId}`.toLowerCase();
}

/**
 * Calculate action priority score
 * priorityScore = 0.45*severity + 0.25*influence + 0.20*intensity - 0.30*risk
 */
export function calculateActionPriority(
  severity: number,
  influence: number,
  intensity: number,
  risk: number
): number {
  const score = 0.45 * severity + 0.25 * influence + 0.20 * intensity - 0.30 * risk;
  // Normalize to 1-5 (1=highest priority)
  const normalized = Math.max(0, Math.min(100, score));
  return Math.ceil(5 - (normalized / 25)); // 100→1, 75→2, 50→3, 25→4, 0→5
}
