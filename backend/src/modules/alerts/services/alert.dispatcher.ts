/**
 * ALERT DISPATCHER
 * ================
 * 
 * Central service for dispatching alerts with:
 * - Deduplication
 * - Cooldown per asset
 * - Channel routing (Telegram, Discord, Webhook)
 * - Async fire-and-forget
 */

import { v4 as uuidv4 } from 'uuid';
import {
  Alert,
  AlertType,
  AlertSeverity,
  AlertChannel,
  DecisionAlertPayload,
  RiskWarningPayload,
  SystemDegradationPayload,
  RecoveryPayload,
  AlertSettings,
} from '../contracts/alert.types.js';
import { ProductAlertModel, getAlertSettings } from '../storage/alert.model.js';
import { telegramSender } from './telegram.sender.js';

// In-memory cooldown cache
const cooldownCache = new Map<string, number>();

class AlertDispatcher {
  private settings: AlertSettings | null = null;
  
  /**
   * Initialize dispatcher (load settings)
   */
  async init(): Promise<void> {
    this.settings = await getAlertSettings();
    console.log('[AlertDispatcher] Initialized');
  }
  
  /**
   * Reload settings from DB
   */
  async reloadSettings(): Promise<void> {
    this.settings = await getAlertSettings();
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC DISPATCH METHODS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Dispatch a decision alert (BUY/SELL)
   */
  async dispatchDecision(payload: DecisionAlertPayload): Promise<void> {
    if (!this.settings) await this.init();
    
    // Check if decisions channel enabled
    if (!this.settings!.channels.decisions) {
      return;
    }
    
    // Check confidence threshold
    if (payload.confidence < this.settings!.decisionConfidenceThreshold) {
      return;
    }
    
    // Check watchlist (if not empty)
    if (this.settings!.watchlist.length > 0 && !this.settings!.watchlist.includes(payload.symbol)) {
      return;
    }
    
    const dedupeKey = `DECISION_${payload.symbol}_${payload.action}`;
    
    await this.dispatch({
      type: 'DECISION',
      severity: 'INFO',
      payload,
      dedupeKey,
      cooldownMs: this.settings!.cooldownPerAssetMs,
    });
  }
  
  /**
   * Dispatch a risk warning
   */
  async dispatchRiskWarning(payload: RiskWarningPayload): Promise<void> {
    if (!this.settings) await this.init();
    
    if (!this.settings!.channels.riskWarnings) {
      return;
    }
    
    const dedupeKey = `RISK_${payload.symbol}_${payload.riskType}`;
    
    await this.dispatch({
      type: 'RISK_WARNING',
      severity: payload.severity,
      payload,
      dedupeKey,
      cooldownMs: this.settings!.cooldownPerAssetMs,
    });
  }
  
  /**
   * Dispatch a system degradation alert
   */
  async dispatchDegradation(payload: SystemDegradationPayload): Promise<void> {
    if (!this.settings) await this.init();
    
    if (!this.settings!.channels.systemAlerts) {
      return;
    }
    
    const dedupeKey = `SYSTEM_${payload.event}`;
    
    await this.dispatch({
      type: 'SYSTEM_DEGRADATION',
      severity: 'CRITICAL',
      payload,
      dedupeKey,
      cooldownMs: this.settings!.cooldownPerEventMs,
    });
  }
  
  /**
   * Dispatch a recovery alert
   */
  async dispatchRecovery(payload: RecoveryPayload): Promise<void> {
    if (!this.settings) await this.init();
    
    if (!this.settings!.channels.systemAlerts) {
      return;
    }
    
    const dedupeKey = `RECOVERY_${payload.event}`;
    
    await this.dispatch({
      type: 'RECOVERY',
      severity: 'INFO',
      payload,
      dedupeKey,
      cooldownMs: this.settings!.cooldownPerEventMs,
    });
  }
  
  // ═══════════════════════════════════════════════════════════════
  // CORE DISPATCH LOGIC
  // ═══════════════════════════════════════════════════════════════
  
  private async dispatch(params: {
    type: AlertType;
    severity: AlertSeverity;
    payload: any;
    dedupeKey: string;
    cooldownMs: number;
  }): Promise<void> {
    const { type, severity, payload, dedupeKey, cooldownMs } = params;
    
    // Check global enable
    if (!this.settings?.enabled) {
      return;
    }
    
    // Check cooldown
    if (this.isOnCooldown(dedupeKey, cooldownMs)) {
      console.log(`[AlertDispatcher] Skipping (cooldown): ${dedupeKey}`);
      return;
    }
    
    // Set cooldown
    cooldownCache.set(dedupeKey, Date.now());
    
    // Dispatch to enabled channels (fire-and-forget)
    const channels: AlertChannel[] = [];
    
    if (this.settings!.telegram.enabled && this.settings!.telegram.botToken && this.settings!.telegram.chatId) {
      channels.push('TELEGRAM');
    }
    
    if (this.settings!.discord.enabled && this.settings!.discord.webhookUrl) {
      channels.push('DISCORD');
    }
    
    if (channels.length === 0) {
      console.log(`[AlertDispatcher] No channels enabled, skipping: ${dedupeKey}`);
      return;
    }
    
    // Send to each channel
    for (const channel of channels) {
      this.sendToChannel(channel, {
        alertId: uuidv4(),
        type,
        severity,
        channel,
        payload,
        createdAt: Date.now(),
        status: 'PENDING',
        dedupeKey,
      }).catch(err => {
        console.error(`[AlertDispatcher] Channel ${channel} failed:`, err.message);
      });
    }
  }
  
  private isOnCooldown(key: string, cooldownMs: number): boolean {
    const lastSent = cooldownCache.get(key);
    if (!lastSent) return false;
    return Date.now() - lastSent < cooldownMs;
  }
  
  private async sendToChannel(channel: AlertChannel, alert: Alert): Promise<void> {
    try {
      let result: { ok: boolean; error?: string };
      
      if (channel === 'TELEGRAM') {
        result = await telegramSender.send(
          alert,
          this.settings!.telegram.botToken!,
          this.settings!.telegram.chatId!
        );
      } else if (channel === 'DISCORD') {
        // TODO: Implement Discord webhook
        result = { ok: false, error: 'Discord not implemented' };
      } else {
        result = { ok: false, error: 'Unknown channel' };
      }
      
      // Save alert log
      await ProductAlertModel.create({
        ...alert,
        sentAt: result.ok ? Date.now() : undefined,
        status: result.ok ? 'SENT' : 'FAILED',
        error: result.error,
      });
      
      if (result.ok) {
        console.log(`[AlertDispatcher] Sent via ${channel}: ${alert.type}`);
      }
    } catch (err: any) {
      console.error(`[AlertDispatcher] Send error:`, err.message);
      
      await ProductAlertModel.create({
        ...alert,
        status: 'FAILED',
        error: err.message,
      });
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // ADMIN METHODS
  // ═══════════════════════════════════════════════════════════════
  
  getSettings(): AlertSettings | null {
    return this.settings;
  }
  
  async getAlertHistory(limit = 50): Promise<Alert[]> {
    return ProductAlertModel.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean() as Promise<Alert[]>;
  }
  
  async getAlertStats(): Promise<{
    total: number;
    sent: number;
    failed: number;
    byType: Record<string, number>;
  }> {
    const [total, sent, failed] = await Promise.all([
      ProductAlertModel.countDocuments(),
      ProductAlertModel.countDocuments({ status: 'SENT' }),
      ProductAlertModel.countDocuments({ status: 'FAILED' }),
    ]);
    
    const byType = await ProductAlertModel.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);
    
    return {
      total,
      sent,
      failed,
      byType: Object.fromEntries(byType.map(r => [r._id, r.count])),
    };
  }
  
  /**
   * Test alert (for admin verification)
   */
  async testAlert(channel: AlertChannel): Promise<{ ok: boolean; error?: string }> {
    if (!this.settings) await this.init();
    
    const testAlert: Alert = {
      alertId: uuidv4(),
      type: 'DECISION',
      severity: 'INFO',
      channel,
      payload: {
        symbol: 'BTCUSDT',
        action: 'BUY',
        confidence: 0.75,
        drivers: ['Exchange trend: BULLISH', 'ML: HEALTHY', 'Risk: LOW'],
        riskLevel: 'LOW',
        dataMode: 'LIVE',
      } as DecisionAlertPayload,
      createdAt: Date.now(),
      status: 'PENDING',
      dedupeKey: 'TEST',
    };
    
    if (channel === 'TELEGRAM') {
      if (!this.settings!.telegram.botToken || !this.settings!.telegram.chatId) {
        return { ok: false, error: 'Telegram not configured' };
      }
      
      return telegramSender.send(
        testAlert,
        this.settings!.telegram.botToken,
        this.settings!.telegram.chatId
      );
    }
    
    return { ok: false, error: 'Channel not supported' };
  }
}

export const alertDispatcher = new AlertDispatcher();
