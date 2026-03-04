/**
 * Regime Factor - Market structure alignment
 * 
 * Bull patterns in uptrend = bonus
 * Bear patterns in downtrend = bonus
 * Counter-trend patterns = penalty
 */

import { FactorResult, PatternInput, MarketContext } from '../confluence_types.js';
import { CONFLUENCE_WEIGHTS } from '../confluence_weights.js';

export function regimeFactor(pattern: PatternInput, context: MarketContext): FactorResult {
  const regime = context.regime;
  const direction = pattern.direction;
  const reasons: string[] = [];
  
  let value = 0.5; // neutral default
  
  // Trend alignment
  if (regime === 'UP' && (direction === 'BULL' || direction === 'BOTH')) {
    value = 1.0;
    reasons.push('aligned_with_uptrend');
  } else if (regime === 'DOWN' && (direction === 'BEAR' || direction === 'BOTH')) {
    value = 1.0;
    reasons.push('aligned_with_downtrend');
  } else if (regime === 'SIDEWAYS') {
    // Range patterns work well
    value = 0.7;
    reasons.push('sideways_market');
  } else if (regime === 'TRANSITION') {
    // Uncertain regime
    value = 0.6;
    reasons.push('transition_regime');
  } else {
    // Counter-trend
    value = 0.4;
    reasons.push('counter_trend');
  }
  
  // Add hhhlScore bonus if available
  if (context.hhhlScore !== undefined) {
    const hhhl = context.hhhlScore;
    if (hhhl > 0.7 && direction === 'BULL') {
      value = Math.min(value + 0.1, 1.0);
      reasons.push('strong_hh_hl_structure');
    } else if (hhhl < -0.7 && direction === 'BEAR') {
      value = Math.min(value + 0.1, 1.0);
      reasons.push('strong_lh_ll_structure');
    }
  }
  
  return {
    name: 'regime',
    value,
    weight: CONFLUENCE_WEIGHTS.regime,
    reason: reasons
  };
}
