/**
 * MACRO SERIES REPOSITORY
 * 
 * Release-time safe data access layer
 * 
 * Key principle: ONLY use releasedAt for filtering, NOT periodEnd
 * This ensures no lookahead bias in backtests
 */

import { Db, Collection } from 'mongodb';

// ═══════════════════════════════════════════════════════════════
// CONTRACTS
// ═══════════════════════════════════════════════════════════════

export interface MacroSeriesPoint {
  seriesId: string;
  periodEnd: Date;
  value: number;
  releasedAt: Date;
  revisionId?: string;
  source?: string;
}

export interface MacroSeriesDoc {
  _id?: any;
  seriesId: string;
  periodEnd: Date;
  value: number;
  releasedAt: Date;
  revisionId?: string;
  source?: string;
  createdAt?: Date;
}

// ═══════════════════════════════════════════════════════════════
// REPOSITORY CLASS
// ═══════════════════════════════════════════════════════════════

export class MacroSeriesRepo {
  private collection: Collection<MacroSeriesDoc>;
  
  constructor(db: Db) {
    this.collection = db.collection('macro_series');
  }
  
  /**
   * Get the latest available value as of a specific date
   * 
   * CRITICAL: Uses releasedAt, NOT periodEnd
   * This ensures no lookahead bias
   */
  async getLatestAvailableValue(
    seriesId: string,
    asOf: Date
  ): Promise<MacroSeriesPoint | null> {
    const doc = await this.collection.findOne(
      {
        seriesId,
        releasedAt: { $lte: asOf },
      },
      {
        sort: { releasedAt: -1 },
        projection: { _id: 0 },
      }
    );
    
    if (!doc) return null;
    
    return {
      seriesId: doc.seriesId,
      periodEnd: doc.periodEnd,
      value: doc.value,
      releasedAt: doc.releasedAt,
      revisionId: doc.revisionId,
      source: doc.source,
    };
  }
  
  /**
   * Get historical window of values available as of a date
   * 
   * Returns values in chronological order (oldest first)
   */
  async getWindow(
    seriesId: string,
    asOf: Date,
    windowSize: number
  ): Promise<MacroSeriesPoint[]> {
    const docs = await this.collection
      .find(
        {
          seriesId,
          releasedAt: { $lte: asOf },
        },
        {
          sort: { releasedAt: -1 },
          limit: windowSize,
          projection: { _id: 0 },
        }
      )
      .toArray();
    
    // Reverse to chronological order
    return docs.reverse().map(doc => ({
      seriesId: doc.seriesId,
      periodEnd: doc.periodEnd,
      value: doc.value,
      releasedAt: doc.releasedAt,
      revisionId: doc.revisionId,
      source: doc.source,
    }));
  }
  
  /**
   * Get value for a specific period, considering revisions
   * 
   * If multiple revisions exist for same periodEnd,
   * returns the latest revision released before asOf
   */
  async getValueForPeriod(
    seriesId: string,
    periodEnd: Date,
    asOf: Date
  ): Promise<MacroSeriesPoint | null> {
    const doc = await this.collection.findOne(
      {
        seriesId,
        periodEnd,
        releasedAt: { $lte: asOf },
      },
      {
        sort: { releasedAt: -1 }, // Latest revision first
        projection: { _id: 0 },
      }
    );
    
    if (!doc) return null;
    
    return {
      seriesId: doc.seriesId,
      periodEnd: doc.periodEnd,
      value: doc.value,
      releasedAt: doc.releasedAt,
      revisionId: doc.revisionId,
      source: doc.source,
    };
  }
  
  /**
   * Insert a new data point (with revision support)
   */
  async insert(point: MacroSeriesPoint): Promise<void> {
    await this.collection.insertOne({
      ...point,
      createdAt: new Date(),
    });
  }
  
  /**
   * Ensure indexes for efficient queries
   */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { seriesId: 1, releasedAt: -1 },
      { name: 'seriesId_releasedAt' }
    );
    await this.collection.createIndex(
      { seriesId: 1, periodEnd: 1, releasedAt: -1 },
      { name: 'seriesId_periodEnd_releasedAt' }
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON FACTORY
// ═══════════════════════════════════════════════════════════════

let _repoInstance: MacroSeriesRepo | null = null;

export function getMacroSeriesRepo(db: Db): MacroSeriesRepo {
  if (!_repoInstance) {
    _repoInstance = new MacroSeriesRepo(db);
  }
  return _repoInstance;
}

export default MacroSeriesRepo;
