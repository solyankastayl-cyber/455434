/**
 * Exchange Horizon Cascade Service (BLOCK 3)
 * 
 * Cross-horizon influence in training:
 * - 1D outcomes influence 7D training (max ±15%)
 * - 7D outcomes influence 30D training (max ±25%)
 * - Sample-weighted + time-decay
 * - Protection for longer horizons from short-term noise
 */

import { Db } from 'mongodb';
import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface HorizonCascadeState {
  symbol: string;
  updatedAt: Date;
  
  // Measured biases from outcomes (-1..+1)
  bias1D: number;
  bias7D: number;
  
  // Confidence in biases (0..1)
  confidence1D: number;
  confidence7D: number;
  
  // Sample counts
  samples1D: number;
  samples7D: number;
  
  // Config used
  halfLifeDays: number;
  minSamplesForInfluence: number;
}

export interface CascadeInfluence {
  value: number;          // -0.25 to +0.25
  fromHorizon: ExchangeHorizon;
  parentBias: number;
  parentConfidence: number;
  parentSamples: number;
  applied: boolean;
  reason?: string;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

interface CascadeConfig {
  halfLifeDays: number;
  minSamplesForInfluence: number;
  sampleThresholdForFullConfidence: number;
  
  // Max influence per horizon
  maxInfluence1Dto7D: number;     // ±15%
  maxInfluence7Dto30D: number;    // ±25%
  
