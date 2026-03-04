/**
 * BLOCK 80.2 — Drift Alert Service
 * 
 * Monitors drift severity and sends Telegram alerts.
 * Implements rate limiting and deduplication.
 */

import { v4 as uuid } from 'uuid';
import { DriftAlertModel } from './drift-alert.model.js';
import { driftService } from './drift.service.js';

// Rate limits (hours)
const RATE_LIMITS = {
  WATCH: 24,   // 1 per 24h
  WARN: 12,    // 2 per 24h (effectively 1 per 12h)
  CRITICAL: 1, // 1 per hour (but no skip)
};

// Telegram config from environment
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

interface DriftCheckResult {
  shouldAlert: boolean;
  severity: string;
  previousSeverity?: string;
  rateLimited: boolean;
  reason?: string;
  alertId?: string;
  telegramSent?: boolean;
}

class DriftAlertService {
  
  /**
   * Check drift and send alert if needed
   * Called from daily-run pipeline
   */
  async checkAndAlert(symbol: string = 'BTC'): Promise<DriftCheckResult> {
    try {
      // 1. Get current drift state
      const driftReport = await driftService.build({
        symbol,
        focus: '30d',
        preset: 'balanced',
        role: 'ACTIVE',
        windowDays: 365,
      });
      
      const currentSeverity = driftReport.verdict?.overallSeverity || 'OK';
      
      // 2. Get last alert for this severity
      const lastAlert = await DriftAlertModel.findOne({
        symbol,
        severity: currentSeverity,
      }).sort({ triggeredAt: -1 });
      
      // 3. Check if should alert
      const now = new Date();
      let shouldAlert = false;
      let rateLimited = false;
      let reason = '';
      
      if (currentSeverity === 'OK') {
        // No alert for OK
        return { shouldAlert: false, severity: 'OK', rateLimited: false, reason: 'Severity OK' };
      }
      
      // Check rate limit
      if (lastAlert) {
        const hoursSinceLastAlert = (now.getTime() - lastAlert.triggeredAt.getTime()) / (1000 * 60 * 60);
        const rateLimit = RATE_LIMITS[currentSeverity as keyof typeof RATE_LIMITS] || 24;
        
        if (hoursSinceLastAlert < rateLimit && currentSeverity !== 'CRITICAL') {
          rateLimited = true;
          reason = `Rate limited: ${hoursSinceLastAlert.toFixed(1)}h since last ${currentSeverity} alert (limit: ${rateLimit}h)`;
        } else {
          shouldAlert = true;
          reason = 'Rate limit passed';
        }
      } else {
        // First alert of this severity
        shouldAlert = true;
        reason = 'First alert of this severity';
      }
      
      // CRITICAL always alerts (but still record)
      if (currentSeverity === 'CRITICAL') {
        shouldAlert = true;
        rateLimited = false;
      }
      
      // 4. Create alert record
      const alertId = `drift_${uuid().slice(0, 8)}`;
      const comparison = driftReport.comparisons?.[0];
      
      const alertDoc = await DriftAlertModel.create({
        alertId,
        symbol,
        severity: currentSeverity,
        previousSeverity: lastAlert?.severity,
        metrics: {
          deltaSharpe: comparison?.deltas?.sharpe || 0,
          deltaHitRate: comparison?.deltas?.hitRatePP || 0,
          calibrationError: comparison?.deltas?.calibrationPP || 0,
          liveSamples: driftReport.sampleCounts?.totalLiveSamples || 0,
        },
        comparison: {
          pair: comparison?.pair,
          cohortA: 'LIVE',
          cohortB: comparison?.pair?.split('_')[1],
        },
        triggeredAt: now,
        sentToTelegram: false,
        wasRateLimited: rateLimited,
        governanceLocked: !driftReport.governanceLockStatus?.canApply,
        recommendation: driftReport.verdict?.recommendation,
      });
      
      // 5. Send Telegram if should alert
      let telegramSent = false;
      if (shouldAlert && TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_CHAT_ID) {
        try {
          const message = this.buildTelegramMessage(currentSeverity, symbol, driftReport, alertDoc);
          await this.sendTelegram(message);
          telegramSent = true;
          
          // Update alert record
          await DriftAlertModel.updateOne(
            { alertId },
            { $set: { sentToTelegram: true } }
          );
        } catch (err: any) {
          console.error('[DriftAlert] Telegram send failed:', err.message);
        }
      }
      
      console.log(`[DriftAlert] ${symbol}: ${currentSeverity} - Alert: ${shouldAlert}, RateLimited: ${rateLimited}`);
      
      return {
        shouldAlert,
        severity: currentSeverity,
        previousSeverity: lastAlert?.severity,
        rateLimited,
        reason,
        alertId,
        telegramSent,
      };
      
    } catch (err: any) {
      console.error('[DriftAlert] Check failed:', err.message);
      return {
        shouldAlert: false,
        severity: 'ERROR',
        rateLimited: false,
        reason: err.message,
      };
    }
  }
  
