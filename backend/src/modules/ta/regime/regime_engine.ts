/**
 * Phase I.0: Regime Engine
 * 
 * Deterministic classification of market regime
 */

import { RegimeLabel, MarketRegime, VolRegime, RegimeSignals } from './regime_types.js';

function clamp(x: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, x));
}

/**
 * Classify volatility regime from ATR percentile
 */
export function classifyVol(atrPercentile: number): VolRegime {
  if (atrPercentile >= 0.92) return 'EXTREME';
  if (atrPercentile >= 0.75) return 'HIGH';
  if (atrPercentile <= 0.25) return 'LOW';
  return 'NORMAL';
}

/**
 * Classify market regime from structure + MA + compression
 */
export function classifyMarketRegime(params: {
  maAlignment: 'BULL' | 'BEAR' | 'MIXED';
  maSlope20: number;
  maSlope50: number;
  structure: 'HH_HL' | 'LH_LL' | 'MIXED' | 'UNKNOWN';
  compression: number;
}): { regime: MarketRegime; confidence: number } {
  const { maAlignment, maSlope20, maSlope50, structure, compression } = params;

  // Slope strength (combined)
  const slopeMag = Math.abs(maSlope20) + Math.abs(maSlope50);
  const slopeScore = clamp(slopeMag / 0.02); // 2%/bar combined = "strong"

  // Structure score
  const bullStruct = structure === 'HH_HL' ? 1 : structure === 'MIXED' ? 0.5 : 0;
  const bearStruct = structure === 'LH_LL' ? 1 : structure === 'MIXED' ? 0.5 : 0;

  // Alignment score
  const bullAlign = maAlignment === 'BULL' ? 1 : maAlignment === 'MIXED' ? 0.5 : 0;
  const bearAlign = maAlignment === 'BEAR' ? 1 : maAlignment === 'MIXED' ? 0.5 : 0;

  // Trend strength: alignment + structure + slope, penalized by compression
  const bullTrend = (0.45 * bullAlign + 0.35 * bullStruct + 0.20 * slopeScore) * (1 - 0.6 * compression);
  const bearTrend = (0.45 * bearAlign + 0.35 * bearStruct + 0.20 * slopeScore) * (1 - 0.6 * compression);

  // Range strength: high compression + mixed signals
  const rangeScore = clamp(
    0.6 * compression + 
    (maAlignment === 'MIXED' ? 0.3 : 0) + 
    (structure === 'MIXED' ? 0.2 : 0)
  );

  // Decision
  if (bullTrend > 0.58 && bullTrend > bearTrend + 0.10) {
    return { regime: 'TREND_UP', confidence: clamp(bullTrend) };
  }
  if (bearTrend > 0.58 && bearTrend > bullTrend + 0.10) {
    return { regime: 'TREND_DOWN', confidence: clamp(bearTrend) };
  }
  if (rangeScore > 0.60) {
    return { regime: 'RANGE', confidence: clamp(rangeScore) };
  }

  // Transition = uncertain / mixed signals
  const conf = clamp(Math.max(bullTrend, bearTrend, rangeScore) * 0.85);
  return { regime: 'TRANSITION', confidence: conf };
}

/**
 * Build complete regime label from inputs
 */
export function buildRegimeLabel(input: {
  maAlignment: 'BULL' | 'BEAR' | 'MIXED';
  maSlope20: number;
  maSlope50: number;
  structure: 'HH_HL' | 'LH_LL' | 'MIXED' | 'UNKNOWN';
  compression: number;
  atrPercentile: number;
}): RegimeLabel {
  const volRegime = classifyVol(input.atrPercentile);
  const { regime, confidence } = classifyMarketRegime({
    maAlignment: input.maAlignment,
    maSlope20: input.maSlope20,
    maSlope50: input.maSlope50,
    structure: input.structure,
    compression: input.compression,
  });

  return {
    marketRegime: regime,
    volRegime,
    confidence,
    signals: {
      maAlignment: input.maAlignment,
      maSlope20: input.maSlope20,
      maSlope50: input.maSlope50,
      structure: input.structure,
      compression: input.compression,
      atrPercentile: input.atrPercentile,
    },
  };
}

/**
 * Infer regime signals from feature pack / analysis data
 */
export function inferRegimeSignals(featurePack: any, structure: any): RegimeSignals {
  // MA alignment from trend indicators
  let maAlignment: 'BULL' | 'BEAR' | 'MIXED' = 'MIXED';
  const maTrend = featurePack?.maTrend || structure?.maTrend;
  if (maTrend === 'BULL' || maTrend === 'BULLISH') maAlignment = 'BULL';
  else if (maTrend === 'BEAR' || maTrend === 'BEARISH') maAlignment = 'BEAR';

  // MA slopes
  const maSlope20 = featurePack?.indicators?.maSlope20 || 0;
  const maSlope50 = featurePack?.indicators?.maSlope50 || 0;

  // Structure from HH/HL or LH/LL
  let structureLabel: 'HH_HL' | 'LH_LL' | 'MIXED' | 'UNKNOWN' = 'UNKNOWN';
  const hhhlScore = structure?.hhhlScore || featurePack?.hhhlScore || 0;
  if (hhhlScore > 0.6) structureLabel = 'HH_HL';
  else if (hhhlScore < -0.6) structureLabel = 'LH_LL';
  else if (Math.abs(hhhlScore) > 0.2) structureLabel = 'MIXED';

  // Compression
  const compression = structure?.compressionScore || featurePack?.compressionScore || 0;

  // ATR percentile
  const atrPercentile = featurePack?.volatility?.atrPercentile || 0.5;

  return {
    maAlignment,
    maSlope20,
    maSlope50,
    structure: structureLabel,
    compression,
    atrPercentile,
  };
}
