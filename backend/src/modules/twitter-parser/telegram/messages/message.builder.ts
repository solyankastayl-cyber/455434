/**
 * Twitter Parser Module — Telegram Message Builder
 * 
 * Builds formatted messages for Telegram.
 * Based on: v4.2-final
 * 
 * FROZEN: Pure formatting, no business logic
 */

import type { TelegramEvent, EventPayload, TelegramMessage } from './event.types.js';
import { MESSAGE_TEMPLATES, escapeHtml } from './templates.js';

/**
 * TelegramMessageBuilder
 * 
 * Builds formatted messages for Telegram
 */
export class TelegramMessageBuilder {
  
  /**
   * Build message for event
   */
  static build(event: TelegramEvent, payload: EventPayload = {}): TelegramMessage {
    const config = MESSAGE_TEMPLATES[event];
    
    if (!config) {
      console.warn(`[MessageBuilder] Unknown event: ${event}`);
      return {
        text: `📢 <b>Event: ${event}</b>\n\n${JSON.stringify(payload, null, 2)}`,
        title: event,
      };
    }
    
    const body = config.template(payload);
    const text = `${config.emoji} <b>${config.title}</b>\n\n${body}`;
    
    return {
      text,
      title: config.title,
    };
  }
  
  /**
   * Build custom message
   */
  static custom(params: {
    emoji: string;
    title: string;
    body: string;
  }): TelegramMessage {
    return {
      text: `${params.emoji} <b>${escapeHtml(params.title)}</b>\n\n${params.body}`,
      title: params.title,
    };
  }
  
  /**
   * Build simple text message
   */
  static text(message: string): TelegramMessage {
    return {
      text: message,
    };
  }
}
