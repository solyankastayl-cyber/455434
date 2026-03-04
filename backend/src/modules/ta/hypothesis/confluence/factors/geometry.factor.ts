/**
 * Geometry Factor - Pattern geometric quality
 * 
 * Measures: symmetry, compression, noise level, fit quality
 */

import { FactorResult, PatternInput } from '../confluence_types.js';
import { CONFLUENCE_WEIGHTS } from '../confluence_weights.js';

export function geometryFactor(pattern: PatternInput): FactorResult {
  const metrics = pattern.metrics || {};
  const reasons: string[] = [];
  
  let value = pattern.score || 0.5;
  
  // Adjust based on available metrics
  if (metrics.geometryScore !== undefined) {
    value = metrics.geometryScore;
    reasons.push(`geometryScore=${metrics.geometryScore.toFixed(2)}`);
  }
  
  if (metrics.symmetry !== undefined && metrics.symmetry > 0.8) {
    value = Math.min(value + 0.1, 1.0);
    reasons.push('high_symmetry');
  }
  
  if (metrics.compression !== undefined && metrics.compression > 0.6) {
    value = Math.min(value + 0.05, 1.0);
    reasons.push('good_compression');
  }
  
  if (metrics.noiseScore !== undefined && metrics.noiseScore > 0.7) {
    value = Math.min(value + 0.05, 1.0);
    reasons.push('low_noise');
  }
  
  if (reasons.length === 0) {
    reasons.push(`base_score=${pattern.score.toFixed(2)}`);
  }
  
  return {
    name: 'geometry',
    value: Math.max(0, Math.min(1, value)),
    weight: CONFLUENCE_WEIGHTS.geometry,
    reason: reasons
  };
}
