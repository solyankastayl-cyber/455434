// Scope-aware Notification Service
// Routes alerts to correct Telegram bot based on execution scope

import { ExecutionScope, isSystemScope } from '../core/execution-scope.js';
import { sendTelegramMessage, TelegramConnectionModel } from '../../../core/notifications/telegram.service.js';

// Bot chat IDs from environment
const USER_BOT_CHAT_ID = process.env.TELEGRAM_USER_BOT_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID || '';
const SYSTEM_BOT_CHAT_ID = process.env.TELEGRAM_SYSTEM_BOT_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID || '';

// Alert types
export enum AlertType {
  // Parser alerts
  PARSER_DOWN = 'PARSER_DOWN',
  PARSER_UP = 'PARSER_UP',
  
  // Session alerts
  SESSION_INVALID = 'SESSION_INVALID',
  SESSION_STALE = 'SESSION_STALE',
  SESSION_RECOVERED = 'SESSION_RECOVERED',
  
  // Policy alerts
  POLICY_VIOLATION = 'POLICY_VIOLATION',
  
  // Parse alerts
  PARSE_ABORTED = 'PARSE_ABORTED',
  PARSE_SUCCESS = 'PARSE_SUCCESS',
  
  // Health alerts
  HIGH_ABORT_RATE = 'HIGH_ABORT_RATE',
  COOKIES_EXPIRED = 'COOKIES_EXPIRED',
}

export interface ScopedAlert {
  scope: ExecutionScope;
  type: AlertType;
  message: string;
  sessionId?: string;
  accountId?: string;
  metadata?: Record<string, any>;
}

/**
 * Get the appropriate chat ID based on scope
 */
function getChatIdForScope(scope: ExecutionScope): string {
  return isSystemScope(scope) ? SYSTEM_BOT_CHAT_ID : USER_BOT_CHAT_ID;
}

/**
 * Get emoji for alert type
 */
function getAlertEmoji(type: AlertType): string {
  switch (type) {
    case AlertType.PARSER_DOWN: return '🔴';
    case AlertType.PARSER_UP: return '🟢';
    case AlertType.SESSION_INVALID: return '🚨';
    case AlertType.SESSION_STALE: return '⚠️';
    case AlertType.SESSION_RECOVERED: return '✅';
    case AlertType.POLICY_VIOLATION: return '🚫';
    case AlertType.PARSE_ABORTED: return '❌';
    case AlertType.PARSE_SUCCESS: return '✅';
    case AlertType.HIGH_ABORT_RATE: return '🔥';
    case AlertType.COOKIES_EXPIRED: return '🔑';
    default: return '📢';
  }
}

/**
 * Get scope label for message
 */
function getScopeLabel(scope: ExecutionScope): string {
  return isSystemScope(scope) ? '🤖 SYSTEM' : '👤 USER';
}

/**
 * Send a scoped alert
 */
export async function sendScopedAlert(alert: ScopedAlert): Promise<boolean> {
  const chatId = getChatIdForScope(alert.scope);
  
  if (!chatId) {
    console.log(`[ScopedNotifier] No chat ID configured for scope: ${alert.scope}`);
    
    // Try fallback to any connected admin
    const connection = await TelegramConnectionModel.findOne({ isActive: true }).sort({ connectedAt: 1 });
    if (!connection) {
      console.log('[ScopedNotifier] No fallback Telegram chat available');
      return false;
    }
  }
  
  const emoji = getAlertEmoji(alert.type);
  const scopeLabel = getScopeLabel(alert.scope);
  
  const formattedMessage = `${emoji} <b>${alert.type.replace(/_/g, ' ')}</b>
  
<b>Scope:</b> ${scopeLabel}
${alert.sessionId ? `<b>Session:</b> <code>${alert.sessionId}</code>` : ''}
${alert.accountId ? `<b>Account:</b> <code>${alert.accountId}</code>` : ''}

${alert.message}

<i>${new Date().toISOString()}</i>`;

  try {
    const targetChatId = chatId || (await TelegramConnectionModel.findOne({ isActive: true }))?.chatId;
    if (!targetChatId) return false;
    
    const result = await sendTelegramMessage(targetChatId, formattedMessage);
    return result.ok;
  } catch (error) {
    console.error('[ScopedNotifier] Error sending alert:', error);
    return false;
  }
}

/**
 * Convenience functions for common alerts
 */
export async function notifyParserDown(scope: ExecutionScope, error: string): Promise<boolean> {
  return sendScopedAlert({
    scope,
    type: AlertType.PARSER_DOWN,
    message: `Parser service is DOWN.\n<b>Error:</b> ${escapeHtml(error)}`,
  });
}

export async function notifyParserUp(scope: ExecutionScope): Promise<boolean> {
  return sendScopedAlert({
    scope,
    type: AlertType.PARSER_UP,
    message: 'Parser service is back online.',
  });
}

export async function notifySessionInvalid(
  scope: ExecutionScope, 
  sessionId: string, 
  accountId?: string,
  reason?: string
): Promise<boolean> {
  return sendScopedAlert({
    scope,
    type: AlertType.SESSION_INVALID,
    sessionId,
    accountId,
    message: `Session cookies are invalid.${reason ? `\n<b>Reason:</b> ${escapeHtml(reason)}` : ''}\n\n👉 <b>Action:</b> Re-sync cookies via extension`,
  });
}

export async function notifyParseAborted(
  scope: ExecutionScope,
  sessionId: string,
  reason: string,
  taskId?: string
): Promise<boolean> {
  return sendScopedAlert({
    scope,
    type: AlertType.PARSE_ABORTED,
    sessionId,
    message: `Parse task aborted.\n<b>Reason:</b> ${escapeHtml(reason)}${taskId ? `\n<b>Task:</b> ${taskId}` : ''}`,
  });
}

export async function notifyHighAbortRate(
  scope: ExecutionScope,
  rate: number,
  window: string
): Promise<boolean> {
  return sendScopedAlert({
    scope,
    type: AlertType.HIGH_ABORT_RATE,
    message: `High abort rate detected: <b>${rate}%</b> in last ${window}.\n\n👉 Check system health and session validity.`,
  });
}

export async function notifyPolicyViolation(
  scope: ExecutionScope,
  violation: string,
  sessionId?: string
): Promise<boolean> {
  return sendScopedAlert({
    scope,
    type: AlertType.POLICY_VIOLATION,
    sessionId,
    message: `Policy violation: ${escapeHtml(violation)}`,
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
