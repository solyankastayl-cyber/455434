/**
 * System Telegram Notifier
 * 
 * Admin/Ops Telegram notifications for critical events.
 * 
 * IMPORTANT:
 * - This is NOT user-facing
 * - Uses @x_fomo_bot (SYSTEM_TELEGRAM_BOT_TOKEN)
 * - Sends to admin chat only (SYSTEM_TELEGRAM_CHAT_ID)
 * - Cannot be disabled by users
 * - Includes anti-spam protection
 */

import axios from 'axios';
import {
  PolicyViolationAlert,
  CooldownAlert,
  UserDisabledAlert,
  ParserAlert,
} from './systemTelegram.types.js';

const TOKEN = process.env.SYSTEM_TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.SYSTEM_TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  console.warn('[SystemTelegram] ENV not configured - alerts will be skipped');
}

const API_URL = TOKEN ? `https://api.telegram.org/bot${TOKEN}/sendMessage` : '';

// Anti-spam cache (in-memory, will use Redis later)
const alertCache = new Map<string, number>();
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function canSend(key: string, ttlMs = DEFAULT_TTL_MS): boolean {
  const last = alertCache.get(key);
  if (last && Date.now() - last < ttlMs) return false;
  alertCache.set(key, Date.now());
  return true;
}

class SystemTelegramNotifier {
  private enabled: boolean;

  constructor() {
    this.enabled = !!(TOKEN && CHAT_ID);
    if (this.enabled) {
      console.log('[SystemTelegram] Notifier initialized');
    }
  }

  private async send(text: string): Promise<void> {
    if (!this.enabled) {
      console.log('[SystemTelegram] Would send (disabled):', text.split('\n')[0]);
      return;
    }

    try {
      await axios.post(API_URL, {
        chat_id: CHAT_ID,
        text,
        parse_mode: 'Markdown',
      });
      console.log('[SystemTelegram] Alert sent successfully');
    } catch (err: any) {
      console.error('[SystemTelegram] Send failed:', err?.response?.data || err.message);
    }
  }

  /**
   * Policy Violation Alert
   */
  async sendPolicyViolation(p: PolicyViolationAlert): Promise<void> {
    const cacheKey = `POLICY_${p.userId}_${p.violationType}`;
    if (!canSend(cacheKey)) {
      console.log(`[SystemTelegram] Skipping duplicate: ${cacheKey}`);
      return;
    }

    await this.send(
`🚨 *POLICY VIOLATION*

👤 User: \`${p.userId}\`
❗ Violation: *${p.violationType}*
📊 Value: ${p.currentValue} / ${p.limitValue}
⚙️ Action: *${p.action}*
🌐 Scope: ${p.policyScope}

🕒 ${p.timestamp}`
    );
  }

  /**
   * Cooldown Applied Alert
   */
  async sendCooldownApplied(c: CooldownAlert): Promise<void> {
    const cacheKey = `COOLDOWN_${c.userId}`;
    if (!canSend(cacheKey)) {
      console.log(`[SystemTelegram] Skipping duplicate: ${cacheKey}`);
      return;
    }

    await this.send(
`⚠️ *COOLDOWN APPLIED*

👤 User: \`${c.userId}\`
⏱ Duration: ${c.minutes} min
📄 Reason: ${c.reason}

Sessions → STALE`
    );
  }

  /**
   * User Disabled Alert
   */
  async sendUserDisabled(u: UserDisabledAlert): Promise<void> {
    const cacheKey = `DISABLED_${u.userId}`;
    if (!canSend(cacheKey, 60 * 60 * 1000)) { // 1 hour for disable
      console.log(`[SystemTelegram] Skipping duplicate: ${cacheKey}`);
      return;
    }

    await this.send(
`⛔ *USER DISABLED*

👤 User: \`${u.userId}\`
🚫 Reason: ${u.reason}
🔁 Cooldowns (24h): ${u.cooldowns24h}

Accounts → DISABLED
Sessions → INVALID`
    );
  }

  /**
   * Parser Down Alert
   */
  async sendParserDown(p: ParserAlert): Promise<void> {
    const cacheKey = `PARSER_DOWN_${p.service}`;
    if (!canSend(cacheKey, 5 * 60 * 1000)) { // 5 min for parser
      return;
    }

    await this.send(
`🚨 *PARSER DOWN*

🔧 Service: ${p.service}
❌ Error: ${p.error || 'unknown'}`
    );
  }

  /**
   * Parser Recovered Alert
   */
  async sendParserRecovered(p: ParserAlert): Promise<void> {
    await this.send(
`✅ *PARSER RECOVERED*

🔧 Service: ${p.service}
✔️ Status: UP`
    );
  }

  /**
   * Generic system alert
   */
  async sendAlert(title: string, message: string): Promise<void> {
    const cacheKey = `ALERT_${title}`;
    if (!canSend(cacheKey)) {
      return;
    }

    await this.send(`🔔 *${title}*\n\n${message}`);
  }
}

export const systemTelegram = new SystemTelegramNotifier();
