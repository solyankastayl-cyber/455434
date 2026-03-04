/**
 * BLOCK 83 — Intel Alerts Service
 * 
 * Handles:
 * - Rate limiting (max 3 non-critical per 24h)
 * - Telegram message building and sending
 * - Alert persistence and deduplication
 */

import { IntelEventAlertModel } from './intel-alerts.model.js';
import type { DetectedEvent } from './intel-alerts.detector.js';
import type { IntelEventAlert, IntelAlertSource } from './intel-alerts.types.js';

// Telegram sender adapter
async function sendTelegram(text: string): Promise<{ ok: boolean; reason?: string }> {
  const token = process.env.TG_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TG_ADMIN_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID;
  
  if (!token || !chatId) {
    console.log('[IntelAlerts] Telegram credentials not configured');
    return { ok: false, reason: 'no_credentials' };
  }
  
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
    
    const result = await response.json();
    if (result.ok) {
      console.log('[IntelAlerts] Telegram message sent successfully');
      return { ok: true };
    } else {
      console.error('[IntelAlerts] Telegram error:', result);
      return { ok: false, reason: result.description };
    }
  } catch (err: any) {
    console.error('[IntelAlerts] Telegram send error:', err);
    return { ok: false, reason: err.message };
  }
}

class IntelAlertsService {
  
  /**
   * Check rate limit: max 3 non-critical per 24h rolling
   */
  async canSendNonCritical(symbol: string, source: string): Promise<boolean> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await IntelEventAlertModel.countDocuments({
      symbol,
      source,
      severity: { $in: ['INFO', 'WARN'] },
      createdAt: { $gte: since },
      sent: true,
    });
    return count < 3;
  }
  
  /**
   * Build Telegram message for an alert
   */
  buildTelegramMessage(a: IntelEventAlert): string {
    const p: any = a.payload;
    
    const titleMap: Record<string, string> = {
      LOCK_ENTER: '🔒 STRUCTURAL LOCK ENTER',
      LOCK_EXIT: '🔓 STRUCTURAL LOCK EXIT',
      DOMINANCE_SHIFT: '🔄 DOMINANCE SHIFT',
      PHASE_DOWNGRADE: '⬇️ PHASE DOWNGRADE',
    };

    const severityEmoji: Record<string, string> = {
      INFO: 'ℹ️',
      WARN: '⚠️',
      CRITICAL: '🔴',
    };

    const lines = [
      `<b>🧠 FRACTAL INTEL ALERT</b>`,
      ``,
      `<b>${titleMap[a.eventType] || a.eventType}</b> ${severityEmoji[a.severity]} ${a.severity}`,
      `${a.symbol} · ${a.date} · ${a.source}`,
      ``,
      `<b>Consensus:</b> ${p.consensusIndex ?? '-'} | <b>Conflict:</b> ${p.conflictLevel ?? '-'}`,
      `<b>Dominance:</b> ${p.from?.dominanceTier ?? '-'} → ${p.to?.dominanceTier ?? '-'}`,
      `<b>Lock:</b> ${String(p.from?.structuralLock)} → ${String(p.to?.structuralLock)}`,
      `<b>Phase:</b> ${p.phaseType ?? '-'} (${p.from?.phaseGrade ?? '-'} → ${p.to?.phaseGrade ?? '-'})`,
      `<b>Vol:</b> ${p.volRegime ?? '-'} | <b>Divergence:</b> ${p.divergenceGrade ?? '-'} (${p.divergenceScore ?? '-'})`,
    ];

    if (Array.isArray(p.notes) && p.notes.length) {
      lines.push('', `<i>Notes:</i>`, ...p.notes.map((n: string) => `• ${n}`));
    }

    return lines.join('\n');
  }
  
  /**
   * Upsert alert (dedup by unique index)
   */
  async upsertAlertBase(alert: IntelEventAlert): Promise<any> {
    const doc = await IntelEventAlertModel.findOneAndUpdate(
      { 
        symbol: alert.symbol, 
        source: alert.source, 
        date: alert.date, 
        eventType: alert.eventType 
      },
      { $setOnInsert: alert },
      { new: true, upsert: true }
    );
    return doc;
  }
  
  /**
   * Mark alert as sent
   */
  async markSent(id: string): Promise<void> {
    await IntelEventAlertModel.updateOne(
      { _id: id }, 
      { $set: { sent: true, sentAt: new Date() } }
    );
  }
  
  /**
   * Run for detected events
   * - Only sends if source=LIVE and liveSamples >= 15
   * - Respects rate limits
   */
  async runForDetectedEvents(params: {
    symbol: string;
    source: IntelAlertSource;
    date: string;
    liveSamples: number;
    detected: DetectedEvent[];
  }): Promise<any[]> {
    const { symbol, source, date, liveSamples, detected } = params;
    
    // Send only LIVE and only if liveSamples >= 15
    const allowSend = source === 'LIVE' && liveSamples >= 15;
    
    const results: any[] = [];
    
    for (const ev of detected) {
      const base: IntelEventAlert = {
        date,
        symbol,
        source,
        eventType: ev.eventType,
        severity: ev.severity,
        payload: ev.payload,
        sent: false,
        sentAt: null,
        rateKey: `${symbol}:${source}:${ev.eventType}`,
      };
      
      try {
        const doc = await this.upsertAlertBase(base);
        
        // If existed already (sent), don't resend
        if (!doc || doc.sent) {
          results.push({ eventType: ev.eventType, status: 'dedup_skip' });
          continue;
        }
        
        if (!allowSend) {
          results.push({ 
            eventType: ev.eventType, 
            status: 'stored_no_send', 
            reason: `live_gate (samples=${liveSamples})` 
          });
          continue;
        }
        
        // Rate limit (non-critical)
        if (ev.severity !== 'CRITICAL') {
          const ok = await this.canSendNonCritical(symbol, source);
          if (!ok) {
            results.push({ eventType: ev.eventType, status: 'rate_limited' });
            continue;
          }
        }
        
        const msg = this.buildTelegramMessage(doc.toObject());
        const sent = await sendTelegram(msg);
        
        if (sent.ok) {
          await this.markSent(String(doc._id));
          results.push({ eventType: ev.eventType, status: 'sent' });
        } else {
          results.push({ eventType: ev.eventType, status: 'send_failed', reason: sent.reason });
        }
      } catch (err: any) {
        console.error(`[IntelAlerts] Error processing ${ev.eventType}:`, err);
        results.push({ eventType: ev.eventType, status: 'error', reason: err.message });
      }
    }
    
    return results;
  }
  
  /**
   * List alerts for admin UI
   */
  async list(params: { 
    symbol?: string; 
    source?: string; 
    limit?: number 
  }): Promise<any[]> {
    const q: any = {};
    if (params.symbol) q.symbol = params.symbol;
    if (params.source) q.source = params.source;
    const limit = Math.min(params.limit ?? 50, 200);
    
    return IntelEventAlertModel.find(q)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }
}

export const intelAlertsService = new IntelAlertsService();
export default intelAlertsService;
