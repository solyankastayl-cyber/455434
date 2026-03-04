/**
 * Dispatcher Engine (A4)
 * 
 * Purpose: "Когда, кому и как сообщать о группе событий?"
 * 
 * A4 is attention management:
 * - notify now
 * - update silently
 * - escalate
 * - stay quiet
 * 
 * NOT responsible for:
 * - Grouping (A3)
 * - Severity calculation (A2)
 * - Deduplication (A1)
 * - Normalization (A0)
 */
import { v4 as uuidv4 } from 'uuid';
import type { GroupedEvent, AlertGroup, GroupPriority } from '../grouping/alert_group.schema.js';
import type { 
  DispatchDecision, 
  DispatchPayload, 
  DispatchType,
  ChannelType,
  UserAlertPreferences,
  DispatchPriority,
} from './dispatcher.schema.js';
import { 
  UserAlertPreferencesModel, 
  RateLimitModel, 
  NotificationHistoryModel 
} from './dispatcher.model.js';

/**
 * Default preferences for new users
 */
const DEFAULT_PREFERENCES: Omit<UserAlertPreferences, 'userId'> = {
  minPriority: 'medium',
  channels: ['ui'],
  notifyOn: {
    new: true,
    escalation: true,
    cooling: false,
    resolution: false,
  },
  telegram: {
    enabled: false,
  },
  rateLimits: {
    maxPerHour: 10,
    minIntervalMinutes: 15,
  },
};

/**
 * Severity delta threshold for escalation notification
 */
const ESCALATION_SEVERITY_DELTA = 0.5;

export class DispatcherEngine {
  /**
   * Main dispatch process
   * 
   * Flow:
   * 1. Get user preferences
   * 2. Make dispatch decision
   * 3. If dispatch → check rate limits
   * 4. If allowed → create payload
   * 5. Send to channels
   * 6. Record in history
   */
  async process(groupedEvent: GroupedEvent): Promise<{
    decision: DispatchDecision;
    payload?: DispatchPayload;
    delivered?: Record<ChannelType, boolean>;
  }> {
    const { group, isNewGroup, isEscalation, isResolution, isCoolingStart } = groupedEvent;
    
    // 1. Get user preferences
    const preferences = await this.getUserPreferences(group.userId);
    
    // 2. Make dispatch decision
    const decision = this.makeDecision(groupedEvent, preferences);
    
    if (!decision.shouldDispatch) {
      return { decision };
    }
    
    // 3. Check rate limits
    const rateLimitResult = await this.checkRateLimits(
      group.userId,
      group.groupId,
      preferences
    );
    
    if (!rateLimitResult.allowed) {
      return {
        decision: {
          shouldDispatch: false,
          reason: rateLimitResult.reason,
        },
      };
    }
    
    // 4. Create payload
    const payload = this.createPayload(
      group,
      decision.type!,
      decision.channels!
    );
    
    // 5. Send to channels
    const delivered: Record<string, boolean> = {};
    
    for (const channel of decision.channels!) {
      try {
        await this.sendToChannel(channel, payload, preferences);
        delivered[channel] = true;
      } catch (error) {
        console.error(`[Dispatcher] Failed to send to ${channel}:`, error);
        delivered[channel] = false;
      }
    }
    
    // 6. Record in history
    await this.recordNotification(payload, decision.channels!, delivered);
    
    // 7. Update rate limits
    await this.updateRateLimits(group.userId, group.groupId);
    
    return {
      decision,
      payload,
      delivered: delivered as Record<ChannelType, boolean>,
    };
  }

  /**
   * Make dispatch decision (DISPATCH DECISION MATRIX)
   */
  private makeDecision(
    groupedEvent: GroupedEvent,
    preferences: UserAlertPreferences
  ): DispatchDecision {
    const { group, isNewGroup, isEscalation, isResolution, isCoolingStart } = groupedEvent;
    
    // Check minimum priority
    if (!this.meetsMinPriority(group.priority, preferences.minPriority)) {
      return {
        shouldDispatch: false,
        reason: 'below_min_priority',
      };
    }
    
    // 1️⃣ NEW GROUP
    if (isNewGroup && preferences.notifyOn.new) {
      return {
        shouldDispatch: true,
        type: 'new',
        channels: preferences.channels as ChannelType[],
      };
    }
    
    // 2️⃣ ESCALATION
    if (isEscalation && preferences.notifyOn.escalation) {
      return {
        shouldDispatch: true,
        type: 'escalation',
        channels: preferences.channels as ChannelType[],
      };
    }
    
    // 3️⃣ ONGOING UPDATE (SILENT) - no notification
    // This is implicit - we just don't match any condition
    
    // 4️⃣ COOLING
    if (isCoolingStart && preferences.notifyOn.cooling) {
      // Cooling is optional, lower priority
      return {
        shouldDispatch: true,
        type: 'cooling',
        channels: preferences.channels as ChannelType[],
      };
    }
    
    // 5️⃣ RESOLVED
    if (isResolution && preferences.notifyOn.resolution) {
      return {
        shouldDispatch: true,
        type: 'resolved',
        channels: preferences.channels as ChannelType[],
      };
    }
    
    // Default: silent update
    return {
      shouldDispatch: false,
      reason: 'silent_update',
    };
  }

