/**
 * SPX → FRACTAL CONTRACT ADAPTER
 * 
 * Converts SpxFocusPack to FractalSignalContract format.
 * This allows the frontend to consume SPX data using the same
 * interface as BTC without any UI changes.
 * 
 * PRINCIPLE: Pure mapper, no business logic recalculation.
 * 
 * @module spx/adapters/spx-to-fractal
 */

import type { SpxFocusPack, SpxOverlayMatch } from '../../spx-core/spx-focus-pack.builder.js';

// ═══════════════════════════════════════════════════════════════
// FRACTAL SIGNAL CONTRACT (BTC Canonical Format)
// ═══════════════════════════════════════════════════════════════

/**
 * Unified contract that frontend expects.
 * BTC is the canonical source, SPX adapts to this.
 */
export interface FractalSignalContract {
  // Contract metadata
  contract: {
    module: 'fractal';
    version: string;
    frozen: boolean;
    horizons: number[];
    symbol: string;
    generatedAt: string;
    asofCandleTs: number;
  };

  // Primary decision (SPX: derived from forecast direction)
  decision: {
    action: 'LONG' | 'SHORT' | 'HOLD';
    confidence: number;
    reliability: number;
    sizeMultiplier: number;
    preset: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  };

  // Per-horizon breakdown
  horizons: Array<{
    h: number;
    action: 'LONG' | 'SHORT' | 'HOLD';
    expectedReturn: number;
    confidence: number;
    weight: number;
    dominant: boolean;
  }>;

  // Risk metrics
  risk: {
    maxDD_WF: number;
    mcP95_DD: number;
    entropy: number;
    tailBadge: 'OK' | 'WARN' | 'DEGRADED' | 'CRITICAL';
  };

  // Reliability
  reliability: {
    score: number;
    badge: 'HIGH' | 'WARN' | 'DEGRADED' | 'CRITICAL';
    effectiveN: number;
    driftScore: number;
  };

  // Market context
  market: {
    phase: string;
    sma200: 'ABOVE' | 'BELOW' | 'NEAR';
    currentPrice: number;
    volatility: number;
  };

  // Explainability
  explain: {
    topMatches: Array<{
      id: string;
      date: string;
      similarity: number;
      phase: string;
      return: number;
      maxDrawdown: number;
    }>;
    noTradeReasons: string[];
    influence: Array<{
      factor: string;
      weight: number;
      contribution: string;
    }>;
  };

  // Chart data (extended for UI)
  chartData: {
    path: number[];
    bands: {
      p10: number[];
      p25: number[];
      p50: number[];
      p75: number[];
      p90: number[];
    };
    currentWindow: {
      raw: number[];
      normalized: number[];
      timestamps: number[];
    };
    forecast: {
      upperBand: number[];
      lowerBand: number[];
      confidenceDecay: number[];
      tailFloor: number;
      currentPrice: number;
    };
  };

  // Diagnostics
  diagnostics: {
    similarity: number;
    directionMatch: number;
    projectionGap: number;
    quality: number;
    sampleSize: number;
    effectiveN: number;
    entropy: number;
    coverageYears: number;
  };

  // Phase engine data
  phaseEngine: {
    currentPhase: string;
    trend: string;
    volatility: string;
  };

  // Governance (SPX: always normal for now)
  governance: {
    mode: 'NORMAL' | 'PROTECTION' | 'FROZEN_ONLY' | 'HALT';
    frozenVersionId: string;
    guardLevel: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
  };
}

// ═══════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Adapts SpxFocusPack to FractalSignalContract.
 * Pure mapping, no recalculation of business logic.
 */
