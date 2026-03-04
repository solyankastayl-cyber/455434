/**
 * Route Confidence Calculator (P0.5)
 * 
 * Calculates data quality / confidence score (0..1).
 * Based on completeness of labels, pricing, and chain coverage.
 */

import { ISegmentV2, IRouteLabels } from '../storage/route_enriched.model.js';

// ============================================
// Config
// ============================================

const CONFIDENCE_CONFIG = {
  // Component weights
  WEIGHT_LABELS: 0.25,
  WEIGHT_PRICING: 0.25,
  WEIGHT_CHAIN_COVERAGE: 0.20,
  WEIGHT_SEGMENT_CONFIDENCE: 0.30
};

// ============================================
// Types
// ============================================

export interface ConfidenceResult {
  confidence: number;          // 0..1
  components: {
    labelCoverage: number;
    pricingCoverage: number;
    chainCoverage: number;
    avgSegmentConfidence: number;
  };
  warnings: string[];
}

// ============================================
// Main Calculator
// ============================================

/**
 * Calculate route confidence score
 */
export function calculateRouteConfidence(
  segments: ISegmentV2[],
  labels: IRouteLabels,
  chains: string[]
): ConfidenceResult {
  const result: ConfidenceResult = {
    confidence: 0,
    components: {
      labelCoverage: 0,
      pricingCoverage: 0,
      chainCoverage: 0,
      avgSegmentConfidence: 0
    },
    warnings: []
  };
  
  if (segments.length === 0) {
    result.warnings.push('NO_SEGMENTS');
    return result;
  }
  
  // 1. Label coverage
  result.components.labelCoverage = calculateLabelCoverage(segments, labels);
  
  if (result.components.labelCoverage < 0.5) {
    result.warnings.push('LOW_LABEL_COVERAGE');
  }
  
  // 2. Pricing coverage
  result.components.pricingCoverage = calculatePricingCoverage(segments);
  
  if (result.components.pricingCoverage < 0.5) {
    result.warnings.push('LOW_PRICING_COVERAGE');
  }
  
  // 3. Chain coverage
  result.components.chainCoverage = calculateChainCoverage(chains);
  
  // 4. Average segment confidence
  result.components.avgSegmentConfidence = calculateAvgSegmentConfidence(segments);
  
  if (result.components.avgSegmentConfidence < 0.5) {
    result.warnings.push('LOW_SEGMENT_CONFIDENCE');
  }
  
  // Calculate weighted confidence
  result.confidence = 
    result.components.labelCoverage * CONFIDENCE_CONFIG.WEIGHT_LABELS +
    result.components.pricingCoverage * CONFIDENCE_CONFIG.WEIGHT_PRICING +
    result.components.chainCoverage * CONFIDENCE_CONFIG.WEIGHT_CHAIN_COVERAGE +
    result.components.avgSegmentConfidence * CONFIDENCE_CONFIG.WEIGHT_SEGMENT_CONFIDENCE;
  
  // Round to 2 decimal places
  result.confidence = Math.round(result.confidence * 100) / 100;
  
  return result;
}

// ============================================
// Component Calculators
// ============================================

/**
 * Calculate label coverage
 */
function calculateLabelCoverage(
  segments: ISegmentV2[],
  labels: IRouteLabels
): number {
  let labeledCount = 0;
  let totalChecks = 0;
  
  for (const segment of segments) {
    // Check fromLabel
    totalChecks++;
    if (segment.fromLabel) labeledCount++;
    
    // Check toLabel
    totalChecks++;
    if (segment.toLabel) labeledCount++;
    
    // Check protocol for SWAP/BRIDGE
    if (segment.type === 'SWAP' || segment.type === 'BRIDGE') {
      totalChecks++;
      if (segment.protocol) labeledCount++;
    }
  }
  
  // Bonus for CEX/bridge detection
  if (labels.cexTouched) labeledCount += 2;
  if (labels.bridgeTouched) labeledCount++;
  totalChecks += 3;
  
  return totalChecks > 0 ? labeledCount / totalChecks : 0;
}

/**
 * Calculate pricing coverage
 */
function calculatePricingCoverage(segments: ISegmentV2[]): number {
  if (segments.length === 0) return 0;
  
  let pricedCount = 0;
  
  for (const segment of segments) {
    if (segment.amountUsd && segment.amountUsd > 0) {
      pricedCount++;
    }
  }
  
  return pricedCount / segments.length;
}

/**
 * Calculate chain coverage (known chains score higher)
 */
function calculateChainCoverage(chains: string[]): number {
  const knownChains = new Set(['ETH', 'ARB', 'OP', 'BASE', 'POLY', 'BNB', 'AVAX']);
  
  if (chains.length === 0) return 0;
  
  let knownCount = 0;
  for (const chain of chains) {
    if (knownChains.has(chain)) {
      knownCount++;
    }
  }
  
  return knownCount / chains.length;
}

/**
 * Calculate average segment confidence
 */
function calculateAvgSegmentConfidence(segments: ISegmentV2[]): number {
  if (segments.length === 0) return 0;
  
  let total = 0;
  for (const segment of segments) {
    total += segment.confidence || 0.5;
  }
  
  return total / segments.length;
}

// ============================================
// Quality Checks
// ============================================

/**
 * Check if route has sufficient confidence for alerts
 */
export function hasAlertConfidence(confidence: number): boolean {
  return confidence >= 0.4;
}

/**
 * Get confidence level
 */
export function getConfidenceLevel(confidence: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (confidence >= 0.7) return 'HIGH';
  if (confidence >= 0.4) return 'MEDIUM';
  return 'LOW';
}

export { CONFIDENCE_CONFIG };
