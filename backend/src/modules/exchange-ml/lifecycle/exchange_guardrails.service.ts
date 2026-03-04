/**
 * Exchange Auto-Learning Loop - PR6: Guardrails Service
 * 
 * Production safety controls:
 * - Kill switch
 * - Promotion lock
 * - Retrain throttle
 * - Drift state tracking
 * - Exposure limits
 */

import { Db } from 'mongodb';
import { GUARDRAILS_CONFIG, GuardrailsConfig } from './exchange_lifecycle.config.js';
import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';
import { getExchangeEventLoggerService } from './exchange_event_logger.service.js';

// ═══════════════════════════════════════════════════════════════
// RUNTIME STATE
// ═══════════════════════════════════════════════════════════════

interface GuardrailsState {
  killSwitch: boolean;
  promotionLock: boolean;
  retrainThrottle: {
    lastRetrainTimestamp: number;
    retrainCountToday: number;
    retrainDay: number;
  };
  driftStates: Record<ExchangeHorizon, 'NORMAL' | 'WARNING' | 'CRITICAL'>;
}

// ═══════════════════════════════════════════════════════════════
// GUARDRAILS SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExchangeGuardrailsService {
  private config: GuardrailsConfig;
  private state: GuardrailsState;
  
  constructor(private db: Db) {
    this.config = { ...GUARDRAILS_CONFIG };
    this.state = {
      killSwitch: GUARDRAILS_CONFIG.killSwitch,
      promotionLock: GUARDRAILS_CONFIG.promotionLock,
      retrainThrottle: {
        lastRetrainTimestamp: 0,
        retrainCountToday: 0,
        retrainDay: new Date().getUTCDate(),
      },
      driftStates: {
        '1D': 'NORMAL',
        '7D': 'NORMAL',
        '30D': 'NORMAL',
      },
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // KILL SWITCH
  // ═══════════════════════════════════════════════════════════════
  
  isKillSwitchActive(): boolean {
    return this.state.killSwitch;
  }
  
  async activateKillSwitch(reason?: string): Promise<void> {
    this.state.killSwitch = true;
    
    const eventLogger = getExchangeEventLoggerService(this.db);
    await eventLogger.logKillSwitch(true, reason);
    
    console.log(`[Guardrails] 🛑 KILL SWITCH ACTIVATED: ${reason || 'Manual'}`);
  }
  
  async deactivateKillSwitch(reason?: string): Promise<void> {
    this.state.killSwitch = false;
    
    const eventLogger = getExchangeEventLoggerService(this.db);
    await eventLogger.logKillSwitch(false, reason);
    
    console.log(`[Guardrails] ✅ Kill switch deactivated: ${reason || 'Manual'}`);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PROMOTION LOCK
  // ═══════════════════════════════════════════════════════════════
  
  isPromotionLocked(): boolean {
    return this.state.promotionLock;
  }
  
  async lockPromotion(reason?: string): Promise<void> {
    this.state.promotionLock = true;
    
    const eventLogger = getExchangeEventLoggerService(this.db);
    await eventLogger.logPromotionLock(true, reason);
    
    console.log(`[Guardrails] 🔒 Promotion LOCKED: ${reason || 'Manual'}`);
  }
  
  async unlockPromotion(reason?: string): Promise<void> {
    this.state.promotionLock = false;
    
    const eventLogger = getExchangeEventLoggerService(this.db);
    await eventLogger.logPromotionLock(false, reason);
    
    console.log(`[Guardrails] 🔓 Promotion unlocked: ${reason || 'Manual'}`);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // RETRAIN THROTTLE
  // ═══════════════════════════════════════════════════════════════
  
  canRetrain(): { allowed: boolean; reason: string } {
    const now = Date.now();
    const today = new Date().getUTCDate();
    
    // Reset daily counter if new day
    if (today !== this.state.retrainThrottle.retrainDay) {
      this.state.retrainThrottle.retrainDay = today;
      this.state.retrainThrottle.retrainCountToday = 0;
    }
    
    // Check daily limit
    if (this.state.retrainThrottle.retrainCountToday >= this.config.maxDailyRetrains) {
      return {
        allowed: false,
        reason: `Daily retrain limit reached: ${this.config.maxDailyRetrains}`,
      };
    }
    
    // Check interval
    const minutesSince = (now - this.state.retrainThrottle.lastRetrainTimestamp) / 60000;
    if (minutesSince < this.config.minRetrainIntervalMinutes) {
      return {
        allowed: false,
        reason: `Retrain interval: ${minutesSince.toFixed(0)}min < ${this.config.minRetrainIntervalMinutes}min`,
      };
    }
    
    return { allowed: true, reason: 'Retrain allowed' };
  }
  
  markRetrainExecuted(): void {
    this.state.retrainThrottle.lastRetrainTimestamp = Date.now();
    this.state.retrainThrottle.retrainCountToday++;
    
    console.log(
      `[Guardrails] Retrain marked. Count today: ${this.state.retrainThrottle.retrainCountToday}/${this.config.maxDailyRetrains}`
    );
  }
  
  // ═══════════════════════════════════════════════════════════════
  // DRIFT STATE
  // ═══════════════════════════════════════════════════════════════
  
  getDriftState(horizon: ExchangeHorizon): 'NORMAL' | 'WARNING' | 'CRITICAL' {
    return this.state.driftStates[horizon];
  }
  
  setDriftState(horizon: ExchangeHorizon, state: 'NORMAL' | 'WARNING' | 'CRITICAL'): void {
    const prev = this.state.driftStates[horizon];
    this.state.driftStates[horizon] = state;
    
    if (prev !== state) {
      console.log(`[Guardrails] Drift state changed: ${horizon} ${prev} -> ${state}`);
    }
  }
  
  hasAnyCriticalDrift(): boolean {
    return Object.values(this.state.driftStates).some(s => s === 'CRITICAL');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // EXPOSURE LIMITS
  // ═══════════════════════════════════════════════════════════════
  
  getMaxExposure(): number {
    return this.config.maxPortfolioExposure;
  }
  
  capExposure(proposedExposure: number): number {
    return Math.min(proposedExposure, this.config.maxPortfolioExposure);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // VOLATILITY CHECK
  // ═══════════════════════════════════════════════════════════════
  
  shouldBlockTrading(currentVolatility: number): boolean {
    return currentVolatility > this.config.maxVolatilityForTrading;
  }
  
  getMaxVolatility(): number {
    return this.config.maxVolatilityForTrading;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // CONFIG MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  getConfig(): GuardrailsConfig {
    return { ...this.config };
  }
  
  updateConfig(updates: Partial<GuardrailsConfig>): void {
    this.config = { ...this.config, ...updates };
    
    // Sync state with config
    if (updates.killSwitch !== undefined) {
      this.state.killSwitch = updates.killSwitch;
    }
    if (updates.promotionLock !== undefined) {
      this.state.promotionLock = updates.promotionLock;
    }
    
    console.log('[Guardrails] Config updated:', updates);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATUS
  // ═══════════════════════════════════════════════════════════════
  
  getStatus(): {
    killSwitch: boolean;
    promotionLock: boolean;
    retrainThrottle: {
      retrainsToday: number;
      maxDaily: number;
      canRetrain: boolean;
      minutesSinceLastRetrain: number;
    };
    driftStates: Record<ExchangeHorizon, string>;
    config: GuardrailsConfig;
  } {
    const now = Date.now();
    const minutesSince = (now - this.state.retrainThrottle.lastRetrainTimestamp) / 60000;
    
    return {
      killSwitch: this.state.killSwitch,
      promotionLock: this.state.promotionLock,
      retrainThrottle: {
        retrainsToday: this.state.retrainThrottle.retrainCountToday,
        maxDaily: this.config.maxDailyRetrains,
        canRetrain: this.canRetrain().allowed,
        minutesSinceLastRetrain: Math.floor(minutesSince),
      },
      driftStates: this.state.driftStates,
      config: this.config,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let guardrailsInstance: ExchangeGuardrailsService | null = null;

export function getExchangeGuardrailsService(db: Db): ExchangeGuardrailsService {
  if (!guardrailsInstance) {
    guardrailsInstance = new ExchangeGuardrailsService(db);
  }
  return guardrailsInstance;
}

console.log('[Exchange ML] Guardrails service loaded');
