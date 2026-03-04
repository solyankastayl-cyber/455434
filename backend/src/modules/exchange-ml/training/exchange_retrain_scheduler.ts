/**
 * Exchange Auto-Learning Loop - PR2: Retrain Scheduler
 * 
 * Manages automatic model retraining:
 * - Threshold-based: triggers when enough new samples
 * - Scheduled: cron-like periodic retraining
 * - Cooldown enforcement to prevent too frequent retrains
 */

import { Db } from 'mongodb';
import {
  RetrainSchedulerConfig,
  DEFAULT_RETRAIN_CONFIG,
} from './exchange_training.types.js';
import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';
import { getExchangeDatasetService } from '../dataset/exchange_dataset.service.js';
import { getExchangeTrainerService } from './exchange_trainer.service.js';
import { getExchangeModelRegistryService } from './exchange_model_registry.service.js';

// ═══════════════════════════════════════════════════════════════
// RETRAIN SCHEDULER CLASS
// ═══════════════════════════════════════════════════════════════

export class ExchangeRetrainScheduler {
  private config: RetrainSchedulerConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastRetrainTime: Record<ExchangeHorizon, number> = {
    '1D': 0,
    '7D': 0,
    '30D': 0,
  };
  private lastSampleCounts: Record<ExchangeHorizon, number> = {
    '1D': 0,
    '7D': 0,
    '30D': 0,
  };
  
  constructor(private db: Db, config?: Partial<RetrainSchedulerConfig>) {
    this.config = { ...DEFAULT_RETRAIN_CONFIG, ...config };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // START/STOP
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Start the scheduler.
   */
  start(): void {
    if (this.isRunning) {
      console.log('[RetrainScheduler] Already running');
      return;
    }
    
    this.isRunning = true;
    
    // Check every 10 minutes for retrain conditions
    const checkInterval = 10 * 60 * 1000;
    
    this.intervalId = setInterval(async () => {
      await this.checkAndRetrain();
    }, checkInterval);
    
    console.log('[RetrainScheduler] Started (check every 10 min)');
    
    // Run initial check
    setTimeout(() => this.checkAndRetrain(), 5000);
  }
  
  /**
   * Stop the scheduler.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[RetrainScheduler] Stopped');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // RETRAIN CHECK
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Check if any horizon needs retraining.
   */
  async checkAndRetrain(): Promise<void> {
    if (!this.isRetrainEnabled()) {
      console.log('[RetrainScheduler] Retrain disabled by feature flag');
      return;
    }
    
    const horizons: ExchangeHorizon[] = ['1D', '7D', '30D'];
    
    for (const horizon of horizons) {
      try {
        const shouldRetrain = await this.shouldRetrain(horizon);
        
        if (shouldRetrain.trigger) {
          console.log(`[RetrainScheduler] Triggering retrain for ${horizon}: ${shouldRetrain.reason}`);
          await this.triggerRetrain(horizon, shouldRetrain.reason);
        }
      } catch (err) {
        console.error(`[RetrainScheduler] Error checking ${horizon}:`, err);
      }
    }
  }
  
  /**
   * Check if a horizon should be retrained.
   */
  async shouldRetrain(horizon: ExchangeHorizon): Promise<{ trigger: boolean; reason: string }> {
    const now = Date.now();
    
    // Check cooldown
    const lastRetrain = this.lastRetrainTime[horizon];
    if (now - lastRetrain < this.config.cooldownMs) {
      return { trigger: false, reason: 'Cooldown active' };
    }
    
    // Get current sample count
    const datasetService = getExchangeDatasetService(this.db);
    const stats = await datasetService.getStats();
    const currentCount = stats.byHorizon[horizon] || 0;
    const resolvedCount = stats.byStatus.RESOLVED || 0;
    
    // Check threshold trigger
    const lastCount = this.lastSampleCounts[horizon];
    const newSamples = currentCount - lastCount;
    
    if (newSamples >= this.config.minNewSamples) {
      return { trigger: true, reason: `New samples threshold: ${newSamples} >= ${this.config.minNewSamples}` };
    }
    
    // Check if we have enough samples at all
    const registryService = getExchangeModelRegistryService(this.db);
    const activeModel = await registryService.getActiveModel(horizon);
    
    if (!activeModel && resolvedCount >= this.config.minNewSamples) {
      return { trigger: true, reason: `No active model and ${resolvedCount} samples available` };
    }
    
    return { trigger: false, reason: 'No trigger conditions met' };
  }
  
  /**
   * Manually trigger retrain for a horizon.
   */
  async triggerRetrain(horizon: ExchangeHorizon, reason: string): Promise<{ success: boolean; runId?: string; error?: string }> {
    console.log(`[RetrainScheduler] Starting retrain for ${horizon}: ${reason}`);
    
    const trainerService = getExchangeTrainerService(this.db);
    const registryService = getExchangeModelRegistryService(this.db);
    
    try {
      // Train new model
      const result = await trainerService.trainModel({
        horizon,
        trigger: reason.includes('manual') ? 'MANUAL' : 'THRESHOLD',
      });
      
      if (!result.success || !result.modelId) {
        return { success: false, runId: result.runId, error: result.error };
      }
      
      // Register as shadow model
      const registerResult = await registryService.registerShadowModel(result.modelId, horizon);
      
      if (!registerResult.success) {
        return { success: false, runId: result.runId, error: registerResult.error };
      }
      
      // Update tracking
      this.lastRetrainTime[horizon] = Date.now();
      const datasetService = getExchangeDatasetService(this.db);
      const stats = await datasetService.getStats();
      this.lastSampleCounts[horizon] = stats.byHorizon[horizon] || 0;
      
      console.log(`[RetrainScheduler] Retrain complete: ${result.modelId}`);
      
      return { success: true, runId: result.runId };
      
    } catch (err: any) {
      console.error(`[RetrainScheduler] Retrain failed:`, err);
      return { success: false, error: err.message };
    }
  }
  
  /**
   * Manually trigger retrain for all horizons.
   */
  async triggerRetrainAll(): Promise<Record<ExchangeHorizon, { success: boolean; runId?: string; error?: string }>> {
    const horizons: ExchangeHorizon[] = ['1D', '7D', '30D'];
    const results: Record<ExchangeHorizon, { success: boolean; runId?: string; error?: string }> = {} as any;
    
    for (const horizon of horizons) {
      results[horizon] = await this.triggerRetrain(horizon, 'Manual trigger (all horizons)');
    }
    
    return results;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════
  
  private isRetrainEnabled(): boolean {
    return process.env.EXCHANGE_RETRAIN_ENABLED === 'true';
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATUS
  // ═══════════════════════════════════════════════════════════════
  
  getStatus(): {
    isRunning: boolean;
    config: RetrainSchedulerConfig;
    lastRetrainTime: Record<ExchangeHorizon, number>;
    lastSampleCounts: Record<ExchangeHorizon, number>;
    featureEnabled: boolean;
  } {
    return {
      isRunning: this.isRunning,
      config: this.config,
      lastRetrainTime: this.lastRetrainTime,
      lastSampleCounts: this.lastSampleCounts,
      featureEnabled: this.isRetrainEnabled(),
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let schedulerInstance: ExchangeRetrainScheduler | null = null;

export function getExchangeRetrainScheduler(db: Db): ExchangeRetrainScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new ExchangeRetrainScheduler(db);
  }
  return schedulerInstance;
}

console.log('[Exchange ML] Retrain scheduler loaded');
