/**
 * FORECAST SERIES REPOSITORY
 * ==========================
 * 
 * BLOCK F1: Forecast Persistence Layer
 * 
 * MongoDB storage for forecast points.
 * Append-only design - points are never updated.
 * Unique constraint: (symbol, model, horizon, createdDay)
 */

import type { Collection, Db } from 'mongodb';
import type { 
  ForecastPoint, 
  ForecastModelKey, 
  ForecastHorizon 
} from './forecast-series.types.js';

export class ForecastSeriesRepo {
  private col: Collection<ForecastPoint>;
  private initialized = false;

  constructor(private db: Db) {
    this.col = db.collection<ForecastPoint>('forecast_series');
  }

  /**
   * Ensure indexes exist (idempotent)
   */
  async ensureIndexes(): Promise<void> {
    if (this.initialized) return;
    
    // Unique index for deduplication: one point per (symbol, model, horizon, day)
    await this.col.createIndex(
      { symbol: 1, model: 1, horizon: 1, createdDay: 1 }, 
      { unique: true, background: true }
    );
    
    // Query index for time-range queries
    await this.col.createIndex(
      { createdAtIso: -1 }, 
      { background: true }
    );
    
    // Query index for symbol+model+horizon lookups
    await this.col.createIndex(
      { symbol: 1, model: 1, horizon: 1, createdAtIso: 1 }, 
      { background: true }
    );
    
    this.initialized = true;
    console.log('[ForecastSeriesRepo] Indexes ensured');
  }

  /**
   * Insert a new forecast point (append-only)
   * Uses $setOnInsert to never overwrite existing data
   */
  async upsertPoint(point: ForecastPoint): Promise<{ inserted: boolean }> {
    const result = await this.col.updateOne(
      { 
        symbol: point.symbol, 
        model: point.model, 
        horizon: point.horizon, 
        createdDay: point.createdDay 
      },
      { $setOnInsert: point },
      { upsert: true }
    );
    
    return { inserted: result.upsertedCount > 0 };
  }

  /**
   * List forecast points for a symbol/model/horizon combination
   */
  async listPoints(params: {
    symbol: string;
    model: ForecastModelKey;
    horizon: ForecastHorizon;
    fromIso?: string;
    toIso?: string;
    limit?: number;
  }): Promise<ForecastPoint[]> {
    const query: Record<string, unknown> = { 
      symbol: params.symbol, 
      model: params.model, 
      horizon: params.horizon 
    };
    
    // Optional time range filter
    if (params.fromIso || params.toIso) {
      query.createdAtIso = {};
      if (params.fromIso) (query.createdAtIso as Record<string, string>).$gte = params.fromIso;
      if (params.toIso) (query.createdAtIso as Record<string, string>).$lte = params.toIso;
    }

    const limit = Math.min(params.limit ?? 500, 2000);

    return this.col
      .find(query)
      .sort({ createdAtIso: 1 })  // Chronological order
      .limit(limit)
      .toArray();
  }

  /**
   * Get the most recent forecast point
   */
  async latestPoint(params: { 
    symbol: string; 
    model: ForecastModelKey; 
    horizon: ForecastHorizon 
  }): Promise<ForecastPoint | null> {
    return this.col
      .find({ 
        symbol: params.symbol, 
        model: params.model, 
        horizon: params.horizon 
      })
      .sort({ createdAtIso: -1 })
      .limit(1)
      .next();
  }

  /**
   * Count total points (for monitoring)
   */
  async countPoints(params?: { 
    symbol?: string; 
    model?: ForecastModelKey; 
    horizon?: ForecastHorizon 
  }): Promise<number> {
    const query: Record<string, unknown> = {};
    if (params?.symbol) query.symbol = params.symbol;
    if (params?.model) query.model = params.model;
    if (params?.horizon) query.horizon = params.horizon;
    
    return this.col.countDocuments(query);
  }

  /**
   * Get distinct symbols with forecast data
   */
  async getDistinctSymbols(): Promise<string[]> {
    return this.col.distinct('symbol');
  }
}

// Singleton instance (initialized lazily)
let repoInstance: ForecastSeriesRepo | null = null;

export function getForecastSeriesRepo(db: Db): ForecastSeriesRepo {
  if (!repoInstance) {
    repoInstance = new ForecastSeriesRepo(db);
  }
  return repoInstance;
}

console.log('[ForecastSeriesRepo] Module loaded (Block F1)');
