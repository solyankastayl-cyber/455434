/**
 * Volatility Factor - Volatility Gate
 * 
 * High volatility reduces pattern reliability.
 * Acts as a MULTIPLIER (gate) not additive factor.
 */

import { FactorResult, MarketContext } from '../confluence_types.js';
import { CONFLUENCE_WEIGHTS } from '../confluence_weights.js';

export function volatilityFactor(context: MarketContext): FactorResult {
  const vol = context.volatility;
  const reasons: string[] = [];
  
  let value = 1.0;
  let multiplier = 1.0;
  
  switch (vol) {
    case 'LOW':
      value = 0.9;
      multiplier = 1.0;
      reasons.push('low_vol_stable');
      break;
    case 'NORMAL':
      value = 1.0;
      multiplier = 1.0;
      reasons.push('normal_vol');
      break;
    case 'HIGH':
      value = 0.6;
      multiplier = 0.85;
      reasons.push('high_vol_caution');
      break;
    case 'EXTREME':
      value = 0.4;
      multiplier = 0.7;
      reasons.push('extreme_vol_danger');
      break;
    default:
      value = 0.7;
      reasons.push('vol_unknown');
  }
  
  // ATR percentile details
  if (context.atrPercentile !== undefined) {
    const pct = context.atrPercentile;
    reasons.push(`atr_pct=${(pct * 100).toFixed(0)}`);
    
    if (pct > 0.9) {
      multiplier *= 0.8;
      reasons.push('atr_extreme_90pct');
    }
  }
  
  return {
    name: 'volatility',
    value,
    weight: CONFLUENCE_WEIGHTS.volatility,
    multiplier,
    reason: reasons
  };
}
