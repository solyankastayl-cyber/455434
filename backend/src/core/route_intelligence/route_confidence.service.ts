/**
 * Route Confidence Engine (P0.3)
 * 
 * Calculates confidence score for route validity.
 * Higher confidence = more certain this is a real liquidity path.
 */

import { IRouteSegment } from './route_segment.model.js';

// ============================================
// Configuration
// ============================================

const WEIGHTS = {
  amountSimilarity: 0.25,   // How similar are amounts between segments
  timeProximity: 0.20,      // How close in time are segments
  bridgeMatch: 0.20,        // Known bridge protocol used
  protocolKnown: 0.15,      // Known protocol (DEX, bridge)
  cexMatch: 0.20            // Ends at known CEX
};

const THRESHOLDS = {
  // Amount similarity: within X% is considered "matching"
  amountSimilarityPercent: 5,
  
  // Time proximity: segments within X minutes are "proximate"
  timeProximityMinutes: 30,
  
  // Max time gap before route is considered broken
  maxTimeGapMinutes: 120
};

// ============================================
// Types
// ============================================

export interface ConfidenceFactors {
  amountSimilarity: number;
  timeProximity: number;
  bridgeMatch: number;
  protocolKnown: number;
  cexMatch: number;
}

export interface ConfidenceResult {
  score: number;            // 0-1 overall score
  factors: ConfidenceFactors;
  explanation: string[];
}

// ============================================
// Main Scoring Function
// ============================================

/**
 * Calculate confidence score for a route
 */
export function calculateRouteConfidence(
  segments: IRouteSegment[],
  endIsCEX: boolean = false
): ConfidenceResult {
  if (segments.length === 0) {
    return {
      score: 0,
      factors: { amountSimilarity: 0, timeProximity: 0, bridgeMatch: 0, protocolKnown: 0, cexMatch: 0 },
      explanation: ['No segments to analyze']
    };
  }
  
  const explanation: string[] = [];
  
  // Calculate individual factors
  const amountSimilarity = calculateAmountSimilarity(segments);
  const timeProximity = calculateTimeProximity(segments);
  const bridgeMatch = calculateBridgeMatch(segments);
  const protocolKnown = calculateProtocolKnown(segments);
  const cexMatch = endIsCEX ? 1.0 : 0.0;
  
  // Build explanation
  if (amountSimilarity > 0.8) {
    explanation.push('Amounts closely match across segments');
  } else if (amountSimilarity < 0.5) {
    explanation.push('Amount variation between segments');
  }
  
  if (timeProximity > 0.8) {
    explanation.push('Segments are closely timed');
  }
  
  if (bridgeMatch > 0.5) {
    explanation.push('Known bridge protocols detected');
  }
  
  if (protocolKnown > 0.5) {
    explanation.push('Known protocols used throughout');
  }
  
  if (endIsCEX) {
    explanation.push('Route ends at known CEX');
  }
  
  const factors: ConfidenceFactors = {
    amountSimilarity,
    timeProximity,
    bridgeMatch,
    protocolKnown,
    cexMatch
  };
  
  // Calculate weighted score
  const score = 
    factors.amountSimilarity * WEIGHTS.amountSimilarity +
    factors.timeProximity * WEIGHTS.timeProximity +
    factors.bridgeMatch * WEIGHTS.bridgeMatch +
    factors.protocolKnown * WEIGHTS.protocolKnown +
    factors.cexMatch * WEIGHTS.cexMatch;
  
  return {
    score: Math.min(1, Math.max(0, score)),
    factors,
    explanation
  };
}

// ============================================
// Individual Factor Calculations
// ============================================

/**
 * Calculate amount similarity score
 * How consistent are the amounts across segments?
 */
function calculateAmountSimilarity(segments: IRouteSegment[]): number {
  if (segments.length < 2) return 1.0;
  
  const amounts = segments
    .map(s => parseFloat(s.amount))
    .filter(a => !isNaN(a) && a > 0);
  
  if (amounts.length < 2) return 0.5;
  
  // Calculate variance from first amount
  const baseAmount = amounts[0];
  let totalDeviation = 0;
  
  for (let i = 1; i < amounts.length; i++) {
    const deviation = Math.abs(amounts[i] - baseAmount) / baseAmount;
    totalDeviation += deviation;
  }
  
  const avgDeviation = totalDeviation / (amounts.length - 1);
  
  // Convert to score (lower deviation = higher score)
  // 0% deviation = 1.0, 5% = 0.75, 10% = 0.5, 20%+ = 0.25
  if (avgDeviation <= 0.01) return 1.0;
  if (avgDeviation <= 0.05) return 0.85;
  if (avgDeviation <= 0.10) return 0.7;
  if (avgDeviation <= 0.20) return 0.5;
  if (avgDeviation <= 0.50) return 0.3;
  return 0.1;
}

