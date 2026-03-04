/**
 * Segment Rollover Service (BLOCK 4.2)
 * 
 * Manages prediction segment lifecycle:
 * - 30D segments rollover every 7D checkpoint
 * - Old segments become GHOST (displayed as faded on graph)
 * - New segment starts from current price point
 */

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  ForecastSegment,
  SegmentLayer,
  SegmentHorizon,
  SegmentCandle,
  RolloverReason,
} from './forecast_segment.model.js';
import { ForecastSegmentRepo, getForecastSegmentRepo } from './forecast_segment.repo.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface VerdictCandidate {
  symbol: string;
  layer: SegmentLayer;
  horizon: SegmentHorizon;
  anchorPrice: number;      // Current price (start)
  targetPrice: number;      // Target price
  expectedReturnPct: number; // Expected return %
  confidence: number;
  meta?: {
    modelVersion?: string;
    qualityState?: string;
    driftState?: string;
    snapshotId?: string;
    source?: string;
  };
}

export interface RolloverResult {
  changed: boolean;
  active: ForecastSegment | null;
  ghosted: ForecastSegment | null;
  reason?: RolloverReason;
}

// ═══════════════════════════════════════════════════════════════
// TRAJECTORY GENERATOR
// ═══════════════════════════════════════════════════════════════

/**
 * Generate synthetic candles for a prediction segment.
 * Uses brownian bridge interpolation with realistic volatility.
 */
function generateTrajectory(params: {
  startTs: number;
  endTs: number;
  fromPrice: number;
  targetPrice: number;
  horizon: SegmentHorizon;
  volatilityFactor?: number;
}): SegmentCandle[] {
  const { startTs, endTs, fromPrice, targetPrice, horizon, volatilityFactor = 1.0 } = params;
  
  // Number of candles based on horizon
  const candleCount = horizon === '1D' ? 24 : horizon === '7D' ? 7 * 24 : 30 * 24;
  const interval = (endTs - startTs) / candleCount;
  
  // Base volatility (% per candle)
  const baseVol = horizon === '1D' ? 0.005 : horizon === '7D' ? 0.008 : 0.012;
  const vol = baseVol * volatilityFactor;
  
  const candles: SegmentCandle[] = [];
  let currentPrice = fromPrice;
  
  // Total expected move
  const totalMove = targetPrice - fromPrice;
  const movePerCandle = totalMove / candleCount;
  
  for (let i = 0; i < candleCount; i++) {
    const time = Math.floor(startTs + i * interval);
    
    // Progress towards target with noise
    const drift = movePerCandle;
    const noise = (Math.random() - 0.5) * 2 * currentPrice * vol;
    
    // Brownian bridge: pull towards target as we approach end
    const progress = i / candleCount;
    const remainingMove = targetPrice - currentPrice;
    const bridgePull = remainingMove * progress * 0.1;
    
    const open = currentPrice;
    const closePrice = open + drift + noise + bridgePull;
    
    // Generate high/low with realistic spread
    const spread = Math.abs(closePrice - open) + currentPrice * vol * 0.5;
    const high = Math.max(open, closePrice) + Math.random() * spread * 0.5;
    const low = Math.min(open, closePrice) - Math.random() * spread * 0.5;
    
    candles.push({
      time,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(closePrice.toFixed(2)),
      volume: Math.floor(1000 + Math.random() * 9000),
    });
    
    currentPrice = closePrice;
  }
  
  // Ensure last candle reaches target
  if (candles.length > 0) {
    candles[candles.length - 1].close = Number(targetPrice.toFixed(2));
  }
  
  return candles;
}

// ═══════════════════════════════════════════════════════════════
// ROLLOVER SERVICE
// ═══════════════════════════════════════════════════════════════

export class SegmentRolloverService {
  private repo: ForecastSegmentRepo;
  
  constructor(
    private db: Db,
    private verdictProvider: (params: {
      symbol: string;
      layer: SegmentLayer;
      horizon: SegmentHorizon;
    }) => Promise<VerdictCandidate | null>
  ) {
    this.repo = getForecastSegmentRepo(db);
  }
  
  /**
   * Check if 30D segment should rollover (7D checkpoint).
   */
  private shouldRollover30D(active: ForecastSegment | null, nowTs: number): boolean {
    // If no active segment, create one
    if (!active) return true;
    
    // Check if 7 days have passed since segment start
    const daysElapsed = (nowTs - active.startTs) / (60 * 60 * 24);
    return daysElapsed >= 7;
  }
  
  /**
   * Check if segment needs update (for non-30D horizons).
   */
  private shouldUpdate(
    active: ForecastSegment | null,
    horizon: SegmentHorizon,
    nowTs: number
  ): boolean {
    if (!active) return true;
    
    // 1D: update every 4 hours
    if (horizon === '1D') {
      const hoursElapsed = (nowTs - active.createdAtTs) / (60 * 60);
      return hoursElapsed >= 4;
    }
    
    // 7D: update every day
    if (horizon === '7D') {
      const daysElapsed = (nowTs - active.createdAtTs) / (60 * 60 * 24);
      return daysElapsed >= 1;
    }
    
    return false;
  }
  
