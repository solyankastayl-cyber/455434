/**
 * A.3.3 - Policy Evaluator Service
 * 
 * Evaluates user metrics against policy limits and triggers actions:
 * - Calculates rolling metrics (tasks_1h, posts_24h, abort_rate_24h)
 * - Checks violations against policy
 * - Applies actions (WARN, COOLDOWN, DISABLE)
 * - Sends System Telegram alerts for critical actions
 */

import { UserTwitterAccountModel } from '../../twitter-user/models/twitter-account.model.js';
import { UserTwitterSessionModel } from '../../twitter-user/models/twitter-session.model.js';
import { UserTwitterParseTaskModel } from '../../twitter-user/models/twitter-parse-task.model.js';
import { TwitterPolicyService, EffectivePolicy } from './policy.service.js';
import { PolicyViolationLogModel, ViolationType } from '../models/policy-violation-log.model.js';
import { PolicyAction } from '../models/twitter-policy.model.js';
import { TelegramNotifierV2 } from '../../twitter-user/notifications/telegram-notifier.js';
import { SystemTelegramEvents } from '../../telegram/system-telegram.notifier.js';
import { systemTelegram } from '../../system-telegram/index.js';

export interface UserMetrics {
  userId: string;
  tasks1h: number;
  posts24h: number;
  abortRate24h: number;
  activeAccounts: number;
  staleSessions: number;
  totalSessions: number;
  recentCooldowns: number; // cooldowns in last 24h
}

export interface PolicyEvaluation {
  userId: string;
  violations: ViolationType[];
  action: PolicyAction | null;
  metrics: UserMetrics;
  cooldownUntil?: Date;
}

export class PolicyEvaluatorService {
  private policyService: TwitterPolicyService;
  
  constructor() {
    this.policyService = new TwitterPolicyService();
  }
  
  /**
   * Calculate current metrics for a user
   */
  async getUserMetrics(userId: string): Promise<UserMetrics> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Tasks in last hour
    const tasks1h = await UserTwitterParseTaskModel.countDocuments({
      ownerUserId: userId,
      createdAt: { $gte: oneHourAgo },
    });
    
    // Posts fetched in last 24h
    const postsAgg = await UserTwitterParseTaskModel.aggregate([
      { 
        $match: { 
          ownerUserId: userId, 
          createdAt: { $gte: oneDayAgo },
          status: { $in: ['DONE', 'PARTIAL'] },
        } 
      },
      { $group: { _id: null, total: { $sum: '$fetchedCount' } } },
    ]);
    const posts24h = postsAgg[0]?.total || 0;
    
    // Abort rate in last 24h
    const totalTasks24h = await UserTwitterParseTaskModel.countDocuments({
      ownerUserId: userId,
      createdAt: { $gte: oneDayAgo },
    });
    const abortedTasks24h = await UserTwitterParseTaskModel.countDocuments({
      ownerUserId: userId,
      createdAt: { $gte: oneDayAgo },
      status: { $in: ['FAILED', 'PARTIAL'] },
    });
    const abortRate24h = totalTasks24h > 0 
      ? Math.round((abortedTasks24h / totalTasks24h) * 100) 
      : 0;
    
    // Active accounts (enabled = true)
    const activeAccounts = await UserTwitterAccountModel.countDocuments({
      ownerUserId: userId,
      enabled: true,
    });
    
