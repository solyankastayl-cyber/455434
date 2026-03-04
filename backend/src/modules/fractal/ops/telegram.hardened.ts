/**
 * BLOCK E.1 — Telegram Hardening: Rate Limiter + Retry Logic
 * 
 * Защита от спама и надёжная доставка:
 * - Rate limiting: max N сообщений в минуту
 * - Exponential backoff при ошибках
 * - Deduplication по hash сообщения
 * - Audit logging всех отправок
 */

import type { Logger } from '../isolation/fractal.host.deps.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type AlertLevel = 'INFO' | 'ALERT' | 'CRITICAL';

export interface TelegramSendResult {
  ok: boolean;
  messageId?: number;
  status: number;
  error?: string;
  retries: number;
  rateLimited: boolean;
  deduplicated: boolean;
  timestamp: string;
}

export interface TelegramHardenedConfig {
  token: string;
  chatId: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  rateLimit?: {
    maxPerMinute: number;
    maxPerHour: number;
  };
  dedupeWindowMs?: number;
  logger?: Logger;
}

interface SendRecord {
  hash: string;
  timestamp: number;
  level: AlertLevel;
}

// ═══════════════════════════════════════════════════════════════
// HARDENED TELEGRAM SERVICE
// ═══════════════════════════════════════════════════════════════

export class TelegramHardenedService {
  private config: Required<Omit<TelegramHardenedConfig, 'logger'>> & { logger?: Logger };
  private sendHistory: SendRecord[] = [];
  private auditLog: TelegramSendResult[] = [];

  constructor(config: TelegramHardenedConfig) {
    this.config = {
      token: config.token,
      chatId: config.chatId,
      maxRetries: config.maxRetries ?? 3,
      baseDelayMs: config.baseDelayMs ?? 1000,
      maxDelayMs: config.maxDelayMs ?? 30000,
      rateLimit: config.rateLimit ?? { maxPerMinute: 10, maxPerHour: 60 },
      dedupeWindowMs: config.dedupeWindowMs ?? 60000, // 1 minute
      logger: config.logger,
    };
  }

  /**
   * Send message with full hardening
   */
  async send(
    text: string,
    level: AlertLevel = 'INFO',
    options?: { force?: boolean; parseMode?: 'HTML' | 'MarkdownV2' }
  ): Promise<TelegramSendResult> {
    const hash = this.hashMessage(text);
    const now = Date.now();

    // 1. Check deduplication (skip identical messages in window)
    if (!options?.force && this.isDuplicate(hash, now)) {
      const result: TelegramSendResult = {
        ok: true,
        status: 0,
        retries: 0,
        rateLimited: false,
        deduplicated: true,
        timestamp: new Date().toISOString(),
      };
      this.log('info', { hash, level }, 'Message deduplicated, skipping');
      return result;
    }

    // 2. Check rate limit
    if (this.isRateLimited(now)) {
      const result: TelegramSendResult = {
        ok: false,
        status: 429,
        error: 'RATE_LIMITED',
        retries: 0,
        rateLimited: true,
        deduplicated: false,
        timestamp: new Date().toISOString(),
      };
      this.log('warn', { level, rateLimit: this.config.rateLimit }, 'Rate limit exceeded');
      this.auditLog.push(result);
      return result;
    }

    // 3. Send with retry
    const result = await this.sendWithRetry(text, level, options?.parseMode ?? 'HTML');

    // 4. Record send
    if (result.ok) {
      this.sendHistory.push({ hash, timestamp: now, level });
      this.cleanupHistory(now);
    }

    this.auditLog.push(result);
    return result;
  }

  /**
   * Send CRITICAL alert (bypasses rate limit, no dedupe)
   */
  async sendCritical(text: string): Promise<TelegramSendResult> {
    return this.send(text, 'CRITICAL', { force: true });
  }

