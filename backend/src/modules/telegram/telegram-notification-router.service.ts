/**
 * Phase 5.2.2 - TelegramNotificationRouter
 * 
 * ЕДИНАЯ точка маршрутизации событий → Telegram
 * 
 * ПРАВИЛА:
 * 1. Ни один сервис напрямую не шлёт в Telegram
 * 2. Все события идут через этот router
 * 3. Router решает: кому, что, можно ли, в каком формате
 * 4. USER и SYSTEM потоки изолированы
 */

import { TelegramConnectionModel, sendTelegramMessage } from '../../core/notifications/telegram.service.js';
import { systemTelegram } from './system-telegram.notifier.js';
import { TelegramMessageBuilder, TelegramEvent, EventPayload } from './telegram-message-builder.js';

// Dedupe storage (in-memory, can migrate to Redis/Mongo TTL later)
const dedupeCache = new Map<string, number>();

// Dedupe TTL by event type (ms)
const DEDUPE_TTL: Record<TelegramEvent, number> = {
  'NEW_TWEETS': 5 * 60 * 1000,        // 5 min - frequent event
  'SESSION_EXPIRED': 30 * 60 * 1000,  // 30 min - important, don't spam
  'SESSION_RESYNCED': 15 * 60 * 1000, // 15 min
  'SESSION_OK': 15 * 60 * 1000,       // 15 min
  'SESSION_STALE': 30 * 60 * 1000,    // 30 min
  'TARGET_COOLDOWN': 15 * 60 * 1000,  // 15 min
  'HIGH_RISK': 30 * 60 * 1000,        // 30 min
  'PARSE_COMPLETED': 5 * 60 * 1000,   // 5 min - noisy, short TTL
  'PARSE_ABORTED': 10 * 60 * 1000,    // 10 min
  'PARSER_DOWN': 10 * 60 * 1000,      // 10 min - critical
  'PARSER_UP': 5 * 60 * 1000,         // 5 min
  'ABORT_RATE_HIGH': 15 * 60 * 1000,  // 15 min
  'SYSTEM_COOLDOWN': 15 * 60 * 1000,  // 15 min
};

// Event to preference key mapping
const EVENT_TO_PREF: Record<TelegramEvent, string | null> = {
  'NEW_TWEETS': null,                 // Custom handling per target
  'SESSION_EXPIRED': 'sessionInvalid',
  'SESSION_RESYNCED': 'sessionOk',
  'SESSION_OK': 'sessionOk',
  'SESSION_STALE': 'sessionStale',
  'TARGET_COOLDOWN': 'cooldown',
  'HIGH_RISK': 'highRisk',
  'PARSE_COMPLETED': 'parseCompleted',
  'PARSE_ABORTED': 'parseAborted',
  'PARSER_DOWN': null,                // SYSTEM only
  'PARSER_UP': null,                  // SYSTEM only
  'ABORT_RATE_HIGH': null,            // SYSTEM only
  'SYSTEM_COOLDOWN': null,            // SYSTEM only
};

export type EventScope = 'USER' | 'SYSTEM';

export interface SendEventParams {
  event: TelegramEvent;
  userId?: string;        // Required for USER scope
  payload: EventPayload;
  scope: EventScope;
}

export interface SendEventResult {
  sent: boolean;
  reason?: string;
  messageId?: number;
}

/**
 * TelegramNotificationRouter
 * 
 * Единственный способ отправить что-либо в Telegram из системы
 */
class TelegramNotificationRouter {
  
  /**
   * Send event to Telegram
   * 
   * Main entry point for all Telegram notifications
   */
  async sendEvent(params: SendEventParams): Promise<SendEventResult> {
    const { event, userId, payload, scope } = params;
    
    console.log(`[TelegramRouter] sendEvent | event: ${event} | scope: ${scope} | userId: ${userId || 'N/A'}`);
    
    // 1. Validate scope requirements
    if (scope === 'USER' && !userId) {
      console.warn(`[TelegramRouter] USER event without userId: ${event}`);
      return { sent: false, reason: 'MISSING_USER_ID' };
    }
    
    // 2. Check dedupe
    const dedupeKey = this.getDedupeKey(event, userId);
    if (this.isDuplicate(dedupeKey, event)) {
      console.log(`[TelegramRouter] Dedupe hit: ${dedupeKey}`);
      return { sent: false, reason: 'DEDUPE' };
    }
    
    // 3. Route by scope
    let result: SendEventResult;
    
    if (scope === 'SYSTEM') {
      result = await this.sendSystemEvent(event, payload);
    } else {
      result = await this.sendUserEvent(event, userId!, payload);
    }
    
    // 4. Update dedupe cache on success
    if (result.sent) {
      this.markSent(dedupeKey, event);
    }
    
    return result;
  }
  
  /**
   * Send USER-scoped event
   */
  private async sendUserEvent(
    event: TelegramEvent,
    userId: string,
    payload: EventPayload
  ): Promise<SendEventResult> {
    
    // 1. Find user's Telegram connection
    const connection = await TelegramConnectionModel.findOne({
      userId,
      isActive: true,
    });
    
    if (!connection) {
      console.log(`[TelegramRouter] No connection for user ${userId}`);
      return { sent: false, reason: 'NO_CONNECTION' };
    }
    
    if (!connection.chatId) {
      console.log(`[TelegramRouter] No chatId for user ${userId}`);
      return { sent: false, reason: 'NO_CHAT_ID' };
    }
    
    // 2. Check event preferences
    const prefKey = EVENT_TO_PREF[event];
    if (prefKey) {
      const prefs = connection.eventPreferences || {};
      const isEnabled = (prefs as any)[prefKey] !== false; // Default true
      
      if (!isEnabled) {
        console.log(`[TelegramRouter] Event ${event} disabled for user ${userId}`);
        return { sent: false, reason: 'EVENT_DISABLED' };
      }
    }
    
    // 3. Build message
    const message = TelegramMessageBuilder.build(event, payload);
    
    // 4. Send
    const result = await sendTelegramMessage(connection.chatId, message.text, {
      parseMode: 'HTML',
    });
    
    if (result.ok) {
      console.log(`[TelegramRouter] ✅ Sent ${event} to user ${userId}`);
      return { sent: true, messageId: result.messageId };
    } else {
      console.error(`[TelegramRouter] ❌ Failed ${event} to user ${userId}: ${result.error}`);
      return { sent: false, reason: result.error };
    }
  }
  