  /**
   * Check if group priority meets minimum threshold
   */
  private meetsMinPriority(
    groupPriority: GroupPriority,
    minPriority: DispatchPriority
  ): boolean {
    const priorityOrder: GroupPriority[] = ['low', 'medium', 'high'];
    
    const groupIndex = priorityOrder.indexOf(groupPriority);
    const minIndex = priorityOrder.indexOf(minPriority as GroupPriority);
    
    return groupIndex >= minIndex;
  }

  /**
   * Check rate limits (RATE LIMITING - MUST)
   */
  private async checkRateLimits(
    userId: string,
    groupId: string,
    preferences: UserAlertPreferences
  ): Promise<{ allowed: boolean; reason?: string }> {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Get or create user rate limit entry
    let userLimit = await RateLimitModel.findOne({ userId, groupId: null });
    
    if (!userLimit) {
      userLimit = await RateLimitModel.create({
        userId,
        groupId: null,
        notificationsThisHour: 0,
        hourStartedAt: now,
      });
    }
    
    // Reset counter if hour passed
    if (userLimit.hourStartedAt < hourAgo) {
      userLimit.notificationsThisHour = 0;
      userLimit.hourStartedAt = now;
    }
    
    // Check max per hour
    const maxPerHour = preferences.rateLimits?.maxPerHour || DEFAULT_PREFERENCES.rateLimits!.maxPerHour;
    if (userLimit.notificationsThisHour >= maxPerHour) {
      return {
        allowed: false,
        reason: `rate_limited_hourly (${maxPerHour}/hour)`,
      };
    }
    
    // Check per-group min interval
    const groupLimit = await RateLimitModel.findOne({ userId, groupId });
    if (groupLimit?.lastNotificationAt) {
      const minIntervalMs = (preferences.rateLimits?.minIntervalMinutes || 15) * 60 * 1000;
      const timeSinceLast = now.getTime() - groupLimit.lastNotificationAt.getTime();
      
      if (timeSinceLast < minIntervalMs) {
        return {
          allowed: false,
          reason: `rate_limited_per_group (${Math.ceil((minIntervalMs - timeSinceLast) / 60000)}min remaining)`,
        };
      }
    }
    
    return { allowed: true };
  }

  /**
   * Update rate limit counters
   */
  private async updateRateLimits(userId: string, groupId: string): Promise<void> {
    const now = new Date();
    
    // Update user-level counter
    await RateLimitModel.findOneAndUpdate(
      { userId, groupId: null },
      {
        $inc: { notificationsThisHour: 1 },
        $set: { lastNotificationAt: now },
      },
      { upsert: true }
    );
    
    // Update group-level counter
    await RateLimitModel.findOneAndUpdate(
      { userId, groupId },
      {
        $set: { lastNotificationAt: now },
      },
      { upsert: true }
    );
  }

  /**
   * Create dispatch payload (UNIFIED)
   */
  private createPayload(
    group: AlertGroup,
    type: DispatchType,
    channels: ChannelType[]
  ): DispatchPayload {
    const title = this.generateTitle(group, type);
    const message = this.generateMessage(group, type);
    
    return {
      payloadId: uuidv4(),
      groupId: group.groupId,
      userId: group.userId,
      
      type,
      priority: group.priority as DispatchPriority,
      
      title,
      message,
      
      reason: group.reason,
      
      actionLink: `/alerts?group=${group.groupId}`,
      
      targetMeta: group.targetMeta,
      
      createdAt: new Date(),
    };
  }

  /**
   * Generate notification title
   */
  private generateTitle(group: AlertGroup, type: DispatchType): string {
    const asset = group.targetMeta?.symbol || 'Asset';
    
    const titleMap: Record<DispatchType, string> = {
      new: `New: ${group.reason.summary}`,
      escalation: `⚠️ Escalation: ${asset} activity intensified`,
      cooling: `${asset} activity slowing`,
      resolved: `✓ ${asset} activity ended`,
    };
    
    return titleMap[type];
  }

  /**
   * Generate notification message
   */
  private generateMessage(group: AlertGroup, type: DispatchType): string {
    const { reason, eventCount, priority } = group;
    
    let message = reason.summary;
    
    if (reason.context && reason.context !== 'Just started') {
      message += ` • ${reason.context}`;
    }
    
    if (priority === 'high') {
      message += ' • Immediate attention recommended';
    }
    
    return message;
  }

  /**
   * Send notification to a channel
   */
  private async sendToChannel(
    channel: ChannelType,
    payload: DispatchPayload,
    preferences: UserAlertPreferences
  ): Promise<void> {
    switch (channel) {
      case 'ui':
        await this.sendToUI(payload);
        break;
      
      case 'telegram':
        await this.sendToTelegram(payload, preferences);
        break;
      
      default:
        console.warn(`[Dispatcher] Unknown channel: ${channel}`);
    }
  }

