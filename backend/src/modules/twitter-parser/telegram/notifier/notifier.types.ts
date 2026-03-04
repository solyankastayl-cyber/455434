/**
 * Twitter Parser Module — Notifier Types
 * 
 * Types for telegram notification sending.
 * Based on: v4.2-final
 */

export interface NotifierConfig {
  botToken: string;
  defaultChatId?: string;
  retryCount?: number;
  retryDelayMs?: number;
}

export interface SendOptions {
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disableWebPreview?: boolean;
  disableNotification?: boolean;
}

export interface SendResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

export interface NotifierStats {
  totalSent: number;
  totalFailed: number;
  lastSentAt?: Date;
  lastError?: string;
}