    // Sessions
    const sessions = await UserTwitterSessionModel.aggregate([
      { $match: { ownerUserId: userId, isActive: true } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    
    let staleSessions = 0;
    let totalSessions = 0;
    for (const s of sessions) {
      totalSessions += s.count;
      if (s._id === 'STALE') staleSessions = s.count;
    }
    
    // Recent cooldowns (policy violations with COOLDOWN in last 24h)
    const recentCooldowns = await PolicyViolationLogModel.countDocuments({
      userId,
      actionTaken: 'COOLDOWN',
      createdAt: { $gte: oneDayAgo },
    });
    
    return {
      userId,
      tasks1h,
      posts24h,
      abortRate24h,
      activeAccounts,
      staleSessions,
      totalSessions,
      recentCooldowns,
    };
  }
  
  /**
   * Evaluate user against policy and return violations
   */
  async evaluate(userId: string): Promise<PolicyEvaluation> {
    const policy = await this.policyService.getEffectivePolicy(userId);
    const metrics = await this.getUserMetrics(userId);
    
    // If policy is disabled, no violations
    if (!policy.enabled) {
      return {
        userId,
        violations: [],
        action: null,
        metrics,
      };
    }
    
    const violations: ViolationType[] = [];
    
    // Check each limit
    if (metrics.activeAccounts > policy.limits.maxAccounts) {
      violations.push('MAX_ACCOUNTS_EXCEEDED');
    }
    
    if (metrics.tasks1h > policy.limits.maxTasksPerHour) {
      violations.push('MAX_TASKS_EXCEEDED');
    }
    
    if (metrics.posts24h > policy.limits.maxPostsPerDay) {
      violations.push('MAX_POSTS_EXCEEDED');
    }
    
    if (metrics.abortRate24h > policy.limits.maxAbortRatePct) {
      violations.push('HIGH_ABORT_RATE');
    }
    
    // Check for repeated cooldowns (escalation to DISABLE)
    if (metrics.recentCooldowns >= 3) {
      violations.push('REPEATED_COOLDOWNS');
    }
    
    // Determine action
    let action: PolicyAction | null = null;
    let cooldownUntil: Date | undefined;
    
    if (violations.length > 0) {
      // Escalate to DISABLE if repeated cooldowns
      if (violations.includes('REPEATED_COOLDOWNS')) {
        action = 'DISABLE';
      } else {
        action = policy.actions.onLimitExceeded;
        
        if (action === 'COOLDOWN' && policy.actions.cooldownMinutes) {
          cooldownUntil = new Date(Date.now() + policy.actions.cooldownMinutes * 60 * 1000);
        }
      }
    }
    
    return {
      userId,
      violations,
      action,
      metrics,
      cooldownUntil,
    };
  }
  
  /**
   * Apply policy action to a user
   */
  async applyAction(evaluation: PolicyEvaluation): Promise<void> {
    const { userId, violations, action, metrics, cooldownUntil } = evaluation;
    
    if (!action || violations.length === 0) return;
    
    console.log(`[PolicyEvaluator] Applying ${action} to user ${userId} for violations: ${violations.join(', ')}`);
    
    // Log violation
    const primaryViolation = violations[0];
    const policy = await this.policyService.getEffectivePolicy(userId);
    
    let limitValue = 0;
    let currentValue = 0;
    
    switch (primaryViolation) {
      case 'MAX_ACCOUNTS_EXCEEDED':
        limitValue = policy.limits.maxAccounts;
        currentValue = metrics.activeAccounts;
        break;
      case 'MAX_TASKS_EXCEEDED':
        limitValue = policy.limits.maxTasksPerHour;
        currentValue = metrics.tasks1h;
        break;
      case 'MAX_POSTS_EXCEEDED':
        limitValue = policy.limits.maxPostsPerDay;
        currentValue = metrics.posts24h;
        break;
      case 'HIGH_ABORT_RATE':
        limitValue = policy.limits.maxAbortRatePct;
        currentValue = metrics.abortRate24h;
        break;
      case 'REPEATED_COOLDOWNS':
        limitValue = 3;
        currentValue = metrics.recentCooldowns;
        break;
    }
    
    await PolicyViolationLogModel.create({
      userId,
      violationType: primaryViolation,
      currentValue,
      limitValue,
      actionTaken: action,
      cooldownUntil,
      metrics: {
        tasks1h: metrics.tasks1h,
        posts24h: metrics.posts24h,
        abortRate24h: metrics.abortRate24h,
        activeAccounts: metrics.activeAccounts,
        staleSessions: metrics.staleSessions,
      },
      notificationSent: false,
      adminNotified: false,
    });
    
    // Apply action
    switch (action) {
      case 'WARN':
        await this.sendWarning(userId, primaryViolation, metrics);
        break;
        
      case 'COOLDOWN':
        await this.applyCooldown(userId, cooldownUntil, primaryViolation, metrics);
        break;
        
      case 'DISABLE':
        await this.disableUser(userId, primaryViolation, metrics);
        break;
    }
  }
  
  /**
   * Send warning notification
   */
  private async sendWarning(userId: string, violation: ViolationType, metrics: UserMetrics): Promise<void> {
    const message = this.getViolationMessage(violation, 'WARN');
    
    // Notify admin via System Telegram
    await SystemTelegramEvents.policyViolation(userId, violation, {
      action: 'WARN',
      currentValue: this.getCurrentValueForViolation(violation, metrics),
      metrics: {
        tasks1h: metrics.tasks1h,
        posts24h: metrics.posts24h,
        abortRate: metrics.abortRate24h,
      },
    });
    
    try {
      await TelegramNotifierV2.notifyUser(userId, {
        type: 'HIGH_RISK_WARNING',
        payload: {
          reason: message,
          violation,
          metrics: {
            tasks1h: metrics.tasks1h,
            posts24h: metrics.posts24h,
            abortRate: metrics.abortRate24h,
          },
        },
      });
      
      // Update log
      await PolicyViolationLogModel.updateOne(
        { userId, violationType: violation, notificationSent: false },
        { notificationSent: true },
        { sort: { createdAt: -1 } }
      );
    } catch (err) {
      console.error(`[PolicyEvaluator] Failed to send warning to ${userId}:`, err);
    }
  }
  
  /**
   * Apply cooldown to all user sessions
   */
  private async applyCooldown(
    userId: string, 
    cooldownUntil: Date | undefined, 
    violation: ViolationType,
    metrics: UserMetrics
  ): Promise<void> {
    // Mark all sessions as STALE
    await UserTwitterSessionModel.updateMany(
      { ownerUserId: userId, status: { $ne: 'INVALID' } },
      { 
        $set: { 
          status: 'STALE',
          lastAbortAt: new Date(),
        },
      }
    );
    
    const message = this.getViolationMessage(violation, 'COOLDOWN');
    const cooldownMinutes = cooldownUntil 
      ? Math.round((cooldownUntil.getTime() - Date.now()) / 60000)
      : 30;
    
    // Notify admin via System Telegram
    await SystemTelegramEvents.cooldownApplied(
      userId,
      cooldownMinutes,
      `${violation}: ${message}`
    );
    
    try {
      await TelegramNotifierV2.notifyUser(userId, {
        type: 'COOLDOWN_ENABLED',
        payload: {
          reason: message,
          cooldownUntil: cooldownUntil?.toISOString(),
          violation,
        },
      });
      
      await PolicyViolationLogModel.updateOne(
        { userId, violationType: violation, notificationSent: false },
        { notificationSent: true },
        { sort: { createdAt: -1 } }
      );
    } catch (err) {
      console.error(`[PolicyEvaluator] Failed to send cooldown notification to ${userId}:`, err);
    }
  }
  
  /**
   * Disable user parsing
   */
  private async disableUser(
    userId: string, 
    violation: ViolationType,
    metrics: UserMetrics
  ): Promise<void> {
    // Disable all accounts (enabled = false)
    await UserTwitterAccountModel.updateMany(
      { ownerUserId: userId },
      { $set: { enabled: false } }
    );
    
    // Invalidate all sessions
    await UserTwitterSessionModel.updateMany(
      { ownerUserId: userId },
      { $set: { status: 'INVALID', isActive: false } }
    );
    
    const message = this.getViolationMessage(violation, 'DISABLE');
    
    // Get all violations for this user
    const violations = await PolicyViolationLogModel.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
    
    const violationTypes = violations.map(v => v.violationType);
    
    // Notify admin via System Telegram
    await SystemTelegramEvents.userDisabled(
      userId,
      message,
      violationTypes
    );
    
    try {
      await TelegramNotifierV2.notifyUser(userId, {
        type: 'SESSION_INVALID',
        payload: {
          reason: message,
          violation,
        },
      });
      
      await PolicyViolationLogModel.updateOne(
        { userId, violationType: violation, notificationSent: false },
        { notificationSent: true },
        { sort: { createdAt: -1 } }
      );
    } catch (err) {
      console.error(`[PolicyEvaluator] Failed to send disable notification to ${userId}:`, err);
    }
  }
  
  /**
   * Get human-readable violation message
   */
  private getViolationMessage(violation: ViolationType, action: PolicyAction): string {
    const messages: Record<ViolationType, Record<PolicyAction, string>> = {
      MAX_ACCOUNTS_EXCEEDED: {
        WARN: '⚠️ You have exceeded the maximum number of accounts',
        COOLDOWN: '🧊 Account limit exceeded. Parsing paused temporarily.',
        DISABLE: '🔴 Parsing disabled due to account limit violation.',
      },
      MAX_TASKS_EXCEEDED: {
        WARN: '⚠️ High task frequency detected. Please slow down.',
        COOLDOWN: '🧊 Too many tasks. Parsing paused for fair-use.',
        DISABLE: '🔴 Parsing disabled due to excessive task volume.',
      },
      MAX_POSTS_EXCEEDED: {
        WARN: '⚠️ Approaching daily post limit.',
        COOLDOWN: '🧊 Daily post limit reached. Parsing paused.',
        DISABLE: '🔴 Parsing disabled due to daily limit.',
      },
      HIGH_ABORT_RATE: {
        WARN: '⚠️ High abort rate detected. Check your sessions.',
        COOLDOWN: '🧊 High abort rate. Sessions cooling down.',
        DISABLE: '🔴 Parsing disabled due to high abort rate.',
      },
      REPEATED_COOLDOWNS: {
        WARN: '⚠️ Multiple cooldowns detected.',
        COOLDOWN: '🧊 Repeated cooldowns. Extended pause.',
        DISABLE: '🔴 Parsing disabled due to repeated violations.',
      },
    };
    
    return messages[violation]?.[action] || 'Policy violation detected.';
  }
  
  /**
   * Get current value for a specific violation type
   */
  private getCurrentValueForViolation(violation: ViolationType, metrics: UserMetrics): number {
    switch (violation) {
      case 'MAX_ACCOUNTS_EXCEEDED':
        return metrics.activeAccounts;
      case 'MAX_TASKS_EXCEEDED':
        return metrics.tasks1h;
      case 'MAX_POSTS_EXCEEDED':
        return metrics.posts24h;
      case 'HIGH_ABORT_RATE':
        return metrics.abortRate24h;
      case 'REPEATED_COOLDOWNS':
        return metrics.recentCooldowns;
      default:
        return 0;
    }
  }
  
  /**
   * Get recent violations for a user
   */
  async getRecentViolations(userId: string, limit = 20): Promise<any[]> {
    const violations = await PolicyViolationLogModel.find(
      { userId },
      {},
      { sort: { createdAt: -1 }, limit }
    ).lean();
    
    return violations.map(v => ({
      id: v._id.toString(),
      type: v.violationType,
      currentValue: v.currentValue,
      limitValue: v.limitValue,
      action: v.actionTaken,
      cooldownUntil: v.cooldownUntil,
      metrics: v.metrics,
      createdAt: v.createdAt,
    }));
  }
}
