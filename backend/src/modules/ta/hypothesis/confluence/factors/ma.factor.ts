/**
 * MA Factor - Moving Average alignment
 * 
 * Price above MA + bullish pattern = bonus
 * Price below MA + bearish pattern = bonus
 * Golden cross + bull = strong bonus
 */

import { FactorResult, PatternInput, MarketContext } from '../confluence_types.js';
import { CONFLUENCE_WEIGHTS } from '../confluence_weights.js';

export function maFactor(pattern: PatternInput, context: MarketContext): FactorResult {
  const maTrend = context.maTrend;
  const direction = pattern.direction;
  const reasons: string[] = [];
  
  let value = 0.5;
  
  // MA trend alignment
  if (maTrend === 'BULL' && (direction === 'BULL' || direction === 'BOTH')) {
    value = 0.9;
    reasons.push('ma_bull_aligned');
  } else if (maTrend === 'BEAR' && (direction === 'BEAR' || direction === 'BOTH')) {
    value = 0.9;
    reasons.push('ma_bear_aligned');
  } else if (maTrend === 'MIXED') {
    value = 0.6;
    reasons.push('ma_mixed');
  } else if (maTrend === 'FLAT') {
    value = 0.5;
    reasons.push('ma_flat');
  } else {
    // Counter-MA
    value = 0.4;
    reasons.push('counter_ma_trend');
  }
  
  // Price vs MA details
  if (context.priceVsMa50 !== undefined) {
    const dist = context.priceVsMa50;
    if (dist > 0.02 && direction === 'BULL') {
      value = Math.min(value + 0.05, 1.0);
      reasons.push('price_above_ma50');
    } else if (dist < -0.02 && direction === 'BEAR') {
      value = Math.min(value + 0.05, 1.0);
      reasons.push('price_below_ma50');
    }
  }
  
  // MA slope
  if (context.ma50Slope !== undefined) {
    const slope = context.ma50Slope;
    if (slope > 0 && direction === 'BULL') {
      reasons.push('ma50_rising');
    } else if (slope < 0 && direction === 'BEAR') {
      reasons.push('ma50_falling');
    }
  }
  
  if (reasons.length === 0) {
    reasons.push(`maTrend=${maTrend || 'unknown'}`);
  }
  
  return {
    name: 'ma',
    value,
    weight: CONFLUENCE_WEIGHTS.ma,
    reason: reasons
  };
}
