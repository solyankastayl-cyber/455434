/**
 * BLOCK 1.4.2 — Alt Feature Builder
 * ===================================
 * Builds AltFeatureVector from existing IndicatorVector + FundingContext.
 */

import type { Db } from 'mongodb';
import type { AltFeatureVector } from './contracts/alt.feature.vector.js';
import type { IndicatorVector } from '../../exchange-alt/types.js';
import { FundingStore } from '../funding/funding.store.js';

export class AltFeatureBuilder {
  private fundingStore: FundingStore | null = null;

  init(db: Db) {
    this.fundingStore = new FundingStore(db);
  }

  /**
   * Build AltFeatureVector from existing IndicatorVector
   */
  async buildFromIndicatorVector(
    iv: IndicatorVector,
    db?: Db
  ): Promise<AltFeatureVector> {
    // Get funding context if available
    let fundingScore = iv.funding_z ?? 0;
    let fundingTrend = 0;
    let fundingLabel: AltFeatureVector['fundingLabel'] = 'NEUTRAL';

    if (db || this.fundingStore) {
      const store = this.fundingStore ?? new FundingStore(db!);
      const fctx = await store.latest(iv.symbol);
      if (fctx) {
        fundingScore = fctx.fundingScore;
        fundingTrend = fctx.fundingTrend;
        fundingLabel = fctx.label;
      }
    }

    const missing: string[] = [];
    
    // Track missing features
    if (iv.rsi_14 === undefined) missing.push('rsi');
    if (iv.funding_rate === undefined) missing.push('funding');
    if (iv.oi_change_1h === undefined) missing.push('oi');

    return {
      symbol: iv.symbol,
      ts: iv.ts,

      // Core Momentum
      rsi: iv.rsi_14 ?? 50,
      rsiSlope: this.calculateSlope(iv.rsi_14, 50),
      rsiZ: iv.rsi_z ?? 0,
      macdHist: 0, // Would need MACD from indicator provider
      momentum1h: iv.momentum_1h ?? 0,
      momentum4h: iv.momentum_4h ?? 0,
      momentum24h: iv.momentum_24h ?? 0,

      // Volume / Flow
      volumeZ: 0, // Would need volume z-score
      volumeTrend: 0,
      orderImbalance: 0,

      // Derivatives (Funding Layer)
      fundingScore,
      fundingTrend,
      fundingLabel,
      oiDelta: iv.oi_change_1h ?? 0,
      oiZ: iv.oi_z ?? 0,
      longBias: iv.long_bias ?? 0,

      // Liquidations
      liquidationPressure: iv.liq_imbalance ?? 0,
      liquidationZ: iv.liq_z ?? 0,
      cascadeRisk: iv.cascade_risk ?? 0,

      // Volatility / Regime
      volatility: iv.atr_pct ?? 0,
      volatilityZ: iv.volatility_z ?? 0,
      trendStrength: Math.abs(iv.trend_score ?? 0),

      // Market Structure
      breakoutScore: iv.breakout_score ?? 0,
      meanrevScore: iv.meanrev_score ?? 0,
      squeezeScore: iv.squeeze_score ?? 0,

      // Macro Overlay
      btcCorrelation: 0, // Would need correlation calculation
      btcDominanceDelta: 0,

      // Quality
      coverage: (26 - missing.length) / 26,
      missing,
    };
  }

  /**
   * Build batch of AltFeatureVectors
   */
  async buildBatch(
    vectors: IndicatorVector[],
    db?: Db
  ): Promise<AltFeatureVector[]> {
    const results: AltFeatureVector[] = [];

    for (const iv of vectors) {
      const afv = await this.buildFromIndicatorVector(iv, db);
      results.push(afv);
    }

    return results;
  }

  private calculateSlope(current?: number, baseline = 50): number {
    if (current === undefined) return 0;
    return (current - baseline) / 50; // Normalized slope
  }
}

export const altFeatureBuilder = new AltFeatureBuilder();

console.log('[Screener] Alt Feature Builder loaded');
