/**
 * TwitterQuotaService - управление квотами и лимитами
 * 
 * Формула capacity:
 * postsPerHour = accountsLinked × basePostsPerHour × boostMultiplier
 * 
 * Enforcement point: перед постановкой задач в очередь
 */

import { UserTwitterQuotaModel, type IUserTwitterQuota } from '../models/user-twitter-quota.model.js';
import { UserTwitterSessionModel } from '../models/twitter-session.model.js';
import { userScope } from '../acl/ownership.js';

/** Default values */
const DEFAULTS = {
  basePostsPerHour: 200,
  boostMultiplier: 1.0,
};

/** Response DTO */
export interface QuotaStatusDTO {
  accounts: number;
  postsPerHour: number;
  postsPerDay: number;
  usedThisHour: number;
  usedToday: number;
  plannedThisHour: number;
  remainingHour: number;
  remainingDay: number;
  windowResetsIn: number; // minutes
}

export class TwitterQuotaService {
  /**
   * Получить или создать квоту для пользователя
   */
  async getOrCreate(ownerUserId: string): Promise<IUserTwitterQuota> {
    let quota = await UserTwitterQuotaModel.findOne({ ownerUserId });
    
    if (!quota) {
      quota = new UserTwitterQuotaModel({
        ownerUserId,
        accountsLinked: 0,
        basePostsPerHour: DEFAULTS.basePostsPerHour,
        boostMultiplier: DEFAULTS.boostMultiplier,
        hardCapPerHour: 0,
        hardCapPerDay: 0,
        usedThisHour: 0,
        usedToday: 0,
        plannedThisHour: 0,
        hourWindowStartedAt: new Date(),
        dayWindowStartedAt: this.getStartOfDay(),
      });
      await quota.save();
    }
    
    return quota;
  }

  /**
   * Пересчитать capacity после изменения аккаунтов
   */
  async recalculate(ownerUserId: string): Promise<IUserTwitterQuota> {
    const quota = await this.getOrCreate(ownerUserId);
    
    // Count active sessions (OK or STALE)
    const activeSessions = await UserTwitterSessionModel.countDocuments({
      ...userScope(ownerUserId),
      status: { $in: ['OK', 'STALE'] },
    });
    
    quota.accountsLinked = activeSessions;
    quota.hardCapPerHour = Math.round(
      activeSessions * quota.basePostsPerHour * quota.boostMultiplier
    );
    quota.hardCapPerDay = quota.hardCapPerHour * 24;
    
    await quota.save();
    return quota;
  }

  /**
   * Получить статус квоты для UI
   */
  async getStatus(ownerUserId: string): Promise<QuotaStatusDTO> {
    const quota = await this.getOrCreate(ownerUserId);
    
    // Reset windows if needed
    await this.resetWindowsIfNeeded(ownerUserId);
    
    // Recalculate to ensure fresh data
    const fresh = await this.recalculate(ownerUserId);
    
    const remainingHour = Math.max(0, fresh.hardCapPerHour - fresh.usedThisHour - fresh.plannedThisHour);
    const remainingDay = Math.max(0, fresh.hardCapPerDay - fresh.usedToday);
    
    // Calculate minutes until hour resets
    const now = new Date();
    const hourStart = new Date(fresh.hourWindowStartedAt);
    const minutesPassed = Math.floor((now.getTime() - hourStart.getTime()) / 60000);
    const windowResetsIn = Math.max(0, 60 - minutesPassed);
    
    return {
      accounts: fresh.accountsLinked,
      postsPerHour: fresh.hardCapPerHour,
      postsPerDay: fresh.hardCapPerDay,
      usedThisHour: fresh.usedThisHour,
      usedToday: fresh.usedToday,
      plannedThisHour: fresh.plannedThisHour,
      remainingHour,
      remainingDay,
      windowResetsIn,
    };
  }

  /**
   * Проверить можно ли использовать N постов
   */
  async canConsume(ownerUserId: string, amount: number): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    await this.resetWindowsIfNeeded(ownerUserId);
    const quota = await this.getOrCreate(ownerUserId);
    
    const availableHour = quota.hardCapPerHour - quota.usedThisHour - quota.plannedThisHour;
    const availableDay = quota.hardCapPerDay - quota.usedToday;
    
    if (quota.accountsLinked === 0) {
      return { allowed: false, reason: 'No active accounts' };
    }
    
    if (amount > availableHour) {
      return { allowed: false, reason: `Hourly limit exceeded (${availableHour} remaining)` };
    }
    
    if (amount > availableDay) {
      return { allowed: false, reason: `Daily limit exceeded (${availableDay} remaining)` };
    }
    
    return { allowed: true };
  }

  /**
   * Зарезервировать capacity (перед планированием)
   */
  async reserve(ownerUserId: string, amount: number): Promise<boolean> {
    const check = await this.canConsume(ownerUserId, amount);
    if (!check.allowed) return false;
    
    await UserTwitterQuotaModel.updateOne(
      { ownerUserId },
      { $inc: { plannedThisHour: amount } }
    );
    
    return true;
  }

  /**
   * Подтвердить использование (после парсинга)
   */
  async consume(ownerUserId: string, amount: number): Promise<void> {
    await UserTwitterQuotaModel.updateOne(
      { ownerUserId },
      {
        $inc: {
          usedThisHour: amount,
          usedToday: amount,
          plannedThisHour: -amount, // release reservation
        },
      }
    );
  }

  /**
   * Отменить резервацию (если задача не выполнена)
   */
  async release(ownerUserId: string, amount: number): Promise<void> {
    await UserTwitterQuotaModel.updateOne(
      { ownerUserId },
      { $inc: { plannedThisHour: -amount } }
    );
  }

  /**
   * Сбросить счётчики если окно истекло
   */
  async resetWindowsIfNeeded(ownerUserId: string): Promise<void> {
    const quota = await UserTwitterQuotaModel.findOne({ ownerUserId });
    if (!quota) return;
    
    const now = new Date();
    let needsSave = false;
    
    // Check hour window (60 minutes)
    const hourStart = new Date(quota.hourWindowStartedAt);
    const hoursPassed = (now.getTime() - hourStart.getTime()) / 3600000;
    if (hoursPassed >= 1) {
      quota.usedThisHour = 0;
      quota.plannedThisHour = 0;
      quota.hourWindowStartedAt = now;
      needsSave = true;
    }
    
    // Check day window
    const dayStart = this.getStartOfDay();
    if (quota.dayWindowStartedAt < dayStart) {
      quota.usedToday = 0;
      quota.dayWindowStartedAt = dayStart;
      needsSave = true;
    }
    
    if (needsSave) {
      await quota.save();
    }
  }

  /**
   * Helper: начало текущего дня (UTC)
   */
  private getStartOfDay(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  /**
   * Check quota thresholds for notifications
   */
  async checkThresholds(ownerUserId: string): Promise<{
    isAt80Percent: boolean;
    isExceeded: boolean;
  }> {
    const quota = await this.getOrCreate(ownerUserId);
    
    const used = quota.usedThisHour + quota.plannedThisHour;
    const threshold80 = quota.hardCapPerHour * 0.8;
    
    return {
      isAt80Percent: used >= threshold80 && used < quota.hardCapPerHour,
      isExceeded: used >= quota.hardCapPerHour,
    };
  }
}
