/**
 * P6.3 — Alert Dispatch Service
 * 
 * Sends divergence alerts to multiple channels:
 * - Console log (always)
 * - Telegram bot (if configured)
 * - Slack webhook (if configured)
 */

import { DivergenceAlert } from './shadow_audit.service.js';

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

interface AlertConfig {
  console: boolean;
  telegram: {
    enabled: boolean;
    botToken: string | null;
    chatId: string | null;
  };
  slack: {
    enabled: boolean;
    webhookUrl: string | null;
  };
}

const config: AlertConfig = {
  console: true,
  telegram: {
    enabled: false,
    botToken: process.env.TELEGRAM_BOT_TOKEN || null,
    chatId: process.env.TELEGRAM_CHAT_ID || null,
  },
  slack: {
    enabled: false,
    webhookUrl: process.env.SLACK_WEBHOOK_URL || null,
  },
};

// ═══════════════════════════════════════════════════════════════
// ALERT DISPATCH SERVICE
// ═══════════════════════════════════════════════════════════════

export class AlertDispatchService {
  
  /**
   * Dispatch alert to all configured channels
   */
  async dispatch(alert: DivergenceAlert): Promise<void> {
    const promises: Promise<void>[] = [];
    
    // Console (always)
    if (config.console) {
      promises.push(this.sendConsole(alert));
    }
    
    // Telegram
    if (config.telegram.enabled && config.telegram.botToken && config.telegram.chatId) {
      promises.push(this.sendTelegram(alert));
    }
    
    // Slack
    if (config.slack.enabled && config.slack.webhookUrl) {
      promises.push(this.sendSlack(alert));
    }
    
    await Promise.allSettled(promises);
  }
  
  /**
   * Dispatch multiple alerts
   */
  async dispatchMany(alerts: DivergenceAlert[]): Promise<void> {
    for (const alert of alerts) {
      await this.dispatch(alert);
    }
  }
  
  /**
   * Console output
   */
  private async sendConsole(alert: DivergenceAlert): Promise<void> {
    const levelEmoji = {
      INFO: 'ℹ️',
      WARNING: '⚠️',
      CRITICAL: '🚨',
    };
    
    const emoji = levelEmoji[alert.level] || '📢';
    
    console.log(`\n${emoji} [MACRO ALERT] ${alert.level}: ${alert.code}`);
    console.log(`   Asset: ${alert.asset}`);
    console.log(`   Message: ${alert.message}`);
    console.log(`   Time: ${alert.timestamp.toISOString()}`);
    if (Object.keys(alert.details).length > 0) {
      console.log(`   Details: ${JSON.stringify(alert.details)}`);
    }
    console.log('');
  }
  
  /**
   * Telegram notification
   */
  private async sendTelegram(alert: DivergenceAlert): Promise<void> {
    if (!config.telegram.botToken || !config.telegram.chatId) return;
    
    const levelEmoji = {
      INFO: 'ℹ️',
      WARNING: '⚠️',
      CRITICAL: '🚨',
    };
    
    const emoji = levelEmoji[alert.level] || '📢';
    
    const text = `${emoji} *MACRO ALERT*

*Level:* ${alert.level}
*Code:* \`${alert.code}\`
*Asset:* ${alert.asset}
*Message:* ${alert.message}
*Time:* ${alert.timestamp.toISOString()}

\`\`\`json
${JSON.stringify(alert.details, null, 2)}
\`\`\``;

    try {
      const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegram.chatId,
          text,
          parse_mode: 'Markdown',
        }),
      });
    } catch (e) {
      console.error('[Alert] Telegram send failed:', (e as Error).message);
    }
  }
  
  /**
   * Slack notification
   */
  private async sendSlack(alert: DivergenceAlert): Promise<void> {
    if (!config.slack.webhookUrl) return;
    
    const color = {
      INFO: '#36a64f',
      WARNING: '#ffcc00',
      CRITICAL: '#ff0000',
    };
    
    try {
      await fetch(config.slack.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachments: [{
            color: color[alert.level] || '#808080',
            title: `${alert.level}: ${alert.code}`,
            text: alert.message,
            fields: [
              { title: 'Asset', value: alert.asset, short: true },
              { title: 'Time', value: alert.timestamp.toISOString(), short: true },
              { title: 'Details', value: JSON.stringify(alert.details), short: false },
            ],
          }],
        }),
      });
    } catch (e) {
      console.error('[Alert] Slack send failed:', (e as Error).message);
    }
  }
  
  /**
   * Update configuration
   */
  configure(updates: Partial<AlertConfig>): void {
    if (updates.console !== undefined) config.console = updates.console;
    if (updates.telegram) {
      config.telegram = { ...config.telegram, ...updates.telegram };
    }
    if (updates.slack) {
      config.slack = { ...config.slack, ...updates.slack };
    }
  }
  
  /**
   * Get current configuration
   */
  getConfig(): AlertConfig {
    return { ...config };
  }
}

// Singleton
let instance: AlertDispatchService | null = null;

export function getAlertDispatchService(): AlertDispatchService {
  if (!instance) {
    instance = new AlertDispatchService();
  }
  return instance;
}
