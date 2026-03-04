/**
 * BLOCK 2.1 + 2.4 — Funding Overlay Service
 * ==========================================
 * Funding-aware cluster intelligence with crowdedness & squeeze detection.
 */

import type { Collection, Db } from 'mongodb';
import type { FundingState, FundingRegime, FUNDING_MODIFIERS } from './macro.types.js';
import { fundingService } from '../funding/funding.service.js';

// Thresholds for funding classification
const FUNDING_CROWD_THRESHOLD = 0.04;     // 0.04% = crowded
const FUNDING_EXTREME_THRESHOLD = 0.08;   // 0.08% = extreme
const FUNDING_Z_CROWD = 1.5;
const FUNDING_Z_EXTREME = 2.5;

export class FundingOverlayService {
  private col: Collection<FundingState> | null = null;
  private marketState: FundingState | null = null;

  init(db: Db) {
    this.col = db.collection<FundingState>('funding_overlay_state');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (!this.col) return;
    try {
      await this.col.createIndex({ ts: -1 });
      await this.col.createIndex({ symbol: 1, ts: -1 });
      await this.col.createIndex({ regime: 1, ts: -1 });
    } catch (e) {
      console.warn('[FundingOverlay] Index creation:', e);
    }
  }

  /**
   * Update market-wide funding state
   */
  async updateMarketFunding(): Promise<FundingState> {
    const ts = Date.now();

    // Get funding from major symbols (BTC, ETH + top alts)
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ARBUSDT', 'OPUSDT'];
    const contexts = await fundingService.batchContext(symbols);

    // Calculate weighted average
    const weights: Record<string, number> = {
      'BTCUSDT': 0.35,
      'ETHUSDT': 0.25,
      'SOLUSDT': 0.15,
      'ARBUSDT': 0.125,
      'OPUSDT': 0.125,
    };

    let avgFunding = 0;
    let totalWeight = 0;
    const byVenue: Record<string, number> = {};

    for (const ctx of contexts) {
      const w = weights[ctx.symbol] ?? 0.1;
      avgFunding += ctx.fundingScore * w;
      totalWeight += w;
    }

    avgFunding = totalWeight > 0 ? avgFunding / totalWeight : 0;

    // Calculate dispersion
    const scores = contexts.map(c => c.fundingScore);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const dispersion = Math.sqrt(
      scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length
    );

    // Determine trend from previous state
    const prev = this.marketState;
    let fundingTrend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
    if (prev) {
      const delta = avgFunding - prev.avgFunding;
      if (delta > 0.05) fundingTrend = 'UP';
      else if (delta < -0.05) fundingTrend = 'DOWN';
    }

    // Classify regime
    const regime = this.classifyFundingRegime(avgFunding);

    // Build state
    const state: FundingState = {
      ts,
      avgFunding,
      fundingZ: avgFunding * 100,  // Simplified z-score (actual would use historical)
      fundingTrend,
      byVenue,
      dispersion,
      regime,
      confidence: 1 - dispersion,  // Higher dispersion = lower confidence
    };

    // Persist
    if (this.col) {
      await this.col.insertOne(state);
    }

    this.marketState = state;
    return state;
  }

  /**
   * Get funding state for specific symbol
   */
  async getSymbolFunding(symbol: string): Promise<FundingState | null> {
    const ctx = await fundingService.getContext(symbol);
    if (!ctx) return null;

    return {
      ts: ctx.ts,
      symbol,
      avgFunding: ctx.fundingScore,
      fundingZ: ctx.fundingScore * 100,
      fundingTrend: ctx.fundingTrend > 0.05 ? 'UP' : ctx.fundingTrend < -0.05 ? 'DOWN' : 'FLAT',
      byVenue: {},
      dispersion: ctx.fundingDispersion,
      regime: this.classifyFundingRegime(ctx.fundingScore),
      confidence: ctx.confidence,
    };
  }

  /**
   * Get current market funding state
   */
  getMarketState(): FundingState | null {
    return this.marketState;
  }

