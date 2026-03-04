/**
 * Exchange Auto-Learning Loop - Cross-Horizon Bias Service (Sample-Weighted)
 * 
 * Provides inference-time confidence adjustments based on horizon performance.
 * 
 * ARCHITECTURE:
 * ═══════════════════════════════════════════════════════════════
 * 1D → influences 7D (max ±15%)
 * 7D → influences 30D (max ±25%)
 * 30D → NO influence on shorter horizons
 * ═══════════════════════════════════════════════════════════════
 * 
 * CRITICAL RULE: Sample-Weighted Influence
 * ───────────────────────────────────────
 * influence = biasScore × weight × confidenceInBias
 * 
 * confidenceInBias = min(1, sampleCount / threshold)
 * 
 * This prevents noisy signals from small sample sizes from destabilizing the system.
 * 
 * ⚠️ This is an INFERENCE-ONLY layer:
 * - Does NOT affect model weights
 * - Does NOT affect retrain decisions
 * - Does NOT affect promotion/rollback
 * - Does NOT create cascading effects (1D → 30D is blocked)
 */

import { Db } from 'mongodb';
import { ExchangeHorizon } from './models/exchange_horizon_stats.model.js';
import { HorizonPerformanceService, getHorizonPerformanceService } from './horizon-performance.service.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface CrossHorizonBiasConfig {
  // Influence weights
  influence1Dto7D: number;       // How much 1D affects 7D (default 0.15)
  influence7Dto30D: number;      // How much 7D affects 30D (default 0.25)
  
  // Maximum bounds
  maxModifier7D: number;         // Max ±15% adjustment for 7D
  maxModifier30D: number;        // Max ±25% adjustment for 30D
  globalMaxModifier: number;     // Absolute max (safety)
  
  // Sample-weighting thresholds
  sampleThreshold1D: number;     // Samples needed for 100% confidence in 1D bias
  sampleThreshold7D: number;     // Samples needed for 100% confidence in 7D bias
  
  // Stability penalty
  stabilityPenaltyWeight: number; // How much low stability affects its own horizon
  minStabilityForInfluence: number; // Minimum stability to have cross-horizon influence
}

const DEFAULT_CONFIG: CrossHorizonBiasConfig = {
  influence1Dto7D: 0.15,
  influence7Dto30D: 0.25,
  
  maxModifier7D: 0.15,     // ±15%
  maxModifier30D: 0.25,    // ±25%
  globalMaxModifier: 0.30, // ±30% absolute max
  
  sampleThreshold1D: 100,  // 100 samples for full 1D confidence
  sampleThreshold7D: 50,   // 50 samples for full 7D confidence (longer horizon = fewer samples)
  
  stabilityPenaltyWeight: 0.10,
  minStabilityForInfluence: 0.3,
};

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface BiasBreakdown {
  fromParentHorizon?: {
    parentHorizon: ExchangeHorizon;
    parentBias: number;
    parentBiasRaw: number;        // NEW: raw (non-decayed) bias
    parentBiasDecayed: number;    // NEW: decayed bias (if valid)
    usedDecay: boolean;           // NEW: whether decay was used
    parentSampleCount: number;
    parentEffectiveSampleCount?: number; // NEW: ESS if decay enabled
    parentConfidence: number;
    rawInfluence: number;
    weightedInfluence: number;
  };
  stabilityPenalty?: {
    ownStability: number;
    penalty: number;
  };
  insufficientData?: boolean;
  decayState?: string;            // NEW: decay state for audit
}

