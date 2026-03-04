/**
 * BLOCK 1.4 — Alt Feature Vector
 * ================================
 * Standardized feature vector for each altcoin.
 * Maps to ~40 indicators from existing IndicatorVector.
 */

import type { FundingContextLabel } from '../../funding/contracts/funding.context.js';

export interface AltFeatureVector {
  symbol: string;
  ts: number;

  // === Core Momentum ===
  rsi: number;              // 0-100
  rsiSlope: number;         // rate of change
  rsiZ: number;             // z-score
  macdHist: number;         // MACD histogram
  momentum1h: number;       // % return 1h
  momentum4h: number;       // % return 4h
  momentum24h: number;      // % return 24h

  // === Volume / Flow ===
  volumeZ: number;          // volume z-score
  volumeTrend: number;      // volume trend
  orderImbalance: number;   // -1..+1

  // === Derivatives (Funding Layer) ===
  fundingScore: number;     // -1..+1 from FundingNormalizer
  fundingTrend: number;     // rate of change
  fundingLabel: FundingContextLabel;
  oiDelta: number;          // open interest change %
  oiZ: number;              // OI z-score
  longBias: number;         // -1..+1 long/short imbalance

  // === Liquidations ===
  liquidationPressure: number;  // -1..+1 (buy vs sell liqs)
  liquidationZ: number;
  cascadeRisk: number;      // 0..1

  // === Volatility / Regime ===
  volatility: number;       // ATR %
  volatilityZ: number;
  trendStrength: number;    // 0..1

  // === Market Structure ===
  breakoutScore: number;    // 0..1
  meanrevScore: number;     // 0..1
  squeezeScore: number;     // 0..1

  // === Macro Overlay ===
  btcCorrelation: number;   // -1..+1
  btcDominanceDelta: number;

  // === Quality ===
  coverage: number;         // 0..1 how many features available
  missing: string[];        // list of missing features

  // === Labels (for training) ===
  futureReturn?: number;
  label?: 'WINNER' | 'LOSER' | 'NEUTRAL';
}

// Feature keys for normalization
export const ALT_FEATURE_KEYS = [
  'rsi',
  'rsiSlope',
  'rsiZ',
  'macdHist',
  'momentum1h',
  'momentum4h',
  'momentum24h',
  'volumeZ',
  'volumeTrend',
  'orderImbalance',
  'fundingScore',
  'fundingTrend',
  'oiDelta',
  'oiZ',
  'longBias',
  'liquidationPressure',
  'liquidationZ',
  'cascadeRisk',
  'volatility',
  'volatilityZ',
  'trendStrength',
  'breakoutScore',
  'meanrevScore',
  'squeezeScore',
  'btcCorrelation',
  'btcDominanceDelta',
] as const;

console.log('[Screener] Alt Feature Vector types loaded');
