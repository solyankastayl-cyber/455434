/**
 * Alert Rules MongoDB Model (P0 Architecture)
 * 
 * AlertRule = condition + channel + watchlistItemId
 * 
 * Key principle: AlertRule ALWAYS has watchlistItemId
 * Auto-create WatchlistItem when creating alert
 * 
 * Alert ≠ Watchlist, but Alert ALWAYS linked to Watchlist
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Alert scope types
 */
export type AlertScope = 'strategy' | 'actor' | 'entity' | 'token' | 'wallet';

/**
 * Throttle options
 */
export type ThrottleInterval = '1h' | '6h' | '24h';

/**
 * Trigger types (from strategy signals + token signals)
 */
export type AlertTriggerType =
  // Strategy triggers
  | 'strategy_detected'
  | 'strategy_confirmed'
  | 'strategy_shift'
  | 'strategy_phase_change'
  | 'strategy_intensity_spike'
  | 'strategy_risk_spike'
  | 'strategy_influence_jump'
  // Token triggers (P0)
  | 'accumulation'
  | 'distribution'
  | 'large_move'
  | 'smart_money_entry'
  | 'smart_money_exit'
  | 'net_flow_spike'
  | 'activity_spike';

/**
 * Extended trigger configuration (P0+)
 */
export interface AlertTriggerConfig {
  type: AlertTriggerType;
  threshold?: number;
  direction?: 'in' | 'out';
  window?: '1h' | '6h' | '24h';
}

/**
 * Notification channels
 */
export interface AlertChannels {
  inApp: boolean;
  telegram: boolean;
}

/**
 * Last triggered metadata
 */
export interface LastTriggeredMeta {
  txHash?: string;
  value?: number;
  actorAddress?: string;
  signalId?: string;
}

/**
 * Alert Rule Document Interface
 */
/**
 * Target types for alerts
 */
export type AlertTargetType = 'token' | 'wallet' | 'actor';

/**
 * Sensitivity presets for alerts
 * Maps to concrete threshold parameters
 */
export type SensitivityLevel = 'low' | 'medium' | 'high';

/**
 * Alert priority levels
 */
export type AlertPriority = 'low' | 'medium' | 'high';

/**
 * Alert Stats - 24h rolling window statistics
 * This is the SEMANTIC BACKBONE for Adaptive Alerts
 */
export interface AlertStats24h {
  // Core counts
  triggers24h: number;
  suppressedCount24h: number;  // Rate-limited / silent updates
  
  // Quality indicators
  highestPriority24h: AlertPriority;
  dominantReason24h?: string;  // Most common trigger reason
  
  // Computed
  noiseScore: number;  // triggers24h + suppressedCount24h * 0.5
  
  // Window tracking
  windowStart: Date;
  lastUpdated: Date;
}

/**
 * Feedback status for alert fatigue detection
 */
export interface AlertFeedbackStatus {
  triggersIn24h: number;
  lastFeedbackSentAt?: Date;
  feedbackSent: boolean;
}

export interface IAlertRule extends Document {
  _id: Types.ObjectId;
  
  // User
  userId: string;
  
  // 🔑 REQUIRED: Link to WatchlistItem
  watchlistItemId: Types.ObjectId;
  
  // Target specification (denormalized for queries)
  scope: AlertScope;
  targetType: AlertTargetType;  // 👈 Explicit target type for easier rendering
  targetId: string;  // address or entityId
  
  // Trigger conditions (extended)
  trigger: AlertTriggerConfig;
  triggerTypes: AlertTriggerType[];  // Legacy compatibility
  minSeverity: number;
  minConfidence: number;
  minStability?: number;
  
  // Sensitivity preset (A5.4)
  sensitivity: SensitivityLevel;
  
  // Notification channels
  channels: AlertChannels;
  
  // Throttle to prevent spam
  throttle: ThrottleInterval;
  
  // Status
  status: 'active' | 'paused';
  active: boolean;  // Legacy compatibility
  
