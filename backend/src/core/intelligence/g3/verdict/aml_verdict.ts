/**
 * AML Verdict Calculator
 * 
 * Determines verdict (LOW/MEDIUM/HIGH/CRITICAL) from risk score
 */

import { G3_CONFIG } from '../g3.config.js';
import { Verdict } from '../g3.types.js';

/**
 * Convert risk score to verdict
 */
export function verdictFromScore(score: number): Verdict {
  if (score >= G3_CONFIG.verdictThresholds.CRITICAL) return 'CRITICAL';
  if (score >= G3_CONFIG.verdictThresholds.HIGH) return 'HIGH';
  if (score >= G3_CONFIG.verdictThresholds.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

/**
 * Get verdict color for UI
 */
export function verdictColor(verdict: Verdict): string {
  switch (verdict) {
    case 'CRITICAL':
      return '#DC2626'; // red-600
    case 'HIGH':
      return '#EA580C'; // orange-600
    case 'MEDIUM':
      return '#F59E0B'; // amber-500
    case 'LOW':
      return '#10B981'; // green-500
  }
}
