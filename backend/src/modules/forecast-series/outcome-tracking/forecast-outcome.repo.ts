/**
 * FORECAST OUTCOME REPOSITORY
 * ===========================
 * 
 * V3.4: Outcome Tracking - Outcome records
 * 
 * Stores resolved outcomes for fast querying and UI display
 */

import type { Db, Collection, WithId } from 'mongodb';
import type { 
  ForecastOutcome, 
  ForecastLayer, 
  ForecastHorizon,
  EvaluationResult,
  OutcomeStats 
} from './forecast-snapshot.types.js';

const COLLECTION_NAME = 'forecast_outcomes';

export class ForecastOutcomeRepo {
  private collection: Collection<ForecastOutcome>;

  constructor(db: Db) {
    this.collection = db.collection(COLLECTION_NAME);
    this.ensureIndexes().catch(err => {
      console.error('[ForecastOutcomeRepo] Index creation failed:', err.message);
    });
  }

  private async ensureIndexes(): Promise<void> {
    try {
      // Index for queries by symbol + layer + horizon
      await this.collection.createIndex(
        { symbol: 1, layer: 1, horizon: 1, resolvedAt: -1 },
        { name: 'symbol_layer_horizon_idx' }
      );
      
      // Index for time-range queries
      await this.collection.createIndex(
        { resolvedAt: -1 },
        { name: 'resolved_at_idx' }
      );
      
      // Index for win/loss filtering
      await this.collection.createIndex(
        { symbol: 1, result: 1 },
        { name: 'symbol_result_idx' }
      );
      
      // Unique constraint on snapshotId
      await this.collection.createIndex(
        { snapshotId: 1 },
        { name: 'snapshot_id_unique_idx', unique: true }
      );
      
      console.log('[ForecastOutcomeRepo] Indexes ensured');
    } catch (err) {
      console.error('[ForecastOutcomeRepo] Index error:', err);
    }
  }

  /**
   * Create a new outcome record
   */
  async create(outcome: Omit<ForecastOutcome, '_id'>): Promise<string> {
    const result = await this.collection.insertOne(outcome as ForecastOutcome);
    return result.insertedId.toString();
  }

  /**
   * Check if outcome already exists for snapshot
   */
  async existsForSnapshot(snapshotId: string): Promise<boolean> {
    const count = await this.collection.countDocuments({ snapshotId });
    return count > 0;
  }

  /**
   * Get recent outcomes for display on chart
   */
  async getRecent(
    symbol: string,
    layer: ForecastLayer,
    horizon: ForecastHorizon,
    limit: number = 50
  ): Promise<ForecastOutcome[]> {
    const docs = await this.collection
      .find({ symbol, layer, horizon })
      .sort({ resolvedAt: -1 })
      .limit(limit)
      .toArray();
    
    return docs.map(doc => this.serialize(doc));
  }

  /**
   * Get all outcomes for a symbol (across all layers/horizons)
   */
  async getForSymbol(
    symbol: string,
    options?: {
      layer?: ForecastLayer;
      horizon?: ForecastHorizon;
      since?: Date;
      limit?: number;
    }
  ): Promise<ForecastOutcome[]> {
    const query: any = { symbol };
    
    if (options?.layer) query.layer = options.layer;
    if (options?.horizon) query.horizon = options.horizon;
    if (options?.since) query.resolvedAt = { $gte: options.since };
    
    const docs = await this.collection
      .find(query)
      .sort({ resolvedAt: -1 })
      .limit(options?.limit || 100)
      .toArray();
    
    return docs.map(doc => this.serialize(doc));
  }