  /**
   * Send SYSTEM-scoped event
   */
  private async sendSystemEvent(
    event: TelegramEvent,
    payload: EventPayload
  ): Promise<SendEventResult> {
    
    // Build message
    const message = TelegramMessageBuilder.build(event, payload);
    
    // Route to system telegram notifier
    try {
      await systemTelegram.send({
        type: this.mapEventToSystemType(event),
        title: message.title || event,
        message: message.text,
        meta: payload,
      });
      
      console.log(`[TelegramRouter] ✅ Sent SYSTEM event: ${event}`);
      return { sent: true };
    } catch (err: any) {
      console.error(`[TelegramRouter] ❌ Failed SYSTEM event ${event}:`, err);
      return { sent: false, reason: err.message };
    }
  }
  
  /**
   * Map TelegramEvent to SystemEventType
   */
  private mapEventToSystemType(event: TelegramEvent): any {
    const map: Record<string, string> = {
      'PARSER_DOWN': 'PARSER_DOWN',
      'PARSER_UP': 'PARSER_RECOVERED',
      'ABORT_RATE_HIGH': 'CRITICAL_ABORT_RATE',
      'SYSTEM_COOLDOWN': 'COOLDOWN_APPLIED',
    };
    return map[event] || 'POLICY_VIOLATION';
  }
  
  /**
   * Generate dedupe key
   */
  private getDedupeKey(event: TelegramEvent, userId?: string): string {
    return `${event}:${userId || 'system'}`;
  }
  
  /**
   * Check if event is duplicate
   */
  private isDuplicate(key: string, event: TelegramEvent): boolean {
    const lastSent = dedupeCache.get(key);
    if (!lastSent) return false;
    
    const ttl = DEDUPE_TTL[event] || 5 * 60 * 1000;
    return Date.now() - lastSent < ttl;
  }
  
  /**
   * Mark event as sent
   */
  private markSent(key: string, event: TelegramEvent): void {
    dedupeCache.set(key, Date.now());
    
    // Cleanup old entries periodically
    if (dedupeCache.size > 1000) {
      this.cleanupDedupeCache();
    }
  }
  
  /**
   * Cleanup expired dedupe entries
   */
  private cleanupDedupeCache(): void {
    const now = Date.now();
    const maxTTL = Math.max(...Object.values(DEDUPE_TTL));
    
    for (const [key, timestamp] of dedupeCache.entries()) {
      if (now - timestamp > maxTTL) {
        dedupeCache.delete(key);
      }
    }
    
    console.log(`[TelegramRouter] Dedupe cache cleanup: ${dedupeCache.size} entries remaining`);
  }
  
  // ============================================
  // Convenience methods for common events
  // ============================================
  
  /**
   * Notify user about new tweets found
   */
  async notifyNewTweets(userId: string, params: {
    count: number;
    target: string;
    targetType: 'keyword' | 'account';
  }): Promise<SendEventResult> {
    return this.sendEvent({
      event: 'NEW_TWEETS',
      userId,
      scope: 'USER',
      payload: params,
    });
  }
  
  /**
   * Notify user about session expiry
   */
  async notifySessionExpired(userId: string, params: {
    account?: string;
    reason?: string;
  }): Promise<SendEventResult> {
    return this.sendEvent({
      event: 'SESSION_EXPIRED',
      userId,
      scope: 'USER',
      payload: params,
    });
  }
  
  /**
   * Notify user about session resync
   */
  async notifySessionResynced(userId: string, params: {
    account?: string;
  }): Promise<SendEventResult> {
    return this.sendEvent({
      event: 'SESSION_RESYNCED',
      userId,
      scope: 'USER',
      payload: params,
    });
  }
  
  /**
   * Notify user about target cooldown
   */
  async notifyTargetCooldown(userId: string, params: {
    target: string;
    reason: string;
    durationMinutes: number;
  }): Promise<SendEventResult> {
    return this.sendEvent({
      event: 'TARGET_COOLDOWN',
      userId,
      scope: 'USER',
      payload: params,
    });
  }
  
  /**
   * Notify admins about parser being down
   */
  async notifyParserDown(params: {
    error: string;
  }): Promise<SendEventResult> {
    return this.sendEvent({
      event: 'PARSER_DOWN',
      scope: 'SYSTEM',
      payload: params,
    });
  }
  
  /**
   * Notify admins about parser recovery
   */
  async notifyParserUp(params: {
    downtimeMinutes?: number;
  }): Promise<SendEventResult> {
    return this.sendEvent({
      event: 'PARSER_UP',
      scope: 'SYSTEM',
      payload: params,
    });
  }
  
  /**
   * Notify admins about high abort rate
   */
  async notifyHighAbortRate(params: {
    abortRate: number;
    threshold: number;
  }): Promise<SendEventResult> {
    return this.sendEvent({
      event: 'ABORT_RATE_HIGH',
      scope: 'SYSTEM',
      payload: params,
    });
  }
}

// Singleton instance
export const telegramRouter = new TelegramNotificationRouter();
