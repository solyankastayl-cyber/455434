/**
 * TelegramNotifierV2 - User-scoped Telegram notifications
 * 
 * ПРАВИЛА:
 * 1. Каждый user получает ТОЛЬКО свои уведомления
 * 2. ownerUserId → TelegramConnection → chatId
 * 3. Проверяем opt-in перед отправкой
 * 4. Логируем ВСЕ попытки отправки
 */

import { TelegramConnectionModel, sendTelegramMessage } from '../../../core/notifications/telegram.service.js';

export type TelegramNotificationType = 
  | 'SESSION_OK'
  | 'SESSION_STALE'
  | 'SESSION_INVALID'
  | 'SESSION_ABORTED'
  | 'HIGH_RISK_WARNING'
  | 'PARSE_COMPLETED'
  | 'COOLDOWN_ENABLED'
  | 'TEST';

interface NotificationPayload {
  account?: string;
  reason?: string;
  risk?: number;
  fetched?: number;
  taskId?: string;
  sessionId?: string;
  message?: string;
}

interface NotificationConfig {
  emoji: string;
  title: string;
  template: (payload: NotificationPayload) => string;
}

const NOTIFICATION_CONFIGS: Record<TelegramNotificationType, NotificationConfig> = {
  SESSION_OK: {
    emoji: '🟢',
    title: 'Session Restored',
    template: (p) => `Twitter session is now active.\n${p.account ? `Account: @${p.account}` : ''}`,
  },
  SESSION_STALE: {
    emoji: '🟠',
    title: 'Session Expiring',
    template: (p) => `Twitter session needs refresh.\n${p.account ? `Account: @${p.account}` : ''}\n\nPlease sync cookies via Chrome extension.`,
  },
  SESSION_INVALID: {
    emoji: '🔴',
    title: 'Session Invalid',
    template: (p) => `Twitter session is no longer valid.\n${p.account ? `Account: @${p.account}` : ''}\n${p.reason ? `Reason: ${p.reason}` : ''}\n\nPlease reconnect your Twitter account.`,
  },
  SESSION_ABORTED: {
    emoji: '⛔',
    title: 'Parsing Aborted',
    template: (p) => `Parser stopped due to risk detection.\n${p.account ? `Account: @${p.account}` : ''}\n${p.reason ? `Reason: ${p.reason}` : ''}\n${p.risk ? `Risk level: ${p.risk}/100` : ''}\n${p.fetched !== undefined ? `Fetched: ${p.fetched} posts` : ''}`,
  },
  HIGH_RISK_WARNING: {
    emoji: '⚠️',
    title: 'High Risk Detected',
    template: (p) => `Risk level is elevated.\n${p.risk ? `Current risk: ${p.risk}/100` : ''}\n\nParsing may be throttled.`,
  },
  PARSE_COMPLETED: {
    emoji: '✅',
    title: 'Parsing Complete',
    template: (p) => `Parsing finished successfully.\n${p.fetched !== undefined ? `Fetched: ${p.fetched} posts` : ''}`,
  },
  COOLDOWN_ENABLED: {
    emoji: '❄️',
    title: 'Cooldown Enabled',
    template: (p) => `Account is in cooldown mode.\n${p.account ? `Account: @${p.account}` : ''}\n${p.reason ? `Reason: ${p.reason}` : ''}`,
  },
  TEST: {
    emoji: '🧪',
    title: 'Test Message',
    template: (p) => p.message || 'This is a test message from AI-ON platform.',
  },
};

export interface TelegramNotifyInput {
  type: TelegramNotificationType;
  payload?: NotificationPayload;
}

export interface TelegramNotifyResult {
  sent: boolean;
  error?: string;
  chatId?: string;
}

/**
 * TelegramNotifierV2 - User-scoped notifications
 */
export class TelegramNotifierV2 {
  
  // Map notification type to preference key
  private static readonly TYPE_TO_PREF: Record<TelegramNotificationType, string> = {
    'SESSION_OK': 'sessionOk',
    'SESSION_STALE': 'sessionStale',
    'SESSION_INVALID': 'sessionInvalid',
    'SESSION_ABORTED': 'parseAborted',
    'HIGH_RISK_WARNING': 'highRisk',
    'PARSE_COMPLETED': 'parseCompleted',
    'COOLDOWN_ENABLED': 'cooldown',
    'TEST': 'test', // Always allowed
  };
  
