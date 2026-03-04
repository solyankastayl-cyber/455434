/**
 * Exchange Auto-Learning Loop - Horizon Performance Service
 * 
 * Tracks rolling performance metrics per horizon.
 * Provides data for CrossHorizonBiasService.
 * 
 * V2: Now includes Time-Decay weighted statistics.
 * 
 * ⚠️ This is an analytics layer:
 * - Does NOT affect model weights
 * - Does NOT trigger retrain
 * - Does NOT affect promotion/rollback
 */

import { Db, Collection } from 'mongodb';
import {
  ExchangeHorizonStats,
  ExchangeHorizon,
} from './models/exchange_horizon_stats.model.js';
import {
  loadBiasDecayConfig,
  computeDecayState,
  DecayState,
  BiasDecayConfig,
} from './config/decay.config.js';
import {
  OutcomeDoc,
  calculateDecayWeights,
  effectiveSampleCount,
  calcWeightedWinRate,
  calcBiasFromWinRate,
  calcWeightedStability,
  clamp,
} from './utils/decay-math.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

interface PerformanceConfig {
  rollingWindow: number;           // Number of samples for rolling calculations
  minSamplesForBias: number;       // Minimum samples to calculate meaningful bias
  maxBiasConfidenceThreshold: number; // Sample count for 100% confidence
}

const DEFAULT_CONFIG: PerformanceConfig = {
  rollingWindow: 100,
  minSamplesForBias: 10,
  maxBiasConfidenceThreshold: 200,
};

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface RawStats {
  sampleCount: number;
  winRate: number;
  lossRate: number;
  biasScore: number;
  biasConfidence: number;
  stabilityScore: number;
}

export interface DecayStats {
  enabled: boolean;
  tauDays: number;
  effectiveSampleCount: number;
  winRate: number;
  biasScore: number;
  stabilityScore: number;
  valid: boolean;
  reason: string;
  state: DecayState;
}

