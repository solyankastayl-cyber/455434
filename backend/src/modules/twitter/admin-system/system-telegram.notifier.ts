// System Telegram Notifier - Production-grade alerts for SYSTEM parsing
// Separate from USER notifications, no user preferences

import { sendTelegramMessage, TelegramConnectionModel } from '../../../core/notifications/telegram.service.js';

// System bot chat ID - should be configured in .env
const SYSTEM_BOT_CHAT_ID = process.env.TELEGRAM_SYSTEM_BOT_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID || '';

// Admin console base URL
const ADMIN_URL = process.env.ADMIN_URL || 'https://backtest-replay-lab.preview.emergentagent.com';

// Alert event types
export enum SystemAlertEvent {
  PARSER_DOWN = 'PARSER_DOWN',
  PARSER_UP = 'PARSER_UP',
  SYSTEM_SESSION_INVALID = 'SYSTEM_SESSION_INVALID',
  SYSTEM_SESSION_STALE = 'SYSTEM_SESSION_STALE',
  SYSTEM_PARSE_BLOCKED = 'SYSTEM_PARSE_BLOCKED',
  SYSTEM_PARSE_ABORTED = 'SYSTEM_PARSE_ABORTED',
  HIGH_ABORT_RATE = 'HIGH_ABORT_RATE',
}

// Alert payload interface
export interface SystemAlertPayload {
  accountId?: string;
  accountUsername?: string;
  sessionId?: string;
  reason?: string;
  blockers?: Array<{ code: string; message: string }>;
  fetchedCount?: number;
  duration?: number;
  abortRate?: number;
  windowSize?: number;
  affectedAccounts?: number;
  error?: string;
  taskId?: string;
}

// Dedupe cache to prevent spam
const recentAlerts = new Map<string, number>();
const ALERT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Check if alert was recently sent (dedupe)
 */
function wasRecentlySent(event: SystemAlertEvent, identifier: string): boolean {
  const key = `${event}:${identifier}`;
  const lastSent = recentAlerts.get(key);
  
  if (lastSent && Date.now() - lastSent < ALERT_COOLDOWN_MS) {
    return true;
  }
  
  return false;
}

/**
 * Mark alert as sent
 */
function markAsSent(event: SystemAlertEvent, identifier: string): void {
  const key = `${event}:${identifier}`;
  recentAlerts.set(key, Date.now());
  
  // Cleanup old entries
  const cutoff = Date.now() - ALERT_COOLDOWN_MS * 2;
  for (const [k, v] of recentAlerts.entries()) {
    if (v < cutoff) recentAlerts.delete(k);
  }
}

/**
 * Format alert message based on event type
 */