/**
 * Calculate time proximity score
 * How close in time are consecutive segments?
 */
function calculateTimeProximity(segments: IRouteSegment[]): number {
  if (segments.length < 2) return 1.0;
  
  const sortedSegments = [...segments].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  let totalScore = 0;
  let gaps = 0;
  
  for (let i = 1; i < sortedSegments.length; i++) {
    const gap = new Date(sortedSegments[i].timestamp).getTime() - 
                new Date(sortedSegments[i-1].timestamp).getTime();
    const gapMinutes = gap / 60000;
    
    // Score based on gap
    if (gapMinutes <= 5) {
      totalScore += 1.0;
    } else if (gapMinutes <= 15) {
      totalScore += 0.9;
    } else if (gapMinutes <= 30) {
      totalScore += 0.7;
    } else if (gapMinutes <= 60) {
      totalScore += 0.5;
    } else if (gapMinutes <= 120) {
      totalScore += 0.3;
    } else {
      totalScore += 0.1;
    }
    gaps++;
  }
  
  return gaps > 0 ? totalScore / gaps : 1.0;
}

/**
 * Calculate bridge match score
 * Are known bridge protocols used?
 */
function calculateBridgeMatch(segments: IRouteSegment[]): number {
  const KNOWN_BRIDGES = [
    'stargate', 'hop', 'across', 'synapse', 'multichain',
    'cbridge', 'orbiter', 'layerzero', 'wormhole', 'axelar'
  ];
  
  const bridgeSegments = segments.filter(s => s.type === 'BRIDGE');
  if (bridgeSegments.length === 0) return 0;
  
  let knownBridges = 0;
  for (const seg of bridgeSegments) {
    const protocol = (seg.protocol || '').toLowerCase();
    if (KNOWN_BRIDGES.some(b => protocol.includes(b))) {
      knownBridges++;
    }
  }
  
  return knownBridges / bridgeSegments.length;
}

/**
 * Calculate protocol known score
 * How many segments use recognized protocols?
 */
function calculateProtocolKnown(segments: IRouteSegment[]): number {
  const KNOWN_PROTOCOLS = [
    // Bridges
    'stargate', 'hop', 'across', 'synapse', 'multichain', 'cbridge', 'orbiter',
    // DEXs
    'uniswap', 'sushiswap', 'curve', '1inch', 'balancer', 'pancakeswap',
    'traderjoe', 'quickswap', 'velodrome', 'aerodrome',
    // Other
    'aave', 'compound', 'maker'
  ];
  
  if (segments.length === 0) return 0;
  
  let knownCount = 0;
  for (const seg of segments) {
    const protocol = (seg.protocol || '').toLowerCase();
    if (protocol && KNOWN_PROTOCOLS.some(p => protocol.includes(p))) {
      knownCount++;
    }
  }
  
  return knownCount / segments.length;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Check if segments form a valid continuous route
 */
export function isValidRouteSequence(segments: IRouteSegment[]): boolean {
  if (segments.length < 2) return true;
  
  const sorted = [...segments].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  for (let i = 1; i < sorted.length; i++) {
    const gap = new Date(sorted[i].timestamp).getTime() - 
                new Date(sorted[i-1].timestamp).getTime();
    const gapMinutes = gap / 60000;
    
    // Too large gap = broken route
    if (gapMinutes > THRESHOLDS.maxTimeGapMinutes) {
      return false;
    }
  }
  
  return true;
}

/**
 * Calculate confidence that two segments are connected
 */
export function calculateSegmentConnection(
  seg1: IRouteSegment,
  seg2: IRouteSegment
): number {
  let score = 0;
  
  // Time proximity
  const gap = Math.abs(
    new Date(seg2.timestamp).getTime() - new Date(seg1.timestamp).getTime()
  );
  const gapMinutes = gap / 60000;
  
  if (gapMinutes <= 5) score += 0.4;
  else if (gapMinutes <= 15) score += 0.3;
  else if (gapMinutes <= 30) score += 0.2;
  else if (gapMinutes <= 60) score += 0.1;
  
  // Amount similarity
  const amt1 = parseFloat(seg1.amount);
  const amt2 = parseFloat(seg2.amount);
  if (amt1 > 0 && amt2 > 0) {
    const diff = Math.abs(amt1 - amt2) / Math.max(amt1, amt2);
    if (diff <= 0.01) score += 0.3;
    else if (diff <= 0.05) score += 0.2;
    else if (diff <= 0.10) score += 0.1;
  }
  
  // Chain continuity (for bridges)
  if (seg1.chainTo === seg2.chainFrom || seg1.chainFrom === seg2.chainFrom) {
    score += 0.2;
  }
  
  // Wallet continuity
  if (seg1.walletTo.toLowerCase() === seg2.walletFrom.toLowerCase()) {
    score += 0.1;
  }
  
  return Math.min(1, score);
}

export { WEIGHTS, THRESHOLDS };
