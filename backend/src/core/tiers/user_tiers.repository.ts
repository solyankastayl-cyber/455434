/**
 * User Tiers Repository
 * Data access layer for user_tiers collection
 */
import {
  UserTierModel,
  IUserTier,
  UserTier,
  TierLimits,
  TIER_LIMITS,
} from './user_tiers.model.js';

/**
 * Get or create user tier
 */
export async function getOrCreateUserTier(userId: string): Promise<IUserTier> {
  // Use findOneAndUpdate with upsert to avoid race conditions
  const tier = await UserTierModel.findOneAndUpdate(
    { userId },
    { 
      $setOnInsert: { 
        userId, 
        tier: 'free',
        usage: {
          signalsToday: 0,
          signalsDate: new Date(),
          apiRequestsMinute: 0,
          apiRequestsTimestamp: new Date(),
        },
      } 
    },
    { new: true, upsert: true }
  ).lean();
  
  return tier as IUserTier;
}

/**
 * Get user tier
 */
export async function getUserTier(userId: string): Promise<IUserTier | null> {
  return UserTierModel.findOne({ userId }).lean();
}

/**
 * Update user tier
 */
export async function updateUserTier(
  userId: string,
  tier: UserTier
): Promise<IUserTier | null> {
  return UserTierModel.findOneAndUpdate(
    { userId },
    { $set: { tier } },
    { new: true, upsert: true }
  ).lean();
}

/**
 * Set custom limits
 */
export async function setCustomLimits(
  userId: string,
  customLimits: Partial<TierLimits>
): Promise<IUserTier | null> {
  return UserTierModel.findOneAndUpdate(
    { userId },
    { $set: { customLimits } },
    { new: true, upsert: true }
  ).lean();
}

/**
 * Increment signals usage
 */
export async function incrementSignalsUsage(userId: string): Promise<boolean> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const result = await UserTierModel.updateOne(
    { userId },
    [
      {
        $set: {
          'usage.signalsToday': {
            $cond: {
              if: { $lt: ['$usage.signalsDate', today] },
              then: 1,
              else: { $add: ['$usage.signalsToday', 1] },
            },
          },
          'usage.signalsDate': today,
        },
      },
    ]
  );
  
  return result.modifiedCount > 0;
}

/**
 * Check and increment API rate limit
 */
export async function checkAndIncrementRateLimit(userId: string): Promise<{
  allowed: boolean;
  current: number;
  limit: number;
}> {
  const tier = await getOrCreateUserTier(userId);
  const limits = TIER_LIMITS[tier.tier];
  
  const now = new Date();
  const minuteAgo = new Date(now.getTime() - 60 * 1000);
  
  // Reset if more than a minute passed
  if (tier.usage.apiRequestsTimestamp < minuteAgo) {
    await UserTierModel.updateOne(
      { userId },
      {
        $set: {
          'usage.apiRequestsMinute': 1,
          'usage.apiRequestsTimestamp': now,
        },
      }
    );
    return { allowed: true, current: 1, limit: limits.apiRateLimit };
  }
  
  // Check limit
  if (tier.usage.apiRequestsMinute >= limits.apiRateLimit) {
    return { allowed: false, current: tier.usage.apiRequestsMinute, limit: limits.apiRateLimit };
  }
  
  // Increment
  await UserTierModel.updateOne(
    { userId },
    { $inc: { 'usage.apiRequestsMinute': 1 } }
  );
  
  return { allowed: true, current: tier.usage.apiRequestsMinute + 1, limit: limits.apiRateLimit };
}

/**
 * Get signals usage for today
 */
export async function getSignalsUsage(userId: string): Promise<{
  used: number;
  limit: number;
}> {
  const tier = await getOrCreateUserTier(userId);
  const limits = TIER_LIMITS[tier.tier];
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Reset if different day
  if (tier.usage.signalsDate < today) {
    return { used: 0, limit: limits.strategySignalsPerDay };
  }
  
  return { used: tier.usage.signalsToday, limit: limits.strategySignalsPerDay };
}

/**
 * Get tier stats
 */
export async function getTierStats(): Promise<{
  byTier: Record<string, number>;
  total: number;
}> {
  const [byTierAgg, total] = await Promise.all([
    UserTierModel.aggregate([
      { $group: { _id: '$tier', count: { $sum: 1 } } },
    ]),
    UserTierModel.countDocuments(),
  ]);
  
  const byTier: Record<string, number> = {};
  for (const item of byTierAgg) {
    byTier[item._id] = item.count;
  }
  
  return { byTier, total };
}
