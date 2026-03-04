/**
 * Risk/Reward Factor
 * 
 * R:R >= 3 = excellent
 * R:R >= 2 = good
 * R:R < 1.5 = poor
 */

import { FactorResult, PatternInput } from '../confluence_types.js';
import { CONFLUENCE_WEIGHTS } from '../confluence_weights.js';

export function rrFactor(pattern: PatternInput): FactorResult {
  const metrics = pattern.metrics || {};
  const trade = pattern.trade || {};
  const reasons: string[] = [];
  
  // Get R:R from metrics or calculate from trade
  let rr = metrics.rr;
  
  if (rr === undefined && trade.entry && trade.stop && trade.target1) {
    const risk = Math.abs(trade.entry - trade.stop);
    const reward = Math.abs(trade.target1 - trade.entry);
    if (risk > 0) {
      rr = reward / risk;
    }
  }
  
  // Default if still undefined
  if (rr === undefined) {
    rr = 1.5;
    reasons.push('rr_estimated');
  }
  
  let value = 0.5;
  
  if (rr >= 3) {
    value = 1.0;
    reasons.push('excellent_rr');
  } else if (rr >= 2.5) {
    value = 0.9;
    reasons.push('very_good_rr');
  } else if (rr >= 2) {
    value = 0.8;
    reasons.push('good_rr');
  } else if (rr >= 1.5) {
    value = 0.6;
    reasons.push('acceptable_rr');
  } else {
    value = 0.4;
    reasons.push('poor_rr');
  }
  
  reasons.push(`rr=${rr.toFixed(2)}`);
  
  return {
    name: 'rr',
    value,
    weight: CONFLUENCE_WEIGHTS.rr,
    reason: reasons
  };
}
