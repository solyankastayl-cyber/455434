/**
 * BLOCK 9 — Explainability Types
 * ================================
 * 
 * "Why this asset today" — clear explanation of selection.
 */

import type { Venue } from '../types.js';
import type { MarketContext } from '../ml/ml.types.js';

// ═══════════════════════════════════════════════════════════════
// EXPLAIN VECTOR
// ═══════════════════════════════════════════════════════════════

export interface ExplainVector {
  asset: string;
  date: string;
  venue: Venue;
  
  // Scores
  opportunityScore: number;
  confidence: number;
  
  // Drivers (local reasons)
  drivers: IndicatorDriver[];
  
  // Pattern evidence
  patterns: PatternEvidence[];
  
  // Market context binding
  marketContext: MarketContextBinding;
  
  // Final interpretation
  summary: string;
  
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR DRIVERS
// ═══════════════════════════════════════════════════════════════

export interface IndicatorDriver {
  indicator: string;
  direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  strength: number;        // 0..1
  value: number;
  threshold?: number;
  reason: string;
}

export const DRIVER_CONFIGS: Record<string, {
  posThreshold: number;
  negThreshold: number;
  posReason: (val: number) => string;
  negReason: (val: number) => string;
}> = {
  rsi_14: {
    posThreshold: 30,
    negThreshold: 70,
    posReason: (val) => `RSI oversold at ${val.toFixed(0)}, potential bounce`,
    negReason: (val) => `RSI overbought at ${val.toFixed(0)}, potential reversal`,
  },
  rsi_z: {
    posThreshold: -1.5,
    negThreshold: 1.5,
    posReason: (val) => `RSI z-score extremely low (${val.toFixed(2)}), mean reversion likely`,
    negReason: (val) => `RSI z-score extremely high (${val.toFixed(2)}), exhaustion possible`,
  },
  funding_rate: {
    posThreshold: -0.0001,
    negThreshold: 0.0003,
    posReason: (_val) => `Negative funding — shorts paying longs`,
    negReason: (_val) => `High positive funding — crowded long trade`,
  },
  funding_z: {
    posThreshold: -1.5,
    negThreshold: 1.5,
    posReason: (_val) => `Extremely negative funding z-score`,
    negReason: (_val) => `Extremely positive funding z-score`,
  },
  oi_change_1h: {
    posThreshold: 5,
    negThreshold: -5,
    posReason: (val) => `OI expanding +${val.toFixed(1)}% — new positions entering`,
    negReason: (val) => `OI contracting ${val.toFixed(1)}% — positions closing`,
  },
  volatility_z: {
    posThreshold: -1,
    negThreshold: 2,
    posReason: (_val) => `Low volatility — potential breakout setup`,
    negReason: (_val) => `Extreme volatility — risk-off conditions`,
  },
  squeeze_score: {
    posThreshold: 0.5,
    negThreshold: -1, // Never negative
    posReason: (_val) => `Volatility squeeze forming — expect expansion`,
    negReason: () => '',
  },
  trend_score: {
    posThreshold: 0.5,
    negThreshold: -0.5,
    posReason: (val) => `Strong bullish trend (${(val * 100).toFixed(0)}%)`,
    negReason: (val) => `Strong bearish trend (${(val * 100).toFixed(0)}%)`,
  },
  long_bias: {
    posThreshold: 0.3,
    negThreshold: -0.3,
    posReason: (_val) => `Longs dominant — watch for continuation`,
    negReason: (_val) => `Shorts dominant — watch for squeeze`,
  },
  liq_imbalance: {
    posThreshold: 0.3,
    negThreshold: -0.3,
    posReason: (_val) => `More shorts liquidated — bullish pressure`,
    negReason: (_val) => `More longs liquidated — bearish pressure`,
  },
  breakout_score: {
    posThreshold: 0.7,
    negThreshold: -1,
    posReason: (_val) => `Near breakout from range`,
    negReason: () => '',
  },
  meanrev_score: {
    posThreshold: 0.5,
    negThreshold: -1,
    posReason: (_val) => `Mean reversion setup active`,
    negReason: () => '',
  },
};

// ═══════════════════════════════════════════════════════════════
// PATTERN EVIDENCE
// ═══════════════════════════════════════════════════════════════

export interface PatternEvidence {
  id: string;
  name: string;
  description: string;
  hitRate7d: number;
  avgReturn7d: number;
  sampleCount: number;
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════
// MARKET CONTEXT BINDING
// ═══════════════════════════════════════════════════════════════

export interface MarketContextBinding {
  btcRegime: string;
  fundingBias: 'LONG_SQUEEZE' | 'SHORT_SQUEEZE' | 'NEUTRAL';
  volatilityState: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  interpretation: string;
}

export function interpretMarketContext(context: MarketContext): MarketContextBinding {
  // Funding bias
  let fundingBias: MarketContextBinding['fundingBias'] = 'NEUTRAL';
  if (context.fundingGlobal < -0.0001) fundingBias = 'SHORT_SQUEEZE';
  else if (context.fundingGlobal > 0.0002) fundingBias = 'LONG_SQUEEZE';

  // Volatility state
  let volatilityState: MarketContextBinding['volatilityState'] = 'NORMAL';
  if (context.btcVolatility < 0.3) volatilityState = 'LOW';
  else if (context.btcVolatility > 0.7) volatilityState = 'HIGH';
  else if (context.btcVolatility > 0.9) volatilityState = 'EXTREME';

  // Interpretation
  let interpretation = '';
  
  if (context.marketRegime === 'RANGE') {
    interpretation = 'BTC in range — alt rotation likely';
  } else if (context.marketRegime === 'BULL') {
    interpretation = 'BTC bullish — alts may follow or outperform';
  } else if (context.marketRegime === 'BEAR') {
    interpretation = 'BTC bearish — selective alt opportunities only';
  } else {
    interpretation = 'Risk-off conditions — caution advised';
  }

  if (fundingBias !== 'NEUTRAL') {
    interpretation += `. ${fundingBias === 'SHORT_SQUEEZE' ? 'Short squeeze potential' : 'Long squeeze risk'}`;
  }

  return {
    btcRegime: context.marketRegime,
    fundingBias,
    volatilityState,
    interpretation,
  };
}

console.log('[Block9] Explainability Types loaded');