function formatSystemAlert(event: SystemAlertEvent, payload: SystemAlertPayload): string {
  const timestamp = new Date().toISOString().slice(11, 19) + ' UTC';
  
  switch (event) {
    case SystemAlertEvent.PARSER_DOWN:
      return `🔴 <b>PARSER DOWN</b>

Service: twitter-parser-v2
Time: ${timestamp}
${payload.error ? `Error: ${escapeHtml(payload.error)}` : ''}

→ <a href="${ADMIN_URL}/admin/system-parsing">System Health</a>`;

    case SystemAlertEvent.PARSER_UP:
      return `🟢 <b>PARSER UP</b>

Service: twitter-parser-v2
Time: ${timestamp}

Parser is back online.`;

    case SystemAlertEvent.SYSTEM_SESSION_INVALID:
      return `🚨 <b>SESSION INVALID</b>

Account: @${payload.accountUsername || 'unknown'}
Session: <code>${payload.sessionId?.slice(0, 20)}...</code>
${payload.reason ? `Reason: ${escapeHtml(payload.reason)}` : ''}

→ <a href="${ADMIN_URL}/admin/system-parsing/sessions">View Sessions</a>`;

    case SystemAlertEvent.SYSTEM_SESSION_STALE:
      return `⚠️ <b>SESSION STALE</b>

Account: @${payload.accountUsername || 'unknown'}
Session: <code>${payload.sessionId?.slice(0, 20)}...</code>

Cookies may be expiring. Consider re-sync.

→ <a href="${ADMIN_URL}/admin/system-parsing/sessions">View Sessions</a>`;

    case SystemAlertEvent.SYSTEM_PARSE_BLOCKED:
      const blockersList = payload.blockers?.map(b => `• ${b.message}`).join('\n') || 'Unknown';
      return `🚫 <b>SYSTEM PARSE BLOCKED</b>

Account: @${payload.accountUsername || 'unknown'}
Reason: PREFLIGHT_FAILED
Blockers:
${blockersList}

→ <a href="${ADMIN_URL}/admin/system-parsing/health">System Console</a>`;

    case SystemAlertEvent.SYSTEM_PARSE_ABORTED:
      return `💥 <b>SYSTEM PARSE ABORTED</b>

Account: @${payload.accountUsername || 'unknown'}
Reason: ${payload.reason || 'UNKNOWN'}
Fetched: ${payload.fetchedCount ?? 0}
Duration: ${payload.duration ? `${Math.round(payload.duration / 1000)}s` : '-'}
${payload.taskId ? `Task: <code>${payload.taskId}</code>` : ''}

→ <a href="${ADMIN_URL}/admin/system-parsing/tasks">View Tasks</a>`;

    case SystemAlertEvent.HIGH_ABORT_RATE:
      return `🟡 <b>HIGH ABORT RATE</b>

Window: last ${payload.windowSize || 10} tasks
Abort rate: ${payload.abortRate || 0}%
Accounts affected: ${payload.affectedAccounts || 0}

→ <a href="${ADMIN_URL}/admin/system-parsing/health">System Console</a>`;

    default:
      return `📢 <b>SYSTEM ALERT</b>

Event: ${event}
Time: ${timestamp}

→ <a href="${ADMIN_URL}/admin/system-parsing">System Console</a>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Send system alert via Telegram
 */
export async function sendSystemAlert(
  event: SystemAlertEvent, 
  payload: SystemAlertPayload
): Promise<boolean> {
  // Determine identifier for dedupe
  const identifier = payload.accountId || payload.sessionId || 'global';
  
  // Check dedupe (except for critical events)
  if (event !== SystemAlertEvent.PARSER_DOWN && event !== SystemAlertEvent.PARSER_UP) {
    if (wasRecentlySent(event, identifier)) {
      console.log(`[SystemNotifier] Alert ${event} for ${identifier} was recently sent, skipping`);
      return false;
    }
  }
  
  // Get chat ID
  let chatId = SYSTEM_BOT_CHAT_ID;
  
  if (!chatId) {
    // Fallback to first active admin connection
    const connection = await TelegramConnectionModel.findOne({ isActive: true }).sort({ connectedAt: 1 });
    chatId = connection?.chatId || '';
  }
  
  if (!chatId) {
    console.log('[SystemNotifier] No Telegram chat configured for SYSTEM alerts');
    return false;
  }
  
  // Format message
  const message = formatSystemAlert(event, payload);
  
  try {
    const result = await sendTelegramMessage(chatId, message);
    
    if (result.ok) {
      markAsSent(event, identifier);
      console.log(`[SystemNotifier] Sent ${event} alert for ${identifier}`);
    }
    
    return result.ok;
  } catch (error) {
    console.error('[SystemNotifier] Failed to send alert:', error);
    return false;
  }
}

// Convenience functions
export async function notifyParserDown(error?: string): Promise<boolean> {
  return sendSystemAlert(SystemAlertEvent.PARSER_DOWN, { error });
}

export async function notifyParserUp(): Promise<boolean> {
  return sendSystemAlert(SystemAlertEvent.PARSER_UP, {});
}

export async function notifySystemParseBlocked(
  sessionId: string,
  accountUsername: string,
  blockers: Array<{ code: string; message: string }>
): Promise<boolean> {
  return sendSystemAlert(SystemAlertEvent.SYSTEM_PARSE_BLOCKED, {
    sessionId,
    accountUsername,
    blockers,
  });
}

export async function notifySystemParseAborted(
  sessionId: string,
  accountUsername: string,
  reason: string,
  fetchedCount: number,
  duration: number,
  taskId?: string
): Promise<boolean> {
  return sendSystemAlert(SystemAlertEvent.SYSTEM_PARSE_ABORTED, {
    sessionId,
    accountUsername,
    reason,
    fetchedCount,
    duration,
    taskId,
  });
}

export async function notifySessionInvalid(
  sessionId: string,
  accountUsername: string,
  reason?: string
): Promise<boolean> {
  return sendSystemAlert(SystemAlertEvent.SYSTEM_SESSION_INVALID, {
    sessionId,
    accountUsername,
    reason,
  });
}

export async function notifySessionStale(
  sessionId: string,
  accountUsername: string
): Promise<boolean> {
  return sendSystemAlert(SystemAlertEvent.SYSTEM_SESSION_STALE, {
    sessionId,
    accountUsername,
  });
}

export async function notifyHighAbortRate(
  abortRate: number,
  windowSize: number,
  affectedAccounts: number
): Promise<boolean> {
  return sendSystemAlert(SystemAlertEvent.HIGH_ABORT_RATE, {
    abortRate,
    windowSize,
    affectedAccounts,
  });
}
