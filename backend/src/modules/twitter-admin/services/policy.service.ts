/**
 * A.3.3 - Twitter Policy Service
 * 
 * CRUD operations for policies:
 * - Get/Update global policy
 * - Get/Set user overrides
 * - Resolve effective policy for a user
 */

import { 
  TwitterPolicyModel, 
  ITwitterPolicy, 
  IPolicyLimits, 
  IPolicyActions,
  DEFAULT_GLOBAL_POLICY,
} from '../models/twitter-policy.model.js';

export interface EffectivePolicy {
  limits: Required<IPolicyLimits>;
  actions: IPolicyActions;
  source: 'GLOBAL' | 'USER_OVERRIDE';
  enabled: boolean;
}

export class TwitterPolicyService {
  
  /**
   * Get or create global policy
   */
  async getGlobalPolicy(): Promise<ITwitterPolicy> {
    let policy = await TwitterPolicyModel.findOne({ scope: 'GLOBAL' });
    
    if (!policy) {
      policy = await TwitterPolicyModel.create({
        scope: 'GLOBAL',
        limits: {
          maxAccounts: DEFAULT_GLOBAL_POLICY.maxAccounts,
          maxTasksPerHour: DEFAULT_GLOBAL_POLICY.maxTasksPerHour,
          maxPostsPerDay: DEFAULT_GLOBAL_POLICY.maxPostsPerDay,
          maxAbortRatePct: DEFAULT_GLOBAL_POLICY.maxAbortRatePct,
        },
        actions: DEFAULT_GLOBAL_POLICY.actions,
        enabled: true,
      });
      console.log('[Policy] Created default global policy');
    }
    
    return policy;
  }
  
  /**
   * Update global policy
   */
  async updateGlobalPolicy(
    updates: Partial<IPolicyLimits> & { actions?: Partial<IPolicyActions>; enabled?: boolean }
  ): Promise<ITwitterPolicy> {
    const policy = await this.getGlobalPolicy();
    
    // Update limits
    if (updates.maxAccounts !== undefined) policy.limits.maxAccounts = updates.maxAccounts;
    if (updates.maxTasksPerHour !== undefined) policy.limits.maxTasksPerHour = updates.maxTasksPerHour;
    if (updates.maxPostsPerDay !== undefined) policy.limits.maxPostsPerDay = updates.maxPostsPerDay;
    if (updates.maxAbortRatePct !== undefined) policy.limits.maxAbortRatePct = updates.maxAbortRatePct;
    
    // Update actions
    if (updates.actions) {
      if (updates.actions.onLimitExceeded) {
        policy.actions.onLimitExceeded = updates.actions.onLimitExceeded;
      }
      if (updates.actions.cooldownMinutes !== undefined) {
        policy.actions.cooldownMinutes = updates.actions.cooldownMinutes;
      }
    }
    
    // Update enabled
    if (updates.enabled !== undefined) {
      policy.enabled = updates.enabled;
    }
    
    await policy.save();
    console.log('[Policy] Updated global policy');
    return policy;
  }
  
  /**
   * Get user-specific policy override
   */
  async getUserOverride(userId: string): Promise<ITwitterPolicy | null> {
    return TwitterPolicyModel.findOne({ scope: 'USER', userId });
  }
  
