/**
 * Twitter Parser Module — Event Router
 * 
 * Routes events to appropriate channels.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT CHANGE routing logic
 */

import type { 
  TelegramEvent, 
  EventPayload, 
  EventScope, 
  SendEventParams, 
  SendEventResult 
} from '../messages/event.types.js';
import { TelegramMessageBuilder } from '../messages/message.builder.js';
import { getDedupeKey, isDuplicate, markSent } from './dedupe.guard.js';
import { EVENT_TO_PREF, type UserConnection, type SendFunction, type SystemSendFunction, type ConnectionFinder } from './router.types.js';

/**
 * Event router interface
 */
export interface IEventRouter {
  sendEvent(params: SendEventParams): Promise<SendEventResult>;
}

/**
 * Event router configuration
 */
export interface EventRouterConfig {
  findConnection: ConnectionFinder;
  sendUserMessage: SendFunction;
  sendSystemMessage: SystemSendFunction;
}

/**
 * TelegramEventRouter
 * 
 * Routes events to USER or SYSTEM channels
 */
export class TelegramEventRouter implements IEventRouter {
  private config: EventRouterConfig | null = null;
  
  /**
   * Initialize router with host functions
   */
  init(config: EventRouterConfig): void {
    this.config = config;
    console.log('[EventRouter] Initialized with host config');
  }
  
  /**
   * Send event to Telegram
   */
  async sendEvent(params: SendEventParams): Promise<SendEventResult> {
    const { event, userId, payload, scope } = params;
    
    console.log(`[EventRouter] sendEvent | event: ${event} | scope: ${scope} | userId: ${userId || 'N/A'}`);
    
    if (!this.config) {
      console.warn('[EventRouter] Not initialized');
      return { sent: false, reason: 'NOT_INITIALIZED' };
    }
    
    // 1. Validate scope requirements
    if (scope === 'USER' && !userId) {
      console.warn(`[EventRouter] USER event without userId: ${event}`);
      return { sent: false, reason: 'MISSING_USER_ID' };
    }
    
    // 2. Check dedupe
    const dedupeKey = getDedupeKey(event, userId);
    if (isDuplicate(dedupeKey, event)) {
      console.log(`[EventRouter] Dedupe hit: ${dedupeKey}`);
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
      markSent(dedupeKey);
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
    
    if (!this.config) {
      return { sent: false, reason: 'NOT_INITIALIZED' };
    }
    
    // 1. Find user's Telegram connection
    const connection = await this.config.findConnection(userId);
    
    if (!connection) {
      console.log(`[EventRouter] No connection for user ${userId}`);
      return { sent: false, reason: 'NO_CONNECTION' };
    }
    
    if (!connection.chatId) {
      console.log(`[EventRouter] No chatId for user ${userId}`);
      return { sent: false, reason: 'NO_CHAT_ID' };
    }
    
    // 2. Check event preferences
    const prefKey = EVENT_TO_PREF[event];
    if (prefKey && connection.eventPreferences) {
      const isEnabled = (connection.eventPreferences as any)[prefKey] !== false;
      
      if (!isEnabled) {
        console.log(`[EventRouter] Event ${event} disabled for user ${userId}`);
        return { sent: false, reason: 'EVENT_DISABLED' };
      }
    }
    
    // 3. Build message
    const message = TelegramMessageBuilder.build(event, payload);
    
    // 4. Send
    const result = await this.config.sendUserMessage(connection.chatId, message.text, {
      parseMode: 'HTML',
    });
    
    if (result.ok) {
      console.log(`[EventRouter] ✅ Sent ${event} to user ${userId}`);
      return { sent: true, messageId: result.messageId };
    } else {
      console.error(`[EventRouter] ❌ Failed ${event} to user ${userId}: ${result.error}`);
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
    
    if (!this.config) {
      return { sent: false, reason: 'NOT_INITIALIZED' };
    }
    
    // Build message
    const message = TelegramMessageBuilder.build(event, payload);
    
    // Route to system telegram notifier
    try {
      await this.config.sendSystemMessage({
        type: this.mapEventToSystemType(event),
        title: message.title || event,
        message: message.text,
        meta: payload,
      });
      
      console.log(`[EventRouter] ✅ Sent SYSTEM event: ${event}`);
      return { sent: true };
    } catch (err: any) {
      console.error(`[EventRouter] ❌ Failed SYSTEM event ${event}:`, err);
      return { sent: false, reason: err.message };
    }
  }
  
  /**
   * Map TelegramEvent to SystemEventType
   */
  private mapEventToSystemType(event: TelegramEvent): string {
    const map: Record<string, string> = {
      'PARSER_DOWN': 'PARSER_DOWN',
      'PARSER_UP': 'PARSER_RECOVERED',
      'ABORT_RATE_HIGH': 'CRITICAL_ABORT_RATE',
      'SYSTEM_COOLDOWN': 'COOLDOWN_APPLIED',
    };
    return map[event] || 'POLICY_VIOLATION';
  }
}

export const eventRouter = new TelegramEventRouter();