export function adaptSpxToFractal(focusPack: SpxFocusPack): FractalSignalContract {
  const { meta, price, phase, overlay, forecast, primarySelection, divergence, diagnostics } = focusPack;

  // Derive action from median return
  const medianReturn = overlay.stats.medianReturn;
  const action = deriveAction(medianReturn);

  // Map horizons from forecast markers
  const mappedHorizons = mapHorizons(forecast.markers, overlay.stats);

  // Calculate SMA200 position
  const sma200Position = deriveSma200Position(price.current, price.sma200);

  // Map top matches
  const topMatches = mapTopMatches(overlay.matches.slice(0, 5));

  // Derive reliability badge
  const reliabilityBadge = deriveReliabilityBadge(diagnostics.reliability);

  // Derive tail badge from avgMaxDD
  const tailBadge = deriveTailBadge(overlay.stats.avgMaxDD);

  // Derive no-trade reasons
  const noTradeReasons = deriveNoTradeReasons(
    diagnostics.sampleSize,
    diagnostics.reliability,
    overlay.stats.entropy || diagnostics.entropy
  );

  return {
    contract: {
      module: 'fractal',
      version: 'SPX_V2.1.0',
      frozen: false, // SPX is not frozen yet
      horizons: extractHorizonNumbers(forecast.markers),
      symbol: 'SPX',
      generatedAt: meta.asOf,
      asofCandleTs: forecast.startTs,
    },

    decision: {
      action,
      confidence: Math.min(1, diagnostics.reliability * overlay.stats.hitRate),
      reliability: diagnostics.reliability,
      sizeMultiplier: calculateSizeMultiplier(diagnostics.reliability, diagnostics.entropy),
      preset: 'BALANCED',
    },

    horizons: mappedHorizons,

    risk: {
      maxDD_WF: overlay.stats.avgMaxDD,
      mcP95_DD: overlay.stats.p10Return, // Using p10 as proxy for worst case
      entropy: diagnostics.entropy,
      tailBadge,
    },

    reliability: {
      score: diagnostics.reliability,
      badge: reliabilityBadge,
      effectiveN: diagnostics.effectiveN,
      driftScore: divergence.score / 100, // Normalize to 0-1
    },

    market: {
      phase: phase.phase,
      sma200: sma200Position,
      currentPrice: price.current,
      volatility: phase.volatility === 'HIGH' ? 0.8 : phase.volatility === 'LOW' ? 0.2 : 0.5,
    },

    explain: {
      topMatches,
      noTradeReasons,
      influence: buildInfluenceFactors(overlay, diagnostics),
    },

    chartData: {
      path: forecast.path,
      bands: {
        p10: overlay.distributionSeries.p10,
        p25: overlay.distributionSeries.p25,
        p50: overlay.distributionSeries.p50,
        p75: overlay.distributionSeries.p75,
        p90: overlay.distributionSeries.p90,
      },
      currentWindow: {
        raw: overlay.currentWindow.raw,
        normalized: overlay.currentWindow.normalized,
        timestamps: overlay.currentWindow.timestamps,
      },
      forecast: {
        upperBand: forecast.upperBand,
        lowerBand: forecast.lowerBand,
        confidenceDecay: forecast.confidenceDecay,
        tailFloor: forecast.tailFloor,
        currentPrice: forecast.currentPrice,
      },
    },

    diagnostics: {
      // Source verification - ALL metrics from SPX, not BTC
      asset: 'SPX',
      sources: {
        matches: 'SPX_MATCHES',
        entropy: 'SPX_SCAN',
        tailRisk: 'SPX_MATCHES',
        drawdown: 'SPX_MATCHES',
      },
      similarity: overlay.matches[0]?.similarity || 0,
      directionMatch: divergence.directionalMismatch ? 0 : 1,
      projectionGap: divergence.terminalDelta,
      quality: diagnostics.qualityScore,
      sampleSize: diagnostics.sampleSize,
      effectiveN: diagnostics.effectiveN,
      entropy: diagnostics.entropy,
      coverageYears: diagnostics.coverageYears,
    },

    phaseEngine: {
      currentPhase: phase.phase,
      trend: phase.trend,
      volatility: phase.volatility,
    },

    governance: {
      mode: 'NORMAL',
      frozenVersionId: '',
      guardLevel: 'GREEN',
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function deriveAction(medianReturn: number): 'LONG' | 'SHORT' | 'HOLD' {
  if (medianReturn > 0.02) return 'LONG';   // > 2%
  if (medianReturn < -0.02) return 'SHORT'; // < -2%
  return 'HOLD';
}

function deriveSma200Position(currentPrice: number, sma200: number): 'ABOVE' | 'BELOW' | 'NEAR' {
  const ratio = currentPrice / sma200;
  if (ratio > 1.02) return 'ABOVE';
  if (ratio < 0.98) return 'BELOW';
  return 'NEAR';
}

function deriveReliabilityBadge(reliability: number): 'HIGH' | 'WARN' | 'DEGRADED' | 'CRITICAL' {
  if (reliability >= 0.7) return 'HIGH';
  if (reliability >= 0.5) return 'WARN';
  if (reliability >= 0.3) return 'DEGRADED';
  return 'CRITICAL';
}

function deriveTailBadge(avgMaxDD: number): 'OK' | 'WARN' | 'DEGRADED' | 'CRITICAL' {
  const absDD = Math.abs(avgMaxDD);
  if (absDD < 10) return 'OK';
  if (absDD < 20) return 'WARN';
  if (absDD < 35) return 'DEGRADED';
  return 'CRITICAL';
}

function mapHorizons(
  markers: Array<{ horizon: string; dayIndex: number; expectedReturn: number; price: number }>,
  stats: { hitRate: number; medianReturn: number }
): FractalSignalContract['horizons'] {
  const horizonDays = [7, 14, 30, 90, 180, 365];
  
  return horizonDays.map((h, index) => {
    const marker = markers.find(m => m.horizon === `${h}d`);
    const expectedReturn = marker?.expectedReturn || 0;
    const action = deriveAction(expectedReturn);
    
    // Weight decreases with horizon (shorter = more weight)
    const weight = 1 / (index + 1);
    const normalizedWeight = weight / horizonDays.reduce((s, _, i) => s + 1/(i+1), 0);
    
    return {
      h,
      action,
      expectedReturn,
      confidence: stats.hitRate * (1 - index * 0.1), // Confidence decays with horizon
      weight: normalizedWeight,
      dominant: index === 2, // 30d is dominant by default
    };
  });
}

function extractHorizonNumbers(markers: Array<{ horizon: string }>): number[] {
  return markers
    .map(m => parseInt(m.horizon.replace('d', ''), 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);
}

function mapTopMatches(matches: SpxOverlayMatch[]): FractalSignalContract['explain']['topMatches'] {
  return matches.map(m => ({
    id: m.id,
    date: m.id, // ID is date string in SPX
    similarity: m.similarity,
    phase: m.phase,
    return: m.return,
    maxDrawdown: m.maxDrawdown,
    // UNIFIED: Include normalized series for Replay mode
    windowNormalized: m.windowNormalized || [],
    aftermathNormalized: m.aftermathNormalized || [],
  }));
}

function deriveNoTradeReasons(
  sampleSize: number,
  reliability: number,
  entropy: number
): string[] {
  const reasons: string[] = [];
  
  if (sampleSize < 10) {
    reasons.push('Insufficient historical samples');
  }
  if (reliability < 0.5) {
    reasons.push('Low pattern reliability');
  }
  if (entropy > 0.7) {
    reasons.push('High outcome uncertainty');
  }
  
  return reasons;
}

function calculateSizeMultiplier(reliability: number, entropy: number): number {
  // Size = reliability * (1 - entropy)
  const raw = reliability * (1 - entropy);
  return Math.max(0, Math.min(1, raw));
}

function buildInfluenceFactors(
  overlay: SpxFocusPack['overlay'],
  diagnostics: SpxFocusPack['diagnostics']
): FractalSignalContract['explain']['influence'] {
  return [
    {
      factor: 'Pattern Similarity',
      weight: 0.35,
      contribution: overlay.matches[0]?.similarity > 70 ? 'POSITIVE' : 'NEUTRAL',
    },
    {
      factor: 'Sample Size',
      weight: 0.25,
      contribution: diagnostics.sampleSize >= 15 ? 'POSITIVE' : diagnostics.sampleSize >= 8 ? 'NEUTRAL' : 'NEGATIVE',
    },
    {
      factor: 'Historical Coverage',
      weight: 0.20,
      contribution: diagnostics.coverageYears >= 20 ? 'POSITIVE' : 'NEUTRAL',
    },
    {
      factor: 'Entropy',
      weight: 0.20,
      contribution: diagnostics.entropy < 0.5 ? 'POSITIVE' : diagnostics.entropy < 0.7 ? 'NEUTRAL' : 'NEGATIVE',
    },
  ];
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export default {
  adaptSpxToFractal,
};
