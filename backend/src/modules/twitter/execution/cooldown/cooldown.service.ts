/**
 * Phase 4.2 + Phase 5.2.2 — CooldownService
 * 
 * Manages automatic cooldowns for accounts and targets
 * to prevent bans and rate limiting.
 * Sends Telegram notifications via Router.
 */

import { UserTwitterAccountModel } from '../../../twitter-user/models/twitter-account.model.js';
import { UserTwitterParseTargetModel } from '../../../twitter-user/models/user-twitter-parse-target.model.js';

// Cooldown durations (milliseconds)
export const COOLDOWN_DURATIONS = {
  RATE_LIMIT: 15 * 60 * 1000,        // 15 minutes
  ABORT_STORM: 30 * 60 * 1000,       // 30 minutes
  CONSECUTIVE_EMPTY: 10 * 60 * 1000, // 10 minutes
  CAPTCHA: 60 * 60 * 1000,           // 1 hour
};

// Thresholds for triggers
export const COOLDOWN_THRESHOLDS = {
  ABORT_COUNT: 3,           // 3 aborts in window
  ABORT_WINDOW_MS: 10 * 60 * 1000, // 10 minutes
  CONSECUTIVE_EMPTY: 5,     // 5 fetched=0 in a row
};

export interface CooldownInfo {
  isOnCooldown: boolean;
  cooldownUntil?: Date;
  cooldownReason?: string;
  remainingMs?: number;
}

export class CooldownService {
  
  /**
   * Apply cooldown to an account
   */
  async applyAccountCooldown(
    accountId: string,
    durationMs: number,
    reason: string
  ): Promise<void> {
    const cooldownUntil = new Date(Date.now() + durationMs);
    
    await UserTwitterAccountModel.updateOne(
      { _id: accountId },
      {
        $set: {
          cooldownUntil,
          cooldownReason: reason,
        },
        $inc: {
          cooldownCount: 1,
        },
      }
    );
    
    console.log(`[Cooldown] Account ${accountId} on cooldown for ${durationMs / 60000}min | reason: ${reason}`);
  }

  /**
   * Apply cooldown to a target
   * Sends Telegram notification via Router (Phase 5.2.2)
   */
  async applyTargetCooldown(
    targetId: string,
    durationMs: number,
    reason: string
  ): Promise<void> {
    const cooldownUntil = new Date(Date.now() + durationMs);
    
    // Get target info for notification
    const target = await UserTwitterParseTargetModel.findByIdAndUpdate(
      targetId,
      {
        $set: {
          cooldownUntil,
          cooldownReason: reason,
        },
      },
      { new: true }
    ).lean();
    
    console.log(`[Cooldown] Target ${targetId} on cooldown for ${durationMs / 60000}min | reason: ${reason}`);
    
    // Phase 5.2.2: Send Telegram notification
    if (target?.ownerUserId) {
      try {
        const { telegramRouter } = await import('../../../telegram/index.js');
        await telegramRouter.notifyTargetCooldown(target.ownerUserId.toString(), {
          target: (target as any).query || (target as any).targetUsername || 'unknown',
          reason,
          durationMinutes: Math.round(durationMs / 60000),
        });
      } catch (err: any) {
        console.warn(`[Cooldown] Telegram notification failed:`, err.message);
      }
    }
  }

  /**
   * Check if account is on cooldown
   */
  async isAccountOnCooldown(accountId: string): Promise<CooldownInfo> {
    const account = await UserTwitterAccountModel.findById(accountId).lean();
    
    if (!account || !account.cooldownUntil) {
      return { isOnCooldown: false };
    }
    
    const now = new Date();
    if (account.cooldownUntil > now) {
      return {
        isOnCooldown: true,
        cooldownUntil: account.cooldownUntil,
        cooldownReason: account.cooldownReason,
        remainingMs: account.cooldownUntil.getTime() - now.getTime(),
      };
    }
    
    return { isOnCooldown: false };
  }

  /**
   * Check if target is on cooldown
   */
  async isTargetOnCooldown(targetId: string): Promise<CooldownInfo> {
    const target = await UserTwitterParseTargetModel.findById(targetId).lean();
    
    if (!target || !target.cooldownUntil) {
      return { isOnCooldown: false };
    }
    
    const now = new Date();
    if (target.cooldownUntil > now) {
      return {
        isOnCooldown: true,
        cooldownUntil: target.cooldownUntil,
        cooldownReason: target.cooldownReason,
        remainingMs: target.cooldownUntil.getTime() - now.getTime(),
      };
    }
    
    return { isOnCooldown: false };
  }

  /**
   * Clear account cooldown
   */
  async clearAccountCooldown(accountId: string): Promise<void> {
    await UserTwitterAccountModel.updateOne(
      { _id: accountId },
      {
        $unset: {
          cooldownUntil: 1,
          cooldownReason: 1,
        },
      }
    );
    console.log(`[Cooldown] Account ${accountId} cooldown cleared`);
  }

  /**
   * Clear target cooldown
   */
  async clearTargetCooldown(targetId: string): Promise<void> {
    await UserTwitterParseTargetModel.updateOne(
      { _id: targetId },
      {
        $unset: {
          cooldownUntil: 1,
          cooldownReason: 1,
        },
        $set: {
          consecutiveEmptyCount: 0,
        },
      }
    );
    console.log(`[Cooldown] Target ${targetId} cooldown cleared`);
  }

  /**
   * Increment consecutive empty count for target
   * Returns true if threshold reached and cooldown applied
   */
  async trackEmptyResult(targetId: string): Promise<boolean> {
    const target = await UserTwitterParseTargetModel.findByIdAndUpdate(
      targetId,
      { $inc: { consecutiveEmptyCount: 1 } },
      { new: true }
    );

    if (!target) return false;

    if ((target.consecutiveEmptyCount || 0) >= COOLDOWN_THRESHOLDS.CONSECUTIVE_EMPTY) {
      await this.applyTargetCooldown(
        targetId,
        COOLDOWN_DURATIONS.CONSECUTIVE_EMPTY,
        'CONSECUTIVE_EMPTY'
      );
      return true;
    }

    return false;
  }

  /**
   * Reset consecutive empty count (called when fetched > 0)
   */
  async resetEmptyCount(targetId: string): Promise<void> {
    await UserTwitterParseTargetModel.updateOne(
      { _id: targetId },
      { $set: { consecutiveEmptyCount: 0 } }
    );
  }
}

// Singleton instance
export const cooldownService = new CooldownService();
