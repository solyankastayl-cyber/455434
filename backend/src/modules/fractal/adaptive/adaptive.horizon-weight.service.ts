/**
 * BLOCK 61 — Adaptive Horizon Weighting Service
 * 
 * Dynamic tier weights based on regime context.
 * In CRISIS: structure dominates, timing weight reduced.
 * In LOW vol: more tactical/timing freedom.
 */

import type { RegimeContext, VolatilityRegime, MarketPhase } from '../regime/regime.types.js';
import type { TierWeights, AdaptiveWeightResult, HorizonTier } from './adaptive.types.js';

// ═══════════════════════════════════════════════════════════════
// POLICY TABLE (Institutional)
// ═══════════════════════════════════════════════════════════════

const BASE_WEIGHTS: TierWeights = {
  STRUCTURE: 0.50,
  TACTICAL: 0.30,
  TIMING: 0.20,
};

// Weights by volatility regime
const REGIME_WEIGHT_TABLE: Record<VolatilityRegime, TierWeights> = {
  LOW: {
    STRUCTURE: 0.45,
    TACTICAL: 0.30,
    TIMING: 0.25,
  },
  NORMAL: {
    STRUCTURE: 0.50,
    TACTICAL: 0.30,
    TIMING: 0.20,
  },
  HIGH: {
    STRUCTURE: 0.55,
    TACTICAL: 0.30,
    TIMING: 0.15,
  },
  EXPANSION: {
    STRUCTURE: 0.60,
    TACTICAL: 0.25,
    TIMING: 0.15,
  },
  CRISIS: {
    STRUCTURE: 0.70,
    TACTICAL: 0.20,
    TIMING: 0.10,
  },
};

// Phase adjustments (additive)
const PHASE_ADJUSTMENTS: Record<MarketPhase, Partial<TierWeights>> = {
  ACCUMULATION: { STRUCTURE: 0.05, TACTICAL: 0.00, TIMING: -0.05 },
  MARKUP: { STRUCTURE: -0.05, TACTICAL: 0.02, TIMING: 0.03 },
  DISTRIBUTION: { STRUCTURE: 0.05, TACTICAL: 0.00, TIMING: -0.05 },
  MARKDOWN: { STRUCTURE: 0.10, TACTICAL: -0.05, TIMING: -0.05 },
  UNKNOWN: { STRUCTURE: 0.00, TACTICAL: 0.00, TIMING: 0.00 },
};

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

export class AdaptiveHorizonWeightService {
  /**
   * Compute adaptive horizon weights based on regime context.
   */
  computeWeights(context: RegimeContext): AdaptiveWeightResult {
    const { volRegime, phase, flags } = context;
    const adjustments: AdaptiveWeightResult['adjustments'] = [];

    // Start with regime-based weights
    const regimeWeights = { ...REGIME_WEIGHT_TABLE[volRegime] };

    // Apply phase adjustments
    const phaseAdj = PHASE_ADJUSTMENTS[phase] || {};
    const adjusted: TierWeights = {
      STRUCTURE: regimeWeights.STRUCTURE + (phaseAdj.STRUCTURE || 0),
      TACTICAL: regimeWeights.TACTICAL + (phaseAdj.TACTICAL || 0),
      TIMING: regimeWeights.TIMING + (phaseAdj.TIMING || 0),
    };

    // Track adjustments
    if (phaseAdj.STRUCTURE && phaseAdj.STRUCTURE !== 0) {
      adjustments.push({
        tier: 'STRUCTURE',
        reason: `Phase ${phase} adjustment`,
        delta: phaseAdj.STRUCTURE,
      });
    }
    if (phaseAdj.TIMING && phaseAdj.TIMING !== 0) {
      adjustments.push({
        tier: 'TIMING',
        reason: `Phase ${phase} adjustment`,
        delta: phaseAdj.TIMING,
      });
    }

    // If structureDominates flag is set, further boost structure
    if (flags.structureDominates && volRegime !== 'CRISIS') {
      const structureBoost = 0.05;
      adjusted.STRUCTURE += structureBoost;
      adjusted.TIMING -= structureBoost;
      adjustments.push({
        tier: 'STRUCTURE',
        reason: 'Structure dominates flag active',
        delta: structureBoost,
      });
    }

    // Normalize to sum = 1.0
    const effectiveWeights = this.normalize(adjusted);

    // Build explain
    const explain = this.buildExplain(volRegime, phase, effectiveWeights, adjustments);

    return {
      baseWeights: BASE_WEIGHTS,
      effectiveWeights,
      adjustments,
      explain,
    };
  }

  /**
   * Get weight for specific horizon
   */
  getHorizonWeight(weights: TierWeights, horizon: string): number {
    const tier = this.horizonToTier(horizon);
    const tierWeight = weights[tier];
    
    // Distribute within tier
    const horizonsInTier = this.getHorizonsInTier(tier);
    return tierWeight / horizonsInTier.length;
  }

  /**
   * Map horizon to tier
   */
  horizonToTier(horizon: string): HorizonTier {
    if (['7d', '14d'].includes(horizon)) return 'TIMING';
    if (['30d', '90d'].includes(horizon)) return 'TACTICAL';
    return 'STRUCTURE';
  }

  private getHorizonsInTier(tier: HorizonTier): string[] {
    switch (tier) {
      case 'TIMING': return ['7d', '14d'];
      case 'TACTICAL': return ['30d', '90d'];
      case 'STRUCTURE': return ['180d', '365d'];
    }
  }

  private normalize(weights: TierWeights): TierWeights {
    const sum = weights.STRUCTURE + weights.TACTICAL + weights.TIMING;
    if (sum <= 0) return BASE_WEIGHTS;
    return {
      STRUCTURE: weights.STRUCTURE / sum,
      TACTICAL: weights.TACTICAL / sum,
      TIMING: weights.TIMING / sum,
    };
  }

  private buildExplain(
    volRegime: VolatilityRegime,
    phase: MarketPhase,
    weights: TierWeights,
    adjustments: AdaptiveWeightResult['adjustments'][]
  ): string[] {
    const explain: string[] = [
      `Vol regime ${volRegime} → base tier weights`,
      `Phase ${phase} → adjustments applied`,
      `Effective: Structure ${(weights.STRUCTURE * 100).toFixed(0)}% / Tactical ${(weights.TACTICAL * 100).toFixed(0)}% / Timing ${(weights.TIMING * 100).toFixed(0)}%`,
    ];

    if (volRegime === 'CRISIS') {
      explain.push('CRISIS: Structure dominates, timing signals heavily discounted');
    }
    if (volRegime === 'LOW') {
      explain.push('LOW vol: More freedom for tactical/timing entries');
    }

    return explain;
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let _instance: AdaptiveHorizonWeightService | null = null;

export function getAdaptiveHorizonWeightService(): AdaptiveHorizonWeightService {
  if (!_instance) {
    _instance = new AdaptiveHorizonWeightService();
  }
  return _instance;
}
