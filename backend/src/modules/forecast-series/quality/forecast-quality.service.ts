/**
 * FORECAST QUALITY SERVICE
 * ========================
 * 
 * V3.5: Model Quality Badge
 * V3.6: Rolling Quality
 * 
 * Calculates forecast performance statistics:
 * - Historical win rate
 * - Rolling win rate (configurable window)
 * - Quality state (GOOD/NEUTRAL/WEAK)
 */

import type { Db, Collection } from 'mongodb';
import type { 
  ForecastLayer, 
  ForecastHorizon,
  ForecastOutcome 
} from '../outcome-tracking/forecast-snapshot.types.js';

export type QualityState = 'GOOD' | 'NEUTRAL' | 'WEAK';

export interface QualityParams {
  symbol: string;
  layer: ForecastLayer;
  horizon: ForecastHorizon;
  window?: number; // Rolling window size (default: 30)
}

export interface QualityResult {
  symbol: string;
  layer: ForecastLayer;
  horizon: ForecastHorizon;
  
  // Counts
  total: number;
  wins: number;
  losses: number;
  
  // Rates
  winRate: number;           // 0..1 (historical)
  rollingWinRate: number;    // 0..1 (last N outcomes)
  
  // Sample counts for diagnostics
  sampleCount: number;
  rollingSampleCount: number;
  
  // Quality assessment
  qualityState: QualityState;
  
  // Metadata
  windowSize: number;
  calculatedAt: Date;
}

const COLLECTION_NAME = 'forecast_outcomes';

export class ForecastQualityService {
  private collection: Collection<ForecastOutcome>;

  constructor(private db: Db) {
    this.collection = db.collection(COLLECTION_NAME);
  }

  /**
   * Get quality metrics for a symbol/layer/horizon
   */
  async getQuality(params: QualityParams): Promise<QualityResult> {
    const { symbol, layer, horizon, window = 30 } = params;

    // Fetch all resolved outcomes sorted by time
    const allOutcomes = await this.collection
      .find({ 
        symbol, 
        layer, 
        horizon, 
        result: { $in: ['WIN', 'LOSS'] } 
      })
      .sort({ resolvedAt: 1 })
      .toArray();

    const total = allOutcomes.length;
    const wins = allOutcomes.filter(o => o.result === 'WIN').length;
    const losses = total - wins;
    const winRate = total > 0 ? wins / total : 0;

    // Rolling window (last N outcomes)
    const recent = allOutcomes.slice(-window);
    const rollingWins = recent.filter(o => o.result === 'WIN').length;
    const rollingTotal = recent.length;
    const rollingWinRate = rollingTotal > 0 ? rollingWins / rollingTotal : 0;

    // Determine quality state based on winRate
    const qualityState = this.getQualityState(winRate);

    return {
      symbol,
      layer,
      horizon,
      total,
      wins,
      losses,
      winRate,
      rollingWinRate,
      sampleCount: total,
      rollingSampleCount: rollingTotal,
      qualityState,
      windowSize: window,
      calculatedAt: new Date(),
    };
  }

  /**
   * Determine quality state from win rate
   * 
   * - GOOD: >= 60%
   * - NEUTRAL: 50-60%
   * - WEAK: < 50%
   */
  private getQualityState(winRate: number): QualityState {
    if (winRate >= 0.6) return 'GOOD';
    if (winRate >= 0.5) return 'NEUTRAL';
    return 'WEAK';
  }
}

// Singleton instance
let serviceInstance: ForecastQualityService | null = null;

export function getForecastQualityService(db: Db): ForecastQualityService {
  if (!serviceInstance) {
    serviceInstance = new ForecastQualityService(db);
  }
  return serviceInstance;
}

console.log('[ForecastQualityService] V3.5 Quality Service loaded');
