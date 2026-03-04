/**
 * Path Entropy Calculator (P0.5)
 * 
 * Calculates mixing/obfuscation signal (0..1).
 * High entropy = potential mixer behavior.
 */

import { ISegmentV2 } from '../storage/route_enriched.model.js';
import { getUniqueChains, getUniqueCounterparties } from '../builders/route_graph_resolver.service.js';
import { isStablecoin } from '../builders/swap_segment_enricher.service.js';

// ============================================
// Config
// ============================================

const ENTROPY_CONFIG = {
  // Normalization factors
  MAX_HOPS: 20,
  MAX_COUNTERPARTIES: 15,
  MAX_CHAINS: 5,
  MAX_STABLE_HOPS: 5,
  
  // Weights
  WEIGHT_HOPS: 0.20,
  WEIGHT_COUNTERPARTIES: 0.25,
  WEIGHT_CHAINS: 0.15,
  WEIGHT_STABLE_HOPS: 0.15,
  WEIGHT_REPETITION: 0.15,
  WEIGHT_TYPE_DIVERSITY: 0.10
};

// ============================================
// Types
// ============================================

export interface PathEntropyResult {
  entropy: number;           // 0..1
  components: {
    hopScore: number;
    counterpartyScore: number;
    chainScore: number;
    stableHopScore: number;
    repetitionScore: number;
    typeDiversityScore: number;
  };
  indicators: string[];
}

// ============================================
// Main Calculator
// ============================================

/**
 * Calculate path entropy for route
 */
export function calculatePathEntropy(
  segments: ISegmentV2[],
  wallet: string
): PathEntropyResult {
  const result: PathEntropyResult = {
    entropy: 0,
    components: {
      hopScore: 0,
      counterpartyScore: 0,
      chainScore: 0,
      stableHopScore: 0,
      repetitionScore: 0,
      typeDiversityScore: 0
    },
    indicators: []
  };
  
  if (segments.length === 0) {
    return result;
  }
  
  // 1. Hop count score
  const hopCount = segments.length;
  result.components.hopScore = Math.min(hopCount / ENTROPY_CONFIG.MAX_HOPS, 1);
  
  if (hopCount > 5) {
    result.indicators.push('MANY_HOPS');
  }
  
  // 2. Unique counterparties score
  const counterparties = getUniqueCounterparties(segments, wallet);
  result.components.counterpartyScore = Math.min(
    counterparties.length / ENTROPY_CONFIG.MAX_COUNTERPARTIES,
    1
  );
  
  if (counterparties.length > 8) {
    result.indicators.push('MANY_COUNTERPARTIES');
  }
  
  // 3. Chain diversity score
  const chains = getUniqueChains(segments);
  result.components.chainScore = Math.min(
    chains.length / ENTROPY_CONFIG.MAX_CHAINS,
    1
  );
  
  if (chains.length >= 3) {
    result.indicators.push('MULTI_CHAIN_COMPLEX');
  }
  
  // 4. Stablecoin hop score
  const stableHops = countStablecoinHops(segments);
  result.components.stableHopScore = Math.min(
    stableHops / ENTROPY_CONFIG.MAX_STABLE_HOPS,
    1
  );
  
  if (stableHops >= 3) {
    result.indicators.push('STABLE_LAYERING');
  }
  
  // 5. Repetition score (same addresses appearing multiple times)
  result.components.repetitionScore = calculateRepetitionScore(segments, wallet);
  
  if (result.components.repetitionScore > 0.5) {
    result.indicators.push('ADDRESS_REPETITION');
  }
  
  // 6. Type diversity score
  result.components.typeDiversityScore = calculateTypeDiversity(segments);
  
  if (result.components.typeDiversityScore > 0.6) {
    result.indicators.push('DIVERSE_OPERATIONS');
  }
  
  // Calculate weighted sum
  result.entropy = 
    result.components.hopScore * ENTROPY_CONFIG.WEIGHT_HOPS +
    result.components.counterpartyScore * ENTROPY_CONFIG.WEIGHT_COUNTERPARTIES +
    result.components.chainScore * ENTROPY_CONFIG.WEIGHT_CHAINS +
    result.components.stableHopScore * ENTROPY_CONFIG.WEIGHT_STABLE_HOPS +
    result.components.repetitionScore * ENTROPY_CONFIG.WEIGHT_REPETITION +
    result.components.typeDiversityScore * ENTROPY_CONFIG.WEIGHT_TYPE_DIVERSITY;
  
  // Round to 2 decimal places
  result.entropy = Math.round(result.entropy * 100) / 100;
  
  // Add mixing indicator if high entropy
  if (result.entropy >= 0.65) {
    result.indicators.push('MIXING_SUSPECTED');
  }
  
  return result;
}

// ============================================
// Component Calculators
// ============================================

/**
 * Count stablecoin hops
 */
function countStablecoinHops(segments: ISegmentV2[]): number {
  let count = 0;
  
  for (const segment of segments) {
    // Check if segment involves stablecoin
    if (isStablecoin(segment.tokenAddress)) {
      count++;
    }
    
    // For swaps, check tokenIn/tokenOut
    if (segment.type === 'SWAP') {
      if (segment.tokenIn && isStablecoin(segment.tokenIn)) count++;
      if (segment.tokenOut && isStablecoin(segment.tokenOut)) count++;
    }
  }
  
  return count;
}

/**
 * Calculate repetition score
 */
function calculateRepetitionScore(segments: ISegmentV2[], wallet: string): number {
  const addressCount = new Map<string, number>();
  const excluded = wallet.toLowerCase();
  
  for (const segment of segments) {
    const from = segment.walletFrom.toLowerCase();
    const to = segment.walletTo.toLowerCase();
    
    if (from !== excluded) {
      addressCount.set(from, (addressCount.get(from) || 0) + 1);
    }
    if (to !== excluded) {
      addressCount.set(to, (addressCount.get(to) || 0) + 1);
    }
  }
  
  // Calculate how many addresses appear more than once
  let repeatedCount = 0;
  for (const count of addressCount.values()) {
    if (count > 1) repeatedCount++;
  }
  
  if (addressCount.size === 0) return 0;
  
  return Math.min(repeatedCount / addressCount.size, 1);
}

/**
 * Calculate type diversity score
 */
function calculateTypeDiversity(segments: ISegmentV2[]): number {
  const types = new Set<string>();
  
  for (const segment of segments) {
    types.add(segment.type);
  }
  
  // 6 possible types
  return types.size / 6;
}

// ============================================
// Analysis
// ============================================

/**
 * Check if route is suspected mixer
 */
export function isMixerSuspected(entropy: number, indicators: string[]): boolean {
  if (entropy >= 0.7) return true;
  
  // Multiple mixing indicators
  const mixingIndicators = ['STABLE_LAYERING', 'ADDRESS_REPETITION', 'MULTI_CHAIN_COMPLEX'];
  const foundCount = indicators.filter(i => mixingIndicators.includes(i)).length;
  
  return foundCount >= 2;
}

/**
 * Get entropy level
 */
export function getEntropyLevel(entropy: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (entropy >= 0.6) return 'HIGH';
  if (entropy >= 0.35) return 'MEDIUM';
  return 'LOW';
}

export { ENTROPY_CONFIG };