  /**
   * Build Telegram message
   */
  private buildTelegramMessage(severity: string, symbol: string, report: any, alert: any): string {
    const emoji = severity === 'CRITICAL' ? '🔥' : severity === 'WARN' ? '🚨' : '⚠️';
    const lockStatus = alert.governanceLocked ? '🔒 LOCKED' : '🔓 Unlocked';
    
    const deltaSharpe = alert.metrics?.deltaSharpe?.toFixed(3) || '0.000';
    const deltaHitRate = alert.metrics?.deltaHitRate?.toFixed(2) || '0.00';
    const calibError = alert.metrics?.calibrationError?.toFixed(2) || '0.00';
    const liveSamples = alert.metrics?.liveSamples || 0;
    
    return `
${emoji} <b>DRIFT ${severity}</b>

<b>Symbol:</b> ${symbol}
<b>LIVE Samples:</b> ${liveSamples}

<b>Metrics (LIVE vs V2020):</b>
• ΔSharpe: ${deltaSharpe}
• ΔHitRate: ${deltaHitRate}pp
• ΔCalibration: ${calibError}pp

<b>Governance:</b> ${lockStatus}
<b>Recommendation:</b> ${report.verdict?.recommendation || 'N/A'}

<i>Alert ID: ${alert.alertId}</i>
`.trim();
  }
  
  /**
   * Send Telegram message
   */
  private async sendTelegram(message: string): Promise<void> {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) {
      console.log('[DriftAlert] Telegram not configured, skipping');
      return;
    }
    
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_ADMIN_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telegram API error: ${error}`);
    }
    
    console.log('[DriftAlert] Telegram message sent');
  }
  
  /**
   * Get alert history
   */
  async getHistory(symbol: string = 'BTC', limit: number = 50): Promise<any[]> {
    const alerts = await DriftAlertModel.find({ symbol })
      .sort({ triggeredAt: -1 })
      .limit(limit)
      .lean();
    
    return alerts.map(a => ({
      alertId: a.alertId,
      severity: a.severity,
      metrics: a.metrics,
      triggeredAt: a.triggeredAt,
      sentToTelegram: a.sentToTelegram,
      wasRateLimited: a.wasRateLimited,
      governanceLocked: a.governanceLocked,
      recommendation: a.recommendation,
    }));
  }
  
  /**
   * Get alert stats
   */
  async getStats(symbol: string = 'BTC'): Promise<any> {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const [total, last24hAlerts, bySeverity] = await Promise.all([
      DriftAlertModel.countDocuments({ symbol }),
      DriftAlertModel.countDocuments({ symbol, triggeredAt: { $gte: last24h } }),
      DriftAlertModel.aggregate([
        { $match: { symbol } },
        { $group: { _id: '$severity', count: { $sum: 1 } } }
      ]),
    ]);
    
    return {
      total,
      last24h: last24hAlerts,
      bySeverity: Object.fromEntries(bySeverity.map(s => [s._id, s.count])),
    };
  }
}

export const driftAlertService = new DriftAlertService();

export default driftAlertService;
