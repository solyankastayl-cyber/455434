/**
 * BLOCK 62 — Adaptive Threshold Service
 * 
 * Dynamic entry thresholds based on regime context.
 * CRISIS → stricter thresholds (harder to enter)
 * LOW vol → relaxed thresholds (easier entry)
 */

import type { RegimeContext, VolatilityRegime, MarketPhase } from '../regime/regime.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ThresholdPack {
  minConfidence: number;      // Below → block entry
  maxEntropy: number;         // Above → block entry
  maxTailRisk: number;        // Above → block entry
  minReliability: number;     // Below → reduce size
  minStability: number;       // Below → reduce size
}

export interface AdaptiveThresholdResult {
  base: ThresholdPack;
  effective: ThresholdPack;
  adjustments: {
    param: keyof ThresholdPack;
    reason: string;
    delta: number;
  }[];
  explain: string[];
}

// ═══════════════════════════════════════════════════════════════
// POLICY TABLES (Institutional)
// ═══════════════════════════════════════════════════════════════

const BASE_THRESHOLDS: ThresholdPack = {
  minConfidence: 0.05,
  maxEntropy: 0.80,
  maxTailRisk: 0.55,
  minReliability: 0.50,
  minStability: 0.40,
};

// Regime-based threshold adjustments
const REGIME_THRESHOLD_TABLE: Record<VolatilityRegime, Partial<ThresholdPack>> = {
  LOW: {
    minConfidence: 0.04,    // Easier entry
    maxEntropy: 0.85,
    maxTailRisk: 0.60,
  },
  NORMAL: {
    minConfidence: 0.05,
    maxEntropy: 0.80,
    maxTailRisk: 0.55,
  },
  HIGH: {
    minConfidence: 0.06,    // Stricter
    maxEntropy: 0.75,
    maxTailRisk: 0.50,
  },
  EXPANSION: {
    minConfidence: 0.07,
    maxEntropy: 0.70,
    maxTailRisk: 0.45,
  },
  CRISIS: {
    minConfidence: 0.08,    // Much stricter
    maxEntropy: 0.65,
    maxTailRisk: 0.40,
    minReliability: 0.60,
    minStability: 0.50,
  },
};

// Phase adjustments (additive)
const PHASE_THRESHOLD_ADJ: Record<MarketPhase, Partial<ThresholdPack>> = {
  ACCUMULATION: { minConfidence: -0.005, maxEntropy: 0.02 },
  MARKUP: { minConfidence: -0.01, maxEntropy: 0.03 },        // Easier in uptrend
  DISTRIBUTION: { minConfidence: 0.005, maxEntropy: -0.02 },
  MARKDOWN: { minConfidence: 0.015, maxEntropy: -0.05 },     // Stricter in downtrend
  UNKNOWN: {},
};

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