export interface HorizonPerformanceResult {
  horizon: ExchangeHorizon;
  raw: RawStats;
  decay: DecayStats;
  // Legacy fields for backward compatibility
  resolvedCount: number;
  consecutiveLosses: number;
  consecutiveWins: number;
  rollingDrawdown: number;
  maxDrawdown: number;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class HorizonPerformanceService {
  private statsCollection: Collection<ExchangeHorizonStats>;
  private shadowCollection: Collection<any>;
  private config: PerformanceConfig;
  private decayConfig: BiasDecayConfig;
  
  constructor(private db: Db, config?: Partial<PerformanceConfig>) {
    this.statsCollection = db.collection('exchange_horizon_stats');
    this.shadowCollection = db.collection('exch_shadow_predictions');
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.decayConfig = loadBiasDecayConfig();
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC METHODS - V2 WITH DECAY
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get horizon performance with both RAW and DECAY statistics.
   * This is the primary method for CrossHorizonBiasService.
   */
  async getPerformanceWithDecay(horizon: ExchangeHorizon): Promise<HorizonPerformanceResult> {
    // Fetch resolved outcomes
    const outcomes = await this.shadowCollection
      .find({
        horizon,
        resolved: true,
      })
      .sort({ resolvedAt: -1 })
      .limit(this.config.rollingWindow)
      .toArray();
    
    const now = new Date();
    const sampleCount = outcomes.length;
    
    // ─────────────────────────────────────────────────
    // RAW Statistics (no decay, as before)
    // ─────────────────────────────────────────────────
    const wins = outcomes.filter(o => o.actualOutcome === 'WIN').length;
    const losses = outcomes.filter(o => o.actualOutcome === 'LOSS').length;
    
    const rawWinRate = sampleCount > 0 ? wins / sampleCount : 0.5;
    const rawLossRate = sampleCount > 0 ? losses / sampleCount : 0.5;
    const rawBiasScore = calcBiasFromWinRate(rawWinRate);
    const rawBiasConfidence = Math.min(1, sampleCount / this.config.maxBiasConfidenceThreshold);
    const rawStabilityScore = this.calculateStability(outcomes);
    
    const raw: RawStats = {
      sampleCount,
      winRate: rawWinRate,
      lossRate: rawLossRate,
      biasScore: rawBiasScore,
      biasConfidence: rawBiasConfidence,
      stabilityScore: rawStabilityScore,
    };
    
    // ─────────────────────────────────────────────────
    // DECAY Statistics (time-weighted)
    // ─────────────────────────────────────────────────
    let decay: DecayStats;
    
    if (!this.decayConfig.enabled) {
      decay = {
        enabled: false,
        tauDays: this.decayConfig.tauDays[horizon],
        effectiveSampleCount: 0,
        winRate: rawWinRate,
        biasScore: rawBiasScore,
        stabilityScore: rawStabilityScore,
        valid: false,
        reason: 'DISABLED',
        state: 'DISABLED',
      };
    } else if (!outcomes.length) {
      decay = {
        enabled: true,
        tauDays: this.decayConfig.tauDays[horizon],
        effectiveSampleCount: 0,
        winRate: 0.5,
        biasScore: 0,
        stabilityScore: 1,
        valid: false,
        reason: 'NO_DATA',
        state: 'LOW_EFFECTIVE_SAMPLES',
      };
    } else {
      const tauDays = this.decayConfig.tauDays[horizon];
      
      // Convert to OutcomeDoc format
      const outcomeDocs: OutcomeDoc[] = outcomes.map(o => ({
        resolvedAt: o.resolvedAt,
        actualOutcome: o.actualOutcome,
      }));
      
      // Calculate decay weights
      const weights = calculateDecayWeights(outcomeDocs, now, tauDays);
      
      // Effective sample count (ESS)
      const ess = effectiveSampleCount(weights);
      
      // Decay-weighted metrics
      const decayedWinRate = calcWeightedWinRate(outcomeDocs, weights);
      const decayedBias = calcBiasFromWinRate(decayedWinRate);
      const decayedStability = calcWeightedStability(outcomeDocs, weights);
      
      // Check validity
      const minEff = this.decayConfig.minEffectiveSamples;
      const valid = ess >= minEff;
      
      // Compute state
      const decayInfo = { enabled: true, valid, effectiveSampleCount: ess };
      const state = computeDecayState(decayInfo, minEff);
      
      decay = {
        enabled: true,
        tauDays,
        effectiveSampleCount: Number(ess.toFixed(2)),
        winRate: decayedWinRate,
        biasScore: decayedBias,
        stabilityScore: decayedStability,
        valid,
        reason: valid ? 'OK' : `LOW_EFFECTIVE_SAMPLES:${ess.toFixed(2)}<${minEff}`,
        state,
      };
    }
    
    // ─────────────────────────────────────────────────
    // Legacy metrics
    // ─────────────────────────────────────────────────
    const consecutiveLosses = this.calculateConsecutiveLosses(outcomes);
    const consecutiveWins = this.calculateConsecutiveWins(outcomes);
    const { rollingDrawdown, maxDrawdown } = this.calculateDrawdown(outcomes);
    
    return {
      horizon,
      raw,
      decay,
      resolvedCount: sampleCount,
      consecutiveLosses,
      consecutiveWins,
      rollingDrawdown,
      maxDrawdown,
      updatedAt: now,
    };
  }
  
  /**
   * Get performance for all horizons.
   */
  async getAllPerformanceWithDecay(): Promise<Record<ExchangeHorizon, HorizonPerformanceResult>> {
    const horizons: ExchangeHorizon[] = ['1D', '7D', '30D'];
    const results: Record<string, HorizonPerformanceResult> = {};
    
    for (const horizon of horizons) {
      results[horizon] = await this.getPerformanceWithDecay(horizon);
    }
    
    return results as Record<ExchangeHorizon, HorizonPerformanceResult>;
  }
  
  /**
   * Get current decay configuration.
   */
  getDecayConfig(): BiasDecayConfig {
    return { ...this.decayConfig };
  }
  
  /**
   * Reload decay configuration from environment.
   */
  reloadDecayConfig(): void {
    this.decayConfig = loadBiasDecayConfig();
    console.log('[HorizonPerformance] Decay config reloaded:', this.decayConfig);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // LEGACY PUBLIC METHODS (backward compatibility)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Update statistics for a horizon based on resolved outcomes.
   * Call this after outcomes are resolved in the dataset.
   */
  async updateStats(horizon: ExchangeHorizon): Promise<ExchangeHorizonStats> {
    console.log(`[HorizonPerformance] Updating stats for ${horizon}...`);
    
    // Fetch resolved predictions from shadow predictions collection
    const outcomes = await this.shadowCollection
      .find({
        horizon,
        resolved: true,
      })
      .sort({ resolvedAt: -1 })
      .limit(this.config.rollingWindow)
      .toArray();
    
    if (!outcomes.length) {
      console.log(`[HorizonPerformance] No resolved outcomes for ${horizon}`);
      return this.getOrCreateStats(horizon);
    }
    
    // Calculate metrics
    const sampleCount = outcomes.length;
    const resolvedCount = sampleCount;
    
    const wins = outcomes.filter(o => o.actualOutcome === 'WIN').length;
    const losses = outcomes.filter(o => o.actualOutcome === 'LOSS').length;
    
    const rollingWinRate = sampleCount > 0 ? wins / sampleCount : 0.5;
    const rollingLossRate = sampleCount > 0 ? losses / sampleCount : 0.5;
    
    const consecutiveLosses = this.calculateConsecutiveLosses(outcomes);
    const consecutiveWins = this.calculateConsecutiveWins(outcomes);
    
    const { rollingDrawdown, maxDrawdown } = this.calculateDrawdown(outcomes);
    
    const stabilityScore = this.calculateStability(outcomes);
    
    // Bias calculation: (winRate - 0.5) * 2 → range -1..+1
    const biasScore = (rollingWinRate - 0.5) * 2;
    
    // Confidence in bias based on sample size
    const biasConfidence = Math.min(1, sampleCount / this.config.maxBiasConfidenceThreshold);
    
    // Update in database
    const now = new Date();
    
    const stats: ExchangeHorizonStats = {
      horizon,
      sampleCount,
      resolvedCount,
      rollingWinRate,
      rollingLossRate,
      rollingDrawdown,
      maxDrawdown,
      consecutiveLosses,
      consecutiveWins,
      stabilityScore,
      biasScore,
      biasConfidence,
      updatedAt: now,
      createdAt: now, // Will be set only on insert
    };
    
    await this.statsCollection.updateOne(
      { horizon },
      {
        $set: {
          ...stats,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );
    
    console.log(`[HorizonPerformance] Updated ${horizon}: winRate=${rollingWinRate.toFixed(3)}, bias=${biasScore.toFixed(3)}, confidence=${biasConfidence.toFixed(3)}`);
    
    return stats;
  }
  
  /**
   * Get current stats for a horizon.
   */
  async getStats(horizon: ExchangeHorizon): Promise<ExchangeHorizonStats | null> {
    const stats = await this.statsCollection.findOne({ horizon });
    return stats || null;
  }
  
  /**
   * Get stats for all horizons.
   */
  async getAllStats(): Promise<ExchangeHorizonStats[]> {
    return this.statsCollection.find({}).toArray();
  }
  
  /**
   * Get or create stats for a horizon.
   */
  async getOrCreateStats(horizon: ExchangeHorizon): Promise<ExchangeHorizonStats> {
    let stats = await this.getStats(horizon);
    
    if (!stats) {
      const now = new Date();
      stats = {
        horizon,
        sampleCount: 0,
        resolvedCount: 0,
        rollingWinRate: 0.5,
        rollingLossRate: 0.5,
        rollingDrawdown: 0,
        maxDrawdown: 0,
        consecutiveLosses: 0,
        consecutiveWins: 0,
        stabilityScore: 1,
        biasScore: 0,
        biasConfidence: 0,
        updatedAt: now,
        createdAt: now,
      };
      
      await this.statsCollection.insertOne(stats);
    }
    
    return stats;
  }
  
  /**
   * Update all horizons.
   */
  async updateAllStats(): Promise<Record<ExchangeHorizon, ExchangeHorizonStats>> {
    const horizons: ExchangeHorizon[] = ['1D', '7D', '30D'];
    const results: Record<string, ExchangeHorizonStats> = {};
    
    for (const horizon of horizons) {
      results[horizon] = await this.updateStats(horizon);
    }
    
    return results as Record<ExchangeHorizon, ExchangeHorizonStats>;
  }
  
  /**
   * Ensure indexes.
   */
  async ensureIndexes(): Promise<void> {
    await this.statsCollection.createIndex({ horizon: 1 }, { unique: true });
    await this.statsCollection.createIndex({ updatedAt: 1 });
    console.log('[HorizonPerformance] Indexes ensured');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PRIVATE CALCULATION METHODS
  // ═══════════════════════════════════════════════════════════════
  
  private calculateConsecutiveLosses(outcomes: any[]): number {
    let count = 0;
    for (const o of outcomes) {
      if (o.actualOutcome === 'LOSS') {
        count++;
      } else {
        break;
      }
    }
    return count;
  }
  
  private calculateConsecutiveWins(outcomes: any[]): number {
    let count = 0;
    for (const o of outcomes) {
      if (o.actualOutcome === 'WIN') {
        count++;
      } else {
        break;
      }
    }
    return count;
  }
  
  private calculateDrawdown(outcomes: any[]): { rollingDrawdown: number; maxDrawdown: number } {
    if (!outcomes.length) {
      return { rollingDrawdown: 0, maxDrawdown: 0 };
    }
    
    let equity = 1;
    let peak = 1;
    let maxDD = 0;
    
    // Process from oldest to newest (reverse array since it's sorted newest first)
    const reversed = [...outcomes].reverse();
    
    for (const o of reversed) {
      // Estimate PnL: WIN = +1%, LOSS = -1%
      const pnl = o.actualOutcome === 'WIN' ? 0.01 : -0.01;
      
      equity *= (1 + pnl);
      
      if (equity > peak) {
        peak = equity;
      }
      
      const dd = (peak - equity) / peak;
      
      if (dd > maxDD) {
        maxDD = dd;
      }
    }
    
    // Current drawdown
    const currentDD = (peak - equity) / peak;
    
    return {
      rollingDrawdown: Math.max(0, currentDD),
      maxDrawdown: Math.max(0, maxDD),
    };
  }
  
  private calculateStability(outcomes: any[]): number {
    if (outcomes.length < 2) {
      return 1; // Perfect stability with insufficient data
    }
    
    // Convert outcomes to binary: WIN = 1, LOSS = 0
    const values = outcomes.map(o => o.actualOutcome === 'WIN' ? 1 : 0);
    
    // Calculate mean
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    
    // Calculate variance
    const variance = values.reduce((sum, v) =>
      sum + Math.pow(v - mean, 2), 0) / values.length;
    
    // Standard deviation
    const stdDev = Math.sqrt(variance);
    
    // Stability: 1 - stdDev (clamped to 0..1)
    // stdDev for binary is max ~0.5, so multiply by 2 to normalize
    const stability = Math.max(0, Math.min(1, 1 - stdDev * 2));
    
    return stability;
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let serviceInstance: HorizonPerformanceService | null = null;

export function getHorizonPerformanceService(db: Db): HorizonPerformanceService {
  if (!serviceInstance) {
    serviceInstance = new HorizonPerformanceService(db);
  }
  return serviceInstance;
}

console.log('[Exchange ML] HorizonPerformanceService loaded');
