/**
 * FRACTAL OPS — Telegram Notifier (Admin Only)
 * 
 * Production-safe Telegram integration for:
 * - Daily job reports
 * - Critical alerts (PROTECTION/HALT)
 * - Milestone notifications (30+ resolved)
 */

import type { FastifyBaseLogger } from 'fastify';

type TgSendOpts = {
  token: string;
  chatId: string;
  text: string;
  parseMode?: 'HTML' | 'MarkdownV2';
  disableWebPreview?: boolean;
};

export async function tgSendMessage(
  logger: FastifyBaseLogger | Console,
  opts: TgSendOpts
): Promise<{ ok: boolean; status: number; body?: any; error?: string }> {
  const url = `https://api.telegram.org/bot${opts.token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: opts.chatId,
        text: opts.text,
        parse_mode: opts.parseMode ?? 'HTML',
        disable_web_page_preview: opts.disableWebPreview ?? true
      })
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      logger.warn?.({ status: res.status, body }, 'TG send failed') ||
        console.warn('TG send failed', res.status);
      return { ok: false, status: res.status, body, error: 'TG_SEND_FAILED' };
    }
    return { ok: true, status: res.status, body };
  } catch (e: any) {
    logger.error?.({ err: e?.message ?? e }, 'TG send exception') ||
      console.error('TG send exception', e?.message);
    return { ok: false, status: 0, error: 'TG_SEND_EXCEPTION' };
  }
}

/**
 * Get Telegram config from environment
 * FRACTAL_ALERTS_ENABLED must be true for alerts to send
 */
export function getTelegramConfig() {
  const alertsEnabled = process.env.FRACTAL_ALERTS_ENABLED === 'true';
  const hasCredentials = !!(process.env.TG_BOT_TOKEN && process.env.TG_ADMIN_CHAT_ID);
  
  return {
    token: process.env.TG_BOT_TOKEN || '',
    chatId: process.env.TG_ADMIN_CHAT_ID || '',
    alertsEnabled,
    enabled: alertsEnabled && hasCredentials
  };
}

/**
 * Check if alerts can be sent (for guard in adapter)
 */
export function isAlertsEnabled(): boolean {
  return process.env.FRACTAL_ALERTS_ENABLED === 'true';
}
