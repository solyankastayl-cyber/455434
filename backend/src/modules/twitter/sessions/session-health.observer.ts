// Session Health Observer
// Monitors session status changes and sends Telegram notifications
// Part of MULTI Architecture

import { TwitterSessionModel, ITwitterSession, SessionStatus } from './session.model.js';
import { sendTelegramMessage, TelegramConnectionModel } from '../../../core/notifications/telegram.service.js';

export interface SessionStatusChange {
  sessionId: string;
  accountId?: string;
  from: SessionStatus;
  to: SessionStatus;
  reason: string;
  timestamp: Date;
}

// Admin chat ID for session notifications (set in env or use first connected admin)
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '577782582';

/**
 * Format session status change for Telegram
 */
function formatSessionChangeMessage(change: SessionStatusChange): string {
  const emoji = 
    change.to === 'OK' ? '🟢' :
    change.to === 'STALE' ? '🟠' :
    change.to === 'INVALID' ? '🔴' :
    '⚪';

  const fromEmoji = 
    change.from === 'OK' ? '🟢' :
    change.from === 'STALE' ? '🟠' :
    change.from === 'INVALID' ? '🔴' :
    '⚪';

  const urgency = change.to === 'INVALID' ? '🚨 <b>URGENT</b>\n\n' : '';
  const action = 
    change.to === 'INVALID' 
      ? '\n\n👉 <b>Action required:</b> Re-login to X/Twitter and sync cookies'
      : change.to === 'STALE'
      ? '\n\n👉 <b>Recommended:</b> Check cookies - may need refresh soon'
      : '';

  return `${urgency}${emoji} <b>Twitter Session Status Changed</b>

<b>Session:</b> <code>${change.sessionId}</code>
${change.accountId ? `<b>Account:</b> <code>${change.accountId}</code>` : ''}

<b>Status:</b> ${fromEmoji} ${change.from} → ${emoji} <b>${change.to}</b>

<b>Reason:</b>
<i>${escapeHtml(change.reason)}</i>

<b>Time:</b> ${change.timestamp.toISOString()}${action}`;
}

/**
 * Escape HTML for Telegram
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Send session status notification to Telegram
 */
async function sendSessionNotification(change: SessionStatusChange): Promise<void> {
  try {
    // First try admin chat ID from env
    let chatId = ADMIN_CHAT_ID;
    
    // If not set, find first connected admin
    if (!chatId) {
      const connection = await TelegramConnectionModel.findOne({ isActive: true }).sort({ connectedAt: 1 });
      if (connection) {
        chatId = connection.chatId;
      }
    }
    
    if (!chatId) {
      console.log('[SessionHealthObserver] No Telegram chat configured for notifications');
      return;
    }

    const message = formatSessionChangeMessage(change);
    const result = await sendTelegramMessage(chatId, message);
    
    if (result.ok) {
      console.log(`[SessionHealthObserver] Sent notification for ${change.sessionId}: ${change.from} → ${change.to}`);
    } else {
      console.error(`[SessionHealthObserver] Failed to send notification:`, result.error);
    }
  } catch (error) {
    console.error('[SessionHealthObserver] Error sending notification:', error);
  }
}

/**
 * Update session status and notify if changed
 * This is the main entry point - call this whenever status might change
 */
export async function updateSessionStatus(
  sessionId: string,
  newStatus: SessionStatus,
  reason: string
): Promise<boolean> {
  try {
    const session = await TwitterSessionModel.findOne({ sessionId });
    if (!session) {
      console.log(`[SessionHealthObserver] Session not found: ${sessionId}`);
      return false;
    }

    const oldStatus = session.status;

    // No change - skip
    if (oldStatus === newStatus) {
      return true;
    }

    console.log(`[SessionHealthObserver] Status change detected: ${sessionId} ${oldStatus} → ${newStatus}`);

    // Update session
    session.status = newStatus;
    session.lastError = newStatus !== 'OK' ? { code: newStatus, message: reason, at: new Date() } : undefined;
    await session.save();

    // Send notification
    const change: SessionStatusChange = {
      sessionId,
      accountId: session.accountId?.toString(),
      from: oldStatus,
      to: newStatus,
      reason,
      timestamp: new Date(),
    };

    // Fire and forget - don't block on notification
    sendSessionNotification(change).catch(err => {
      console.error('[SessionHealthObserver] Notification error:', err);
    });

    return true;
  } catch (error) {
    console.error('[SessionHealthObserver] Error updating status:', error);
    return false;
  }
}

/**
 * Check session health by testing cookies
 * Returns new status based on cookie validity
 */
export async function checkSessionHealth(sessionId: string): Promise<SessionStatus> {
  const session = await TwitterSessionModel.findOne({ sessionId });
  if (!session) {
    return 'INVALID';
  }

  const meta = session.cookiesMeta;
  
  // Check if has required cookies
  if (!meta?.hasAuthToken || !meta?.hasCt0) {
    return 'STALE';
  }

  // Check last sync age
  if (session.lastSyncedAt) {
    const ageMs = Date.now() - session.lastSyncedAt.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    
    // If last sync was more than 48 hours ago, mark as STALE
    if (ageHours > 48) {
      return 'STALE';
    }
  }

  return 'OK';
}

/**
 * Run health check on all active sessions
 * Can be called periodically (e.g., every hour)
 */
export async function runHealthCheckAll(): Promise<{ checked: number; changed: number }> {
  const sessions = await TwitterSessionModel.find({ status: { $ne: 'INVALID' } });
  
  let checked = 0;
  let changed = 0;

  for (const session of sessions) {
    checked++;
    
    const newStatus = await checkSessionHealth(session.sessionId);
    
    if (newStatus !== session.status) {
      const reason = newStatus === 'STALE' 
        ? 'Cookies missing required tokens or expired'
        : newStatus === 'OK'
        ? 'Cookies valid'
        : 'Session invalid';

      const updated = await updateSessionStatus(session.sessionId, newStatus, reason);
      if (updated) changed++;
    }
  }

  console.log(`[SessionHealthObserver] Health check complete: ${checked} checked, ${changed} changed`);
  return { checked, changed };
}

/**
 * Mark session as invalid after parser error
 */
export async function markSessionInvalid(sessionId: string, error: string): Promise<void> {
  await updateSessionStatus(sessionId, 'INVALID', `Parser error: ${error}`);
}

/**
 * Mark session as OK after successful use
 */
export async function markSessionOk(sessionId: string): Promise<void> {
  const session = await TwitterSessionModel.findOne({ sessionId });
  if (session && session.status !== 'OK') {
    await updateSessionStatus(sessionId, 'OK', 'Session recovered - successful request');
  }
  
  // Update last used timestamp
  await TwitterSessionModel.updateOne(
    { sessionId },
    { lastUsedAt: new Date() }
  );
}
