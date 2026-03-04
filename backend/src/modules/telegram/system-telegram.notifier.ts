/**
 * TELEGRAM SPLIT - System Telegram Notifier
 * 
 * FOMO Bot - Admin/System events ONLY
 * 
 * Purpose:
 * - Platform-wide monitoring
 * - Admin alerts
 * - System health events
 * 
 * NOT for:
 * - User-specific notifications
 * - Per-user settings
 * - UI configuration
 */

import axios from 'axios';
import { logAdminEvent, AdminEventType } from '../twitter-admin/models/admin-event-log.model.js';

export type SystemEventType =
  | 'USER_CREATED_TWITTER_ACCOUNT'
  | 'USER_SYNCED_SESSION'
  | 'USER_FIRST_SESSION_OK'
  | 'POLICY_VIOLATION'
  | 'COOLDOWN_APPLIED'
  | 'USER_DISABLED_BY_POLICY'
  | 'PARSER_DOWN'
  | 'PARSER_RECOVERED'
  | 'CRITICAL_ABORT_RATE';

interface SystemTelegramMessage {
  type: SystemEventType;
  title: string;
  message: string;
  meta?: Record<string, any>;
}

/**
 * System Telegram Notifier
 * 
 * ENV-only configuration:
 * - SYSTEM_TELEGRAM_BOT_TOKEN
 * - SYSTEM_TELEGRAM_CHAT_ID
 * 
 * If ENV vars not set, notifier is disabled (logs warning).
 */
class SystemTelegramNotifier {
  private botToken: string | null;
  private chatId: string | null;
  private enabled: boolean;
  
  constructor() {
    this.botToken = process.env.SYSTEM_TELEGRAM_BOT_TOKEN || null;
    this.chatId = process.env.SYSTEM_TELEGRAM_CHAT_ID || null;
    this.enabled = !!(this.botToken && this.chatId);
    
    if (!this.enabled) {
      console.warn('[SystemTelegram] DISABLED - Missing SYSTEM_TELEGRAM_BOT_TOKEN or SYSTEM_TELEGRAM_CHAT_ID');
    } else {
      console.log('[SystemTelegram] ENABLED - System bot ready');
    }
  }
  
  /**
   * Send system event notification
   * 
   * Automatically:
   * - Logs to AdminEventLog
   * - Sends to Telegram (if enabled)
   */
  async send(params: SystemTelegramMessage): Promise<void> {
    const { type, title, message, meta } = params;
    
    // Always log to AdminEventLog
    await this.logToAdminEvents(type, meta);
    
    // Send to Telegram if enabled
    if (!this.enabled) {
      console.log(`[SystemTelegram] Would send (disabled): ${type} - ${title}`);
      return;
    }
    
    try {
      const formattedMessage = this.formatMessage(type, title, message, meta);
      await this.sendToTelegram(formattedMessage);
      console.log(`[SystemTelegram] Sent: ${type}`);
    } catch (err) {
      console.error('[SystemTelegram] Failed to send:', err);
    }
  }
  
  /**
   * Format message for Telegram
   */
  private formatMessage(
    type: SystemEventType,
    title: string,
    message: string,
    meta?: Record<string, any>
  ): string {
    const emoji = this.getEmoji(type);
    let text = `${emoji} *${title}*\n\n${message}`;
    
    // Add metadata if present
    if (meta && Object.keys(meta).length > 0) {
      text += '\n\n*Details:*';
      for (const [key, value] of Object.entries(meta)) {
        if (value !== undefined && value !== null) {
          text += `\n• ${key}: ${JSON.stringify(value)}`;
        }
      }
    }
    
    // Add timestamp
    text += `\n\n_${new Date().toISOString()}_`;
    
    return text;
  }
  
  /**
   * Get emoji for event type
   */
  private getEmoji(type: SystemEventType): string {
    switch (type) {
      case 'USER_CREATED_TWITTER_ACCOUNT':
      case 'USER_SYNCED_SESSION':
      case 'USER_FIRST_SESSION_OK':
        return '🆕';
      case 'POLICY_VIOLATION':
        return '⚠️';
      case 'COOLDOWN_APPLIED':
        return '🧊';
      case 'USER_DISABLED_BY_POLICY':
        return '🔴';
      case 'PARSER_DOWN':
        return '❌';
      case 'PARSER_RECOVERED':
        return '✅';
      case 'CRITICAL_ABORT_RATE':
        return '🔥';
      default:
        return '📢';
    }
  }
  