  // Last triggered tracking
  lastTriggeredAt?: Date;
  lastTriggeredMeta?: LastTriggeredMeta;
  triggerCount: number;
  
  // Alert Feedback Loop (P3)
  recentTriggerTimestamps: Date[];  // Rolling window of trigger times
  feedbackStatus?: AlertFeedbackStatus;
  
  // A5.1: Alert Stats - 24h rolling window
  stats24h?: AlertStats24h;
  
  // Metadata
  name?: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Throttle intervals in milliseconds
 */
export const THROTTLE_MS: Record<ThrottleInterval, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

// ============================================================================
// A5.4: SENSITIVITY PRESETS
// Sensitivity = frequency expectation, NOT strength
// ============================================================================

/**
 * Sensitivity preset configurations
 * Maps abstract levels to concrete thresholds
 */
export interface SensitivityConfig {
  window: '1h' | '6h' | '24h';
  cooldown: '15m' | '1h' | '6h';
  minTransferSizeUsd: number;
  thresholdMultiplier: number;  // For baseline deviation
  description: string;
  expectedFrequency: string;
}

/**
 * Sensitivity presets for token alerts
 */
export const TOKEN_SENSITIVITY_PRESETS: Record<SensitivityLevel, SensitivityConfig> = {
  high: {
    window: '1h',
    cooldown: '15m',
    minTransferSizeUsd: 10_000,
    thresholdMultiplier: 2,  // 2x baseline = signal
    description: 'Any unusual activity',
    expectedFrequency: 'May trigger multiple times per day',
  },
  medium: {
    window: '6h',
    cooldown: '1h',
    minTransferSizeUsd: 50_000,
    thresholdMultiplier: 3,  // 3x baseline = signal
    description: 'Notable activity only',
    expectedFrequency: 'A few times per week',
  },
  low: {
    window: '24h',
    cooldown: '6h',
    minTransferSizeUsd: 250_000,
    thresholdMultiplier: 5,  // 5x baseline = signal
    description: 'Major movements only',
    expectedFrequency: 'Rarely, only significant events',
  },
};

/**
 * Sensitivity presets for wallet alerts
 */
export const WALLET_SENSITIVITY_PRESETS: Record<SensitivityLevel, SensitivityConfig> = {
  high: {
    window: '1h',
    cooldown: '15m',
    minTransferSizeUsd: 5_000,
    thresholdMultiplier: 3,  // 3x activity = signal
    description: 'Any unusual wallet activity',
    expectedFrequency: 'May trigger multiple times per day',
  },
  medium: {
    window: '6h',
    cooldown: '1h',
    minTransferSizeUsd: 25_000,
    thresholdMultiplier: 5,  // 5x activity = signal
    description: 'Significant activity changes',
    expectedFrequency: 'A few times per week',
  },
  low: {
    window: '24h',
    cooldown: '6h',
    minTransferSizeUsd: 100_000,
    thresholdMultiplier: 10,  // 10x activity = signal
    description: 'Major wallet movements only',
    expectedFrequency: 'Rarely, only major events',
  },
};

/**
 * Get sensitivity config for alert type
 */
export function getSensitivityConfig(
  scope: AlertScope,
  level: SensitivityLevel
): SensitivityConfig {
  if (scope === 'wallet') {
    return WALLET_SENSITIVITY_PRESETS[level];
  }
  return TOKEN_SENSITIVITY_PRESETS[level];
}

/**
 * Map sensitivity to minSeverity threshold
 */
export function sensitivityToMinSeverity(level: SensitivityLevel): number {
  switch (level) {
    case 'high': return 30;    // Trigger on low severity
    case 'medium': return 50;  // Trigger on medium severity
    case 'low': return 70;     // Trigger only on high severity
    default: return 50;
  }
}

/**
 * Map sensitivity to throttle
 */
export function sensitivityToThrottle(level: SensitivityLevel): ThrottleInterval {
  switch (level) {
    case 'high': return '1h';
    case 'medium': return '6h';
    case 'low': return '24h';
    default: return '6h';
  }
}

/**
 * Default throttle per trigger type
 */
export const DEFAULT_THROTTLE: Record<string, ThrottleInterval> = {
  'strategy_detected': '24h',
  'strategy_confirmed': '24h',
  'strategy_shift': '6h',
  'strategy_phase_change': '6h',
  'strategy_intensity_spike': '6h',
  'strategy_risk_spike': '6h',
  'strategy_influence_jump': '6h',
  'accumulation': '6h',
  'distribution': '6h',
  'large_move': '1h',
  'smart_money_entry': '6h',
  'smart_money_exit': '6h',
  'net_flow_spike': '6h',
  'activity_spike': '1h',
};

/**
 * Alert Rule Schema
 */
const AlertRuleSchema = new Schema<IAlertRule>(
  {
    // User
    userId: {
      type: String,
      required: true,
      index: true,
    },
    
    // 🔑 REQUIRED: Link to WatchlistItem
    watchlistItemId: {
      type: Schema.Types.ObjectId,
      ref: 'WatchlistItem',
      required: true,
      index: true,
    },
    
    // Target (denormalized for queries and UI rendering)
    scope: {
      type: String,
      enum: ['strategy', 'actor', 'entity', 'token', 'wallet'],
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ['token', 'wallet', 'actor'],
      required: true,
      index: true,
    },
    targetId: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    
    // Extended trigger config
    trigger: {
      type: {
        type: String,
        enum: [
          'strategy_detected', 'strategy_confirmed', 'strategy_shift',
          'strategy_phase_change', 'strategy_intensity_spike',
          'strategy_risk_spike', 'strategy_influence_jump',
          'accumulation', 'distribution', 'large_move',
          'smart_money_entry', 'smart_money_exit',
          'net_flow_spike', 'activity_spike',
        ],
      },
      threshold: Number,
      direction: {
        type: String,
        enum: ['in', 'out'],
      },
      window: {
        type: String,
        enum: ['1h', '6h', '24h'],
      },
    },
    
    // Legacy: trigger types array
    triggerTypes: {
      type: [String],
      enum: [
        'strategy_detected', 'strategy_confirmed', 'strategy_shift',
        'strategy_phase_change', 'strategy_intensity_spike',
        'strategy_risk_spike', 'strategy_influence_jump',
        'accumulation', 'distribution', 'large_move',
        'smart_money_entry', 'smart_money_exit',
        'net_flow_spike', 'activity_spike',
      ],
      default: [],
    },
    
    minSeverity: {
      type: Number,
      min: 0,
      max: 100,
      default: 50,
    },
    minConfidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.6,
    },
    minStability: {
      type: Number,
      min: 0,
      max: 1,
    },
    
    // Sensitivity preset (A5.4)
    sensitivity: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    
    // Notification channels
    channels: {
      inApp: {
        type: Boolean,
        default: true,
      },
      telegram: {
        type: Boolean,
        default: true,
      },
    },
    
    // Throttle
    throttle: {
      type: String,
      enum: ['1h', '6h', '24h'],
      default: '6h',
    },
    
    // Status
    status: {
      type: String,
      enum: ['active', 'paused'],
      default: 'active',
      index: true,
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    
    // Last triggered
    lastTriggeredAt: Date,
    lastTriggeredMeta: {
      txHash: String,
      value: Number,
      actorAddress: String,
      signalId: String,
    },
    triggerCount: {
      type: Number,
      default: 0,
    },
    
    // Alert Feedback Loop (P3)
    recentTriggerTimestamps: {
      type: [Date],
      default: [],
    },
    feedbackStatus: {
      triggersIn24h: {
        type: Number,
        default: 0,
      },
      lastFeedbackSentAt: Date,
      feedbackSent: {
        type: Boolean,
        default: false,
      },
    },
    
    // A5.1: Alert Stats - 24h rolling window (SEMANTIC BACKBONE)
    stats24h: {
      triggers24h: {
        type: Number,
        default: 0,
      },
      suppressedCount24h: {
        type: Number,
        default: 0,
      },
      highestPriority24h: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'low',
      },
      dominantReason24h: String,
      noiseScore: {
        type: Number,
        default: 0,
      },
      windowStart: Date,
      lastUpdated: Date,
    },
    
    // Metadata
    name: String,
  },
  {
    timestamps: true,
    collection: 'alert_rules',
  }
);

