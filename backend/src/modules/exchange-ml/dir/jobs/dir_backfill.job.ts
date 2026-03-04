/**
 * Direction Backfill Job
 * ======================
 * 
 * Backfills historical direction samples for training.
 * Creates samples with features at t0 and resolves them with realized returns.
 */

import { Db, Collection } from 'mongodb';
import { Horizon, DirLabel, DirFeatureSnapshot } from '../../contracts/exchange.types.js';
import { labelDirection } from '../dir.labeler.js';
import { buildDirFeatures, DirFeatureDeps } from '../dir.feature-extractor.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface BackfillProgress {
  total: number;
  processed: number;
  created: number;
  skipped: number;
  errors: number;
  currentDate?: string;
}

export interface BackfillResult {
  success: boolean;
  symbol: string;
  horizons: Horizon[];
  days: number;
  samples: {
    created: number;
    skipped: number;
    errors: number;
  };
  duration: number;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// HORIZON CONFIG
// ═══════════════════════════════════════════════════════════════

const HORIZON_DAYS: Record<Horizon, number> = {
  '1D': 1,
  '7D': 7,
  '30D': 30,
};

// ═══════════════════════════════════════════════════════════════
// BACKFILL SERVICE
// ═══════════════════════════════════════════════════════════════

export class DirBackfillService {
  private collection: Collection;
  
  constructor(
    private db: Db,
    private featureDeps: DirFeatureDeps
  ) {
    this.collection = db.collection('exch_dir_samples');
  }
  
  /**
   * Backfill samples for a symbol and date range
   */
  async backfill(params: {
    symbol: string;
    fromTs: number;  // unix seconds
    toTs: number;    // unix seconds
    horizons?: Horizon[];
    onProgress?: (progress: BackfillProgress) => void;
  }): Promise<BackfillResult> {
    const startTime = Date.now();
    const { symbol, fromTs, toTs, horizons = ['1D', '7D', '30D'], onProgress } = params;
    
    console.log(`[DirBackfill] Starting backfill for ${symbol}`);
    console.log(`[DirBackfill] Date range: ${new Date(fromTs * 1000).toISOString()} to ${new Date(toTs * 1000).toISOString()}`);
    console.log(`[DirBackfill] Horizons: ${horizons.join(', ')}`);
    
    const totalDays = Math.floor((toTs - fromTs) / 86400);
    const totalSamples = totalDays * horizons.length;
    
    const progress: BackfillProgress = {
      total: totalSamples,
      processed: 0,
      created: 0,
      skipped: 0,
      errors: 0,
    };
    
    try {
      // Process day by day
      for (let t = fromTs; t <= toTs - 86400; t += 86400) {
        const dateStr = new Date(t * 1000).toISOString().split('T')[0];
        progress.currentDate = dateStr;
        
        for (const horizon of horizons) {
          try {
            const result = await this.createSample({
              symbol,
              t,
              horizon,
            });
            
            if (result.created) {
              progress.created++;
            } else {
              progress.skipped++;
            }
          } catch (err) {
            progress.errors++;
            console.error(`[DirBackfill] Error at ${dateStr} ${horizon}:`, err);
          }
          
          progress.processed++;
        }
        
        // Report progress every 10 days
        if (progress.processed % (horizons.length * 10) === 0 && onProgress) {
          onProgress({ ...progress });
        }
      }
      
      const duration = Date.now() - startTime;
      
      console.log(`[DirBackfill] Completed: ${progress.created} created, ${progress.skipped} skipped, ${progress.errors} errors`);
      console.log(`[DirBackfill] Duration: ${(duration / 1000).toFixed(1)}s`);
      
      return {
        success: true,
        symbol,
        horizons,
        days: totalDays,
        samples: {
          created: progress.created,
          skipped: progress.skipped,
          errors: progress.errors,
        },
        duration,
      };
      
    } catch (err: any) {
      return {
        success: false,
        symbol,
        horizons,
        days: totalDays,
        samples: {
          created: progress.created,
          skipped: progress.skipped,
          errors: progress.errors,
        },
        duration: Date.now() - startTime,
        error: err.message,
      };
    }
  }
  