  /**
   * Send with exponential backoff retry
   */
  private async sendWithRetry(
    text: string,
    level: AlertLevel,
    parseMode: 'HTML' | 'MarkdownV2'
  ): Promise<TelegramSendResult> {
    let lastError: string | undefined;
    let lastStatus = 0;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const url = `https://api.telegram.org/bot${this.config.token}/sendMessage`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.config.chatId,
            text,
            parse_mode: parseMode,
            disable_web_page_preview: true,
          }),
        });

        lastStatus = res.status;
        const body = await res.json().catch(() => ({}));

        if (res.ok && body.ok) {
          this.log('info', { level, attempt, messageId: body.result?.message_id }, 'TG message sent');
          return {
            ok: true,
            messageId: body.result?.message_id,
            status: res.status,
            retries: attempt,
            rateLimited: false,
            deduplicated: false,
            timestamp: new Date().toISOString(),
          };
        }

        lastError = body.description || `HTTP ${res.status}`;

        // Don't retry on 4xx (except 429)
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          this.log('error', { status: res.status, error: lastError }, 'TG send failed (no retry)');
          break;
        }

        // Retry with backoff
        if (attempt < this.config.maxRetries) {
          const delay = this.getBackoffDelay(attempt);
          this.log('warn', { attempt, delay, error: lastError }, 'TG send failed, retrying');
          await this.sleep(delay);
        }
      } catch (err: any) {
        lastError = err?.message || String(err);
        this.log('error', { attempt, error: lastError }, 'TG send exception');

        if (attempt < this.config.maxRetries) {
          const delay = this.getBackoffDelay(attempt);
          await this.sleep(delay);
        }
      }
    }

    return {
      ok: false,
      status: lastStatus,
      error: lastError,
      retries: this.config.maxRetries,
      rateLimited: false,
      deduplicated: false,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Calculate exponential backoff delay
   */
  private getBackoffDelay(attempt: number): number {
    const delay = this.config.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * delay; // 30% jitter
    return Math.min(delay + jitter, this.config.maxDelayMs);
  }

  /**
   * Check if message is duplicate
   */
  private isDuplicate(hash: string, now: number): boolean {
    const cutoff = now - this.config.dedupeWindowMs;
    return this.sendHistory.some(r => r.hash === hash && r.timestamp > cutoff);
  }

  /**
   * Check rate limit
   */
  private isRateLimited(now: number): boolean {
    const { maxPerMinute, maxPerHour } = this.config.rateLimit;

    const minuteAgo = now - 60_000;
    const hourAgo = now - 3600_000;

    const inLastMinute = this.sendHistory.filter(r => r.timestamp > minuteAgo).length;
    const inLastHour = this.sendHistory.filter(r => r.timestamp > hourAgo).length;

    return inLastMinute >= maxPerMinute || inLastHour >= maxPerHour;
  }

  /**
   * Cleanup old history records
   */
  private cleanupHistory(now: number): void {
    const cutoff = now - 3600_000; // Keep 1 hour
    this.sendHistory = this.sendHistory.filter(r => r.timestamp > cutoff);

    // Keep last 1000 audit entries
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-500);
    }
  }

  /**
   * Simple hash for deduplication
   */
  private hashMessage(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private log(level: 'info' | 'warn' | 'error', data: any, msg: string): void {
    if (this.config.logger) {
      this.config.logger[level]?.(data, msg);
    } else {
      console[level](`[TG] ${msg}`, data);
    }
  }

  /**
   * Get service stats
   */
  getStats(): {
    sentLast5Min: number;
    sentLastHour: number;
    failuresLastHour: number;
    rateLimitedLastHour: number;
  } {
    const now = Date.now();
    const fiveMinAgo = now - 300_000;
    const hourAgo = now - 3600_000;

    const recentAudit = this.auditLog.filter(r => new Date(r.timestamp).getTime() > hourAgo);

    return {
      sentLast5Min: this.sendHistory.filter(r => r.timestamp > fiveMinAgo).length,
      sentLastHour: this.sendHistory.filter(r => r.timestamp > hourAgo).length,
      failuresLastHour: recentAudit.filter(r => !r.ok).length,
      rateLimitedLastHour: recentAudit.filter(r => r.rateLimited).length,
    };
  }

  /**
   * Get audit log (last N entries)
   */
  getAuditLog(limit = 50): TelegramSendResult[] {
    return this.auditLog.slice(-limit);
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON FACTORY
// ═══════════════════════════════════════════════════════════════

let _instance: TelegramHardenedService | null = null;

export function getTelegramHardenedService(config?: TelegramHardenedConfig): TelegramHardenedService {
  if (!_instance && config) {
    _instance = new TelegramHardenedService(config);
  }
  if (!_instance) {
    throw new Error('TelegramHardenedService not initialized');
  }
  return _instance;
}

export function initTelegramHardened(config: TelegramHardenedConfig): TelegramHardenedService {
  _instance = new TelegramHardenedService(config);
  return _instance;
}
