/**
 * BLOCK 36.5-36.7 — Multi-Horizon Engine
 * 
 * V2.0 Core Architecture:
 * - 36.5: Parallel horizon matching (7/14/30/60 days)
 * - 36.6: Weighted horizon assembly
 * - 36.7: Adaptive horizon filtering by regime
 * 
 * The market lives in multiple time-scales simultaneously.
 * V1 = single horizon (14 days) = blind to other regimes.
 * V2 = parallel fractal layers = structural awareness.
 */

import { FractalEngineV2, FractalMatchRequestV2, FractalMatchResponseV2 } from './fractal.engine.v2.js';
import { RegimeKey, classifyRegime, computeRegimeFeatures } from './regime-conditioned.js';
import { V2_EXPERIMENTAL_CONFIG } from '../config/fractal.presets.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface HorizonSignal {
  horizon: number;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  mu: number;              // mean return
  p10: number;             // 10th percentile
  p90: number;             // 90th percentile
  matchCount: number;
  maxDD: number;           // max drawdown from matches
}

export interface MultiHorizonResult {
  asOf: Date;
  regime: RegimeKey;
  signals: HorizonSignal[];
  assembled: AssembledSignal;
  filtered: {
    enabled: boolean;
    originalCount: number;
    filteredCount: number;
    keptHorizons: number[];
  };
}

export interface AssembledSignal {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  weightedScore: number;
  consensusScore: number;    // 0-1, how much horizons agree
  horizonAgreement: {
    long: number;
    short: number;
    neutral: number;
  };
}

export interface MultiHorizonConfig {
  horizons: number[];           // [7, 14, 30, 60]
  horizonWeights: Record<number, number>;  // weight per horizon
  assemblyThreshold: number;    // threshold for direction decision
  adaptiveFilterEnabled: boolean;
  minMatchesPerHorizon: number;
}

export const DEFAULT_MULTI_HORIZON_CONFIG: MultiHorizonConfig = {
  horizons: [7, 14, 30, 60],
  horizonWeights: {
    7: 1.0,    // fast impulse
    14: 1.5,   // standard swing
    30: 2.0,   // positional
    60: 2.5,   // structural
  },
  assemblyThreshold: 0.15,
  adaptiveFilterEnabled: true,
  minMatchesPerHorizon: 5,
};

// ═══════════════════════════════════════════════════════════════
// BLOCK 36.5: MULTI-HORIZON ENGINE
// ═══════════════════════════════════════════════════════════════

export class MultiHorizonEngine {
  private engineV2: FractalEngineV2;

  constructor() {
    this.engineV2 = new FractalEngineV2();
  }

