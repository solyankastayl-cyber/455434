/**
 * Fib Factor - Fibonacci confluence
 * 
 * Pattern at golden pocket (0.618-0.65) = strong bonus
 * Pattern at major fib level = good bonus
 */

import { FactorResult, PatternInput, MarketContext } from '../confluence_types.js';
import { CONFLUENCE_WEIGHTS } from '../confluence_weights.js';

export function fibFactor(pattern: PatternInput, context: MarketContext): FactorResult {
  const fib = context.nearestFib;
  const reasons: string[] = [];
  
  let value = 0.5;
  
  switch (fib) {
    case 'golden':
      value = 0.95;
      reasons.push('golden_pocket_confluence');
      break;
    case 'major':
      value = 0.8;
      reasons.push('major_fib_level');
      break;
    case 'minor':
      value = 0.65;
      reasons.push('minor_fib_level');
      break;
    case 'weak':
      value = 0.5;
      reasons.push('weak_fib_alignment');
      break;
    case 'none':
    default:
      value = 0.4;
      reasons.push('no_fib_confluence');
      break;
  }
  
  // Distance adjustment
  if (context.fibDistance !== undefined) {
    const dist = context.fibDistance;
    if (dist < 0.01) {
      value = Math.min(value + 0.05, 1.0);
      reasons.push('precise_fib_hit');
    }
  }
  
  return {
    name: 'fib',
    value,
    weight: CONFLUENCE_WEIGHTS.fib,
    reason: reasons
  };
}