// Compound indexes
AlertRuleSchema.index({ userId: 1, status: 1 });
AlertRuleSchema.index({ scope: 1, targetId: 1, status: 1 });
AlertRuleSchema.index({ watchlistItemId: 1 });

// Pre-save: sync active with status
AlertRuleSchema.pre('save', function(next) {
  this.active = this.status === 'active';
  next();
});

export const AlertRuleModel = mongoose.model<IAlertRule>('AlertRule', AlertRuleSchema);

// ============================================================================
// REPOSITORY FUNCTIONS
// ============================================================================

/**
 * Create alert rule with auto-created WatchlistItem
 */
export async function createAlertRuleWithWatchlist(
  userId: string,
  data: {
    scope: AlertScope;
    targetId: string;
    triggerTypes: AlertTriggerType[];
    trigger?: AlertTriggerConfig;
    channels?: AlertChannels;
    minSeverity?: number;
    minConfidence?: number;
    throttle?: ThrottleInterval;
    name?: string;
    targetMeta?: { symbol?: string; name?: string; chain?: string };
    sensitivity?: SensitivityLevel;  // A5.4: Add sensitivity parameter
  }
): Promise<IAlertRule> {
  const { findOrCreateWatchlistItem } = await import('../watchlist/watchlist.model.js');
  
  // Map scope to watchlist type / targetType
  const targetType: AlertTargetType = data.scope === 'strategy' ? 'actor' : 
                                       data.scope === 'entity' ? 'actor' :
                                       data.scope as AlertTargetType;
  
  // Auto-create WatchlistItem
  const watchlistItem = await findOrCreateWatchlistItem(
    userId,
    targetType,
    {
      address: data.targetId,
      chain: data.targetMeta?.chain || 'ethereum',
      symbol: data.targetMeta?.symbol,
      name: data.targetMeta?.name,
    }
  );
  
  // A5.4: Use sensitivity to derive minSeverity and throttle if not explicitly set
  const sensitivity = data.sensitivity || 'medium';
  const derivedMinSeverity = data.minSeverity ?? sensitivityToMinSeverity(sensitivity);
  const derivedThrottle = data.throttle || sensitivityToThrottle(sensitivity);
  
  // Create AlertRule with watchlistItemId and targetType
  const rule = new AlertRuleModel({
    userId,
    watchlistItemId: watchlistItem._id,
    scope: data.scope,
    targetType,  // 👈 Explicit target type
    targetId: data.targetId.toLowerCase(),
    triggerTypes: data.triggerTypes,
    trigger: data.trigger || { type: data.triggerTypes[0] },
    channels: data.channels || { inApp: true, telegram: true },
    minSeverity: derivedMinSeverity,
    minConfidence: data.minConfidence ?? 0.6,
    throttle: derivedThrottle,
    sensitivity: sensitivity,  // A5.4: Store sensitivity level
    name: data.name,
    status: 'active',
    active: true,
    triggerCount: 0,
  });
  
  await rule.save();
  return rule;
}

