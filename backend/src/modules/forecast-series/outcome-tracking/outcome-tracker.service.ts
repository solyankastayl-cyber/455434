/**
 * OUTCOME TRACKER SERVICE
 * =======================
 * 
 * V3.4: Outcome Tracking - Business logic
 * 
 * Responsibilities:
 * 1. Create snapshots when forecasts are generated
 * 2. Check pending snapshots for resolution
 * 3. Determine WIN/LOSS based on real price vs target
 * 4. Create outcome records
 */

import type { Db } from 'mongodb';
import type { 
  ForecastSnapshot,
  ForecastOutcome,
  ForecastLayer, 
  ForecastHorizon,
  EvaluationResult 
} from './forecast-snapshot.types.js';
import { ForecastSnapshotRepo, getForecastSnapshotRepo } from './forecast-snapshot.repo.js';
import { ForecastOutcomeRepo, getForecastOutcomeRepo } from './forecast-outcome.repo.js';

// Price provider interface - to be injected
export type PriceProvider = {
  getCurrentPrice: (symbol: string) => Promise<number | null>;
  getHistoricalPrice: (symbol: string, timestamp: Date) => Promise<number | null>;
};

// Result threshold: within X% of target = WIN
const WIN_THRESHOLD_PCT = 0.02; // 2% tolerance
const DRAW_THRESHOLD_PCT = 0.01; // 1% = DRAW if direction correct

export class OutcomeTrackerService {
  private snapshotRepo: ForecastSnapshotRepo;
  private outcomeRepo: ForecastOutcomeRepo;
  private priceProvider: PriceProvider;

  constructor(db: Db, priceProvider: PriceProvider) {
    this.snapshotRepo = getForecastSnapshotRepo(db);
    this.outcomeRepo = getForecastOutcomeRepo(db);
    this.priceProvider = priceProvider;
  }

  /**
   * Create a new forecast snapshot
   * Called when a forecast is generated
   */
  async createSnapshot(params: {
    symbol: string;
    layer: ForecastLayer;
    horizon: ForecastHorizon;
    startPrice: number;
    targetPrice: number;
    expectedMovePct: number;
    direction: 'UP' | 'DOWN' | 'FLAT';
    confidence: number;
    metadata?: {
      verdictId?: string;
      source?: string;
    };
  }): Promise<string> {
    // Check if snapshot already exists today
    const exists = await this.snapshotRepo.existsToday(
      params.symbol,
      params.layer,
      params.horizon
    );
    
    if (exists) {
      console.log(`[OutcomeTracker] Snapshot already exists for ${params.symbol}/${params.layer}/${params.horizon} today`);
      return 'EXISTS';
    }
    
    const now = new Date();
    const resolveAt = this.calculateResolveTime(now, params.horizon);
    
    const snapshot: Omit<ForecastSnapshot, '_id'> = {
      symbol: params.symbol,
      layer: params.layer,
      horizon: params.horizon,
      createdAt: now,
      resolveAt,
      startPrice: params.startPrice,
      targetPrice: params.targetPrice,
      expectedMovePct: params.expectedMovePct,
      direction: params.direction,
      confidence: params.confidence,
      evaluation: {
        status: 'PENDING',
      },
      metadata: params.metadata,
    };
    
    const id = await this.snapshotRepo.create(snapshot);
    console.log(`[OutcomeTracker] Created snapshot ${id} for ${params.symbol}/${params.layer}/${params.horizon}`);
    
    return id;
  }

  /**
   * Process all pending snapshots that are ready for resolution
   */
  async processPendingSnapshots(): Promise<{
    processed: number;
    wins: number;
    losses: number;
    errors: number;
  }> {
    const pending = await this.snapshotRepo.getPendingToResolve(100);
    
    console.log(`[OutcomeTracker] Processing ${pending.length} pending snapshots`);
    
    let wins = 0;
    let losses = 0;
    let errors = 0;
    
    for (const snapshot of pending) {
      try {
        const result = await this.resolveSnapshot(snapshot);
        if (result === 'WIN') wins++;
        else if (result === 'LOSS') losses++;
      } catch (err: any) {
        console.error(`[OutcomeTracker] Error resolving snapshot ${snapshot._id}:`, err.message);
        errors++;
      }
    }
    
    return {
      processed: pending.length,
      wins,
      losses,
      errors,
    };
  }

  /**
   * Resolve a single snapshot
   */
  private async resolveSnapshot(snapshot: ForecastSnapshot): Promise<EvaluationResult> {
    if (!snapshot._id) {
      throw new Error('Snapshot has no ID');
    }
    
    // Check if already has outcome
    const hasOutcome = await this.outcomeRepo.existsForSnapshot(snapshot._id);
    if (hasOutcome) {
      console.log(`[OutcomeTracker] Outcome already exists for snapshot ${snapshot._id}`);
      return 'DRAW';
    }
    
    // Get real price at resolve time
    const realPrice = await this.priceProvider.getHistoricalPrice(
      snapshot.symbol,
      snapshot.resolveAt
    );
    
    if (!realPrice) {
      // Try current price if historical not available
      const currentPrice = await this.priceProvider.getCurrentPrice(snapshot.symbol);
      if (!currentPrice) {
        throw new Error(`Cannot get price for ${snapshot.symbol}`);
      }
      
      // Use current price (snapshot.resolveAt has passed)
      return this.evaluateAndSave(snapshot, currentPrice);
    }
    
    return this.evaluateAndSave(snapshot, realPrice);
  }

