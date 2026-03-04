/**
 * TELEGRAM SENDER
 * ===============
 * 
 * Sends formatted alerts to Telegram via Bot API
 */

import axios from 'axios';
import {
  Alert,
  DecisionAlertPayload,
  RiskWarningPayload,
  SystemDegradationPayload,
  RecoveryPayload,
} from '../contracts/alert.types.js';

const TELEGRAM_API = 'https://api.telegram.org';

class TelegramSender {
  
  /**
   * Send alert to Telegram
   */
  async send(
    alert: Alert,
    botToken: string,
    chatId: string
  ): Promise<{ ok: boolean; error?: string }> {
    const text = this.formatMessage(alert);
    
    try {
      const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
      
      await axios.post(url, {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }, {
        timeout: 10000,
      });
      
      return { ok: true };
    } catch (err: any) {
      const error = err?.response?.data?.description || err.message;
      console.error('[Telegram] Send failed:', error);
      return { ok: false, error };
    }
  }
  
  /**
   * Format alert as Telegram message
   */
  private formatMessage(alert: Alert): string {
    switch (alert.type) {
      case 'DECISION':
        return this.formatDecision(alert.payload as DecisionAlertPayload);
      case 'RISK_WARNING':
        return this.formatRiskWarning(alert.payload as RiskWarningPayload);
      case 'SYSTEM_DEGRADATION':
        return this.formatDegradation(alert.payload as SystemDegradationPayload);
      case 'RECOVERY':
        return this.formatRecovery(alert.payload as RecoveryPayload);
      default:
        return `FOMO AI Alert\n\n${JSON.stringify(alert.payload, null, 2)}`;
    }
  }
  
  /**
   * Format decision alert
   */
  private formatDecision(p: DecisionAlertPayload): string {
    const emoji = p.action === 'BUY' ? '🟢' : '🔴';
    const confPct = (p.confidence * 100).toFixed(0);
    
    let msg = `${emoji} *FOMO AI SIGNAL*\n\n`;
    msg += `*Asset:* \`${p.symbol}\`\n`;
    msg += `*Decision:* *${p.action}*\n`;
    msg += `*Confidence:* ${confPct}%\n\n`;
    
    msg += `*Why:*\n`;
    for (const driver of p.drivers.slice(0, 5)) {
      msg += `• ${this.escapeMarkdown(driver)}\n`;
    }
    
    msg += `\n*Risk:* ${p.riskLevel}\n`;
    msg += `*Data:* ${p.dataMode}\n`;
    
    if (p.snapshotId) {
      msg += `\n🔗 [View snapshot](https://backtest-replay-lab.preview.emergentagent.com/snapshot/${p.snapshotId})`;
    }
    
    return msg;
  }
  
  /**
   * Format risk warning
   */
  private formatRiskWarning(p: RiskWarningPayload): string {
    const emoji = p.severity === 'CRITICAL' ? '🚨' : '⚠️';
    
    let msg = `${emoji} *FOMO AI WARNING*\n\n`;
    msg += `*Asset:* \`${p.symbol}\`\n`;
    msg += `*Risk:* ${p.riskType.replace(/_/g, ' ')}\n`;
    msg += `*Severity:* ${p.severity}\n\n`;
    msg += `${this.escapeMarkdown(p.details)}\n`;
    
    if (p.currentValue !== undefined) {
      msg += `\n*Current value:* ${p.currentValue}`;
    }
    
    return msg;
  }
  
  /**
   * Format system degradation
   */
  private formatDegradation(p: SystemDegradationPayload): string {
    let msg = `🔧 *FOMO AI SYSTEM ALERT*\n\n`;
    msg += `*Event:* ${p.event.replace(/_/g, ' ')}\n`;
    msg += `*Details:* ${this.escapeMarkdown(p.details)}\n`;
    msg += `*Impact:* ${this.escapeMarkdown(p.impact)}\n`;
    
    if (p.affectedSymbols?.length) {
      msg += `\n*Affected:* ${p.affectedSymbols.join(', ')}`;
    }
    
    return msg;
  }
  
  /**
   * Format recovery
   */
  private formatRecovery(p: RecoveryPayload): string {
    return `✅ *FOMO AI RECOVERED*\n\n*Event:* ${p.event}\n${this.escapeMarkdown(p.details)}`;
  }
  
  /**
   * Escape special Markdown characters
   */
  private escapeMarkdown(text: string): string {
    return text
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/`/g, '\\`')
      .replace(/\[/g, '\\[');
  }
}

export const telegramSender = new TelegramSender();
