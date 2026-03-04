/**
 * Playbooks Model (Phase 13.1)
 * 
 * Action templates that define how to respond to signals/events.
 * Not "alert for alert", but ready-to-execute action scenarios.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export type PlaybookScope = 'actor' | 'entity' | 'token' | 'strategy' | 'corridor' | 'global';
export type PlaybookActionType = 
  | 'watch' 
  | 'follow' 
  | 'add_to_watchlist' 
  | 'create_alert_rule' 
  | 'open_entity' 
  | 'open_graph' 
  | 'simulate_copy' 
  | 'notify'
  | 'paper_entry'
  | 'paper_exit';

export interface PlaybookConditions {
  minSeverity?: number;           // 0-100
  maxSeverity?: number;
  minConfidence?: number;         // 0-1
  minStability?: number;          // 0-1
  allowedStrategies?: string[];   // Only trigger for these
  blockedStrategies?: string[];   // Never trigger for these
  riskMax?: number;               // 0-100
  influenceMin?: number;          // 0-100
  minScore?: number;              // 0-100
}

export interface PlaybookAction {
  type: PlaybookActionType;
  params: Record<string, any>;
  priority: number;               // 1-5 (1=highest)
  delaySeconds?: number;          // Delay before execution
}

export interface IPlaybook extends Document {
  _id: Types.ObjectId;
  
  // Ownership
  userId: string;
  
  // Identity
  name: string;
  description?: string;
  
  // Scope
  scope: PlaybookScope;
  scopeTargets?: string[];        // Specific targets (addresses, strategy types, etc.)
  
  // Triggers
  triggerTypes: string[];         // Signal types that can trigger
  
  // Conditions
  conditions: PlaybookConditions;
  
  // Actions to execute
  actions: PlaybookAction[];
  
  // Time controls
  timeHorizon: '1d' | '7d' | '30d' | 'unlimited';
  cooldownMinutes: number;        // Min time between triggers
  lastTriggeredAt?: Date;
  
  // State
  enabled: boolean;
  triggerCount: number;
  lastError?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const PlaybookConditionsSchema = new Schema(
  {
    minSeverity: Number,
    maxSeverity: Number,
    minConfidence: Number,
    minStability: Number,
    allowedStrategies: [String],
    blockedStrategies: [String],
    riskMax: Number,
    influenceMin: Number,
    minScore: Number,
  },
  { _id: false }
);

const PlaybookActionSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['watch', 'follow', 'add_to_watchlist', 'create_alert_rule', 'open_entity', 'open_graph', 'simulate_copy', 'notify', 'paper_entry', 'paper_exit'],
      required: true,
    },
    params: {
      type: Schema.Types.Mixed,
      default: {},
    },
    priority: {
      type: Number,
      min: 1,
      max: 5,
      default: 3,
    },
    delaySeconds: Number,
  },
  { _id: false }
);

const PlaybookSchema = new Schema<IPlaybook>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    
    name: {
      type: String,
      required: true,
    },
    description: String,
    
    scope: {
      type: String,
      enum: ['actor', 'entity', 'token', 'strategy', 'corridor', 'global'],
      required: true,
      index: true,
    },
    scopeTargets: [String],
    
    triggerTypes: {
      type: [String],
      required: true,
      index: true,
    },
    
    conditions: {
      type: PlaybookConditionsSchema,
      default: {},
    },
    
    actions: {
      type: [PlaybookActionSchema],
      required: true,
      validate: [(v: any[]) => v.length > 0, 'At least one action required'],
    },
    
    timeHorizon: {
      type: String,
      enum: ['1d', '7d', '30d', 'unlimited'],
      default: '7d',
    },
    cooldownMinutes: {
      type: Number,
      default: 60, // 1 hour
    },
    lastTriggeredAt: Date,
    
    enabled: {
      type: Boolean,
      default: true,
    },
    triggerCount: {
      type: Number,
      default: 0,
    },
    lastError: String,
  },
  {
    timestamps: true,
    collection: 'playbooks',
  }
);

// Indexes
PlaybookSchema.index({ userId: 1, enabled: 1 });
PlaybookSchema.index({ triggerTypes: 1, enabled: 1 });
PlaybookSchema.index({ scope: 1, scopeTargets: 1 });

export const PlaybookModel = mongoose.model<IPlaybook>('Playbook', PlaybookSchema);

/**
 * Default playbook templates
 */
export const DEFAULT_PLAYBOOK_TEMPLATES: Partial<IPlaybook>[] = [
  {
    name: 'Whale Activity Alert',
    description: 'Notify on significant whale movements',
    scope: 'strategy',
    scopeTargets: ['whale'],
    triggerTypes: ['intensity_spike', 'large_transfer'],
    conditions: { minSeverity: 70, influenceMin: 80 },
    actions: [
      { type: 'notify', params: { message: 'Whale activity detected' }, priority: 1 },
      { type: 'add_to_watchlist', params: {}, priority: 2 },
    ],
    timeHorizon: '7d',
    cooldownMinutes: 360,
  },
  {
    name: 'Strategy Shift Monitor',
    description: 'Track when actors change their strategy',
    scope: 'global',
    triggerTypes: ['strategy_shift', 'behavior_change'],
    conditions: { minConfidence: 0.7 },
    actions: [
      { type: 'follow', params: {}, priority: 2 },
      { type: 'simulate_copy', params: { duration: '7d' }, priority: 3 },
    ],
    timeHorizon: '30d',
    cooldownMinutes: 1440,
  },
  {
    name: 'Risk Spike Protection',
    description: 'Alert on sudden risk increases',
    scope: 'global',
    triggerTypes: ['risk_spike', 'wash_detected'],
    conditions: { minSeverity: 60 },
    actions: [
      { type: 'notify', params: { message: 'Risk spike detected - review positions' }, priority: 1 },
    ],
    timeHorizon: '1d',
    cooldownMinutes: 60,
  },
];
