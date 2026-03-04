/**
 * BLOCK 6.4 — Cluster Feature Builder
 * =====================================
 * 
 * Aggregates indicator vectors into cluster-level features.
 * We DON'T use raw 40 indicators — we use their aggregates.
 */

import type { IndicatorVector } from '../types.js';
import type { ClusterFeatures, MarketContext } from './ml.types.js';

// ═══════════════════════════════════════════════════════════════
// FEATURE BUILDER
// ═══════════════════════════════════════════════════════════════

export class ClusterFeatureBuilder {
  
  /**
   * Build aggregated features from cluster members
   */
  buildClusterFeatures(members: IndicatorVector[]): ClusterFeatures {
    if (members.length === 0) {
      return this.emptyFeatures();
    }

    return {
      avgRSI: this.mean(members.map(m => m.rsi_14 ?? 50)),
      avgRSIZ: this.mean(members.map(m => m.rsi_z ?? 0)),
      avgFunding: this.mean(members.map(m => m.funding_rate ?? 0)),
      avgFundingZ: this.mean(members.map(m => m.funding_z ?? 0)),
      avgOIChange: this.mean(members.map(m => m.oi_change_1h ?? 0)),
      avgOIZ: this.mean(members.map(m => m.oi_z ?? 0)),
      avgVolumeSpike: this.calculateVolumeSpike(members),
      avgVolatilityZ: this.mean(members.map(m => m.volatility_z ?? 0)),
      liquidationBias: this.mean(members.map(m => m.liq_imbalance ?? 0)),
      trendAlignment: this.mean(members.map(m => m.trend_score ?? 0)),
      volatilityRegime: this.encodeVolatilityRegime(members),
      squeezeScore: this.mean(members.map(m => m.squeeze_score ?? 0)),
      breakoutScore: this.mean(members.map(m => m.breakout_score ?? 0)),
      meanrevScore: this.mean(members.map(m => m.meanrev_score ?? 0)),
      longBias: this.mean(members.map(m => m.long_bias ?? 0)),
    };
  }

  /**
   * Build market context from BTC/global indicators
   */
  buildMarketContext(
    btcVector?: IndicatorVector,
    globalData?: {
      fundingGlobal?: number;
      fearGreed?: number;
    }
  ): MarketContext {
    const btcTrend = btcVector?.trend_score ?? 0;
    const btcVolatility = btcVector?.volatility_z ?? 0;
    
    // Determine regime
    let marketRegime: MarketContext['marketRegime'];
    
    if (btcVolatility > 2) {
      marketRegime = 'RISK_OFF';
    } else if (btcTrend > 0.5) {
      marketRegime = 'BULL';
    } else if (btcTrend < -0.5) {
      marketRegime = 'BEAR';
    } else {
      marketRegime = 'RANGE';
    }

    return {
      marketRegime,
      btcTrend,
      btcVolatility: Math.min(1, Math.abs(btcVolatility) / 3),
      fundingGlobal: globalData?.fundingGlobal ?? 0,
      fearGreed: globalData?.fearGreed,
    };
  }

  /**
   * Convert features to ML-ready vector (normalized)
   */
  toFeatureVector(features: ClusterFeatures): number[] {
    return [
      this.normalize(features.avgRSI, 0, 100),
      this.clamp(features.avgRSIZ, -3, 3) / 3,
      this.clamp(features.avgFundingZ, -3, 3) / 3,
      this.clamp(features.avgOIZ, -3, 3) / 3,
      this.clamp(features.avgVolumeSpike, 0, 5) / 5,
      this.clamp(features.avgVolatilityZ, -3, 3) / 3,
      this.clamp(features.liquidationBias, -1, 1),
      this.clamp(features.trendAlignment, -1, 1),
      this.clamp(features.volatilityRegime, 0, 1),
      this.clamp(features.squeezeScore, 0, 1),
      this.clamp(features.breakoutScore, 0, 1),
      this.clamp(features.meanrevScore, 0, 1),
      this.clamp(features.longBias, -1, 1),
    ];
  }

  /**
   * Convert market context to ML-ready vector
   */
  contextToVector(context: MarketContext): number[] {
    const regimeMap = { BULL: 1, BEAR: -1, RANGE: 0, RISK_OFF: -2 };
    
    return [
      regimeMap[context.marketRegime] / 2,
      this.clamp(context.btcTrend, -1, 1),
      this.clamp(context.btcVolatility, 0, 1),
      this.clamp(context.fundingGlobal * 10000, -1, 1),
      context.fearGreed ? (context.fearGreed - 50) / 50 : 0,
    ];
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private calculateVolumeSpike(members: IndicatorVector[]): number {
    // Use momentum as proxy for volume spike
    const moms = members.map(m => Math.abs(m.momentum_1h ?? 0));
    return this.mean(moms);
  }

  private encodeVolatilityRegime(members: IndicatorVector[]): number {
    const regimes = members.map(m => {
      switch (m.vol_regime) {
        case 'LOW': return 0;
        case 'NORMAL': return 0.33;
        case 'HIGH': return 0.66;
        case 'EXTREME': return 1;
        default: return 0.33;
      }
    });
    return this.mean(regimes);
  }

  private normalize(value: number, min: number, max: number): number {
    return (value - min) / (max - min);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private emptyFeatures(): ClusterFeatures {
    return {
      avgRSI: 50,
      avgRSIZ: 0,
      avgFunding: 0,
      avgFundingZ: 0,
      avgOIChange: 0,
      avgOIZ: 0,
      avgVolumeSpike: 0,
      avgVolatilityZ: 0,
      liquidationBias: 0,
      trendAlignment: 0,
      volatilityRegime: 0.33,
      squeezeScore: 0,
      breakoutScore: 0,
      meanrevScore: 0,
      longBias: 0,
    };
  }
}

export const clusterFeatureBuilder = new ClusterFeatureBuilder();

console.log('[Block6] Cluster Feature Builder loaded');
