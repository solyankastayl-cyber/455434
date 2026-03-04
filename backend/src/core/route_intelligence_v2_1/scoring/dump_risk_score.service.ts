/**
 * Dump Risk Score Calculator (P0.5)
 * 
 * Composite risk score (0..100) combining:
 * - Exit probability
 * - DEX activity
 * - Transfer patterns
 * - Mixer suspicion
 */

import { ISegmentV2, IRouteLabels, IRiskScores } from '../storage/route_enriched.model.js';
import { ExitProbabilityResult } from './exit_probability.service.js';
import { PathEntropyResult, isMixerSuspected } from './path_entropy.service.js';

// ============================================
// Config
// ============================================

const DUMP_RISK_CONFIG = {
  // Component weights (total = 100)
  WEIGHT_EXIT_PROBABILITY: 60,
  WEIGHT_DEX_ACTIVITY: 15,
  WEIGHT_LARGE_TRANSFER: 15,
  WEIGHT_MIXER: 10,
  
  // Thresholds
  LARGE_TRANSFER_USD: 50000,
  HIGH_DEX_ACTIVITY_THRESHOLD: 3,  // swaps
  
  // Risk levels
  THRESHOLD_HIGH: 80,
  THRESHOLD_CRITICAL: 90
};

// ============================================
// Types
// ============================================

export interface DumpRiskResult {
  score: number;              // 0..100
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  components: {
    exitProbabilityScore: number;
    dexActivityScore: number;
    largeTransferScore: number;
    mixerScore: number;
  };
  flags: string[];
}

// ============================================
// Main Calculator
// ============================================

/**
 * Calculate dump risk score
 */
export function calculateDumpRiskScore(
  segments: ISegmentV2[],
  labels: IRouteLabels,
  exitResult: ExitProbabilityResult,
  entropyResult: PathEntropyResult,
  totalAmountUsd: number
): DumpRiskResult {
  const result: DumpRiskResult = {
    score: 0,
    level: 'LOW',
    components: {
      exitProbabilityScore: 0,
      dexActivityScore: 0,
      largeTransferScore: 0,
      mixerScore: 0
    },
    flags: []
  };
  
  // 1. Exit probability component (0-60)
  result.components.exitProbabilityScore = exitResult.probability * DUMP_RISK_CONFIG.WEIGHT_EXIT_PROBABILITY;
  
  if (exitResult.probability >= 0.75) {
    result.flags.push('HIGH_EXIT_PROBABILITY');
  }
  
  // 2. DEX activity component (0-15)
  const swapCount = segments.filter(s => s.type === 'SWAP').length;
  const dexScore = Math.min(swapCount / DUMP_RISK_CONFIG.HIGH_DEX_ACTIVITY_THRESHOLD, 1);
  result.components.dexActivityScore = dexScore * DUMP_RISK_CONFIG.WEIGHT_DEX_ACTIVITY;
  
  if (swapCount >= DUMP_RISK_CONFIG.HIGH_DEX_ACTIVITY_THRESHOLD) {
    result.flags.push('HIGH_DEX_ACTIVITY');
  }
  
  // 3. Large transfer component (0-15)
  if (totalAmountUsd >= DUMP_RISK_CONFIG.LARGE_TRANSFER_USD) {
    const transferScore = Math.min(
      totalAmountUsd / (DUMP_RISK_CONFIG.LARGE_TRANSFER_USD * 4),
      1
    );
    result.components.largeTransferScore = transferScore * DUMP_RISK_CONFIG.WEIGHT_LARGE_TRANSFER;
    result.flags.push('LARGE_TRANSFER');
  }
  
  // 4. Mixer component (0-10)
  if (isMixerSuspected(entropyResult.entropy, entropyResult.indicators)) {
    result.components.mixerScore = DUMP_RISK_CONFIG.WEIGHT_MIXER;
    result.flags.push('MIXER_SUSPECTED');
  } else if (entropyResult.entropy > 0.5) {
    // Partial score for high entropy
    result.components.mixerScore = entropyResult.entropy * DUMP_RISK_CONFIG.WEIGHT_MIXER;
  }
  
  // Calculate total score
  result.score = 
    result.components.exitProbabilityScore +
    result.components.dexActivityScore +
    result.components.largeTransferScore +
    result.components.mixerScore;
  
  // Clamp to 0-100
  result.score = Math.min(Math.max(Math.round(result.score), 0), 100);
  
  // Determine risk level
  result.level = getRiskLevel(result.score);
  
  // Add level flag
  if (result.level === 'CRITICAL') {
    result.flags.push('CRITICAL_RISK');
  } else if (result.level === 'HIGH') {
    result.flags.push('HIGH_RISK');
  }
  
  return result;
}

/**
 * Get risk level from score
 */
export function getRiskLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (score >= DUMP_RISK_CONFIG.THRESHOLD_CRITICAL) return 'CRITICAL';
  if (score >= DUMP_RISK_CONFIG.THRESHOLD_HIGH) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}

/**
 * Check if should generate alert
 */
export function shouldGenerateAlert(
  score: number,
  exitProbability: number,
  labels: IRouteLabels
): { shouldAlert: boolean; severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' } {
  // Critical override: high exit probability + CEX touched
  if (exitProbability >= 0.75 && labels.cexTouched) {
    return { shouldAlert: true, severity: 'CRITICAL' };
  }
  
  if (score >= DUMP_RISK_CONFIG.THRESHOLD_CRITICAL) {
    return { shouldAlert: true, severity: 'CRITICAL' };
  }
  
  if (score >= DUMP_RISK_CONFIG.THRESHOLD_HIGH) {
    return { shouldAlert: true, severity: 'HIGH' };
  }
  
  return { shouldAlert: false, severity: 'LOW' };
}

/**
 * Create risk scores object
 */
export function createRiskScores(
  exitResult: ExitProbabilityResult,
  entropyResult: PathEntropyResult,
  dumpResult: DumpRiskResult
): IRiskScores {
  return {
    exitProbability: exitResult.probability,
    dumpRiskScore: dumpResult.score,
    pathEntropy: entropyResult.entropy
  };
}

export { DUMP_RISK_CONFIG };