  // Shield for well-performing longer horizons
  goodQualityShield: number;      // Reduce influence by this factor when target is performing well
  goodQualitySampleThreshold: number;
}

const DEFAULT_CASCADE_CONFIG: CascadeConfig = {
  halfLifeDays: 14,
  minSamplesForInfluence: 20,
  sampleThresholdForFullConfidence: 120,
  
  maxInfluence1Dto7D: 0.15,
  maxInfluence7Dto30D: 0.25,
  
  goodQualityShield: 0.35,        // 65% shield when target is good
  goodQualitySampleThreshold: 300,
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

function expDecayWeight(daysAgo: number, halfLifeDays: number): number {
  return Math.pow(0.5, daysAgo / Math.max(0.0001, halfLifeDays));
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

const CASCADE_STATE_COLLECTION = 'exch_horizon_cascade_state';
const OUTCOMES_COLLECTION = 'exchange_prediction_snapshots'; // Use resolved snapshots

export class HorizonCascadeService {
  private config: CascadeConfig;
  
  constructor(
    private db: Db,
    config?: Partial<CascadeConfig>
  ) {
    this.config = { ...DEFAULT_CASCADE_CONFIG, ...config };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get current cascade state for a symbol.
   */
  async getState(symbol: string): Promise<HorizonCascadeState | null> {
    const doc = await this.db.collection(CASCADE_STATE_COLLECTION)
      .findOne({ symbol });
    return doc as HorizonCascadeState | null;
  }
  
  /**
   * Recompute cascade state from resolved outcomes.
   * Called after outcome resolution or periodically.
   */
  async recompute(symbol: string): Promise<HorizonCascadeState> {
    const now = new Date();
    const nowMs = now.getTime();
    
    const result: Partial<HorizonCascadeState> = {
      symbol,
      updatedAt: now,
      halfLifeDays: this.config.halfLifeDays,
      minSamplesForInfluence: this.config.minSamplesForInfluence,
    };
    
    // Compute bias for 1D and 7D horizons
    for (const horizon of ['1D', '7D'] as const) {
      const { bias, confidence, sampleCount } = await this.computeBiasForHorizon(
        symbol,
        horizon,
        nowMs
      );
      
      if (horizon === '1D') {
        result.bias1D = bias;
        result.confidence1D = confidence;
        result.samples1D = sampleCount;
      } else {
        result.bias7D = bias;
        result.confidence7D = confidence;
        result.samples7D = sampleCount;
      }
    }
    
    // Upsert state
    await this.db.collection(CASCADE_STATE_COLLECTION).updateOne(
      { symbol },
      { $set: result },
      { upsert: true }
    );
    
    console.log(`[HorizonCascade] Recomputed state for ${symbol}: bias1D=${result.bias1D?.toFixed(3)}, bias7D=${result.bias7D?.toFixed(3)}`);
    
    return result as HorizonCascadeState;
  }
  
  /**
   * Compute time-decay weighted bias for a horizon.
   */
  private async computeBiasForHorizon(
    symbol: string,
    horizon: '1D' | '7D',
    nowMs: number
  ): Promise<{ bias: number; confidence: number; sampleCount: number }> {
    // Get resolved snapshots for this horizon
    const docs = await this.db.collection(OUTCOMES_COLLECTION)
      .find({
        symbol,
        horizon,
        status: 'RESOLVED',
        outcome: { $in: ['WIN', 'LOSS'] }, // Exclude NEUTRAL
      })
      .sort({ resolvedAt: -1 })
      .limit(400)
      .toArray();
    
    if (docs.length === 0) {
      return { bias: 0, confidence: 0, sampleCount: 0 };
    }
    
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (const doc of docs) {
      const resolvedAt = new Date((doc as any).resolvedAt).getTime();
      const daysAgo = (nowMs - resolvedAt) / (1000 * 60 * 60 * 24);
      const weight = expDecayWeight(daysAgo, this.config.halfLifeDays);
      
      // Signal: WIN = +1 (model was right about direction), LOSS = -1
      const signal = (doc as any).outcome === 'WIN' ? 1 : -1;
      
      // Check if prediction was correct
      const predictedWin = (doc as any).predictedClass === 'WIN';
      const actualWin = (doc as any).outcome === 'WIN';
      const correct = predictedWin === actualWin;
      
      // Bias direction based on correctness
      const directionSignal = correct ? signal : -signal;
      
      weightedSum += directionSignal * weight;
      totalWeight += weight;
    }
    
    const bias = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const confidence = clamp(0, 1, docs.length / this.config.sampleThresholdForFullConfidence);
    
    return {
      bias: clamp(-1, 1, bias),
      confidence,
      sampleCount: docs.length,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INFLUENCE CALCULATION FOR TRAINING
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get cascade influence for a target horizon.
   * Used during training to adjust sample weights.
   * 
   * @param symbol - Trading symbol
   * @param targetHorizon - Horizon being trained (7D or 30D)
   * @param targetQualityState - Current quality state of target horizon (optional)
   * @param targetSampleCount - Sample count of target horizon (optional)
   */
  async getInfluence(params: {
    symbol: string;
    targetHorizon: ExchangeHorizon;
    targetQualityState?: 'GOOD' | 'NORMAL' | 'BAD';
    targetSampleCount?: number;
  }): Promise<CascadeInfluence> {
    const { symbol, targetHorizon, targetQualityState, targetSampleCount } = params;
    
    // 1D has no parent influence
    if (targetHorizon === '1D') {
      return {
        value: 0,
        fromHorizon: '1D',
        parentBias: 0,
        parentConfidence: 0,
        parentSamples: 0,
        applied: false,
        reason: '1D has no parent horizon',
      };
    }
    
    const state = await this.getState(symbol);
    
    if (!state) {
      return {
        value: 0,
        fromHorizon: targetHorizon === '7D' ? '1D' : '7D',
        parentBias: 0,
        parentConfidence: 0,
        parentSamples: 0,
        applied: false,
        reason: 'No cascade state computed yet',
      };
    }
    
    // Determine parent horizon and max influence
    const parentHorizon: ExchangeHorizon = targetHorizon === '7D' ? '1D' : '7D';
    const maxInfluence = targetHorizon === '7D' 
      ? this.config.maxInfluence1Dto7D 
      : this.config.maxInfluence7Dto30D;
    
    const parentBias = parentHorizon === '1D' ? state.bias1D : state.bias7D;
    const parentConfidence = parentHorizon === '1D' ? state.confidence1D : state.confidence7D;
    const parentSamples = parentHorizon === '1D' ? state.samples1D : state.samples7D;
    
    // Check minimum samples
    if (parentSamples < this.config.minSamplesForInfluence) {
      return {
        value: 0,
        fromHorizon: parentHorizon,
        parentBias,
        parentConfidence,
        parentSamples,
        applied: false,
        reason: `Insufficient samples (${parentSamples} < ${this.config.minSamplesForInfluence})`,
      };
    }
    
    // Calculate raw influence
    let influence = parentBias * parentConfidence * maxInfluence;
    
    // Apply shield if target horizon is performing well
    if (
      targetQualityState === 'GOOD' &&
      targetSampleCount !== undefined &&
      targetSampleCount >= this.config.goodQualitySampleThreshold
    ) {
      influence *= this.config.goodQualityShield;
    }
    
    return {
      value: clamp(-maxInfluence, maxInfluence, influence),
      fromHorizon: parentHorizon,
      parentBias,
      parentConfidence,
      parentSamples,
      applied: true,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SAMPLE WEIGHTING FOR TRAINING
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Calculate sample weight multiplier based on cascade influence.
   * 
   * @param influence - Cascade influence value (-0.25 to +0.25)
   * @param sampleLabelDirection - Direction of sample label (+1 for UP, -1 for DOWN)
   * @returns Weight multiplier (0.7 to 1.3)
   */
  calculateSampleWeight(influence: number, sampleLabelDirection: 1 | -1): number {
    // If influence positive => we trust UP more, so UP samples get higher weight
    const signed = influence * sampleLabelDirection;
    // Map [-0.25..0.25] to [0.7..1.3]
    const weight = 1 + signed * 0.8;
    return clamp(0.7, 1.3, weight);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // ADMIN
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get all cascade states (for admin panel).
   */
  async getAllStates(): Promise<HorizonCascadeState[]> {
    const docs = await this.db.collection(CASCADE_STATE_COLLECTION)
      .find({})
      .sort({ updatedAt: -1 })
      .toArray();
    return docs as HorizonCascadeState[];
  }
  
  /**
   * Get current configuration.
   */
  getConfig(): CascadeConfig {
    return { ...this.config };
  }
  
  /**
   * Ensure indexes.
   */
  async ensureIndexes(): Promise<void> {
    await this.db.collection(CASCADE_STATE_COLLECTION).createIndex(
      { symbol: 1 },
      { unique: true, name: 'idx_cascade_symbol' }
    );
    console.log('[HorizonCascade] Indexes ensured');
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let cascadeInstance: HorizonCascadeService | null = null;

export function getHorizonCascadeService(db: Db): HorizonCascadeService {
  if (!cascadeInstance) {
    cascadeInstance = new HorizonCascadeService(db);
  }
  return cascadeInstance;
}

console.log('[Exchange ML] Horizon Cascade Service loaded (BLOCK 3)');