export class AdaptiveThresholdService {
  /**
   * Compute adaptive thresholds based on regime context.
   */
  computeThresholds(context: RegimeContext): AdaptiveThresholdResult {
    const { volRegime, phase, reliability, tailRisk, flags } = context;
    const adjustments: AdaptiveThresholdResult['adjustments'] = [];

    // Start with regime-based thresholds
    const regimeThresh = REGIME_THRESHOLD_TABLE[volRegime];
    const effective: ThresholdPack = {
      ...BASE_THRESHOLDS,
      ...regimeThresh,
    };

    // Apply phase adjustments
    const phaseAdj = PHASE_THRESHOLD_ADJ[phase] || {};
    for (const [key, delta] of Object.entries(phaseAdj)) {
      if (delta && delta !== 0) {
        const param = key as keyof ThresholdPack;
        effective[param] = (effective[param] ?? BASE_THRESHOLDS[param]) + delta;
        adjustments.push({
          param,
          reason: `Phase ${phase} adjustment`,
          delta,
        });
      }
    }

    // Additional tightening if reliability is degraded
    if (reliability.badge === 'WARN') {
      effective.minConfidence += 0.01;
      effective.maxEntropy -= 0.03;
      adjustments.push({
        param: 'minConfidence',
        reason: 'Reliability WARN',
        delta: 0.01,
      });
    }

    if (reliability.badge === 'CRITICAL') {
      effective.minConfidence += 0.02;
      effective.maxEntropy -= 0.05;
      effective.minReliability += 0.10;
      adjustments.push({
        param: 'minConfidence',
        reason: 'Reliability CRITICAL',
        delta: 0.02,
      });
    }

    // Protection mode: extra tightening
    if (flags.protectionMode) {
      effective.minConfidence += 0.005;
      effective.maxTailRisk -= 0.05;
      adjustments.push({
        param: 'maxTailRisk',
        reason: 'Protection mode active',
        delta: -0.05,
      });
    }

    // Clamp to reasonable ranges
    effective.minConfidence = Math.max(0.01, Math.min(0.15, effective.minConfidence));
    effective.maxEntropy = Math.max(0.50, Math.min(0.95, effective.maxEntropy));
    effective.maxTailRisk = Math.max(0.30, Math.min(0.70, effective.maxTailRisk));
    effective.minReliability = Math.max(0.30, Math.min(0.80, effective.minReliability));
    effective.minStability = Math.max(0.30, Math.min(0.70, effective.minStability));

    // Build explain
    const explain = this.buildExplain(volRegime, phase, effective, adjustments);

    return {
      base: BASE_THRESHOLDS,
      effective,
      adjustments,
      explain,
    };
  }

  /**
   * Check if signal passes thresholds
   */
  checkBlockers(
    thresholds: ThresholdPack,
    signal: {
      confidence: number;
      entropy: number;
      tailRisk: number;
      reliability: number;
      stability: number;
    }
  ): string[] {
    const blockers: string[] = [];

    if (signal.confidence < thresholds.minConfidence) {
      blockers.push(`LOW_CONFIDENCE (${(signal.confidence * 100).toFixed(1)}% < ${(thresholds.minConfidence * 100).toFixed(0)}%)`);
    }
    if (signal.entropy > thresholds.maxEntropy) {
      blockers.push(`HIGH_ENTROPY (${(signal.entropy * 100).toFixed(1)}% > ${(thresholds.maxEntropy * 100).toFixed(0)}%)`);
    }
    if (signal.tailRisk > thresholds.maxTailRisk) {
      blockers.push(`HIGH_TAIL_RISK (${(signal.tailRisk * 100).toFixed(1)}% > ${(thresholds.maxTailRisk * 100).toFixed(0)}%)`);
    }
    if (signal.reliability < thresholds.minReliability) {
      blockers.push(`LOW_RELIABILITY (${(signal.reliability * 100).toFixed(1)}% < ${(thresholds.minReliability * 100).toFixed(0)}%)`);
    }
    if (signal.stability < thresholds.minStability) {
      blockers.push(`LOW_STABILITY (${(signal.stability * 100).toFixed(1)}% < ${(thresholds.minStability * 100).toFixed(0)}%)`);
    }

    return blockers;
  }

  private buildExplain(
    volRegime: VolatilityRegime,
    phase: MarketPhase,
    thresholds: ThresholdPack,
    adjustments: AdaptiveThresholdResult['adjustments'][]
  ): string[] {
    const explain: string[] = [
      `Vol regime ${volRegime} → base thresholds`,
      `Phase ${phase} → adjustments applied`,
      `minConf: ${(thresholds.minConfidence * 100).toFixed(1)}%`,
      `maxEntropy: ${(thresholds.maxEntropy * 100).toFixed(0)}%`,
      `maxTailRisk: ${(thresholds.maxTailRisk * 100).toFixed(0)}%`,
    ];

    if (volRegime === 'CRISIS') {
      explain.push('CRISIS thresholds: Entry requires stronger conviction');
    }

    return explain;
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let _instance: AdaptiveThresholdService | null = null;

export function getAdaptiveThresholdService(): AdaptiveThresholdService {
  if (!_instance) {
    _instance = new AdaptiveThresholdService();
  }
  return _instance;
}
