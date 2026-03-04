/**
 * Twitter Parser Module — Telegram Notifier
 * 
 * Low-level Telegram API wrapper.
 * Based on: v4.2-final
 * 
 * FROZEN: 1 retry, fail-safe (log, no throw)
 */

import type { NotifierConfig, SendOptions, SendResult, NotifierStats } from './notifier.types.js';

/**
 * ITelegramNotifier interface
 * 
 * Can be implemented with different backends
 */
export interface ITelegramNotifier {
  send(chatId: string, text: string, options?: SendOptions): Promise<SendResult>;
  getStats(): NotifierStats;
}

/**
 * TelegramNotifier
 * 
 * Sends messages to Telegram
 */
export class TelegramNotifier implements ITelegramNotifier {
  private config: NotifierConfig | null = null;
  private stats: NotifierStats = {
    totalSent: 0,
    totalFailed: 0,
  };
  
  /**
   * Initialize notifier
   */
  init(config: NotifierConfig): void {
    this.config = config;
    console.log('[TelegramNotifier] Initialized');
  }
  
  /**
   * Send message to chat
   */
  async send(chatId: string, text: string, options: SendOptions = {}): Promise<SendResult> {
    if (!this.config) {
      console.warn('[TelegramNotifier] Not initialized');
      return { ok: false, error: 'NOT_INITIALIZED' };
    }
    
    const maxRetries = this.config.retryCount ?? 1;
    const retryDelay = this.config.retryDelayMs ?? 1000;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.sendRequest(chatId, text, options);
        
        if (result.ok) {
          this.stats.totalSent++;
          this.stats.lastSentAt = new Date();
          return result;
        }
        
        // Non-retryable errors
        if (this.isNonRetryableError(result.error)) {
          this.stats.totalFailed++;
          this.stats.lastError = result.error;
          return result;
        }
        
        // Retry
        if (attempt < maxRetries) {
          console.log(`[TelegramNotifier] Retry ${attempt + 1}/${maxRetries} for chat ${chatId}`);
          await this.sleep(retryDelay);
        }
        
      } catch (err: any) {
        console.error(`[TelegramNotifier] Error sending to ${chatId}:`, err.message);
        
        if (attempt === maxRetries) {
          this.stats.totalFailed++;
          this.stats.lastError = err.message;
          return { ok: false, error: err.message };
        }
        
        await this.sleep(retryDelay);
      }
    }
    
    this.stats.totalFailed++;
    return { ok: false, error: 'MAX_RETRIES_EXCEEDED' };
  }
  
  /**
   * Send HTTP request to Telegram API
   */
  private async sendRequest(chatId: string, text: string, options: SendOptions): Promise<SendResult> {
    if (!this.config) {
      return { ok: false, error: 'NOT_INITIALIZED' };
    }
    
    const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
    
    const body = {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode || 'HTML',
      disable_web_page_preview: options.disableWebPreview ?? true,
      disable_notification: options.disableNotification ?? false,
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    const data = await response.json();
    
    if (data.ok) {
      return { ok: true, messageId: data.result?.message_id };
    }
    
    return { ok: false, error: data.description || 'Unknown error' };
  }
  
  /**
   * Check if error is non-retryable
   */
  private isNonRetryableError(error?: string): boolean {
    if (!error) return false;
    
    const nonRetryable = [
      'chat not found',
      'bot was blocked',
      'user is deactivated',
      'chat_id is empty',
      'Forbidden',
    ];
    
    return nonRetryable.some(e => error.toLowerCase().includes(e.toLowerCase()));
  }
  
  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Get stats
   */
  getStats(): NotifierStats {
    return { ...this.stats };
  }
}

export const telegramNotifier = new TelegramNotifier();
