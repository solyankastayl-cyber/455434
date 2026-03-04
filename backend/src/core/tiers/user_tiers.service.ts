/**
 * User Tiers Service
 * Business logic for tier enforcement
 */
import {
  IUserTier,
  UserTier,
  TierLimits,
  TIER_LIMITS,
  getEffectiveLimits,
  isRareStrategy,
} from './user_tiers.model.js';
import * as repo from './user_tiers.repository.js';
import { IStrategySignal } from '../strategy_signals/strategy_signals.model.js';

/**
 * Enforcement result
 */
export interface EnforcementResult {
  allowed: boolean;
  reason?: string;
  limit?: number;
  current?: number;
}

/**
 * Get user's tier info
 */
export async function getUserTierInfo(userId: string): Promise<{
  tier: UserTier;
  limits: TierLimits;
  usage: IUserTier['usage'];
}> {
  const userTier = await repo.getOrCreateUserTier(userId);
  const limits = getEffectiveLimits(userTier);
  
  return {
    tier: userTier.tier,
    limits,
    usage: userTier.usage,
  };
}

/**
 * Update user tier (admin only in production)
 */
export async function setUserTier(
  userId: string,
  tier: UserTier
): Promise<IUserTier | null> {
  return repo.updateUserTier(userId, tier);
}

// ========== ENFORCEMENT CHECKS ==========

/**
 * Check if user can create more follows
 */
export async function canCreateFollow(userId: string): Promise<EnforcementResult> {
  const userTier = await repo.getOrCreateUserTier(userId);
  const limits = getEffectiveLimits(userTier);
  
  // Import here to avoid circular dependency
  const { countFollowsByUser } = await import('../follows/follows.repository.js');
  const currentCount = await countFollowsByUser(userId);
  
  if (currentCount >= limits.follows) {
    return {
      allowed: false,
      reason: `Follow limit reached (${limits.follows} for ${userTier.tier} tier)`,
      limit: limits.follows,
      current: currentCount,
    };
  }
  
  return { allowed: true, limit: limits.follows, current: currentCount };
}

/**
 * Check if user can create more alert rules
 */
export async function canCreateAlertRule(userId: string): Promise<EnforcementResult> {
  const userTier = await repo.getOrCreateUserTier(userId);
  const limits = getEffectiveLimits(userTier);
  
  // Import here to avoid circular dependency
  const { countAlertRulesByUser } = await import('../alerts/alert_rules.repository.js');
  const currentCount = await countAlertRulesByUser(userId);
  
  if (currentCount >= limits.alertRules) {
    return {
      allowed: false,
      reason: `Alert rule limit reached (${limits.alertRules} for ${userTier.tier} tier)`,
      limit: limits.alertRules,
      current: currentCount,
    };
  }
  
  return { allowed: true, limit: limits.alertRules, current: currentCount };
}

/**
 * Check if user can access a signal (based on confidence and strategy rarity)
 */
export async function canAccessSignal(
  userId: string,
  signal: IStrategySignal
): Promise<EnforcementResult> {
  const userTier = await repo.getOrCreateUserTier(userId);
  const limits = getEffectiveLimits(userTier);
  
  // Check confidence threshold
  if (signal.confidence < limits.minConfidenceAccess) {
    return {
      allowed: false,
      reason: `Signal confidence (${signal.confidence.toFixed(2)}) below tier access level (${limits.minConfidenceAccess})`,
    };
  }
  
  // Check rare strategy access
  if (isRareStrategy(signal.strategyType) && !limits.rareStrategiesAccess) {
    return {
      allowed: false,
      reason: `Rare strategy '${signal.strategyType}' requires Pro or Elite tier`,
    };
  }
  
  // Check daily signals limit
  const usage = await repo.getSignalsUsage(userId);
  if (usage.used >= usage.limit) {
    return {
      allowed: false,
      reason: `Daily signals limit reached (${usage.limit} for ${userTier.tier} tier)`,
      limit: usage.limit,
      current: usage.used,
    };
  }
  
  return { allowed: true };
}

/**
 * Check API rate limit
 */
export async function checkRateLimit(userId: string): Promise<EnforcementResult> {
  const result = await repo.checkAndIncrementRateLimit(userId);
  
  if (!result.allowed) {
    return {
      allowed: false,
      reason: `Rate limit exceeded (${result.limit} requests/minute for your tier)`,
      limit: result.limit,
      current: result.current,
    };
  }
  
  return { allowed: true, limit: result.limit, current: result.current };
}

/**
 * Get signal delay for user
 */
export async function getSignalDelay(userId: string): Promise<number> {
  const userTier = await repo.getOrCreateUserTier(userId);
  const limits = getEffectiveLimits(userTier);
  return limits.signalDelay;
}

/**
 * Get historical depth access (in days)
 */
export async function getHistoricalDepth(userId: string): Promise<number> {
  const userTier = await repo.getOrCreateUserTier(userId);
  const limits = getEffectiveLimits(userTier);
  return limits.historicalDepthDays;
}

/**
 * Track signal access (increment usage)
 */
export async function trackSignalAccess(userId: string): Promise<void> {
  await repo.incrementSignalsUsage(userId);
}
