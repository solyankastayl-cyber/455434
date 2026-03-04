/**
 * FOMO Alert Engine
 * =================
 * 
 * ЕДИНАЯ точка для всех FOMO AI алертов
 * 
 * Правила:
 * 1. Все алерты идут через этот engine
 * 2. Engine применяет rules и guards
 * 3. Telegram = транспорт, не логика
 * 4. USER ≠ ADMIN (разные боты, разные правила)
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import {
  FomoAlertEvent,
  FomoAlertPayload,
  FomoAlertConfig,
  FomoAlertScope,
  FomoAlertLog,
  EVENT_SCOPE_MAP,
  FOMO_DEDUPE_TTL,
  DecisionChangedPayload,
  HighConfidencePayload,
  RiskIncreasedPayload,
} from '../contracts/fomo-alert.types.js';
import { getFomoAlertConfig, FomoAlertLogModel } from '../storage/fomo-alert.model.js';
import { buildFomoAlertMessage } from './fomo-alert-message.builder.js';

// Dedupe cache (in-memory)
const dedupeCache = new Map<string, number>();

// Hourly alert counter
let hourlyAlertCount = 0;
let hourlyResetAt = Date.now() + 60 * 60 * 1000;

class FomoAlertEngine {
  private config: FomoAlertConfig | null = null;
  
  /**
   * Initialize engine
   */
  async init(): Promise<void> {
    this.config = await getFomoAlertConfig();
    console.log('[FomoAlertEngine] Initialized');
  }
  
  /**
   * Reload config
   */
  async reloadConfig(): Promise<void> {
    this.config = await getFomoAlertConfig();
  }
  
  /**
   * Get current config
   */
  getConfig(): FomoAlertConfig | null {
    return this.config;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC EMIT METHODS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Emit DECISION_CHANGED event
   */
  async emitDecisionChanged(payload: DecisionChangedPayload): Promise<void> {
    // Guard: no user alerts on AVOID
    if (this.config?.global.noUserAlertsOnAvoid && payload.newAction === 'AVOID') {
      console.log('[FomoAlertEngine] Skipping DECISION_CHANGED (new action is AVOID)');
      return;
    }
    
    await this.emit('DECISION_CHANGED', payload);
  }
  
  /**
   * Emit HIGH_CONFIDENCE event
   */
  async emitHighConfidence(payload: HighConfidencePayload): Promise<void> {
    // Guard: check threshold
    if (this.config && payload.confidence < this.config.user.confidenceThreshold) {
      return;
    }
    
    // Guard: only BUY/SELL
    if (payload.action !== 'BUY' && payload.action !== 'SELL') {
      return;
    }
    
    // Guard: require LIVE data
    if (this.config?.global.requireLiveData && payload.dataMode !== 'LIVE') {
      return;
    }
    
    await this.emit('HIGH_CONFIDENCE', payload);
  }
  
  /**
   * Emit RISK_INCREASED event
   */
  async emitRiskIncreased(payload: RiskIncreasedPayload): Promise<void> {
    // Only emit if risk actually increased
    const riskOrder = { 'LOW': 0, 'MEDIUM': 1, 'HIGH': 2 };
    if (riskOrder[payload.newRisk] <= riskOrder[payload.previousRisk]) {
      return;
    }
    
    await this.emit('RISK_INCREASED', payload);
  }
  
  /**
   * Emit ML_PROMOTED event
   */
  async emitMlPromoted(payload: { modelId: string; accuracy: number; ece: number; previousModelId?: string }): Promise<void> {
    await this.emit('ML_PROMOTED', payload);
  }
  
  /**
   * Emit ML_ROLLBACK event
   */
  async emitMlRollback(payload: { rolledBackModelId: string; restoredModelId: string; reason: string; critStreak: number }): Promise<void> {
    await this.emit('ML_ROLLBACK', payload);
  }
  
  /**
   * Emit ML_SHADOW_CRITICAL event
   */
  async emitMlShadowCritical(payload: { modelId: string; stage: 'ACTIVE' | 'CANDIDATE'; health: 'CRITICAL'; critStreak: number; lastECE: number }): Promise<void> {
    await this.emit('ML_SHADOW_CRITICAL', payload);
  }
  
  /**
   * Emit PROVIDER_DOWN event
   */
  async emitProviderDown(payload: { provider: string; lastStatus: string; downSince?: number; affectedSymbols?: string[] }): Promise<void> {
    await this.emit('PROVIDER_DOWN', payload);
  }
  
  /**
   * Emit WS_DISCONNECT event
   */
  async emitWsDisconnect(payload: { service: string; error?: string; reconnectAttempts?: number }): Promise<void> {
    await this.emit('WS_DISCONNECT', payload);
  }
  
  /**
   * Emit DATA_COMPLETENESS event
   */
  async emitDataCompleteness(payload: { completeness: number; threshold: number; missingProviders?: string[] }): Promise<void> {
    await this.emit('DATA_COMPLETENESS', payload);
  }
  
  /**
   * Emit TRUST_WARNING event
   */
  async emitTrustWarning(payload: { symbol: string; type: 'DIVERGENCE_SPIKE' | 'ACCURACY_DROP' | 'UNUSUAL_PATTERN'; value: number; threshold?: number; details?: string }): Promise<void> {
    await this.emit('TRUST_WARNING', payload);
  }
  
  /**
   * Emit MACRO_REGIME_CHANGE event
   * Triggered when macro sentiment regime changes (e.g., FEAR → EXTREME_FEAR)
   */
  async emitMacroRegimeChange(payload: {
    previousLabel: string;
    newLabel: string;
    previousValue: number;
    newValue: number;
    direction: 'WORSENING' | 'IMPROVING' | 'STABLE';
    flags: string[];
    confidenceMultiplier: number;
    timestamp: number;
  }): Promise<void> {
    // Only emit for actual label changes
    if (payload.previousLabel === payload.newLabel) {
      return;
    }
    
    // Check if macro regime change alerts are enabled
    if (this.config && !this.config.user.macroRegimeChange) {
      console.log('[FomoAlertEngine] Skipping MACRO_REGIME_CHANGE (disabled)');
      return;
    }
    
    await this.emit('MACRO_REGIME_CHANGE', payload);
  }
  
  /**
   * Emit MACRO_EXTREME event
   * Triggered when extreme macro conditions are detected (PANIC/EUPHORIA)
   */
  async emitMacroExtreme(payload: {
    fearGreedValue: number;
    fearGreedLabel: string;
    btcDominance: number;
    stableDominance: number;
    flags: string[];
    impact: {
      confidenceMultiplier: number;
      blockedStrong: boolean;
      reason: string;
    };
    timestamp: number;
  }): Promise<void> {
    // Only emit for extreme conditions
    const isExtreme = payload.flags.includes('MACRO_PANIC') || payload.flags.includes('MACRO_EUPHORIA');
    if (!isExtreme) {
      return;
    }
    
    // Check if macro extreme alerts are enabled
    if (this.config && !this.config.admin.macroExtreme) {
      console.log('[FomoAlertEngine] Skipping MACRO_EXTREME (disabled)');
      return;
    }
    
    await this.emit('MACRO_EXTREME', payload);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // CORE EMIT LOGIC
  // ═══════════════════════════════════════════════════════════════
  
  private async emit(event: FomoAlertEvent, payload: FomoAlertPayload): Promise<void> {
    if (!this.config) await this.init();
    
    const scope = EVENT_SCOPE_MAP[event];
    const alertId = uuidv4();
    
    console.log(`[FomoAlertEngine] Emit | event: ${event} | scope: ${scope}`);
    
    // 1. Check global enable
    if (!this.config!.enabled) {
      await this.logAlert(alertId, event, scope, payload, 'SKIPPED', 'GLOBAL_DISABLED');
      return;
    }
    
    // 2. Check scope enable
    if (scope === 'USER' && !this.config!.user.enabled) {
      await this.logAlert(alertId, event, scope, payload, 'SKIPPED', 'USER_DISABLED');
      return;
    }
    if (scope === 'ADMIN' && !this.config!.admin.enabled) {
      await this.logAlert(alertId, event, scope, payload, 'SKIPPED', 'ADMIN_DISABLED');
      return;
    }
    
    // 3. Check event toggle
    if (!this.isEventEnabled(event, scope)) {
      await this.logAlert(alertId, event, scope, payload, 'SKIPPED', 'EVENT_DISABLED');
      return;
    }
    
    // 4. Check symbol filter (for USER events)
    if (scope === 'USER' && this.config!.user.symbols.length > 0) {
      const symbol = (payload as any).symbol;
      if (symbol && !this.config!.user.symbols.includes(symbol)) {
        await this.logAlert(alertId, event, scope, payload, 'SKIPPED', 'SYMBOL_NOT_IN_WATCHLIST');
        return;
      }
    }
    
    // 5. Check hourly limit
    this.checkHourlyReset();
    if (hourlyAlertCount >= this.config!.global.maxAlertsPerHour) {
      await this.logAlert(alertId, event, scope, payload, 'SKIPPED', 'HOURLY_LIMIT');
      return;
    }
    
    // 6. Check dedupe
    const dedupeKey = this.getDedupeKey(event, payload);
    if (this.isDuplicate(dedupeKey, event)) {
      await this.logAlert(alertId, event, scope, payload, 'DEDUPED', `DEDUPE_KEY: ${dedupeKey}`);
      return;
    }
    
    // 7. Build message
    const { text, title } = buildFomoAlertMessage(event, payload);
    
    // 8. Send to Telegram
    const sendResult = await this.sendToTelegram(scope, text);
    
    // 9. Update counters and dedupe
    if (sendResult.ok) {
      hourlyAlertCount++;
      dedupeCache.set(dedupeKey, Date.now());
      await this.logAlert(alertId, event, scope, payload, 'SENT', undefined, text);
      console.log(`[FomoAlertEngine] ✅ Sent ${event} via ${scope}`);
    } else {
      await this.logAlert(alertId, event, scope, payload, 'FAILED', sendResult.error, text);
      console.error(`[FomoAlertEngine] ❌ Failed ${event}: ${sendResult.error}`);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // TELEGRAM SEND
  // ═══════════════════════════════════════════════════════════════
  
  private async sendToTelegram(scope: FomoAlertScope, text: string): Promise<{ ok: boolean; error?: string }> {
    const botToken = scope === 'USER' ? this.config!.user.botToken : this.config!.admin.botToken;
    const chatId = scope === 'USER' ? this.config!.user.chatId : this.config!.admin.chatId;
    
    if (!botToken || !chatId) {
      return { ok: false, error: `${scope}_BOT_NOT_CONFIGURED` };
    }
    
    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      
      await axios.post(url, {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }, {
        timeout: 10000,
      });
      
      return { ok: true };
    } catch (err: any) {
      const error = err?.response?.data?.description || err.message;
      return { ok: false, error };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════
  
  private isEventEnabled(event: FomoAlertEvent, scope: FomoAlertScope): boolean {
    if (scope === 'USER') {
      const cfg = this.config!.user;
      switch (event) {
        case 'DECISION_CHANGED': return cfg.decisionChanged;
        case 'HIGH_CONFIDENCE': return cfg.highConfidence;
        case 'RISK_INCREASED': return cfg.riskIncreased;
        case 'MACRO_REGIME_CHANGE': return cfg.macroRegimeChange;
        default: return false;
      }
    } else {
      const cfg = this.config!.admin;
      switch (event) {
        case 'ML_PROMOTED': return cfg.mlPromoted;
        case 'ML_ROLLBACK': return cfg.mlRollback;
        case 'ML_SHADOW_CRITICAL': return cfg.mlShadowCritical;
        case 'PROVIDER_DOWN': return cfg.providerDown;
        case 'WS_DISCONNECT': return cfg.wsDisconnect;
        case 'DATA_COMPLETENESS': return cfg.dataCompleteness;
        case 'TRUST_WARNING': return cfg.trustWarning;
        case 'MACRO_EXTREME': return cfg.macroExtreme;
        default: return false;
      }
    }
  }
  
  private getDedupeKey(event: FomoAlertEvent, payload: FomoAlertPayload): string {
    // For macro events, use the label as key (not symbol)
    if (event === 'MACRO_REGIME_CHANGE') {
      const p = payload as any;
      return `${event}:${p.newLabel}`;
    }
    if (event === 'MACRO_EXTREME') {
      const p = payload as any;
      return `${event}:${p.fearGreedLabel}`;
    }
    const symbol = (payload as any).symbol || 'system';
    return `${event}:${symbol}`;
  }
  
  private isDuplicate(key: string, event: FomoAlertEvent): boolean {
    const lastSent = dedupeCache.get(key);
    if (!lastSent) return false;
    
    const ttl = FOMO_DEDUPE_TTL[event] || this.config!.global.dedupeWindowMs;
    return Date.now() - lastSent < ttl;
  }
  
  private checkHourlyReset(): void {
    if (Date.now() > hourlyResetAt) {
      hourlyAlertCount = 0;
      hourlyResetAt = Date.now() + 60 * 60 * 1000;
    }
  }
  
  private async logAlert(
    alertId: string,
    event: FomoAlertEvent,
    scope: FomoAlertScope,
    payload: FomoAlertPayload,
    status: FomoAlertLog['status'],
    skipReason?: string,
    message?: string
  ): Promise<void> {
    try {
      await FomoAlertLogModel.create({
        alertId,
        event,
        scope,
        payload,
        message: message || '',
        status,
        skipReason,
        createdAt: Date.now(),
        sentAt: status === 'SENT' ? Date.now() : undefined,
      });
    } catch (err) {
      console.error('[FomoAlertEngine] Failed to log alert:', err);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // ADMIN / STATS
  // ═══════════════════════════════════════════════════════════════
  
  async getAlertLogs(limit = 100): Promise<FomoAlertLog[]> {
    return FomoAlertLogModel
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean() as Promise<FomoAlertLog[]>;
  }
  
  async getAlertStats(): Promise<{
    total: number;
    sent: number;
    skipped: number;
    failed: number;
    byEvent: Record<string, number>;
    byStatus: Record<string, number>;
    hourlyRemaining: number;
  }> {
    const [total, sent, skipped, failed, byEvent, byStatus] = await Promise.all([
      FomoAlertLogModel.countDocuments(),
      FomoAlertLogModel.countDocuments({ status: 'SENT' }),
      FomoAlertLogModel.countDocuments({ status: { $in: ['SKIPPED', 'DEDUPED', 'MUTED', 'GUARD_BLOCKED'] } }),
      FomoAlertLogModel.countDocuments({ status: 'FAILED' }),
      FomoAlertLogModel.aggregate([{ $group: { _id: '$event', count: { $sum: 1 } } }]),
      FomoAlertLogModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    
    this.checkHourlyReset();
    
    return {
      total,
      sent,
      skipped,
      failed,
      byEvent: Object.fromEntries(byEvent.map(r => [r._id, r.count])),
      byStatus: Object.fromEntries(byStatus.map(r => [r._id, r.count])),
      hourlyRemaining: Math.max(0, (this.config?.global.maxAlertsPerHour || 50) - hourlyAlertCount),
    };
  }
  
  /**
   * Test alert (for admin verification)
   */
  async testAlert(scope: FomoAlertScope): Promise<{ ok: boolean; error?: string }> {
    if (!this.config) await this.init();
    
    const testPayload = scope === 'USER' 
      ? {
          symbol: 'BTCUSDT',
          previousAction: 'AVOID' as const,
          newAction: 'BUY' as const,
          previousConfidence: 0.45,
          newConfidence: 0.72,
          reasons: ['Test: Market stabilized', 'Test: ML confidence increased'],
          timestamp: Date.now(),
        }
      : {
          provider: 'TEST_PROVIDER',
          lastStatus: 'TEST_DISCONNECT',
          downSince: Date.now() - 5 * 60 * 1000,
        };
    
    const event = scope === 'USER' ? 'DECISION_CHANGED' : 'PROVIDER_DOWN';
    const { text } = buildFomoAlertMessage(event as FomoAlertEvent, testPayload as FomoAlertPayload);
    
    return this.sendToTelegram(scope, `🧪 TEST ALERT\n\n${text}`);
  }
}

export const fomoAlertEngine = new FomoAlertEngine();