  /**
   * Evaluate result and save to both collections
   */
  private async evaluateAndSave(
    snapshot: ForecastSnapshot,
    realPrice: number
  ): Promise<EvaluationResult> {
    const result = this.determineResult(snapshot, realPrice);
    const deviation = this.calculateDeviation(snapshot.targetPrice, realPrice);
    const directionCorrect = this.isDirectionCorrect(snapshot, realPrice);
    
    // Update snapshot
    await this.snapshotRepo.resolve(snapshot._id!, {
      realPrice,
      result,
      deviation,
    });
    
    // Create outcome record
    const outcome: Omit<ForecastOutcome, '_id'> = {
      snapshotId: snapshot._id!,
      symbol: snapshot.symbol,
      layer: snapshot.layer,
      horizon: snapshot.horizon,
      createdAt: snapshot.createdAt,
      resolvedAt: new Date(),
      startPrice: snapshot.startPrice,
      targetPrice: snapshot.targetPrice,
      realPrice,
      result,
      directionCorrect,
      deviation,
      confidence: snapshot.confidence,
    };
    
    await this.outcomeRepo.create(outcome);
    
    console.log(`[OutcomeTracker] Resolved ${snapshot.symbol}/${snapshot.layer}/${snapshot.horizon}: ${result} (deviation: ${(deviation * 100).toFixed(2)}%)`);
    
    return result;
  }

  /**
   * Determine WIN/LOSS/DRAW
   * 
   * Rules:
   * - WIN: Real price within WIN_THRESHOLD of target AND direction correct
   * - LOSS: Direction wrong OR deviation > WIN_THRESHOLD
   * - DRAW: Direction correct but outside threshold
   */
  private determineResult(snapshot: ForecastSnapshot, realPrice: number): EvaluationResult {
    const directionCorrect = this.isDirectionCorrect(snapshot, realPrice);
    const deviation = this.calculateDeviation(snapshot.targetPrice, realPrice);
    
    // If direction is wrong, it's a LOSS
    if (!directionCorrect) {
      return 'LOSS';
    }
    
    // Direction correct, check if within threshold
    if (deviation <= WIN_THRESHOLD_PCT) {
      return 'WIN';
    }
    
    // Direction correct but missed target significantly
    return 'LOSS';
  }

  /**
   * Check if price moved in predicted direction
   */
  private isDirectionCorrect(snapshot: ForecastSnapshot, realPrice: number): boolean {
    if (snapshot.direction === 'FLAT') {
      // FLAT = price within 1% of start
      const pctMove = Math.abs(realPrice - snapshot.startPrice) / snapshot.startPrice;
      return pctMove <= DRAW_THRESHOLD_PCT;
    }
    
    if (snapshot.direction === 'UP') {
      return realPrice > snapshot.startPrice;
    }
    
    // DOWN
    return realPrice < snapshot.startPrice;
  }

  /**
   * Calculate % deviation from target
   */
  private calculateDeviation(target: number, actual: number): number {
    return Math.abs(target - actual) / target;
  }

  /**
   * Calculate when to resolve based on horizon
   */
  private calculateResolveTime(from: Date, horizon: ForecastHorizon): Date {
    const ms: Record<ForecastHorizon, number> = {
      '1D': 24 * 60 * 60 * 1000,
      '7D': 7 * 24 * 60 * 60 * 1000,
      '30D': 30 * 24 * 60 * 60 * 1000,
    };
    
    return new Date(from.getTime() + ms[horizon]);
  }

  /**
   * Get outcome statistics
   */
  async getStats(symbol: string, layer: ForecastLayer, horizon: ForecastHorizon) {
    return this.outcomeRepo.getStats(symbol, layer, horizon);
  }

  /**
   * Get outcomes for chart display
   */
  async getOutcomesForChart(
    symbol: string,
    layer: ForecastLayer,
    horizon: ForecastHorizon,
    limit: number = 30
  ) {
    return this.outcomeRepo.getForChart(symbol, layer, horizon, limit);
  }

  /**
   * Get recent outcomes
   */
  async getRecentOutcomes(
    symbol: string,
    layer: ForecastLayer,
    horizon: ForecastHorizon,
    limit: number = 50
  ) {
    return this.outcomeRepo.getRecent(symbol, layer, horizon, limit);
  }
}

// Singleton instance
let serviceInstance: OutcomeTrackerService | null = null;

export function getOutcomeTrackerService(
  db: Db,
  priceProvider: PriceProvider
): OutcomeTrackerService {
  if (!serviceInstance) {
    serviceInstance = new OutcomeTrackerService(db, priceProvider);
  }
  return serviceInstance;
}

console.log('[OutcomeTrackerService] V3.4 Service loaded');
