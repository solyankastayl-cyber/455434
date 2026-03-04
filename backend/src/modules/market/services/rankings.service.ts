/**
 * RANKINGS SERVICE
 * ================
 * 
 * BLOCK B2: Multi-Asset Ranking - Conviction Score Computation
 * 
 * Computes and ranks assets by "conviction score" based on:
 * - Adjusted confidence from verdict engine
 * - Expected move magnitude
 * - Risk level penalties
 * - Action type (BUY/SELL prioritized over HOLD)
 * 
 * Uses existing heavy verdict cache to avoid redundant ML computations.
 * 
 * Conviction formula:
 *   conviction = adjustedConfidence * |expectedMovePct| * riskMult * actionMult
 * 
 * Where:
 *   riskMult: LOW=1.0, MEDIUM=0.85, HIGH=0.7, EXTREME=0.55
 *   actionMult: BUY/SELL=1.0, HOLD=0.6
 */

import { UniverseService, type UniverseType } from './universe.service.js';

export type Horizon = '1D' | '7D' | '30D';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
export type Action = 'BUY' | 'SELL' | 'HOLD' | 'AVOID';

export interface RankingItem {
  symbol: string;
  price: number;
  action: Action;
  horizon: Horizon;
  adjustedConfidence: number;
  rawConfidence: number;
  expectedMovePct: number;
  convictionScore: number;
  risk: RiskLevel;
  health: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  drivers: {
    exchange: number;
    onchain: number;
    sentiment: number;
  };
  topSignals: Array<{ key: string; impact: number }>;
  updatedAt: string;
}

export interface RankingsResult {
  ok: boolean;
  generatedAt: string;
  horizon: Horizon;
  universe: UniverseType;
  count: number;
  items: RankingItem[];
  buys: RankingItem[];
  sells: RankingItem[];
  computeMs: number;
}

// Risk level multipliers
const RISK_MULT: Record<RiskLevel, number> = {
  LOW: 1.0,
  MEDIUM: 0.85,
  HIGH: 0.7,
  EXTREME: 0.55,
};

// Action type multipliers (HOLD is less actionable)
const ACTION_MULT: Record<Action, number> = {
  BUY: 1.0,
  SELL: 1.0,
  HOLD: 0.6,
  AVOID: 0.3,
};

export class RankingsService {
  private verdictCache: any;

  constructor(verdictCache: any) {
    this.verdictCache = verdictCache;
  }

  /**
   * Compute conviction score for a single verdict
   */
  private computeConviction(
    adjustedConfidence: number,
    expectedMovePct: number,
    risk: RiskLevel,
    action: Action
  ): number {
    const base = adjustedConfidence * Math.abs(expectedMovePct);
    const riskMult = RISK_MULT[risk] ?? 0.75;
    const actionMult = ACTION_MULT[action] ?? 0.5;
    
    return base * riskMult * actionMult;
  }

  /**
   * Get top rankings for a universe and horizon
   */
  async getTopRankings(params: {
    universe?: UniverseType;
    horizon: Horizon;
    limit?: number;
    type?: 'BUY' | 'SELL' | 'ALL';
  }): Promise<RankingsResult> {
    const t0 = Date.now();
    const universe = params.universe || 'core';
    const horizon = params.horizon;
    const limit = params.limit || 20;
    const filterType = params.type || 'ALL';

    const symbols = UniverseService.getUniverse(universe);
    const results: RankingItem[] = [];

    // Fetch verdict for each symbol from cache
    for (const symbol of symbols) {
      try {
        // Use getStaleOk to allow serving stale data
        const cacheKey = this.verdictCache.makeKey({ symbol, horizon });
        const cached = this.verdictCache.getStaleOk(cacheKey);
        
        if (!cached.value) {
          console.log(`[Rankings] No cache for ${symbol}/${horizon}, skipping`);
          continue;
        }

        const heavy = cached.value;
        const verdict = heavy.verdict || {};
        const layers = heavy.layers || {};
        
        // Extract data from verdict
        const adjustedConfidence = verdict.confidence ?? 0;
        const rawConfidence = verdict.raw?.confidence ?? adjustedConfidence;
        const expectedMovePct = (verdict.expectedReturn ?? 0) * 100;
        const risk = (verdict.risk || 'MEDIUM') as RiskLevel;
        const action = (verdict.action || 'HOLD') as Action;
        const health = verdict.health?.state || 'HEALTHY';
        
        // Skip CRITICAL health or AVOID actions
        if (health === 'CRITICAL' || action === 'AVOID') {
          continue;
        }

        // Filter by type if specified
        if (filterType !== 'ALL' && action !== filterType) {
          continue;
        }

        // Compute conviction score
        const convictionScore = this.computeConviction(
          adjustedConfidence,
          expectedMovePct,
          risk,
          action
        );

        // Get last price from layers
        const lastPrice = layers.snapshot?.price ?? 0;

        // Build drivers from layers
        const drivers = {
          exchange: 1.0, // Currently only exchange is active
          onchain: 0,
          sentiment: 0,
        };

        // Extract top signals from features
        const topSignals: Array<{ key: string; impact: number }> = [];
        if (layers.features) {
          const f = layers.features;
          if (f.momentum_1d) topSignals.push({ key: 'momentum', impact: f.momentum_1d * 0.5 });
          if (f.rsi) topSignals.push({ key: 'rsi', impact: (f.rsi - 50) * 0.001 });
        }

        results.push({
          symbol,
          price: lastPrice,
          action,
          horizon,
          adjustedConfidence,
          rawConfidence,
          expectedMovePct,
          convictionScore,
          risk,
          health: health as 'HEALTHY' | 'DEGRADED' | 'CRITICAL',
          drivers,
          topSignals: topSignals.slice(0, 2),
          updatedAt: heavy.computedAt || new Date().toISOString(),
        });

      } catch (err: any) {
        console.warn(`[Rankings] Error for ${symbol}:`, err.message);
      }
    }

    // Sort by conviction score (descending)
    results.sort((a, b) => b.convictionScore - a.convictionScore);

    // Split into buys and sells
    const buys = results
      .filter(r => r.action === 'BUY')
      .slice(0, 5);
    
    const sells = results
      .filter(r => r.action === 'SELL')
      .slice(0, 5);

    const computeMs = Date.now() - t0;

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      horizon,
      universe,
      count: results.length,
      items: results.slice(0, limit),
      buys,
      sells,
      computeMs,
    };
  }
}

console.log('[RankingsService] Module loaded');
