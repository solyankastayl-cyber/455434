/**
 * FORECAST DRIFT SERVICE
 * ======================
 * 
 * V3.7: Drift Detector
 * 
 * Monitors model degradation by comparing:
 * - Historical win rate (long-term performance)
 * - Rolling win rate (recent performance)
 * 
 * Drift = historicalWinRate - rollingWinRate
 * 
 * State determination:
 * - HEALTHY: rolling >= historical (no degradation)
 * - DEGRADING: drift > 5% (warning)
 * - CRITICAL: drift > 10% (severe degradation)
 */

import type { Db } from 'mongodb';
import type { 
  ForecastLayer, 
  ForecastHorizon 
} from '../outcome-tracking/forecast-snapshot.types.js';
import { 
  ForecastQualityService, 
  getForecastQualityService 
} from './forecast-quality.service.js';

export type DriftState = 'HEALTHY' | 'DEGRADING' | 'CRITICAL';

export interface DriftParams {
  symbol: string;
  layer: ForecastLayer;
  horizon: ForecastHorizon;
  window?: number;
  degradingThreshold?: number; // Default: 0.05 (5%)
  criticalThreshold?: number;  // Default: 0.10 (10%)
  minSamples?: number;         // Minimum samples for reliable drift (default: 20)
}

export interface DriftResult {
  symbol: string;
  layer: ForecastLayer;
  horizon: ForecastHorizon;
  
  // Win rates
  historicalWinRate: number;  // 0..1
  rollingWinRate: number;     // 0..1
  
  // Drift calculation
  drift: number;              // historical - rolling (positive = degradation)
  
  // State assessment
  state: DriftState;
  
  // Configuration used
  thresholds: {
    degrading: number;
    critical: number;
    window: number;
    minSamples: number;
  };
  
  // Sample counts for diagnostics
  sampleCounts: {
    historical: number;
    rolling: number;
  };
  
  // Metadata
  calculatedAt: Date;
}

export class ForecastDriftService {
  private qualityService: ForecastQualityService;

  constructor(private db: Db) {
    this.qualityService = getForecastQualityService(db);
  }

  /**
   * Get drift metrics for a symbol/layer/horizon
   */
  async getDrift(params: DriftParams): Promise<DriftResult> {
    const {
      symbol,
      layer,
      horizon,
      window = 30,
      degradingThreshold = 0.05,
      criticalThreshold = 0.10,
      minSamples = 20,
    } = params;

    // Get quality metrics (includes both historical and rolling)
    const quality = await this.qualityService.getQuality({
      symbol,
      layer,
      horizon,
      window,
    });

    const historicalWinRate = this.clamp01(quality.winRate);
    const rollingWinRate = this.clamp01(quality.rollingWinRate);
    
    // Drift = historical - rolling
    // Positive drift = model performing worse recently
    const drift = historicalWinRate - rollingWinRate;

    // Determine drift state with minimum sample guard
    const state = this.getDriftState({
      drift,
      degradingThreshold,
      criticalThreshold,
      historicalN: quality.sampleCount,
      rollingN: quality.rollingSampleCount,
      minSamples,
    });

    return {
      symbol,
      layer,
      horizon,
      historicalWinRate,
      rollingWinRate,
      drift,
      state,
      thresholds: {
        degrading: degradingThreshold,
        critical: criticalThreshold,
        window,
        minSamples,
      },
      sampleCounts: {
        historical: quality.sampleCount,
        rolling: quality.rollingSampleCount,
      },
      calculatedAt: new Date(),
    };
  }

  /**
   * Determine drift state
   * 
   * Rules:
   * - If not enough samples, always HEALTHY (no reliable conclusion)
   * - drift > critical threshold → CRITICAL
   * - drift > degrading threshold → DEGRADING
   * - otherwise → HEALTHY
   */
  private getDriftState(args: {
    drift: number;
    degradingThreshold: number;
    criticalThreshold: number;
    historicalN: number;
    rollingN: number;
    minSamples: number;
  }): DriftState {
    // Guard: if not enough data, don't trigger alerts
    if (args.historicalN < args.minSamples || args.rollingN < args.minSamples) {
      return 'HEALTHY';
    }

    // Check thresholds
    if (args.drift > args.criticalThreshold) return 'CRITICAL';
    if (args.drift > args.degradingThreshold) return 'DEGRADING';
    
    return 'HEALTHY';
  }

  /**
   * Clamp value to 0..1 range
   */
  private clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }
}

// Singleton instance
let serviceInstance: ForecastDriftService | null = null;

export function getForecastDriftService(db: Db): ForecastDriftService {
  if (!serviceInstance) {
    serviceInstance = new ForecastDriftService(db);
  }
  return serviceInstance;
}

console.log('[ForecastDriftService] V3.7 Drift Detector loaded');