  /**
   * Ensure segment is up-to-date.
   * For 30D: rolls over every 7D checkpoint.
   * For 1D/7D: updates more frequently.
   */
  async ensureSegmentUpToDate(params: {
    symbol: string;
    layer: SegmentLayer;
    horizon: SegmentHorizon;
    forceRollover?: boolean;
    reason?: RolloverReason;
  }): Promise<RolloverResult> {
    const { symbol, layer, horizon, forceRollover, reason } = params;
    const nowTs = Math.floor(Date.now() / 1000);
    
    const active = await this.repo.getActive({ symbol, layer, horizon });
    
    // Determine if rollover needed
    let needsRollover = forceRollover ?? false;
    let rolloverReason: RolloverReason = reason ?? 'ROLLOVER_7D';
    
    if (!forceRollover) {
      if (horizon === '30D') {
        needsRollover = this.shouldRollover30D(active, nowTs);
        rolloverReason = active ? 'ROLLOVER_7D' : 'INITIAL';
      } else {
        needsRollover = this.shouldUpdate(active, horizon, nowTs);
        rolloverReason = active ? 'AUTO_PROMOTION' : 'INITIAL';
      }
    }
    
    if (!needsRollover) {
      return {
        changed: false,
        active,
        ghosted: null,
      };
    }
    
    // Get new verdict/prediction
    const verdict = await this.verdictProvider({ symbol, layer, horizon });
    
    if (!verdict) {
      console.warn(`[Rollover] No verdict available for ${symbol} ${layer} ${horizon}`);
      return {
        changed: false,
        active,
        ghosted: null,
      };
    }
    
    // Ghost the current active (if exists)
    let ghosted: ForecastSegment | null = null;
    if (active) {
      ghosted = await this.repo.markActiveAsGhost({
        symbol,
        layer,
        horizon,
        reason: rolloverReason,
      });
    }
    
    // Create new segment
    const startTs = nowTs;
    const horizonDays = horizon === '1D' ? 1 : horizon === '7D' ? 7 : 30;
    const endTs = nowTs + horizonDays * 24 * 60 * 60;
    
    const candles = generateTrajectory({
      startTs,
      endTs,
      fromPrice: verdict.anchorPrice,
      targetPrice: verdict.targetPrice,
      horizon,
    });
    
    const newSegment: ForecastSegment = {
      segmentId: `seg_${uuidv4()}`,
      symbol,
      layer,
      horizon,
      startTs,
      endTs,
      createdAtTs: nowTs,
      status: 'ACTIVE',
      reason: rolloverReason,
      fromPrice: verdict.anchorPrice,
      targetPrice: verdict.targetPrice,
      expectedMovePct: verdict.expectedReturnPct,
      candles,
      meta: {
        confidence: verdict.confidence,
        source: 'verdict-candidate',
        ...verdict.meta,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    await this.repo.insert(newSegment);
    
    console.log(`[Rollover] Created segment ${newSegment.segmentId} for ${symbol} ${layer} ${horizon} (${rolloverReason})`);
    
    // Prune old ghosts (keep 10)
    await this.repo.pruneGhosts({
      symbol,
      layer,
      horizon,
      keepCount: 10,
    });
    
    return {
      changed: true,
      active: newSegment,
      ghosted,
      reason: rolloverReason,
    };
  }
  
  /**
   * Force rollover (for manual/admin use).
   */
  async forceRollover(params: {
    symbol: string;
    layer: SegmentLayer;
    horizon: SegmentHorizon;
    reason: RolloverReason;
  }): Promise<RolloverResult> {
    return this.ensureSegmentUpToDate({
      ...params,
      forceRollover: true,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let rolloverInstance: SegmentRolloverService | null = null;

export function getSegmentRolloverService(
  db: Db,
  verdictProvider?: (params: {
    symbol: string;
    layer: SegmentLayer;
    horizon: SegmentHorizon;
  }) => Promise<VerdictCandidate | null>
): SegmentRolloverService {
  if (!rolloverInstance && verdictProvider) {
    rolloverInstance = new SegmentRolloverService(db, verdictProvider);
  }
  
  if (!rolloverInstance) {
    throw new Error('[Rollover] Service not initialized. Provide verdictProvider.');
  }
  
  return rolloverInstance;
}

/**
 * Initialize rollover service with verdict provider.
 */
export function initializeSegmentRolloverService(
  db: Db,
  verdictProvider: (params: {
    symbol: string;
    layer: SegmentLayer;
    horizon: SegmentHorizon;
  }) => Promise<VerdictCandidate | null>
): SegmentRolloverService {
  rolloverInstance = new SegmentRolloverService(db, verdictProvider);
  return rolloverInstance;
}

console.log('[Forecast] Segment Rollover Service loaded (BLOCK 4.2)');
