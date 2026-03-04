// P1: Session Notifier
// Wrapper around Telegram service for session status notifications

import { sendTelegramMessage, TelegramConnectionModel } from '../../../core/notifications/telegram.service.js';
import { SessionStatus } from '../sessions/session.model.js';

// Admin chat ID for session notifications
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '577782582';

export interface StatusChangeNotification {
  sessionId: string;
  accountId?: string;
  from: SessionStatus;
  to: SessionStatus;
  riskScore: number;
  lifetime: number;
}

export class SessionNotifier {
  /**
   * Send notification when session status changes
   */
  async notifyStatusChange(data: StatusChangeNotification): Promise<void> {
    const emoji = this.getStatusEmoji(data.to);
    const fromEmoji = this.getStatusEmoji(data.from);
    
    const urgency = data.to === 'INVALID' 
      ? '🚨 <b>URGENT</b>\n\n' 
      : '';

    const action = this.getActionText(data.to);

    const message = `${urgency}${emoji} <b>Twitter Session Status Changed</b>

<b>Session:</b> <code>${data.sessionId}</code>
${data.accountId ? `<b>Account:</b> <code>${data.accountId}</code>` : ''}

<b>Status:</b> ${fromEmoji} ${data.from} → ${emoji} <b>${data.to}</b>

<b>Risk Score:</b> ${data.riskScore}%
<b>Expected Lifetime:</b> ~${data.lifetime} days

<b>Time:</b> ${new Date().toISOString()}${action}`;

    await this.send(message);
  }

  /**
   * Send warmth failure notification
   */
  async notifyWarmthFailure(sessionId: string, error: string): Promise<void> {
    const message = `⚠️ <b>Warmth Check Failed</b>

<b>Session:</b> <code>${sessionId}</code>
<b>Error:</b> ${escapeHtml(error)}

<i>Session health may be degrading. Monitor closely.</i>`;

    await this.send(message);
  }

  /**
   * Send daily summary
   */
  async notifyDailySummary(stats: {
    total: number;
    ok: number;
    stale: number;
    invalid: number;
    avgRisk: number;
  }): Promise<void> {
    const healthEmoji = stats.avgRisk < 30 ? '🟢' : stats.avgRisk < 60 ? '🟡' : '🔴';
    
    const message = `📊 <b>Daily Session Health Summary</b>

<b>Total Sessions:</b> ${stats.total}
🟢 OK: ${stats.ok}
🟠 STALE: ${stats.stale}
🔴 INVALID: ${stats.invalid}

<b>Average Risk:</b> ${healthEmoji} ${stats.avgRisk}%

<i>Generated at ${new Date().toISOString()}</i>`;

    await this.send(message);
  }

  /**
   * Send custom message
   */
  async send(message: string): Promise<boolean> {
    try {
      let chatId = ADMIN_CHAT_ID;

      // If not set in env, find first connected admin
      if (!chatId) {
        const connection = await TelegramConnectionModel.findOne({ isActive: true }).sort({ connectedAt: 1 });
        if (connection) {
          chatId = connection.chatId;
        }
      }

      if (!chatId) {
        console.log('[SessionNotifier] No Telegram chat configured');
        return false;
      }

      const result = await sendTelegramMessage(chatId, message);
      return result.ok;
    } catch (error) {
      console.error('[SessionNotifier] Error sending notification:', error);
      return false;
    }
  }

  private getStatusEmoji(status: SessionStatus): string {
    switch (status) {
      case 'OK': return '🟢';
      case 'STALE': return '🟠';
      case 'INVALID': return '🔴';
      case 'EXPIRED': return '⚪';
      default: return '⚪';
    }
  }

  private getActionText(status: SessionStatus): string {
    switch (status) {
      case 'INVALID':
        return '\n\n👉 <b>Action required:</b>\n• Open Twitter in browser\n• Login if needed\n• Click "Sync Now" in extension';
      case 'STALE':
        return '\n\n👉 <b>Recommended:</b>\n• Check cookies - may need refresh soon\n• Open Twitter to verify session';
      case 'OK':
        return '\n\n✅ <b>Session recovered successfully!</b>';
      default:
        return '';
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export const sessionNotifier = new SessionNotifier();