  /**
   * Send to Telegram API
   */
  private async sendToTelegram(message: string): Promise<void> {
    if (!this.botToken || !this.chatId) return;
    
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    
    await axios.post(url, {
      chat_id: this.chatId,
      text: message,
      parse_mode: 'Markdown',
    }, {
      timeout: 5000,
    });
  }
  
  /**
   * Log to AdminEventLog
   */
  private async logToAdminEvents(
    type: SystemEventType,
    meta?: Record<string, any>
  ): Promise<void> {
    // Map SystemEventType to AdminEventType
    const eventTypeMap: Record<SystemEventType, AdminEventType> = {
      'USER_CREATED_TWITTER_ACCOUNT': 'USER_CREATED_TWITTER_ACCOUNT',
      'USER_SYNCED_SESSION': 'USER_SYNCED_SESSION',
      'USER_FIRST_SESSION_OK': 'USER_SYNCED_SESSION',
      'POLICY_VIOLATION': 'POLICY_VIOLATION',
      'COOLDOWN_APPLIED': 'COOLDOWN_APPLIED',
      'USER_DISABLED_BY_POLICY': 'USER_DISABLED_BY_POLICY',
      'PARSER_DOWN': 'PARSER_DOWN',
      'PARSER_RECOVERED': 'PARSER_UP',
      'CRITICAL_ABORT_RATE': 'POLICY_VIOLATION',
    };
    
    const adminEventType = eventTypeMap[type];
    const userId = meta?.userId;
    const details = { ...meta };
    delete details.userId; // Remove userId from details since it's a separate field
    
    await logAdminEvent(adminEventType, userId, details);
  }
}

// Singleton instance
export const systemTelegram = new SystemTelegramNotifier();

/**
 * Convenience functions for common events
 */
export const SystemTelegramEvents = {
  /**
   * User created Twitter account
   */
  userCreatedAccount(userId: string, twitter: string) {
    return systemTelegram.send({
      type: 'USER_CREATED_TWITTER_ACCOUNT',
      title: 'New Twitter Account Connected',
      message: `User connected Twitter account`,
      meta: { userId, twitter },
    });
  },
  
  /**
   * User synced session
   */
  userSyncedSession(userId: string, twitter: string, sessionVersion: number) {
    return systemTelegram.send({
      type: 'USER_SYNCED_SESSION',
      title: 'Session Synced',
      message: `User synced Twitter session`,
      meta: { userId, twitter, sessionVersion },
    });
  },
  
  /**
   * Policy violation detected
   */
  policyViolation(userId: string, violationType: string, details: any) {
    return systemTelegram.send({
      type: 'POLICY_VIOLATION',
      title: 'Policy Violation Detected',
      message: `Violation: ${violationType}`,
      meta: { userId, violationType, ...details },
    });
  },
  
  /**
   * Cooldown applied
   */
  cooldownApplied(userId: string, minutes: number, reason: string) {
    return systemTelegram.send({
      type: 'COOLDOWN_APPLIED',
      title: 'Cooldown Applied',
      message: `User put on cooldown for ${minutes} minutes\nReason: ${reason}`,
      meta: { userId, cooldownMinutes: minutes, reason },
    });
  },
  
  /**
   * User disabled by policy
   */
  userDisabled(userId: string, reason: string, violations: string[]) {
    return systemTelegram.send({
      type: 'USER_DISABLED_BY_POLICY',
      title: 'User Disabled',
      message: `User disabled after repeated violations\nReason: ${reason}`,
      meta: { userId, reason, violations },
    });
  },
  
  /**
   * Parser down
   */
  parserDown(error: string) {
    return systemTelegram.send({
      type: 'PARSER_DOWN',
      title: 'Twitter Parser DOWN',
      message: `Parser is not responding\nError: ${error}`,
      meta: { error },
    });
  },
  
  /**
   * Parser recovered
   */
  parserRecovered(downtimeMinutes: number) {
    return systemTelegram.send({
      type: 'PARSER_RECOVERED',
      title: 'Twitter Parser RECOVERED',
      message: `Parser is back online\nDowntime: ${downtimeMinutes} minutes`,
      meta: { downtimeMinutes },
    });
  },
  
  /**
   * Critical abort rate
   */
  criticalAbortRate(abortRate: number, threshold: number) {
    return systemTelegram.send({
      type: 'CRITICAL_ABORT_RATE',
      title: 'Critical Abort Rate',
      message: `System abort rate is critically high\nCurrent: ${abortRate}%\nThreshold: ${threshold}%`,
      meta: { abortRate, threshold },
    });
  },
};