/**
 * Get user's alert rules with watchlist info
 */
export async function getUserAlertRules(
  userId: string,
  options: { activeOnly?: boolean } = {}
): Promise<IAlertRule[]> {
  const query: any = { userId };
  if (options.activeOnly) {
    query.status = 'active';
  }
  
  return AlertRuleModel.find(query)
    .populate('watchlistItemId')
    .sort({ createdAt: -1 });
}

/**
 * Update alert rule status (pause/resume)
 */
export async function updateAlertRuleStatus(
  userId: string,
  ruleId: string,
  status: 'active' | 'paused'
): Promise<IAlertRule | null> {
  return AlertRuleModel.findOneAndUpdate(
    { _id: ruleId, userId },
    { status, active: status === 'active' },
    { new: true }
  );
}

/**
 * Delete alert rule
 */
export async function deleteAlertRule(
  userId: string,
  ruleId: string
): Promise<boolean> {
  const result = await AlertRuleModel.deleteOne({ _id: ruleId, userId });
  return result.deletedCount > 0;
}

/**
 * Update last triggered info and track recent triggers for feedback loop
 * Also updates A5.1 stats24h
 */
export async function updateLastTriggered(
  ruleId: string,
  meta?: LastTriggeredMeta,
  options?: {
    priority?: AlertPriority;
    reason?: string;
    wasSuppressed?: boolean;
  }
): Promise<{ shouldSendFeedback: boolean; triggersIn24h: number; stats: AlertStats24h }> {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  // First, get current rule to check recent triggers
  const rule = await AlertRuleModel.findById(ruleId);
  if (!rule) {
    return { 
      shouldSendFeedback: false, 
      triggersIn24h: 0, 
      stats: {
        triggers24h: 0,
        suppressedCount24h: 0,
        highestPriority24h: 'low',
        noiseScore: 0,
        windowStart: now,
        lastUpdated: now,
      }
    };
  }
  
  // Filter out old timestamps and add new one
  const recentTriggers = (rule.recentTriggerTimestamps || [])
    .filter((ts: Date) => new Date(ts) > twentyFourHoursAgo);
  recentTriggers.push(now);
  
  const triggersIn24h = recentTriggers.length;
  
  // A5.1: Calculate updated stats24h
  const currentStats = rule.stats24h || {
    triggers24h: 0,
    suppressedCount24h: 0,
    highestPriority24h: 'low' as AlertPriority,
    noiseScore: 0,
    windowStart: twentyFourHoursAgo,
    lastUpdated: now,
  };
  
  // Reset stats if window has passed
  const windowStillValid = currentStats.windowStart && 
    new Date(currentStats.windowStart) > twentyFourHoursAgo;
  
  const newStats: AlertStats24h = windowStillValid ? {
    triggers24h: options?.wasSuppressed ? currentStats.triggers24h : currentStats.triggers24h + 1,
    suppressedCount24h: options?.wasSuppressed ? currentStats.suppressedCount24h + 1 : currentStats.suppressedCount24h,
    highestPriority24h: getHigherPriority(currentStats.highestPriority24h, options?.priority || 'low'),
    dominantReason24h: options?.reason || currentStats.dominantReason24h,
    noiseScore: 0, // Will be calculated below
    windowStart: currentStats.windowStart,
    lastUpdated: now,
  } : {
    triggers24h: options?.wasSuppressed ? 0 : 1,
    suppressedCount24h: options?.wasSuppressed ? 1 : 0,
    highestPriority24h: options?.priority || 'low',
    dominantReason24h: options?.reason,
    noiseScore: 0,
    windowStart: twentyFourHoursAgo,
    lastUpdated: now,
  };
  
  // Calculate noiseScore: triggers24h + suppressedCount24h * 0.5
  newStats.noiseScore = newStats.triggers24h + (newStats.suppressedCount24h * 0.5);
  
  // Determine if we should send feedback
  // Condition: noiseScore >= 3 AND highestPriority24h !== 'high' AND feedback not sent recently
  const shouldSendFeedback = 
    newStats.noiseScore >= 3 &&
    newStats.highestPriority24h !== 'high' &&
    (!rule.feedbackStatus?.feedbackSent || 
     !rule.feedbackStatus?.lastFeedbackSentAt ||
     new Date(rule.feedbackStatus.lastFeedbackSentAt) < twentyFourHoursAgo);
  
  // Update the rule
  await AlertRuleModel.updateOne(
    { _id: ruleId },
    {
      lastTriggeredAt: now,
      lastTriggeredMeta: meta,
      $inc: { triggerCount: options?.wasSuppressed ? 0 : 1 },
      recentTriggerTimestamps: recentTriggers,
      'feedbackStatus.triggersIn24h': triggersIn24h,
      stats24h: newStats,
    }
  );
  
  return { shouldSendFeedback, triggersIn24h, stats: newStats };
}

