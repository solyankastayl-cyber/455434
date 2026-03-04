/**
 * Exchange Forecast Segment Service (BLOCK 5.3)
 * 
 * Core logic for segment lifecycle:
 * - maybeRollSegment: smart roll based on bias/model change
 * - supersede + create atomically
 * - No redrawing of past predictions
 */

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  ExchForecastSegment,
  ExchHorizon,
  ExchDriftState,
} from './exch_forecast_segment.model.js';
import {
  ExchForecastSegmentRepo,
  getExchForecastSegmentRepo,
} from './exch_forecast_segment.repo.js';
import { getExchangeEventLoggerService } from '../lifecycle/exchange_event_logger.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type RollReason = 'MODEL_VERSION_CHANGED' | 'BIAS_CROSSED' | 'MANUAL' | 'SCHEDULED' | 'INITIAL';

export interface CreateSegmentArgs {
  asset: string;
  horizon: ExchHorizon;
  modelVersion: string;
  
  entryPrice: number;
  targetPrice: number;
  expectedReturn: number;
  
  confidence: number;
  biasApplied: number;
  driftState: ExchDriftState;
  
  reason: RollReason;
  minBiasAbsToRoll?: number;
}

export interface RollResult {
  rolled: boolean;
  active: ExchForecastSegment | null;
  supersededCount?: number;
  reason?: string;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const DEFAULT_MIN_BIAS: Record<ExchHorizon, number> = {
  '1D': 0.10,   // 1D can roll more frequently
  '7D': 0.12,
  '30D': 0.15,  // 30D requires stronger signal
};

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class ExchForecastSegmentService {
  private repo: ExchForecastSegmentRepo;
  
  constructor(private db: Db) {
    this.repo = getExchForecastSegmentRepo(db);
  }
  
  /**
   * Main entry point: maybe roll segment based on conditions.
   * 
   * Roll happens when:
   * - No active segment exists (INITIAL)
   * - Model version changed
   * - Bias crossed threshold
   * - Manual/Scheduled trigger
   * 
   * @returns rolled: true if new segment was created
   */
  async maybeRollSegment(args: CreateSegmentArgs): Promise<RollResult> {
    const asset = args.asset.toUpperCase();
    const horizon = args.horizon;
    
    const active = await this.repo.getActive(asset, horizon);
    
    // No active segment → always create
    if (!active) {
      const created = await this.createNewActive(args, asset, 'INITIAL');
      return { rolled: true, active: created, reason: 'No active segment existed' };
    }
    
    // Check if roll is needed
    const minBias = args.minBiasAbsToRoll ?? DEFAULT_MIN_BIAS[horizon];
    const biasAbs = Math.abs(args.biasApplied ?? 0);
    
    const modelChanged = active.modelVersion !== args.modelVersion;
    
    const shouldRoll = 
      args.reason === 'MANUAL' ||
      args.reason === 'SCHEDULED' ||
      modelChanged ||
      (args.reason === 'BIAS_CROSSED' && biasAbs >= minBias);
    
    if (!shouldRoll) {
      return {
        rolled: false,
        active,
        reason: `Roll not needed (biasAbs=${biasAbs.toFixed(3)}, threshold=${minBias}, modelChanged=${modelChanged})`,
      };
    }
    
    // Supersede current active + create new
    const supersededCount = await this.repo.supersedeActive(asset, horizon);
    const created = await this.createNewActive(args, asset, args.reason);
    
    // Log event
    try {
      const eventLogger = getExchangeEventLoggerService(this.db);
      await eventLogger.log({
        type: 'EXCH_SEGMENT_ROLLED',
        horizon,
        modelId: args.modelVersion,
        details: {
          asset,
          segmentId: created.segmentId,
          supersededCount,
          reason: args.reason,
          biasApplied: args.biasApplied,
          modelVersion: args.modelVersion,
          entryPrice: args.entryPrice,
          targetPrice: args.targetPrice,
          expectedReturn: args.expectedReturn,
        },
      });
    } catch (err) {
      console.error('[SegmentService] Failed to log event:', err);
    }
    
    console.log(`[SegmentService] Rolled ${asset} ${horizon}: ${created.segmentId} (${args.reason})`);
    
    return {
      rolled: true,
      active: created,
      supersededCount,
      reason: args.reason,
    };
  }
  
  /**
   * Create new ACTIVE segment.
   */
  private async createNewActive(
    args: CreateSegmentArgs,
    asset: string,
    reason: RollReason
  ): Promise<ExchForecastSegment> {
    const segment: ExchForecastSegment = {
      asset,
      horizon: args.horizon,
      
      segmentId: `exseg_${uuidv4()}`,
      modelVersion: args.modelVersion,
      
      createdAt: new Date(),
      supersededAt: null,
      resolvedAt: null,
      
      entryPrice: args.entryPrice,
      targetPrice: args.targetPrice,
      expectedReturn: args.expectedReturn,
      
      confidence: args.confidence,
      biasApplied: args.biasApplied ?? 0,
      driftState: args.driftState ?? 'NORMAL',
      
      status: 'ACTIVE',
      rollReason: reason,
    };
    
    await this.repo.insert(segment);
    return segment;
  }
  
  /**
   * Get active segment.
   */
  async getActive(asset: string, horizon: ExchHorizon): Promise<ExchForecastSegment | null> {
    return this.repo.getActive(asset.toUpperCase(), horizon);
  }
  
  /**
   * Get segment by ID.
   */
  async getBySegmentId(segmentId: string): Promise<ExchForecastSegment | null> {
    return this.repo.findBySegmentId(segmentId);
  }
  
  /**
   * List segments for timeline.
   */
  async listSegments(
    asset: string,
    horizon: ExchHorizon,
    limit: number = 50
  ): Promise<ExchForecastSegment[]> {
    return this.repo.list(asset.toUpperCase(), horizon, limit);
  }
  
  /**
   * Resolve a segment with outcome.
   */
  async resolveSegment(
    segmentId: string,
    actualReturn: number,
    winThreshold: number = 0.01
  ): Promise<{ resolved: boolean; outcome?: 'WIN' | 'LOSS' | 'NEUTRAL' }> {
    const segment = await this.repo.findBySegmentId(segmentId);
    
    if (!segment) {
      return { resolved: false };
    }
    
    if (segment.status === 'RESOLVED') {
      return { resolved: true, outcome: segment.outcome };
    }
    
    // Determine outcome based on actual return vs expected direction
    const predictedUp = segment.expectedReturn > 0;
    const actualUp = actualReturn > winThreshold;
    const actualDown = actualReturn < -winThreshold;
    
    let outcome: 'WIN' | 'LOSS' | 'NEUTRAL';
    if (!actualUp && !actualDown) {
      outcome = 'NEUTRAL';
    } else if ((predictedUp && actualUp) || (!predictedUp && actualDown)) {
      outcome = 'WIN';
    } else {
      outcome = 'LOSS';
    }
    
    const resolved = await this.repo.markResolved(segmentId, outcome, actualReturn);
    
    return { resolved, outcome };
  }
  
  /**
   * Get repo (for advanced queries).
   */
  getRepo(): ExchForecastSegmentRepo {
    return this.repo;
  }
  
  /**
   * Ensure indexes.
   */
  async ensureIndexes(): Promise<void> {
    await this.repo.ensureIndexes();
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let serviceInstance: ExchForecastSegmentService | null = null;

export function getExchForecastSegmentService(db: Db): ExchForecastSegmentService {
  if (!serviceInstance) {
    serviceInstance = new ExchForecastSegmentService(db);
  }
  return serviceInstance;
}

console.log('[Exchange ML] Forecast Segment Service loaded (BLOCK 5.3)');