  /**
   * Create a single sample with features and label
   */
  private async createSample(params: {
    symbol: string;
    t: number;
    horizon: Horizon;
  }): Promise<{ created: boolean }> {
    const { symbol, t, horizon } = params;
    
    // Check if sample already exists
    const existing = await this.collection.findOne({
      symbol: symbol.toUpperCase(),
      horizon,
      t0: new Date(t * 1000),
    });
    
    if (existing) {
      return { created: false };
    }
    
    // Build features at t0
    const features = await buildDirFeatures(this.featureDeps, {
      symbol,
      t,
      horizon,
    });
    
    // Get entry price (close at t0)
    const entryBars = await this.featureDeps.price.getSeries({
      symbol,
      from: t - 86400,
      to: t + 86400,
      tf: '1d',
    });
    
    const entryBar = entryBars.find(b => b.t >= t) || entryBars[entryBars.length - 1];
    const entryPrice = entryBar?.close ?? 0;
    
    if (entryPrice <= 0) {
      throw new Error('No entry price available');
    }
    
    // Get exit price (close at t0 + horizon)
    const horizonDays = HORIZON_DAYS[horizon];
    const exitTs = t + horizonDays * 86400;
    
    const exitBars = await this.featureDeps.price.getSeries({
      symbol,
      from: exitTs - 86400,
      to: exitTs + 86400,
      tf: '1d',
    });
    
    const exitBar = exitBars.find(b => b.t >= exitTs) || exitBars[exitBars.length - 1];
    const exitPrice = exitBar?.close ?? 0;
    
    // Calculate return and label
    let label: DirLabel = 'NEUTRAL';
    let returnPct: number | null = null;
    let status = 'PENDING';
    
    if (exitPrice > 0) {
      returnPct = (exitPrice / entryPrice) - 1;
      // Use ATR-adjusted labeling with atrN from features
      const atrPct = features.atrN ?? 0.02; // Default 2% if not available
      label = labelDirection({ horizon, realizedReturn: returnPct, atrPct });
      status = 'RESOLVED';
    }
    
    // Insert sample
    await this.collection.insertOne({
      symbol: symbol.toUpperCase(),
      horizon,
      t0: new Date(t * 1000),
      features,
      featureVersion: 'dir_v2.1.0', // v2.1: Added EMA cross, VWAP, volume spike
      entryPrice,
      exitPrice: exitPrice > 0 ? exitPrice : null,
      returnPct,
      label: status === 'RESOLVED' ? label : null,
      status,
      resolveAt: new Date(exitTs * 1000),
      resolvedAt: status === 'RESOLVED' ? new Date() : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    
    return { created: true };
  }
  
  /**
   * Get backfill statistics
   */
  async getStats(): Promise<{
    total: number;
    byHorizon: Record<Horizon, number>;
    byLabel: Record<DirLabel | 'PENDING', number>;
    resolved: number;
    pending: number;
  }> {
    const pipeline = [
      {
        $facet: {
          total: [{ $count: 'count' }],
          byHorizon: [{ $group: { _id: '$horizon', count: { $sum: 1 } } }],
          byLabel: [{ $group: { _id: { $ifNull: ['$label', 'PENDING'] }, count: { $sum: 1 } } }],
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        },
      },
    ];
    
    const [result] = await this.collection.aggregate(pipeline).toArray();
    
    const byHorizon: Record<Horizon, number> = { '1D': 0, '7D': 0, '30D': 0 };
    for (const item of result.byHorizon) {
      byHorizon[item._id as Horizon] = item.count;
    }
    
    const byLabel: Record<DirLabel | 'PENDING', number> = {
      UP: 0, DOWN: 0, NEUTRAL: 0, PENDING: 0,
    };
    for (const item of result.byLabel) {
      byLabel[item._id as any] = item.count;
    }
    
    let resolved = 0;
    let pending = 0;
    for (const item of result.byStatus) {
      if (item._id === 'RESOLVED') resolved = item.count;
      if (item._id === 'PENDING') pending = item.count;
    }
    
    return {
      total: result.total[0]?.count || 0,
      byHorizon,
      byLabel,
      resolved,
      pending,
    };
  }
}

console.log('[Exchange ML] Direction backfill job loaded');