export interface BiasAdjustmentResult {
  adjustedConfidence: number;
  modifier: number;
  breakdown: BiasBreakdown;
  applied: boolean;
  reason?: string;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class CrossHorizonBiasService {
  private config: CrossHorizonBiasConfig;
  
  constructor(
    private performanceService: HorizonPerformanceService,
    config?: Partial<CrossHorizonBiasConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MAIN APPLY METHOD (V2 with Time-Decay support)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Apply cross-horizon bias adjustment to a confidence score.
   * 
   * V2: Now uses decayed bias when available and valid.
   * Falls back to raw bias when decay is disabled or invalid.
   * 
   * @param horizon - Target horizon for the prediction
   * @param baseConfidence - Original model confidence (0..1)
   * @returns Adjusted confidence with breakdown
   */
  async apply(
    horizon: ExchangeHorizon,
    baseConfidence: number
  ): Promise<BiasAdjustmentResult> {
    
    const breakdown: BiasBreakdown = {};
    let modifier = 1.0;
    
    // ────────────────────────────────────────────────
    // RULE 1: 1D has NO cross-horizon influence on itself
    // ────────────────────────────────────────────────
    if (horizon === '1D') {
      // Only apply self-stability penalty
      const perf1D = await this.performanceService.getPerformanceWithDecay('1D');
      
      if (perf1D.raw.sampleCount >= 10) {
        // Use decayed stability if valid, otherwise raw
        const stability = this.pickStability(perf1D);
        const penalty = (1 - stability) * this.config.stabilityPenaltyWeight;
        modifier -= penalty;
        
        breakdown.stabilityPenalty = {
          ownStability: stability,
          penalty,
        };
        breakdown.decayState = perf1D.decay.state;
      }
    }
    
    // ────────────────────────────────────────────────
    // RULE 2: 7D is influenced by 1D (SAMPLE-WEIGHTED + DECAY)
    // ────────────────────────────────────────────────
    if (horizon === '7D') {
      const perf1D = await this.performanceService.getPerformanceWithDecay('1D');
      
      if (perf1D.raw.sampleCount >= this.config.sampleThreshold1D * 0.1) {
        // Use decayed stability if valid, otherwise raw
        const stability = this.pickStability(perf1D);
        
        // Check stability requirement
        if (stability >= this.config.minStabilityForInfluence) {
          // Pick bias: use decay if valid, otherwise raw
          const { bias, usedDecay, biasRaw, biasDecayed } = this.pickBias(perf1D);
          
          // Sample-weighted confidence (use raw sample count for threshold)
          const sampleConfidence = Math.min(1, perf1D.raw.sampleCount / this.config.sampleThreshold1D);
          
          // Raw influence from bias
          const rawInfluence = bias * this.config.influence1Dto7D;
          
          // Weighted influence (damped by sample confidence)
          const weightedInfluence = rawInfluence * sampleConfidence;
          
          // Apply with bounds
          const clampedInfluence = this.clamp(
            -this.config.maxModifier7D,
            this.config.maxModifier7D,
            weightedInfluence
          );
          
          modifier += clampedInfluence;
          
          breakdown.fromParentHorizon = {
            parentHorizon: '1D',
            parentBias: bias,
            parentBiasRaw: biasRaw,
            parentBiasDecayed: biasDecayed,
            usedDecay,
            parentSampleCount: perf1D.raw.sampleCount,
            parentEffectiveSampleCount: perf1D.decay.enabled ? perf1D.decay.effectiveSampleCount : undefined,
            parentConfidence: sampleConfidence,
            rawInfluence,
            weightedInfluence: clampedInfluence,
          };
          breakdown.decayState = perf1D.decay.state;
        } else {
          breakdown.insufficientData = true;
          breakdown.decayState = perf1D.decay.state;
        }
      } else {
        breakdown.insufficientData = true;
      }
    }
    
    // ────────────────────────────────────────────────
    // RULE 3: 30D is influenced by 7D (SAMPLE-WEIGHTED + DECAY)
    // ────────────────────────────────────────────────
    if (horizon === '30D') {
      const perf7D = await this.performanceService.getPerformanceWithDecay('7D');
      
      if (perf7D.raw.sampleCount >= this.config.sampleThreshold7D * 0.1) {
        // Use decayed stability if valid, otherwise raw
        const stability = this.pickStability(perf7D);
        
        // Check stability requirement
        if (stability >= this.config.minStabilityForInfluence) {
          // Pick bias: use decay if valid, otherwise raw
          const { bias, usedDecay, biasRaw, biasDecayed } = this.pickBias(perf7D);
          
          // Sample-weighted confidence (use raw sample count for threshold)
          const sampleConfidence = Math.min(1, perf7D.raw.sampleCount / this.config.sampleThreshold7D);
          
          // Raw influence from bias
          const rawInfluence = bias * this.config.influence7Dto30D;
          
          // Weighted influence (damped by sample confidence)
          const weightedInfluence = rawInfluence * sampleConfidence;
          
          // Apply with bounds
          const clampedInfluence = this.clamp(
            -this.config.maxModifier30D,
            this.config.maxModifier30D,
            weightedInfluence
          );
          
          modifier += clampedInfluence;
          
          breakdown.fromParentHorizon = {
            parentHorizon: '7D',
            parentBias: bias,
            parentBiasRaw: biasRaw,
            parentBiasDecayed: biasDecayed,
            usedDecay,
            parentSampleCount: perf7D.raw.sampleCount,
            parentEffectiveSampleCount: perf7D.decay.enabled ? perf7D.decay.effectiveSampleCount : undefined,
            parentConfidence: sampleConfidence,
            rawInfluence,
            weightedInfluence: clampedInfluence,
          };
          breakdown.decayState = perf7D.decay.state;
        } else {
          breakdown.insufficientData = true;
          breakdown.decayState = perf7D.decay.state;
        }
      } else {
        breakdown.insufficientData = true;
      }
    }
    
    // ────────────────────────────────────────────────
    // Apply global bounds
    // ────────────────────────────────────────────────
    modifier = this.clamp(
      1 - this.config.globalMaxModifier,
      1 + this.config.globalMaxModifier,
      modifier
    );
    
    // Calculate adjusted confidence
    const adjustedConfidence = this.clamp(0, 1, baseConfidence * modifier);
    
    const applied = modifier !== 1.0;
    
    return {
      adjustedConfidence,
      modifier,
      breakdown,
      applied,
      reason: applied ? `Cross-horizon bias applied (modifier=${modifier.toFixed(4)})` : 'No adjustment needed',
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // BIAS SELECTION HELPERS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Pick the best bias score: use decay if valid, otherwise raw.
   */
  private pickBias(perf: { raw: { biasScore: number }; decay: { valid: boolean; biasScore: number } }): {
    bias: number;
    usedDecay: boolean;
    biasRaw: number;
    biasDecayed: number;
  } {
    const biasRaw = perf.raw.biasScore;
    const biasDecayed = perf.decay.biasScore;
    
    if (perf.decay.valid) {
      return { bias: biasDecayed, usedDecay: true, biasRaw, biasDecayed };
    }
    return { bias: biasRaw, usedDecay: false, biasRaw, biasDecayed };
  }
  
  /**
   * Pick the best stability score: use decay if valid, otherwise raw.
   */
  private pickStability(perf: { raw: { stabilityScore: number }; decay: { valid: boolean; stabilityScore: number } }): number {
    if (perf.decay.valid) {
      return perf.decay.stabilityScore;
    }
    return perf.raw.stabilityScore;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════
  
  private clamp(min: number, max: number, value: number): number {
    return Math.max(min, Math.min(max, value));
  }
  
  /**
   * Get current bias adjustments for all horizons (diagnostic).
   */
  async getDiagnostics(): Promise<Record<ExchangeHorizon, BiasAdjustmentResult>> {
    const horizons: ExchangeHorizon[] = ['1D', '7D', '30D'];
    const results: Record<string, BiasAdjustmentResult> = {};
    
    for (const horizon of horizons) {
      // Apply with neutral confidence (0.5) to see raw effect
      results[horizon] = await this.apply(horizon, 0.5);
    }
    
    return results as Record<ExchangeHorizon, BiasAdjustmentResult>;
  }
  
  /**
   * Get current configuration.
   */
  getConfig(): CrossHorizonBiasConfig {
    return { ...this.config };
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let biasServiceInstance: CrossHorizonBiasService | null = null;

export function getCrossHorizonBiasService(db: Db): CrossHorizonBiasService {
  if (!biasServiceInstance) {
    const performanceService = getHorizonPerformanceService(db);
    biasServiceInstance = new CrossHorizonBiasService(performanceService);
  }
  return biasServiceInstance;
}

console.log('[Exchange ML] CrossHorizonBiasService (Sample-Weighted) loaded');