  /**
   * Send to UI (in-app notification)
   */
  private async sendToUI(payload: DispatchPayload): Promise<void> {
    // UI notifications are stored in database and fetched by frontend
    // The NotificationHistory serves as the UI notification store
    console.log(`[Dispatcher] UI notification created: ${payload.title}`);
  }

  /**
   * Send to Telegram
   */
  private async sendToTelegram(
    payload: DispatchPayload,
    preferences: UserAlertPreferences
  ): Promise<void> {
    if (!preferences.telegram?.enabled || !preferences.telegram?.chatId) {
      console.log('[Dispatcher] Telegram not configured for user');
      return;
    }
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.warn('[Dispatcher] TELEGRAM_BOT_TOKEN not configured');
      return;
    }
    
    // Format message for Telegram (human-readable, no raw metrics)
    const telegramMessage = this.formatTelegramMessage(payload);
    
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: preferences.telegram.chatId,
            text: telegramMessage,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        }
      );
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Telegram API error: ${error}`);
      }
      
      console.log(`[Dispatcher] Telegram message sent to ${preferences.telegram.chatId}`);
    } catch (error) {
      console.error('[Dispatcher] Failed to send Telegram message:', error);
      throw error;
    }
  }

  /**
   * Format message for Telegram
   * 
   * Requirements:
   * - Short, human-readable
   * - 1 action link max
   * - No raw metrics
   */
  private formatTelegramMessage(payload: DispatchPayload): string {
    const priorityEmoji = {
      high: '🔴',
      medium: '🟡',
      low: '🟢',
    };
    
    const typeEmoji = {
      new: '📊',
      escalation: '⚠️',
      cooling: '📉',
      resolved: '✅',
    };
    
    const emoji = `${priorityEmoji[payload.priority]} ${typeEmoji[payload.type]}`;
    const asset = payload.targetMeta?.symbol || 'Asset';
    
    let message = `${emoji} <b>${asset}</b>\n\n`;
    message += `${payload.reason.summary}\n`;
    
    if (payload.reason.context && payload.reason.context !== 'Just started') {
      message += `<i>${payload.reason.context}</i>\n`;
    }
    
    // Action link (optional, 1 max)
    if (payload.actionLink) {
      const baseUrl = process.env.FRONTEND_URL || 'https://blockview.app';
      message += `\n<a href="${baseUrl}${payload.actionLink}">View details</a>`;
    }
    
    return message;
  }

  /**
   * Record notification in history
   */
  private async recordNotification(
    payload: DispatchPayload,
    channels: ChannelType[],
    delivered: Record<string, boolean>
  ): Promise<void> {
    const errors: Record<string, string> = {};
    const deliveredAt: Record<string, Date> = {};
    
    for (const channel of channels) {
      if (delivered[channel]) {
        deliveredAt[channel] = new Date();
      } else {
        errors[channel] = 'Failed to deliver';
      }
    }
    
    await NotificationHistoryModel.create({
      notificationId: payload.payloadId,
      userId: payload.userId,
      groupId: payload.groupId,
      
      type: payload.type,
      priority: payload.priority,
      
      channels,
      payload,
      
      createdAt: new Date(),
      
      deliveredAt,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    });
  }

  /**
   * Get user preferences (with defaults)
   */
  async getUserPreferences(userId: string): Promise<UserAlertPreferences> {
    const stored = await UserAlertPreferencesModel.findOne({ userId }).lean();
    
    if (stored) {
      return stored as UserAlertPreferences;
    }
    
    // Return defaults
    return {
      userId,
      ...DEFAULT_PREFERENCES,
    };
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(
    userId: string,
    updates: Partial<UserAlertPreferences>
  ): Promise<UserAlertPreferences> {
    const updated = await UserAlertPreferencesModel.findOneAndUpdate(
      { userId },
      { $set: updates },
      { new: true, upsert: true, lean: true }
    );
    
    return updated as UserAlertPreferences;
  }

  /**
   * Get notifications for user
   */
  async getNotificationsForUser(
    userId: string,
    limit: number = 50
  ): Promise<any[]> {
    return NotificationHistoryModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(userId: string, since: Date): Promise<number> {
    return NotificationHistoryModel.countDocuments({
      userId,
      createdAt: { $gte: since },
    });
  }

  /**
   * Clean up old notifications (maintenance)
   */
  async cleanupOldNotifications(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const result = await NotificationHistoryModel.deleteMany({
      createdAt: { $lt: cutoffDate },
    });
    
    return result.deletedCount || 0;
  }

  /**
   * Reset rate limits (maintenance, for testing)
   */
  async resetRateLimits(userId: string): Promise<void> {
    await RateLimitModel.deleteMany({ userId });
  }
}

// Export singleton instance
export const dispatcherEngine = new DispatcherEngine();
