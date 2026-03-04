/**
 * Alert Rules Repository (P0 Architecture)
 * 
 * Key: Always auto-create WatchlistItem when creating alert
 */
import {
  AlertRuleModel,
  createAlertRuleWithWatchlist,
  getUserAlertRules,
  updateLastTriggered,
  migrateExistingRules,
} from './alert_rules.model.js';

import type {
  IAlertRule,
  AlertScope,
  AlertTriggerType,
  ThrottleInterval,
  AlertChannels,
  AlertTriggerConfig,
} from './alert_rules.model.js';

export interface CreateAlertRuleInput {
  userId: string;
  scope: AlertScope;
  targetId: string;
  triggerTypes: AlertTriggerType[];
  trigger?: AlertTriggerConfig;
  channels?: AlertChannels;
  minSeverity?: number;
  minConfidence?: number;
  minStability?: number;
  throttle?: ThrottleInterval;
  name?: string;
  targetMeta?: { symbol?: string; name?: string; chain?: string };
  sensitivity?: 'low' | 'medium' | 'high';
}

export interface UpdateAlertRuleInput {
  triggerTypes?: AlertTriggerType[];
  trigger?: AlertTriggerConfig;
  channels?: AlertChannels;
  minSeverity?: number;
  minConfidence?: number;
  minStability?: number;
  throttle?: ThrottleInterval;
  status?: 'active' | 'paused';
  active?: boolean;
  name?: string;
  sensitivity?: 'low' | 'medium' | 'high';
}

/**
 * Create alert rule with auto-created WatchlistItem
 */
export async function createAlertRule(input: CreateAlertRuleInput): Promise<IAlertRule> {
  return createAlertRuleWithWatchlist(input.userId, {
    scope: input.scope,
    targetId: input.targetId,
    triggerTypes: input.triggerTypes,
    trigger: input.trigger,
    channels: input.channels,
    minSeverity: input.minSeverity,
    minConfidence: input.minConfidence,
    throttle: input.throttle,
    name: input.name,
    targetMeta: input.targetMeta,
    sensitivity: input.sensitivity,  // A5.4: Pass sensitivity to model
  });
}

/**
 * Get rule by ID
 */
export async function getAlertRuleById(id: string): Promise<IAlertRule | null> {
  return AlertRuleModel.findById(id).populate('watchlistItemId').lean();
}

/**
 * Get user's rules with watchlist info
 */
export async function getAlertRulesByUser(
  userId: string,
  activeOnly: boolean = false
): Promise<IAlertRule[]> {
  return getUserAlertRules(userId, { activeOnly });
}

/**
 * Get active rules matching criteria
 */
export async function getMatchingRules(
  scope: AlertScope,
  targetId: string,
  signalType: string
): Promise<IAlertRule[]> {
  return AlertRuleModel
    .find({
      status: 'active',
      scope,
      targetId: targetId.toLowerCase(),
      triggerTypes: signalType,
    })
    .lean();
}

/**
 * Get all active rules for a signal type
 */
export async function getActiveRulesForSignalType(
  signalType: string
): Promise<IAlertRule[]> {
  return AlertRuleModel
    .find({
      status: 'active',
      triggerTypes: signalType,
    })
    .lean();
}

/**
 * Update rule
 */
export async function updateAlertRule(
  id: string,
  update: UpdateAlertRuleInput
): Promise<IAlertRule | null> {
  // Handle status change
  if (update.status !== undefined) {
    update.active = update.status === 'active';
  } else if (update.active !== undefined) {
    update.status = update.active ? 'active' : 'paused';
  }
  
  return AlertRuleModel.findByIdAndUpdate(
    id,
    { $set: update },
    { new: true }
  ).populate('watchlistItemId').lean();
}

/**
 * Delete rule
 */
export async function deleteAlertRule(id: string): Promise<boolean> {
  const result = await AlertRuleModel.deleteOne({ _id: id });
  return result.deletedCount > 0;
}

/**
 * Count user's rules
 */
export async function countAlertRulesByUser(userId: string): Promise<number> {
  return AlertRuleModel.countDocuments({ userId });
}

/**
 * Get rules stats
 */
export async function getAlertRulesStats(): Promise<{
  total: number;
  active: number;
  byScope: Record<string, number>;
}> {
  const [total, active, byScopeAgg] = await Promise.all([
    AlertRuleModel.countDocuments(),
    AlertRuleModel.countDocuments({ status: 'active' }),
    AlertRuleModel.aggregate([
      { $group: { _id: '$scope', count: { $sum: 1 } } },
    ]),
  ]);
  
  const byScope: Record<string, number> = {};
  for (const item of byScopeAgg) {
    byScope[item._id] = item.count;
  }
  
  return { total, active, byScope };
}

/**
 * Record alert trigger
 */
export async function recordAlertTrigger(
  ruleId: string,
  meta?: { txHash?: string; value?: number; actorAddress?: string; signalId?: string }
): Promise<void> {
  return updateLastTriggered(ruleId, meta);
}

/**
 * Run migration for existing rules
 */
export async function runMigration(): Promise<number> {
  return migrateExistingRules();
}

// Re-export types
export {
  AlertScope,
  AlertTriggerType,
  ThrottleInterval,
  AlertChannels,
  AlertTriggerConfig,
  IAlertRule,
};
