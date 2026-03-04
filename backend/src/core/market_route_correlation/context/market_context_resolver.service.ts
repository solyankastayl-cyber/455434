/**
 * Market Context Resolver (P1.6)
 * 
 * Resolves market context for a given token and time window.
 * Converts raw market data into regime classifications.
 */

import { 
  IMarketSnapshot, 
  VolatilityRegime, 
  LiquidityRegime 
} from '../storage/route_market_context.model.js';
import { getLatestMetric } from '../../market_data/storage/market_metric.model.js';
import { getQuality } from '../../market_data/storage/market_quality.model.js';

// ============================================
// Types
// ============================================

export interface ResolveContextRequest {
  token: string;
  fromTs: number;
  toTs: number;
}

export interface ResolveContextResult {
  snapshot: IMarketSnapshot | null;
  sourceQuality: number;
  error?: string;
}

// ============================================
// Thresholds (deterministic rules)
// ============================================

const VOLATILITY_THRESHOLDS = {
  LOW: 2,      // < 2% = LOW
  HIGH: 6      // > 6% = HIGH, else NORMAL
};

const LIQUIDITY_THRESHOLDS = {
  THIN: 1e8,   // < $100M volume = THIN
  DEEP: 1e10   // > $10B volume = DEEP, else NORMAL
};

const STRESS_THRESHOLDS = {
  volatility: 8,     // > 8% volatility
  volumeZscore: 2.5  // > 2.5 z-score
};

// ============================================
// Resolver Service
// ============================================

export class MarketContextResolver {
  
  /**
   * Resolve market context for a token at a given time
   */
  async resolve(request: ResolveContextRequest): Promise<ResolveContextResult> {
    const { token } = request;
    const symbol = token.toUpperCase();
    
    try {
      // Get latest 24h metric (fallback to 7d)
      let metric = await getLatestMetric(symbol, '24h');
      if (!metric) {
        metric = await getLatestMetric(symbol, '7d');
      }
      
      if (!metric) {
        return {
          snapshot: null,
          sourceQuality: 0,
          error: 'No market data available'
        };
      }
      
      // Get quality info
      const quality = await getQuality(symbol, '1h');
      const dataQuality = quality ? quality.qualityScore / 100 : 0.5;
      
      // Build snapshot with regime classifications
      const snapshot: IMarketSnapshot = {
        priceChange24h: metric.priceChangePct || 0,
        volumeUsd24h: metric.volumeTotal || 0,
        volumeDeltaZscore: metric.volumeZ || 0,
        volatilityRegime: this.classifyVolatility(metric.volatilityPct || 0),
        liquidityRegime: this.classifyLiquidity(metric.volumeTotal || 0),
        isStressed: this.checkStressed(metric.volatilityPct || 0, metric.volumeZ || 0),
        dataQuality
      };
      
      return {
        snapshot,
        sourceQuality: dataQuality
      };
      
    } catch (err) {
      return {
        snapshot: null,
        sourceQuality: 0,
        error: (err as Error).message
      };
    }
  }
  
  // ============================================
  // Regime Classification (deterministic)
  // ============================================
  
  private classifyVolatility(volatilityPct: number): VolatilityRegime {
    if (volatilityPct < VOLATILITY_THRESHOLDS.LOW) return 'LOW';
    if (volatilityPct > VOLATILITY_THRESHOLDS.HIGH) return 'HIGH';
    return 'NORMAL';
  }
  
  private classifyLiquidity(volumeUsd: number): LiquidityRegime {
    if (volumeUsd < LIQUIDITY_THRESHOLDS.THIN) return 'THIN';
    if (volumeUsd > LIQUIDITY_THRESHOLDS.DEEP) return 'DEEP';
    return 'NORMAL';
  }
  
  private checkStressed(volatilityPct: number, volumeZscore: number): boolean {
    return (
      volatilityPct > STRESS_THRESHOLDS.volatility ||
      Math.abs(volumeZscore) > STRESS_THRESHOLDS.volumeZscore
    );
  }
}

// Singleton
export const marketContextResolver = new MarketContextResolver();