/**
 * Helper: Get higher priority
 */
function getHigherPriority(a: AlertPriority, b: AlertPriority): AlertPriority {
  const order = { 'low': 0, 'medium': 1, 'high': 2 };
  return order[a] >= order[b] ? a : b;
}

/**
 * Record suppressed alert (rate-limited)
 */
export async function recordSuppressedAlert(
  ruleId: string,
  reason?: string
): Promise<void> {
  await updateLastTriggered(ruleId, undefined, { 
    wasSuppressed: true, 
    reason 
  });
}

/**
 * Get alert stats for a rule
 */
export async function getAlertStats(ruleId: string): Promise<AlertStats24h | null> {
  const rule = await AlertRuleModel.findById(ruleId);
  if (!rule) return null;
  
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  // Recalculate from recentTriggerTimestamps if stats are stale
  const recentTriggers = (rule.recentTriggerTimestamps || [])
    .filter((ts: Date) => new Date(ts) > twentyFourHoursAgo);
  
  const stats = rule.stats24h || {
    triggers24h: recentTriggers.length,
    suppressedCount24h: 0,
    highestPriority24h: 'low' as AlertPriority,
    noiseScore: recentTriggers.length,
    windowStart: twentyFourHoursAgo,
    lastUpdated: now,
  };
  
  // Ensure noiseScore is fresh
  stats.noiseScore = stats.triggers24h + (stats.suppressedCount24h * 0.5);
  
  return stats;
}

