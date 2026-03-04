// Webhook DTO (extension → backend)
// Phase 1.2: Контракт webhook (финальный)

export interface CookieKV {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
}

/**
 * Webhook payload от Chrome Extension
 * 
 * ВАЖНО: 
 * - Authorization: Bearer <apiKey> в headers (Phase 1.1)
 * - accountId получен из UI, user осознанно выбирает к какому аккаунту привязывает cookies
 * - ownerUserId НЕ передаётся, извлекается из API key middleware
 */
export interface CookieWebhookDTO {
  /** ID аккаунта (из UI, не из extension guesses) */
  accountId: string;
  
  /** Cookies массив */
  cookies: CookieKV[];
  
  /** User agent браузера */
  userAgent?: string;
  
  /** Timestamp отправки */
  ts?: number;
}