  /**
   * Classify funding regime
   */
  classifyFundingRegime(fundingScore: number): FundingRegime {
    if (fundingScore >= FUNDING_EXTREME_THRESHOLD || fundingScore >= FUNDING_Z_EXTREME / 100) {
      return 'EXTREME_LONG';
    }
    if (fundingScore >= FUNDING_CROWD_THRESHOLD || fundingScore >= FUNDING_Z_CROWD / 100) {
      return 'CROWD_LONG';
    }
    if (fundingScore <= -FUNDING_EXTREME_THRESHOLD || fundingScore <= -FUNDING_Z_EXTREME / 100) {
      return 'EXTREME_SHORT';
    }
    if (fundingScore <= -FUNDING_CROWD_THRESHOLD || fundingScore <= -FUNDING_Z_CROWD / 100) {
      return 'CROWD_SHORT';
    }
    return 'NEUTRAL';
  }

  /**
   * Get funding modifier for cluster confidence
   */
  getFundingModifier(regime?: FundingRegime): number {
    const r = regime ?? this.marketState?.regime ?? 'NEUTRAL';
    
    const modifiers: Record<FundingRegime, number> = {
      NEUTRAL: 1.0,
      CROWD_LONG: 0.8,
      CROWD_SHORT: 1.1,
      EXTREME_LONG: 0.55,
      EXTREME_SHORT: 1.25,
    };

    return modifiers[r];
  }

  /**
   * Detect squeeze potential
   */
  detectSqueezePotential(fundingState: FundingState): {
    hasSqueezeRisk: boolean;
    direction: 'LONG_SQUEEZE' | 'SHORT_SQUEEZE' | null;
    confidence: number;
  } {
    const { regime, avgFunding, fundingTrend } = fundingState;

    // Long squeeze: Extreme long funding + funding starting to drop
    if (regime === 'EXTREME_LONG' && fundingTrend === 'DOWN') {
      return {
        hasSqueezeRisk: true,
        direction: 'LONG_SQUEEZE',
        confidence: 0.7 + Math.abs(avgFunding) * 2,
      };
    }

    // Short squeeze: Extreme short funding + funding starting to rise
    if (regime === 'EXTREME_SHORT' && fundingTrend === 'UP') {
      return {
        hasSqueezeRisk: true,
        direction: 'SHORT_SQUEEZE',
        confidence: 0.7 + Math.abs(avgFunding) * 2,
      };
    }

    // Potential squeeze based on extreme regime alone
    if (regime === 'EXTREME_LONG') {
      return {
        hasSqueezeRisk: true,
        direction: 'LONG_SQUEEZE',
        confidence: 0.5,
      };
    }

    if (regime === 'EXTREME_SHORT') {
      return {
        hasSqueezeRisk: true,
        direction: 'SHORT_SQUEEZE',
        confidence: 0.5,
      };
    }

    return {
      hasSqueezeRisk: false,
      direction: null,
      confidence: 0,
    };
  }

  /**
   * Apply funding penalty to cluster
   */
  applyFundingToCluster(clusterConfidence: number, symbol?: string): {
    adjustedConfidence: number;
    modifier: number;
    regime: FundingRegime;
    reason?: string;
  } {
    const regime = this.marketState?.regime ?? 'NEUTRAL';
    const modifier = this.getFundingModifier(regime);
    const adjustedConfidence = Math.min(1, clusterConfidence * modifier);

    let reason: string | undefined;
    if (modifier < 1) {
      reason = `Funding crowded (${regime}), confidence reduced`;
    } else if (modifier > 1) {
      reason = `Funding favorable (${regime}), confidence boosted`;
    }

    return {
      adjustedConfidence,
      modifier,
      regime,
      reason,
    };
  }

  /**
   * Get history
   */
  async getHistory(limit = 100): Promise<FundingState[]> {
    if (!this.col) return [];
    return this.col.find({ symbol: { $exists: false } }, { projection: { _id: 0 } })
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();
  }
}

export const fundingOverlayService = new FundingOverlayService();

console.log('[Macro] Funding Overlay Service loaded');