  /**
   * Notify a specific user via Telegram
   * 
   * @param ownerUserId - User ID (not account ID!)
   * @param input - Notification type and payload
   */
  static async notifyUser(
    ownerUserId: string,
    input: TelegramNotifyInput
  ): Promise<TelegramNotifyResult> {
    const { type, payload = {} } = input;
    
    console.log(`[TelegramV2] notifyUser() called | user: ${ownerUserId} | type: ${type}`);
    
    // 1. Get user's Telegram connection
    const connection = await TelegramConnectionModel.findOne({
      userId: ownerUserId,
      isActive: true,
    });
    
    if (!connection) {
      console.log(`[TelegramV2] No active connection for user ${ownerUserId}`);
      return { sent: false, error: 'NO_CONNECTION' };
    }
    
    const chatId = connection.chatId;
    console.log(`[TelegramV2] Found chatId: ${chatId} for user ${ownerUserId}`);
    
    // 2. Check event preferences (skip for TEST)
    if (type !== 'TEST') {
      const prefKey = this.TYPE_TO_PREF[type];
      const prefs = connection.eventPreferences || {};
      
      // Default to true if not set
      const isEnabled = prefs[prefKey as keyof typeof prefs] !== false;
      
      if (!isEnabled) {
        console.log(`[TelegramV2] Event ${type} disabled for user ${ownerUserId}`);
        return { sent: false, error: 'EVENT_DISABLED' };
      }
    }
    
    // 3. Get notification config
    const config = NOTIFICATION_CONFIGS[type];
    if (!config) {
      console.warn(`[TelegramV2] Unknown notification type: ${type}`);
      return { sent: false, error: 'UNKNOWN_TYPE' };
    }
    
    // 4. Format message
    const text = `${config.emoji} <b>${config.title}</b>\n\n${config.template(payload)}`;
    
    // 5. Send via Telegram API
    console.log(`[TelegramV2] Sending to chatId: ${chatId}`);
    const result = await sendTelegramMessage(chatId, text);
    
    if (result.ok) {
      console.log(`[TelegramV2] ✅ Successfully sent ${type} to user ${ownerUserId}`);
      return { sent: true, chatId };
    } else {
      console.error(`[TelegramV2] ❌ Failed to send: ${result.error}`);
      return { sent: false, error: result.error, chatId };
    }
  }
  
  /**
   * Send test message to user
   */
  static async sendTestMessage(ownerUserId: string): Promise<TelegramNotifyResult> {
    return this.notifyUser(ownerUserId, {
      type: 'TEST',
      payload: {
        message: '✅ Connection verified!\n\nYou will receive notifications about:\n• Session status changes\n• Parsing activity\n• Risk alerts',
      },
    });
  }
  
  /**
   * Check if user has active Telegram connection
   */
  static async hasConnection(ownerUserId: string): Promise<boolean> {
    const connection = await TelegramConnectionModel.findOne({
      userId: ownerUserId,
      isActive: true,
    });
    return !!connection;
  }
  
  /**
   * Get user's Telegram connection info
   */
  static async getConnectionInfo(ownerUserId: string): Promise<{
    connected: boolean;
    username?: string;
    chatId?: string;
    lastMessageAt?: Date;
    eventPreferences?: {
      sessionOk: boolean;
      sessionStale: boolean;
      sessionInvalid: boolean;
      parseCompleted: boolean;
      parseAborted: boolean;
      cooldown: boolean;
      highRisk: boolean;
    };
  }> {
    const connection = await TelegramConnectionModel.findOne({
      userId: ownerUserId,
    });
    
    if (!connection) {
      return { connected: false };
    }
    
    return {
      connected: connection.isActive,
      username: connection.username,
      chatId: connection.chatId ? `***${connection.chatId.slice(-4)}` : undefined,
      lastMessageAt: connection.lastMessageAt,
      eventPreferences: connection.eventPreferences || {
        sessionOk: true,
        sessionStale: true,
        sessionInvalid: true,
        parseCompleted: false,
        parseAborted: true,
        cooldown: true,
        highRisk: true,
      },
    };
  }
  
  /**
   * Disconnect user's Telegram
   */
  static async disconnect(ownerUserId: string): Promise<boolean> {
    const result = await TelegramConnectionModel.updateOne(
      { userId: ownerUserId, isActive: true },
      { isActive: false }
    );
    console.log(`[TelegramV2] Disconnected user ${ownerUserId}: ${result.modifiedCount > 0}`);
    return result.modifiedCount > 0;
  }
  
  /**
   * Update user's event preferences
   */
  static async updateEventPreferences(
    ownerUserId: string,
    preferences: Partial<{
      sessionOk: boolean;
      sessionStale: boolean;
      sessionInvalid: boolean;
      parseCompleted: boolean;
      parseAborted: boolean;
      cooldown: boolean;
      highRisk: boolean;
    }>
  ): Promise<{
    updated: boolean;
    eventPreferences?: typeof preferences;
  }> {
    // Build update object for only provided fields
    const updateFields: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(preferences)) {
      if (typeof value === 'boolean') {
        updateFields[`eventPreferences.${key}`] = value;
      }
    }
    
    if (Object.keys(updateFields).length === 0) {
      return { updated: false };
    }
    
    const result = await TelegramConnectionModel.findOneAndUpdate(
      { userId: ownerUserId, isActive: true },
      { $set: updateFields },
      { new: true }
    );
    
    if (!result) {
      console.log(`[TelegramV2] No active connection for user ${ownerUserId} to update preferences`);
      return { updated: false };
    }
    
    console.log(`[TelegramV2] Updated event preferences for user ${ownerUserId}:`, preferences);
    return {
      updated: true,
      eventPreferences: result.eventPreferences,
    };
  }
}

// Export for compatibility
export const TelegramNotifier = TelegramNotifierV2;
