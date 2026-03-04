/**
 * Touches Factor - Level/line touch strength
 * 
 * More touches = more validated pattern
 */

import { FactorResult, PatternInput } from '../confluence_types.js';
import { CONFLUENCE_WEIGHTS } from '../confluence_weights.js';

export function touchesFactor(pattern: PatternInput): FactorResult {
  const metrics = pattern.metrics || {};
  const reasons: string[] = [];
  
  // Count total touches
  let touches = metrics.touches || 0;
  
  // For channels/triangles, use upper + lower
  if (metrics.touchesUpper !== undefined && metrics.touchesLower !== undefined) {
    touches = metrics.touchesUpper + metrics.touchesLower;
  }
  
  // Use touchScore if available (already normalized)
  if (metrics.touchScore !== undefined) {
    reasons.push(`touchScore=${metrics.touchScore.toFixed(2)}`);
    return {
      name: 'touches',
      value: metrics.touchScore,
      weight: CONFLUENCE_WEIGHTS.touches,
      reason: reasons
    };
  }
  
  // Normalize: 5+ touches = perfect (1.0)
  const value = Math.min(touches / 5, 1);
  reasons.push(`touches=${touches}`);
  
  if (touches >= 6) reasons.push('excellent_validation');
  else if (touches >= 4) reasons.push('good_validation');
  else if (touches < 2) reasons.push('weak_validation');
  
  return {
    name: 'touches',
    value,
    weight: CONFLUENCE_WEIGHTS.touches,
    reason: reasons
  };
}