/**
 * Mark feedback as sent for a rule
 */
export async function markFeedbackSent(ruleId: string): Promise<void> {
  await AlertRuleModel.updateOne(
    { _id: ruleId },
    {
      'feedbackStatus.feedbackSent': true,
      'feedbackStatus.lastFeedbackSentAt': new Date(),
    }
  );
}

/**
 * Reset feedback status (when user adjusts settings)
 */
export async function resetFeedbackStatus(ruleId: string): Promise<void> {
  await AlertRuleModel.updateOne(
    { _id: ruleId },
    {
      'feedbackStatus.feedbackSent': false,
      'feedbackStatus.lastFeedbackSentAt': null,
    }
  );
}

/**
 * Get active rules for target
 */
export async function getActiveRulesForTarget(
  scope: AlertScope,
  targetId: string
): Promise<IAlertRule[]> {
  return AlertRuleModel.find({
    scope,
    targetId: targetId.toLowerCase(),
    status: 'active',
  });
}

/**
 * Count alerts for watchlist item
 */
export async function countAlertsForWatchlistItem(
  watchlistItemId: string
): Promise<number> {
  return AlertRuleModel.countDocuments({
    watchlistItemId,
    status: 'active',
  });
}

/**
 * Migration: Add watchlistItemId to existing rules
 */
export async function migrateExistingRules(): Promise<number> {
  const { findOrCreateWatchlistItem } = await import('../watchlist/watchlist.model.js');
  
  // Find rules without watchlistItemId
  const rulesWithoutWatchlist = await AlertRuleModel.find({
    watchlistItemId: { $exists: false },
  });
  
  let migrated = 0;
  
  for (const rule of rulesWithoutWatchlist) {
    try {
      const watchlistType = rule.scope === 'strategy' ? 'actor' : rule.scope;
      
      const watchlistItem = await findOrCreateWatchlistItem(
        rule.userId,
        watchlistType as any,
        {
          address: rule.targetId,
          chain: 'ethereum',
        }
      );
      
      rule.watchlistItemId = watchlistItem._id;
      await rule.save();
      migrated++;
    } catch (err) {
      console.error(`[Migration] Failed to migrate rule ${rule._id}:`, err);
    }
  }
  
  console.log(`[Migration] Migrated ${migrated} alert rules`);
  return migrated;
}