  /**
   * Calculate outcome statistics
   */
  async getStats(
    symbol: string,
    layer: ForecastLayer,
    horizon: ForecastHorizon
  ): Promise<OutcomeStats> {
    const pipeline = [
      { $match: { symbol, layer, horizon } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          wins: { $sum: { $cond: [{ $eq: ['$result', 'WIN'] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $eq: ['$result', 'LOSS'] }, 1, 0] } },
          draws: { $sum: { $cond: [{ $eq: ['$result', 'DRAW'] }, 1, 0] } },
          directionCorrect: { $sum: { $cond: ['$directionCorrect', 1, 0] } },
          avgDeviation: { $avg: '$deviation' },
          maxDeviation: { $max: '$deviation' },
          avgConfidence: { $avg: '$confidence' },
        },
      },
    ];
    
    const results = await this.collection.aggregate(pipeline).toArray();
    
    // Get last 10 outcomes for streak
    const recentDocs = await this.collection
      .find({ symbol, layer, horizon })
      .sort({ resolvedAt: -1 })
      .limit(10)
      .toArray();
    
    const lastOutcomes = recentDocs.map(d => d.result);
    
    // Calculate streak
    let streak = { type: 'NONE' as const, count: 0 };
    if (lastOutcomes.length > 0) {
      const firstResult = lastOutcomes[0];
      if (firstResult === 'WIN' || firstResult === 'LOSS') {
        let count = 0;
        for (const r of lastOutcomes) {
          if (r === firstResult) count++;
          else break;
        }
        streak = { type: firstResult, count };
      }
    }
    
    if (results.length === 0) {
      return {
        symbol,
        layer,
        horizon,
        total: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0,
        directionAccuracy: 0,
        avgDeviation: 0,
        maxDeviation: 0,
        avgConfidence: 0,
        calibrationScore: 0,
        lastOutcomes,
        streak,
      };
    }
    
    const r = results[0];
    const total = r.total || 0;
    const wins = r.wins || 0;
    const winRate = total > 0 ? wins / total : 0;
    const directionAccuracy = total > 0 ? (r.directionCorrect || 0) / total : 0;
    const avgConfidence = r.avgConfidence || 0;
    
    // Calibration score: how well confidence predicts win rate
    // Perfect calibration = |confidence - winRate| = 0, score = 100
    const calibrationError = Math.abs(avgConfidence - winRate);
    const calibrationScore = Math.max(0, 100 - calibrationError * 200);
    
    return {
      symbol,
      layer,
      horizon,
      total,
      wins,
      losses: r.losses || 0,
      draws: r.draws || 0,
      winRate,
      directionAccuracy,
      avgDeviation: r.avgDeviation || 0,
      maxDeviation: r.maxDeviation || 0,
      avgConfidence,
      calibrationScore,
      lastOutcomes,
      streak,
    };
  }

  /**
   * Get outcomes for chart markers (time-indexed)
   */
  async getForChart(
    symbol: string,
    layer: ForecastLayer,
    horizon: ForecastHorizon,
    limit: number = 30
  ): Promise<Array<{
    time: number;
    result: EvaluationResult;
    targetPrice: number;
    realPrice: number;
    deviation: number;
  }>> {
    const docs = await this.collection
      .find({ symbol, layer, horizon })
      .sort({ resolvedAt: -1 })
      .limit(limit)
      .toArray();
    
    return docs.map(d => ({
      time: Math.floor(d.resolvedAt.getTime() / 1000),
      result: d.result,
      targetPrice: d.targetPrice,
      realPrice: d.realPrice,
      deviation: d.deviation,
    }));
  }

  /**
   * Convert MongoDB doc to plain object
   */
  private serialize(doc: WithId<ForecastOutcome>): ForecastOutcome {
    const { _id, ...rest } = doc;
    return {
      _id: _id.toString(),
      ...rest,
    };
  }
}

// Singleton instance
let repoInstance: ForecastOutcomeRepo | null = null;

export function getForecastOutcomeRepo(db: Db): ForecastOutcomeRepo {
  if (!repoInstance) {
    repoInstance = new ForecastOutcomeRepo(db);
  }
  return repoInstance;
}

console.log('[ForecastOutcomeRepo] V3.4 Repository loaded');