  /**
   * Run multi-horizon match for all configured horizons
   */
  async runMultiHorizonMatch(
    asOf: Date | string,
    config: Partial<MultiHorizonConfig> = {}
  ): Promise<MultiHorizonResult> {
    const cfg: MultiHorizonConfig = {
      ...DEFAULT_MULTI_HORIZON_CONFIG,
      ...config,
    };

    const asOfDate = typeof asOf === 'string' ? new Date(asOf) : asOf;
    
    console.log(`[MULTI-HORIZON 36.5] Running for ${cfg.horizons.length} horizons at ${asOfDate.toISOString().slice(0, 10)}`);

    // Run parallel matching for all horizons
    const signals: HorizonSignal[] = [];
    
    for (const horizon of cfg.horizons) {
      try {
        const result = await this.engineV2.matchV2({
          asOf: asOfDate,
          forwardHorizon: horizon,
          windowLen: 60,
          topK: 25,
          version: 2,
          ageDecayEnabled: true,
          regimeConditioned: true,
          useDynamicFloor: true,
          useTemporalDispersion: true,
        });

        if (!result.ok || result.matches.length < cfg.minMatchesPerHorizon) {
          signals.push({
            horizon,
            direction: 'NEUTRAL',
            confidence: 0,
            mu: 0,
            p10: 0,
            p90: 0,
            matchCount: result.matches?.length ?? 0,
            maxDD: 0,
          });
          continue;
        }

        const mu = result.forwardStats?.return?.mean ?? 0;
        const p10 = result.forwardStats?.return?.p10 ?? 0;
        const p90 = result.forwardStats?.return?.p90 ?? 0;
        const maxDD = result.forwardStats?.maxDrawdown?.p50 ?? 0;
        const confidence = result.confidence?.stabilityScore ?? 0;

        // Determine direction
        let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
        if (mu > 0.01 && p10 > -0.05) direction = 'LONG';
        else if (mu < -0.01 && p90 < 0.05) direction = 'SHORT';

        signals.push({
          horizon,
          direction,
          confidence,
          mu: Math.round(mu * 10000) / 10000,
          p10: Math.round(p10 * 10000) / 10000,
          p90: Math.round(p90 * 10000) / 10000,
          matchCount: result.matches.length,
          maxDD: Math.round(maxDD * 10000) / 10000,
        });

      } catch (err) {
        console.error(`[MULTI-HORIZON] Horizon ${horizon} failed:`, err);
        signals.push({
          horizon,
          direction: 'NEUTRAL',
          confidence: 0,
          mu: 0,
          p10: 0,
          p90: 0,
          matchCount: 0,
          maxDD: 0,
        });
      }
    }

    // Determine current regime from the 14-day match
    const baseSignal = signals.find(s => s.horizon === 14) ?? signals[0];
    let regime: RegimeKey = 'SIDE';
    
    // Get regime from V2 engine (uses 60-day window)
    try {
      const regimeResult = await this.engineV2.matchV2({
        asOf: asOfDate,
        forwardHorizon: 14,
        windowLen: 60,
        version: 2,
      });
      regime = regimeResult.v2?.regime?.currentRegime ?? 'SIDE';
    } catch {
      // Default to SIDE if regime detection fails
    }

    // BLOCK 36.7: Apply adaptive filter
    let filteredSignals = signals;
    let filteredCount = signals.length;
    
    if (cfg.adaptiveFilterEnabled) {
      filteredSignals = this.adaptiveHorizonFilter(signals, regime);
      filteredCount = filteredSignals.length;
    }

    // BLOCK 36.6: Assemble signals
    const assembled = this.assembleHorizonSignals(filteredSignals, cfg);

    console.log(
      `[MULTI-HORIZON 36.5] Complete: Regime=${regime}, ` +
      `Signals=${signals.length}, Filtered=${filteredCount}, ` +
      `Direction=${assembled.direction}, Score=${assembled.weightedScore.toFixed(3)}`
    );

    return {
      asOf: asOfDate,
      regime,
      signals,
      assembled,
      filtered: {
        enabled: cfg.adaptiveFilterEnabled,
        originalCount: signals.length,
        filteredCount,
        keptHorizons: filteredSignals.map(s => s.horizon),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 36.6: HORIZON ASSEMBLER
  // ═══════════════════════════════════════════════════════════════

  /**
   * Weighted assembly of horizon signals
   * Longer horizons get more weight (structural > impulse)
   */
  assembleHorizonSignals(
    signals: HorizonSignal[],
    config: MultiHorizonConfig = DEFAULT_MULTI_HORIZON_CONFIG
  ): AssembledSignal {
    if (signals.length === 0) {
      return {
        direction: 'NEUTRAL',
        confidence: 0,
        weightedScore: 0,
        consensusScore: 0,
        horizonAgreement: { long: 0, short: 0, neutral: 0 },
      };
    }

    let weightedScore = 0;
    let totalWeight = 0;
    let totalConfidence = 0;

    const agreement = { long: 0, short: 0, neutral: 0 };

    for (const signal of signals) {
      const horizonWeight = config.horizonWeights[signal.horizon] ?? 1.0;
      
      const dirValue = 
        signal.direction === 'LONG' ? 1 :
        signal.direction === 'SHORT' ? -1 : 0;

      // Weight = horizon importance * signal confidence
      const weight = horizonWeight * Math.max(0.1, signal.confidence);

      weightedScore += dirValue * weight;
      totalWeight += weight;
      totalConfidence += signal.confidence;

      // Track agreement
      if (signal.direction === 'LONG') agreement.long++;
      else if (signal.direction === 'SHORT') agreement.short++;
      else agreement.neutral++;
    }

    const finalScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
    const avgConfidence = signals.length > 0 ? totalConfidence / signals.length : 0;

    // Calculate consensus score (how much horizons agree)
    const maxAgreement = Math.max(agreement.long, agreement.short, agreement.neutral);
    const consensusScore = signals.length > 0 ? maxAgreement / signals.length : 0;

    // Determine final direction
    let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
    if (finalScore > config.assemblyThreshold) direction = 'LONG';
    else if (finalScore < -config.assemblyThreshold) direction = 'SHORT';

    return {
      direction,
      confidence: Math.round(avgConfidence * 1000) / 1000,
      weightedScore: Math.round(finalScore * 1000) / 1000,
      consensusScore: Math.round(consensusScore * 1000) / 1000,
      horizonAgreement: agreement,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 36.7: ADAPTIVE HORIZON POLICY
  // ═══════════════════════════════════════════════════════════════

  /**
   * Filter horizons based on market regime
   * 
   * CRASH → fast horizons only (7, 14) - need quick reactions
   * BULL → long horizons (14, 30, 60) - ride the trend
   * BEAR → all horizons - need full picture
   * SIDE → medium horizons (7, 14, 30) - avoid structural noise
   * BUBBLE → short horizons (7, 14) - high uncertainty
   */
  adaptiveHorizonFilter(
    signals: HorizonSignal[],
    regime: RegimeKey
  ): HorizonSignal[] {
    const regimeFilters: Record<RegimeKey, number[]> = {
      CRASH: [7, 14],           // Fast exit needed
      BULL: [14, 30, 60],       // Ride the trend
      BEAR: [7, 14, 30, 60],    // Full picture needed
      SIDE: [7, 14, 30],        // Avoid structural noise
      BUBBLE: [7, 14],          // High uncertainty, stay nimble
    };

    const allowedHorizons = regimeFilters[regime] ?? [7, 14, 30, 60];
    
    const filtered = signals.filter(s => allowedHorizons.includes(s.horizon));

    if (filtered.length !== signals.length) {
      console.log(
        `[ADAPTIVE 36.7] Regime=${regime}: ` +
        `Filtered ${signals.length - filtered.length} horizons, ` +
        `kept [${filtered.map(s => s.horizon).join(', ')}]`
      );
    }

    return filtered;
  }

  /**
   * Get horizon recommendation based on regime
   */
  getRecommendedHorizon(regime: RegimeKey): number {
    const recommendations: Record<RegimeKey, number> = {
      CRASH: 7,    // Quick response
      BULL: 30,    // Ride trend
      BEAR: 14,    // Standard
      SIDE: 14,    // Standard
      BUBBLE: 7,   // Stay nimble
    };
    return recommendations[regime] ?? 14;
  }
}

// ═══════════════════════════════════════════════════════════════
// MULTI-HORIZON SIGNAL BUILDER (for simulation)
// ═══════════════════════════════════════════════════════════════

export interface MultiHorizonSignalResult {
  action: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  regime: RegimeKey;
  weightedScore: number;
  consensusScore: number;
  horizonBreakdown: HorizonSignal[];
  meta: {
    adaptiveFilterEnabled: boolean;
    keptHorizons: number[];
    recommendedHorizon: number;
  };
}

/**
 * Build a multi-horizon signal for simulation
 */
export async function buildMultiHorizonSignal(
  asOf: Date | string,
  config?: Partial<MultiHorizonConfig>
): Promise<MultiHorizonSignalResult> {
  const engine = new MultiHorizonEngine();
  const result = await engine.runMultiHorizonMatch(asOf, config);

  return {
    action: result.assembled.direction,
    confidence: result.assembled.confidence,
    regime: result.regime,
    weightedScore: result.assembled.weightedScore,
    consensusScore: result.assembled.consensusScore,
    horizonBreakdown: result.signals,
    meta: {
      adaptiveFilterEnabled: result.filtered.enabled,
      keptHorizons: result.filtered.keptHorizons,
      recommendedHorizon: engine.getRecommendedHorizon(result.regime),
    },
  };
}

// Export singleton
export const multiHorizonEngine = new MultiHorizonEngine();
