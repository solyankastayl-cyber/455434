/**
 * Exchange Auto-Learning Loop - PR4/5/6: Lifecycle Scheduler
 * 
 * Runs periodic checks:
 * - Auto-promotion evaluation (every 6 hours)
 * - Auto-rollback evaluation (every 3 hours)
 */

import { Db } from 'mongodb';
import { AUTOPROMOTION_CONFIG, AUTOROLLBACK_CONFIG } from './exchange_lifecycle.config.js';
import { getExchangeAutoPromotionService } from './exchange_auto_promotion.service.js';
import { getExchangeAutoRollbackService } from './exchange_auto_rollback.service.js';
import { getExchangeGuardrailsService } from './exchange_guardrails.service.js';

// ═══════════════════════════════════════════════════════════════
// LIFECYCLE SCHEDULER
// ═══════════════════════════════════════════════════════════════

export class ExchangeLifecycleScheduler {
  private promotionIntervalId: NodeJS.Timeout | null = null;
  private rollbackIntervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  
  constructor(private db: Db) {}
  
  // ═══════════════════════════════════════════════════════════════
  // START/STOP
  // ═══════════════════════════════════════════════════════════════
  
  start(): void {
    if (this.isRunning) {
      console.log('[LifecycleScheduler] Already running');
      return;
    }
    
    if (!this.isEnabled()) {
      console.log('[LifecycleScheduler] Disabled by feature flag');
      return;
    }
    
    this.isRunning = true;
    
    // Auto-promotion check (every 6 hours)
    const promotionIntervalMs = AUTOPROMOTION_CONFIG.global.evaluationIntervalHours * 60 * 60 * 1000;
    this.promotionIntervalId = setInterval(async () => {
      await this.runPromotionCheck();
    }, promotionIntervalMs);
    
    // Auto-rollback check (every 3 hours)
    const rollbackIntervalMs = AUTOROLLBACK_CONFIG.global.evaluationIntervalHours * 60 * 60 * 1000;
    this.rollbackIntervalId = setInterval(async () => {
      await this.runRollbackCheck();
    }, rollbackIntervalMs);
    
    console.log(
      `[LifecycleScheduler] Started. ` +
      `Promotion: every ${AUTOPROMOTION_CONFIG.global.evaluationIntervalHours}h, ` +
      `Rollback: every ${AUTOROLLBACK_CONFIG.global.evaluationIntervalHours}h`
    );
    
    // Run initial checks after short delay
    setTimeout(() => this.runRollbackCheck(), 30000);
    setTimeout(() => this.runPromotionCheck(), 60000);
  }
  
  stop(): void {
    if (this.promotionIntervalId) {
      clearInterval(this.promotionIntervalId);
      this.promotionIntervalId = null;
    }
    
    if (this.rollbackIntervalId) {
      clearInterval(this.rollbackIntervalId);
      this.rollbackIntervalId = null;
    }
    
    this.isRunning = false;
    console.log('[LifecycleScheduler] Stopped');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PROMOTION CHECK
  // ═══════════════════════════════════════════════════════════════
  
  async runPromotionCheck(): Promise<void> {
    const guardrails = getExchangeGuardrailsService(this.db);
    
    // Skip if kill switch active
    if (guardrails.isKillSwitchActive()) {
      console.log('[LifecycleScheduler] Promotion check skipped: kill switch active');
      return;
    }
    
    // Skip if promotion locked
    if (guardrails.isPromotionLocked()) {
      console.log('[LifecycleScheduler] Promotion check skipped: promotion locked');
      return;
    }
    
    console.log('[LifecycleScheduler] Running promotion check...');
    
    try {
      const promotionService = getExchangeAutoPromotionService(this.db);
      const results = await promotionService.executeAllPromotions();
      
      if (results.totalPromoted > 0) {
        console.log(`[LifecycleScheduler] Promoted ${results.totalPromoted} model(s)`);
      } else {
        console.log('[LifecycleScheduler] No promotions needed');
      }
    } catch (err) {
      console.error('[LifecycleScheduler] Promotion check error:', err);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // ROLLBACK CHECK
  // ═══════════════════════════════════════════════════════════════
  
  async runRollbackCheck(): Promise<void> {
    const guardrails = getExchangeGuardrailsService(this.db);
    
    // Skip if kill switch active
    if (guardrails.isKillSwitchActive()) {
      console.log('[LifecycleScheduler] Rollback check skipped: kill switch active');
      return;
    }
    
    console.log('[LifecycleScheduler] Running rollback check...');
    
    try {
      const rollbackService = getExchangeAutoRollbackService(this.db);
      const results = await rollbackService.executeAllRollbacks();
      
      if (results.totalRolledBack > 0) {
        console.log(`[LifecycleScheduler] ⚠️ Rolled back ${results.totalRolledBack} model(s)`);
      } else {
        console.log('[LifecycleScheduler] No rollbacks needed');
      }
    } catch (err) {
      console.error('[LifecycleScheduler] Rollback check error:', err);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════
  
  private isEnabled(): boolean {
    return process.env.EXCHANGE_AUTOPROMOTE_ENABLED === 'true' ||
           process.env.EXCHANGE_AUTOROLLBACK_ENABLED === 'true';
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATUS
  // ═══════════════════════════════════════════════════════════════
  
  getStatus(): {
    isRunning: boolean;
    promotionIntervalHours: number;
    rollbackIntervalHours: number;
    featureEnabled: boolean;
  } {
    return {
      isRunning: this.isRunning,
      promotionIntervalHours: AUTOPROMOTION_CONFIG.global.evaluationIntervalHours,
      rollbackIntervalHours: AUTOROLLBACK_CONFIG.global.evaluationIntervalHours,
      featureEnabled: this.isEnabled(),
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let schedulerInstance: ExchangeLifecycleScheduler | null = null;

export function getExchangeLifecycleScheduler(db: Db): ExchangeLifecycleScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new ExchangeLifecycleScheduler(db);
  }
  return schedulerInstance;
}

console.log('[Exchange ML] Lifecycle scheduler loaded');