  /**
   * Set user-specific policy override
   */
  async setUserOverride(
    userId: string,
    overrides: Partial<IPolicyLimits> & { actions?: Partial<IPolicyActions>; enabled?: boolean }
  ): Promise<ITwitterPolicy> {
    const existing = await this.getUserOverride(userId);
    
    if (existing) {
      // Update existing
      if (overrides.maxAccounts !== undefined) existing.limits.maxAccounts = overrides.maxAccounts;
      if (overrides.maxTasksPerHour !== undefined) existing.limits.maxTasksPerHour = overrides.maxTasksPerHour;
      if (overrides.maxPostsPerDay !== undefined) existing.limits.maxPostsPerDay = overrides.maxPostsPerDay;
      if (overrides.maxAbortRatePct !== undefined) existing.limits.maxAbortRatePct = overrides.maxAbortRatePct;
      
      if (overrides.actions) {
        if (overrides.actions.onLimitExceeded) {
          existing.actions.onLimitExceeded = overrides.actions.onLimitExceeded;
        }
        if (overrides.actions.cooldownMinutes !== undefined) {
          existing.actions.cooldownMinutes = overrides.actions.cooldownMinutes;
        }
      }
      
      if (overrides.enabled !== undefined) {
        existing.enabled = overrides.enabled;
      }
      
      await existing.save();
      return existing;
    } else {
      // Create new override
      const globalPolicy = await this.getGlobalPolicy();
      
      return TwitterPolicyModel.create({
        scope: 'USER',
        userId,
        limits: {
          maxAccounts: overrides.maxAccounts ?? globalPolicy.limits.maxAccounts,
          maxTasksPerHour: overrides.maxTasksPerHour ?? globalPolicy.limits.maxTasksPerHour,
          maxPostsPerDay: overrides.maxPostsPerDay ?? globalPolicy.limits.maxPostsPerDay,
          maxAbortRatePct: overrides.maxAbortRatePct ?? globalPolicy.limits.maxAbortRatePct,
        },
        actions: {
          onLimitExceeded: overrides.actions?.onLimitExceeded ?? globalPolicy.actions.onLimitExceeded,
          cooldownMinutes: overrides.actions?.cooldownMinutes ?? globalPolicy.actions.cooldownMinutes,
        },
        enabled: overrides.enabled ?? true,
      });
    }
  }
  
  /**
   * Remove user override (reset to global)
   */
  async removeUserOverride(userId: string): Promise<boolean> {
    const result = await TwitterPolicyModel.deleteOne({ scope: 'USER', userId });
    return result.deletedCount > 0;
  }
  
  /**
   * Get all user overrides
   */
  async getAllUserOverrides(): Promise<ITwitterPolicy[]> {
    return TwitterPolicyModel.find({ scope: 'USER' }).sort({ updatedAt: -1 });
  }
  
  /**
   * Get effective policy for a user
   * User override takes precedence over global
   */
  async getEffectivePolicy(userId: string): Promise<EffectivePolicy> {
    const globalPolicy = await this.getGlobalPolicy();
    const userOverride = await this.getUserOverride(userId);
    
    if (userOverride && userOverride.enabled) {
      return {
        limits: {
          maxAccounts: userOverride.limits.maxAccounts ?? globalPolicy.limits.maxAccounts ?? 3,
          maxTasksPerHour: userOverride.limits.maxTasksPerHour ?? globalPolicy.limits.maxTasksPerHour ?? 20,
          maxPostsPerDay: userOverride.limits.maxPostsPerDay ?? globalPolicy.limits.maxPostsPerDay ?? 1000,
          maxAbortRatePct: userOverride.limits.maxAbortRatePct ?? globalPolicy.limits.maxAbortRatePct ?? 30,
        },
        actions: {
          onLimitExceeded: userOverride.actions.onLimitExceeded,
          cooldownMinutes: userOverride.actions.cooldownMinutes,
        },
        source: 'USER_OVERRIDE',
        enabled: globalPolicy.enabled && userOverride.enabled,
      };
    }
    
    return {
      limits: {
        maxAccounts: globalPolicy.limits.maxAccounts ?? 3,
        maxTasksPerHour: globalPolicy.limits.maxTasksPerHour ?? 20,
        maxPostsPerDay: globalPolicy.limits.maxPostsPerDay ?? 1000,
        maxAbortRatePct: globalPolicy.limits.maxAbortRatePct ?? 30,
      },
      actions: {
        onLimitExceeded: globalPolicy.actions.onLimitExceeded,
        cooldownMinutes: globalPolicy.actions.cooldownMinutes,
      },
      source: 'GLOBAL',
      enabled: globalPolicy.enabled,
    };
  }
}
