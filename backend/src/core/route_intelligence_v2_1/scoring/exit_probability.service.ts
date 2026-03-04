/**
 * Exit Probability Calculator (P0.5)
 * 
 * Rules-based calculation of exit probability (0..1).
 * NO ML - purely deterministic signals.
 */

import { ISegmentV2, IRouteLabels } from '../storage/route_enriched.model.js';
import { hasSwapBeforeExitPattern, hasSwapToStablePattern, countSwaps } from '../builders/swap_segment_enricher.service.js';
import { getRouteDuration, getUniqueChains } from '../builders/route_graph_resolver.service.js';

// ============================================
// Config - Signal Weights
// ============================================

const EXIT_SIGNALS = {
  // Core signals
  TOUCHED_CEX: 0.45,           // Route touches CEX
  ENDS_AT_CEX: 0.15,           // Additional if ends at CEX
  
  // Pattern signals
  BRIDGE_AFTER_SWAP: 0.12,     // Bridge follows swap
  SWAP_TO_STABLE: 0.10,        // Swap output is stablecoin
  SWAP_BEFORE_EXIT: 0.08,      // Swap shortly before CEX deposit
  
  // Route characteristics
  MULTI_CHAIN: 0.05,           // Multiple chains involved
  HIGH_HOP_COUNT: 0.05,        // More than 3 hops
  FAST_EXECUTION: 0.08,        // Route completed in <30 min
  
  // Bridge patterns
  KNOWN_BRIDGE_ROUTER: 0.08,   // Uses known bridge
  MULTIPLE_BRIDGES: 0.05,      // More than 1 bridge
  
  // Entropy signal (from path_entropy)
  HIGH_ENTROPY: 0.07           // Path entropy > 0.6
};

// ============================================
// Types
// ============================================

export interface ExitProbabilityResult {
  probability: number;         // 0..1
  signals: string[];           // Active signals
  breakdown: Record<string, number>;  // Signal contributions
}

// ============================================
// Main Calculator
// ============================================

/**
 * Calculate exit probability for route
 */
export function calculateExitProbability(
  segments: ISegmentV2[],
  labels: IRouteLabels,
  pathEntropy: number
): ExitProbabilityResult {
  const result: ExitProbabilityResult = {
    probability: 0,
    signals: [],
    breakdown: {}
  };
  
  if (segments.length === 0) {
    return result;
  }
  
  // Signal 1: CEX touched
  if (labels.cexTouched) {
    addSignal(result, 'TOUCHED_CEX', EXIT_SIGNALS.TOUCHED_CEX);
    
    // Additional: ends at CEX
    const lastSegment = segments[segments.length - 1];
    if (lastSegment.type === 'CEX_DEPOSIT') {
      addSignal(result, 'ENDS_AT_CEX', EXIT_SIGNALS.ENDS_AT_CEX);
    }
  }
  
  // Signal 2: Bridge after swap pattern
  if (hasBridgeAfterSwap(segments)) {
    addSignal(result, 'BRIDGE_AFTER_SWAP', EXIT_SIGNALS.BRIDGE_AFTER_SWAP);
  }
  
  // Signal 3: Swap to stablecoin
  if (hasSwapToStablePattern(segments)) {
    addSignal(result, 'SWAP_TO_STABLE', EXIT_SIGNALS.SWAP_TO_STABLE);
  }
  
  // Signal 4: Swap before exit
  if (hasSwapBeforeExitPattern(segments)) {
    addSignal(result, 'SWAP_BEFORE_EXIT', EXIT_SIGNALS.SWAP_BEFORE_EXIT);
  }
  
  // Signal 5: Multi-chain
  const chains = getUniqueChains(segments);
  if (chains.length > 1) {
    addSignal(result, 'MULTI_CHAIN', EXIT_SIGNALS.MULTI_CHAIN);
  }
  
  // Signal 6: High hop count
  if (segments.length > 3) {
    addSignal(result, 'HIGH_HOP_COUNT', EXIT_SIGNALS.HIGH_HOP_COUNT);
  }
  
  // Signal 7: Fast execution
  const duration = getRouteDuration(segments);
  if (duration > 0 && duration < 30 * 60 * 1000) { // < 30 minutes
    addSignal(result, 'FAST_EXECUTION', EXIT_SIGNALS.FAST_EXECUTION);
  }
  
  // Signal 8: Known bridge router
  if (labels.bridgeTouched) {
    addSignal(result, 'KNOWN_BRIDGE_ROUTER', EXIT_SIGNALS.KNOWN_BRIDGE_ROUTER);
    
    // Multiple bridges
    const bridgeCount = segments.filter(s => s.type === 'BRIDGE').length;
    if (bridgeCount > 1) {
      addSignal(result, 'MULTIPLE_BRIDGES', EXIT_SIGNALS.MULTIPLE_BRIDGES);
    }
  }
  
  // Signal 9: High entropy
  if (pathEntropy > 0.6) {
    addSignal(result, 'HIGH_ENTROPY', EXIT_SIGNALS.HIGH_ENTROPY);
  }
  
  // Clamp probability to 0..1
  result.probability = Math.min(Math.max(result.probability, 0), 1);
  
  // Round to 2 decimal places
  result.probability = Math.round(result.probability * 100) / 100;
  
  return result;
}

/**
 * Add signal to result
 */
function addSignal(
  result: ExitProbabilityResult,
  signal: string,
  weight: number
): void {
  result.signals.push(signal);
  result.breakdown[signal] = weight;
  result.probability += weight;
}

// ============================================
// Pattern Detection
// ============================================

/**
 * Check for bridge after swap pattern
 */
function hasBridgeAfterSwap(segments: ISegmentV2[]): boolean {
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].type === 'SWAP') {
      // Check next 2 segments for bridge
      for (let j = i + 1; j < Math.min(i + 3, segments.length); j++) {
        if (segments[j].type === 'BRIDGE') {
          return true;
        }
      }
    }
  }
  return false;
}

// ============================================
// Thresholds
// ============================================

/**
 * Get risk level from probability
 */
export function getExitRiskLevel(probability: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (probability >= 0.85) return 'CRITICAL';
  if (probability >= 0.65) return 'HIGH';
  if (probability >= 0.40) return 'MEDIUM';
  return 'LOW';
}

/**
 * Check if exit is imminent
 */
export function isExitImminent(
  probability: number,
  labels: IRouteLabels
): boolean {
  // Override rule: high probability + CEX touched = imminent
  return probability >= 0.75 && labels.cexTouched;
}

export { EXIT_SIGNALS };
