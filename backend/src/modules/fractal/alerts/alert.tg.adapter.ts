/**
 * BLOCK 67 — Alert Telegram Adapter
 * 
 * Sends alerts to admin Telegram chat.
 * Only sends events with blockedBy === 'NONE'.
 * 
 * PRODUCTION GUARD: Requires FRACTAL_ALERTS_ENABLED=true
 */

import { tgSendMessage, getTelegramConfig, isAlertsEnabled } from '../ops/telegram.notifier.js';
import type { AlertEvent } from './alert.types.js';

const ADMIN_BASE_URL = process.env.PUBLIC_ADMIN_URL || '';

/**
 * Format alert for Telegram (institutional style)
 */
function formatAlertMessage(event: AlertEvent): string {
  const levelEmoji: Record<string, string> = {
    INFO: '📊',
    HIGH: '⚠️',
    CRITICAL: '🔴'
  };
  
  const lines: string[] = [
    `<b>[${event.level}] ${event.symbol} — ${event.type.replace(/_/g, ' ')}</b>`,
    '',
    event.message.replace(/\n/g, '\n'),
  ];
  
  // Add key metrics from meta
  if (event.meta) {
    lines.push('');
    
    if (event.meta.currentRegime) {
      lines.push(`Regime: <code>${event.meta.currentRegime}</code>`);
    }
    if (event.meta.currentHealth) {
      lines.push(`Health: <code>${event.meta.currentHealth}</code>`);
    }
    if (event.meta.currentTailRisk !== undefined) {
      lines.push(`Tail Risk: <code>${event.meta.currentTailRisk.toFixed(1)}%</code>`);
    }
    if (event.meta.decision) {
      lines.push(`Decision: <code>${event.meta.decision}</code>`);
    }
    if (event.meta.blockers && event.meta.blockers.length > 0) {
      lines.push(`Blockers: <code>${event.meta.blockers.join(', ')}</code>`);
    }
  }
  
  // Add admin link
  if (ADMIN_BASE_URL) {
    lines.push('');
    lines.push(`<a href="${ADMIN_BASE_URL}/admin/fractal?tab=alerts">View Alerts</a>`);
  }
  
  // Timestamp
  lines.push('');
  lines.push(`<i>${event.triggeredAt.toISOString()}</i>`);
  
  return lines.join('\n');
}

/**
 * Send single alert to Telegram
 * GUARD: Only sends if FRACTAL_ALERTS_ENABLED=true AND blockedBy === 'NONE'
 */
export async function sendAlertToTelegram(
  event: AlertEvent,
  logger: Console | any = console
): Promise<{ ok: boolean; error?: string }> {
  // PRODUCTION GUARD: Check FRACTAL_ALERTS_ENABLED first
  if (!isAlertsEnabled()) {
    logger.info?.('[AlertTG] FRACTAL_ALERTS_ENABLED=false, skipping send') ||
      console.log('[AlertTG] FRACTAL_ALERTS_ENABLED=false, skipping send');
    return { ok: false, error: 'ALERTS_DISABLED' };
  }
  
  // Only send if not blocked
  if (event.blockedBy !== 'NONE') {
    return { ok: false, error: `Blocked by ${event.blockedBy}` };
  }
  
  const config = getTelegramConfig();
  
  if (!config.enabled) {
    logger.warn?.('[AlertTG] Telegram not configured, skipping') ||
      console.warn('[AlertTG] Telegram not configured');
    return { ok: false, error: 'TG_NOT_CONFIGURED' };
  }
  
  const text = formatAlertMessage(event);
  
  const result = await tgSendMessage(logger, {
    token: config.token,
    chatId: config.chatId,
    text,
    parseMode: 'HTML',
    disableWebPreview: true
  });
  
  if (result.ok) {
    logger.info?.({ type: event.type, level: event.level }, '[AlertTG] Alert sent') ||
      console.log('[AlertTG] Alert sent:', event.type);
  } else {
    logger.error?.({ error: result.error }, '[AlertTG] Failed to send alert') ||
      console.error('[AlertTG] Failed to send alert:', result.error);
  }
  
  return { ok: result.ok, error: result.error };
}

/**
 * Send multiple alerts to Telegram
 */
export async function sendAlertsToTelegram(
  events: AlertEvent[],
  logger: Console | any = console
): Promise<{ sent: number; failed: number; skipped: number }> {
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  
  for (const event of events) {
    if (event.blockedBy !== 'NONE') {
      skipped++;
      continue;
    }
    
    const result = await sendAlertToTelegram(event, logger);
    if (result.ok) {
      sent++;
    } else {
      failed++;
    }
    
    // Small delay between messages to avoid rate limits
    if (events.length > 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  return { sent, failed, skipped };
}
