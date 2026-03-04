/**
 * System Alerts V2 - Model
 * 
 * Alerts V2 = System & Intelligence Notifications Layer
 * NOT user rules, NOT signals, NOT trading recommendations
 * 
 * "What important events happened with system, data, ML, or market"
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

// Alert Types by Category
export type SystemAlertType = 
  // System / Infrastructure
  | 'CHAIN_LAG'
  | 'RPC_DEGRADED'
  | 'RPC_RECOVERED'
  | 'CHAIN_PAUSED'
  | 'CHAIN_RESUMED'
  | 'INDEXER_PAUSE'
  | 'INDEXER_RESUME'
  // Intelligence / ML
  | 'ML_GATE_BLOCK'
  | 'ML_GATE_PASS'
  | 'ML_KILL_SWITCH'
  | 'ML_KILL_RESET'
  | 'ML_DRIFT_HIGH'
  | 'ML_DRIFT_NORMAL'
  | 'ML_MODE_CHANGE'
  // Market / Cross-chain
  | 'BRIDGE_ACTIVITY_SPIKE'
  | 'LARGE_LIQUIDITY_MOVE'
  | 'CROSS_CHAIN_FLOW'
  | 'BRIDGE_MIGRATION'
  // Watchlist Events
  | 'WATCHLIST_ACCUMULATION'
  | 'WATCHLIST_DISTRIBUTION'
  | 'WATCHLIST_LARGE_TRANSFER'
  | 'WATCHLIST_BRIDGE_IN'
  | 'WATCHLIST_BRIDGE_OUT'
  | 'WATCHLIST_ACTOR_ACTIVITY'
  // Actor Intelligence (BLOCK 3)
  | 'ACTOR_REPEAT_BRIDGE'
  | 'ACTOR_ROUTE_DOMINANCE'
  | 'ACTOR_LIQUIDITY_ESCALATION'
  | 'ACTOR_MULTI_CHAIN'
  | 'ACTOR_STRATEGIC_TIMING'
  | 'ACTOR_NEW_STRATEGIC';

export type AlertSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AlertSource = 'system' | 'ml' | 'market' | 'bridge' | 'chain' | 'watchlist' | 'actor_intelligence';
export type AlertStatus = 'OPEN' | 'ACKED' | 'RESOLVED';
export type AlertCategory = 'SYSTEM' | 'ML' | 'MARKET' | 'ACTOR';

export interface ISystemAlert extends Document {
  _id: Types.ObjectId;
  alertId: string;
  type: SystemAlertType;
  category: AlertCategory;
  source: AlertSource;
  severity: AlertSeverity;
  
  title: string;
  message: string;
  metadata: Record<string, any>;
  
  status: AlertStatus;
  ackedAt?: Date;
  ackedBy?: string;
  resolvedAt?: Date;
  resolvedBy?: string;
  
  chain?: string;
  
  // Watchlist entity reference
  entityRef?: {
    entityType: 'TOKEN' | 'WALLET' | 'ACTOR';
    entityId: string;
    address?: string;
    chain?: string;
    label?: string;
  };
  watchlistEventId?: string;
  
  firstSeenAt: Date;
  lastSeenAt: Date;
  
  // Telegram notification tracking
  telegramSent: boolean;
  telegramSentAt?: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

const SystemAlertSchema = new Schema<ISystemAlert>(
  {
    alertId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        'CHAIN_LAG', 'RPC_DEGRADED', 'RPC_RECOVERED', 'CHAIN_PAUSED', 'CHAIN_RESUMED',
        'INDEXER_PAUSE', 'INDEXER_RESUME',
        'ML_GATE_BLOCK', 'ML_GATE_PASS', 'ML_KILL_SWITCH', 'ML_KILL_RESET',
        'ML_DRIFT_HIGH', 'ML_DRIFT_NORMAL', 'ML_MODE_CHANGE',
        'BRIDGE_ACTIVITY_SPIKE', 'LARGE_LIQUIDITY_MOVE', 'CROSS_CHAIN_FLOW', 'BRIDGE_MIGRATION',
        // Watchlist types
        'WATCHLIST_ACCUMULATION', 'WATCHLIST_DISTRIBUTION', 'WATCHLIST_LARGE_TRANSFER',
        'WATCHLIST_BRIDGE_IN', 'WATCHLIST_BRIDGE_OUT', 'WATCHLIST_ACTOR_ACTIVITY',
        // Actor Intelligence types (BLOCK 3)
        'ACTOR_REPEAT_BRIDGE', 'ACTOR_ROUTE_DOMINANCE', 'ACTOR_LIQUIDITY_ESCALATION',
        'ACTOR_MULTI_CHAIN', 'ACTOR_STRATEGIC_TIMING', 'ACTOR_NEW_STRATEGIC',
      ],
      index: true,
    },
    category: {
      type: String,
      required: true,
      enum: ['SYSTEM', 'ML', 'MARKET', 'ACTOR'],
      index: true,
    },
    source: {
      type: String,
      required: true,
      enum: ['system', 'ml', 'market', 'bridge', 'chain', 'watchlist', 'actor_intelligence'],
      index: true,
    },
    severity: {
      type: String,
      required: true,
      enum: ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      required: true,
      enum: ['OPEN', 'ACKED', 'RESOLVED'],
      default: 'OPEN',
      index: true,
    },
    ackedAt: Date,
    ackedBy: String,
    resolvedAt: Date,
    resolvedBy: String,
    chain: {
      type: String,
      index: true,
    },
    // Watchlist entity reference
    entityRef: {
      entityType: {
        type: String,
        enum: ['TOKEN', 'WALLET', 'ACTOR'],
      },
      entityId: String,
      address: String,
      chain: String,
      label: String,
    },
    watchlistEventId: {
      type: String,
      index: true,
    },
    firstSeenAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    lastSeenAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    telegramSent: {
      type: Boolean,
      default: false,
    },
    telegramSentAt: Date,
  },
  {
    timestamps: true,
    collection: 'system_alerts',
  }
);

// Compound indexes for common queries
SystemAlertSchema.index({ status: 1, severity: 1, createdAt: -1 });
SystemAlertSchema.index({ category: 1, status: 1, createdAt: -1 });
SystemAlertSchema.index({ createdAt: -1 });

export const SystemAlertModel = mongoose.model<ISystemAlert>(
  'SystemAlert',
  SystemAlertSchema
);

// Type mapping helpers
export const ALERT_CATEGORY_MAP: Record<SystemAlertType, AlertCategory> = {
  // System
  'CHAIN_LAG': 'SYSTEM',
  'RPC_DEGRADED': 'SYSTEM',
  'RPC_RECOVERED': 'SYSTEM',
  'CHAIN_PAUSED': 'SYSTEM',
  'CHAIN_RESUMED': 'SYSTEM',
  'INDEXER_PAUSE': 'SYSTEM',
  'INDEXER_RESUME': 'SYSTEM',
  // ML
  'ML_GATE_BLOCK': 'ML',
  'ML_GATE_PASS': 'ML',
  'ML_KILL_SWITCH': 'ML',
  'ML_KILL_RESET': 'ML',
  'ML_DRIFT_HIGH': 'ML',
  'ML_DRIFT_NORMAL': 'ML',
  'ML_MODE_CHANGE': 'ML',
  // Market
  'BRIDGE_ACTIVITY_SPIKE': 'MARKET',
  'LARGE_LIQUIDITY_MOVE': 'MARKET',
  'CROSS_CHAIN_FLOW': 'MARKET',
  'BRIDGE_MIGRATION': 'MARKET',
  // Watchlist → Market
  'WATCHLIST_ACCUMULATION': 'MARKET',
  'WATCHLIST_DISTRIBUTION': 'MARKET',
  'WATCHLIST_LARGE_TRANSFER': 'MARKET',
  'WATCHLIST_BRIDGE_IN': 'MARKET',
  'WATCHLIST_BRIDGE_OUT': 'MARKET',
  'WATCHLIST_ACTOR_ACTIVITY': 'MARKET',
  // Actor Intelligence (BLOCK 3)
  'ACTOR_REPEAT_BRIDGE': 'ACTOR',
  'ACTOR_ROUTE_DOMINANCE': 'ACTOR',
  'ACTOR_LIQUIDITY_ESCALATION': 'ACTOR',
  'ACTOR_MULTI_CHAIN': 'ACTOR',
  'ACTOR_STRATEGIC_TIMING': 'ACTOR',
  'ACTOR_NEW_STRATEGIC': 'ACTOR',
};

export const ALERT_SOURCE_MAP: Record<SystemAlertType, AlertSource> = {
  // System
  'CHAIN_LAG': 'chain',
  'RPC_DEGRADED': 'system',
  'RPC_RECOVERED': 'system',
  'CHAIN_PAUSED': 'chain',
  'CHAIN_RESUMED': 'chain',
  'INDEXER_PAUSE': 'system',
  'INDEXER_RESUME': 'system',
  // ML
  'ML_GATE_BLOCK': 'ml',
  'ML_GATE_PASS': 'ml',
  'ML_KILL_SWITCH': 'ml',
  'ML_KILL_RESET': 'ml',
  'ML_DRIFT_HIGH': 'ml',
  'ML_DRIFT_NORMAL': 'ml',
  'ML_MODE_CHANGE': 'ml',
  // Market
  'BRIDGE_ACTIVITY_SPIKE': 'bridge',
  'LARGE_LIQUIDITY_MOVE': 'market',
  'CROSS_CHAIN_FLOW': 'bridge',
  'BRIDGE_MIGRATION': 'bridge',
  // Watchlist
  'WATCHLIST_ACCUMULATION': 'watchlist',
  'WATCHLIST_DISTRIBUTION': 'watchlist',
  'WATCHLIST_LARGE_TRANSFER': 'watchlist',
  'WATCHLIST_BRIDGE_IN': 'watchlist',
  'WATCHLIST_BRIDGE_OUT': 'watchlist',
  'WATCHLIST_ACTOR_ACTIVITY': 'watchlist',
  // Actor Intelligence (BLOCK 3)
  'ACTOR_REPEAT_BRIDGE': 'actor_intelligence',
  'ACTOR_ROUTE_DOMINANCE': 'actor_intelligence',
  'ACTOR_LIQUIDITY_ESCALATION': 'actor_intelligence',
  'ACTOR_MULTI_CHAIN': 'actor_intelligence',
  'ACTOR_STRATEGIC_TIMING': 'actor_intelligence',
  'ACTOR_NEW_STRATEGIC': 'actor_intelligence',
};

// Default severity per alert type
export const ALERT_DEFAULT_SEVERITY: Record<SystemAlertType, AlertSeverity> = {
  // System
  'CHAIN_LAG': 'MEDIUM',
  'RPC_DEGRADED': 'HIGH',
  'RPC_RECOVERED': 'INFO',
  'CHAIN_PAUSED': 'CRITICAL',
  'CHAIN_RESUMED': 'INFO',
  'INDEXER_PAUSE': 'HIGH',
  'INDEXER_RESUME': 'INFO',
  // ML
  'ML_GATE_BLOCK': 'MEDIUM',
  'ML_GATE_PASS': 'INFO',
  'ML_KILL_SWITCH': 'CRITICAL',
  'ML_KILL_RESET': 'INFO',
  'ML_DRIFT_HIGH': 'HIGH',
  'ML_DRIFT_NORMAL': 'INFO',
  'ML_MODE_CHANGE': 'MEDIUM',
  // Market
  'BRIDGE_ACTIVITY_SPIKE': 'HIGH',
  'LARGE_LIQUIDITY_MOVE': 'MEDIUM',
  'CROSS_CHAIN_FLOW': 'MEDIUM',
  'BRIDGE_MIGRATION': 'HIGH',
  // Watchlist
  'WATCHLIST_ACCUMULATION': 'MEDIUM',
  'WATCHLIST_DISTRIBUTION': 'MEDIUM',
  'WATCHLIST_LARGE_TRANSFER': 'HIGH',
  'WATCHLIST_BRIDGE_IN': 'HIGH',
  'WATCHLIST_BRIDGE_OUT': 'HIGH',
  'WATCHLIST_ACTOR_ACTIVITY': 'LOW',
  // Actor Intelligence (BLOCK 3)
  'ACTOR_REPEAT_BRIDGE': 'MEDIUM',
  'ACTOR_ROUTE_DOMINANCE': 'MEDIUM',
  'ACTOR_LIQUIDITY_ESCALATION': 'HIGH',
  'ACTOR_MULTI_CHAIN': 'LOW',
  'ACTOR_STRATEGIC_TIMING': 'HIGH',
  'ACTOR_NEW_STRATEGIC': 'HIGH',
};
