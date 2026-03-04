/**
 * ETAP 7.2 — Confidence Reasons Generator
 * 
 * Generates human-readable explanations for confidence score.
 * 
 * Order (FIXED):
 * 1. Coverage
 * 2. Actors
 * 3. Flow
 * 4. Temporal
 * 5. Evidence
 * 
 * Max 6 reasons. Facts only, no interpretations.
 */
import { ConfidenceInput, ConfidenceBreakdown, ActorWeightInfo } from './confidence.types.js';

// ==================== REASON GENERATORS ====================

/**
 * Generate coverage-related reasons
 */
function getCoverageReasons(coverage: number): string[] {
  if (coverage >= 70) {
    return [`High data coverage (${coverage}%)`];
  } else if (coverage >= 40) {
    return [`Medium data coverage (${coverage}%)`];
  } else {
    return [`Low data coverage (${coverage}%)`];
  }
}

/**
 * Generate actor-related reasons
 * P0.1: Include actor weight info
 */
function getActorReasons(input: ConfidenceInput): string[] {
  const reasons: string[] = [];
  const sources = input.actorSources || [];
  const actorWeights = input.actorWeights || [];
  
  const verified = sources.filter(s => s === 'verified').length;
  const attributed = sources.filter(s => s === 'attributed').length;
  
  // P0.1: Check for exchange/MM actors
  const exchangeMM = actorWeights.filter(a => a.isExchangeOrMM).length;
  
  if (exchangeMM > 0) {
    reasons.push(`${exchangeMM} exchange/MM actor${exchangeMM > 1 ? 's' : ''} involved`);
  } else if (verified > 0) {
    reasons.push(`${verified} verified actor${verified > 1 ? 's' : ''} involved`);
  } else if (attributed > 0) {
    reasons.push('Attributed actors only');
  } else {
    reasons.push('Unverified actors');
  }
  
  // P0.2: Multi-actor confirmation
  if (actorWeights.length >= 2) {
    const totalWeight = actorWeights.reduce((sum, a) => sum + a.weight, 0);
    if (totalWeight >= 1.2) {
      reasons.push('Multi-actor confirmation');
    }
  }
  
  return reasons;
}

/**
 * Generate flow-related reasons
 */
function getFlowReasons(input: ConfidenceInput): string[] {
  const netFlow = Math.abs(input.netFlowUsd || 0);
  
  if (netFlow >= 10_000_000) {
    return ['Strong net flow detected ($10M+)'];
  } else if (netFlow >= 1_000_000) {
    return ['Moderate net flow ($1M+)'];
  } else if (netFlow >= 100_000) {
    return ['Net flow detected ($100k+)'];
  } else {
    return ['Weak flow strength'];
  }
}

/**
 * Generate temporal-related reasons
 */
function getTemporalReasons(input: ConfidenceInput): string[] {
  const window = input.window;
  const has7dSupport = input.has7dSupport || false;
  
  if (window === '24h' && has7dSupport) {
    return ['Pattern stable across 24h and 7d'];
  } else if (window === '7d' || window === '30d') {
    return [`Observed over ${window} window`];
  } else if (window === '24h') {
    return ['Short-term activity (24h only)'];
  }
  
  return [];
}

/**
 * Generate evidence-related reasons
 */
function getEvidenceReasons(input: ConfidenceInput): string[] {
  const metrics = input.evidenceMetrics || {};
  const count = Object.keys(metrics).length;
  
  if (count >= 3) {
    return ['Multiple independent metrics confirmed'];
  } else if (count === 2) {
    return ['Two metrics confirmed'];
  } else {
    return ['Single-metric signal'];
  }
}

// ==================== MAIN GENERATOR ====================

/**
 * Generate confidence reasons in strict order
 * 
 * @param input - Confidence input data
 * @param breakdown - Calculated breakdown scores
 * @returns Array of reason strings (max 6)
 */
export function generateReasons(
  input: ConfidenceInput,
  breakdown: ConfidenceBreakdown
): string[] {
  const allReasons: string[] = [];
  
  // 1. Coverage (always include)
  allReasons.push(...getCoverageReasons(breakdown.coverage));
  
  // 2. Actors
  allReasons.push(...getActorReasons(input));
  
  // 3. Flow (only if significant)
  const flowReasons = getFlowReasons(input);
  if (flowReasons.length > 0 && !flowReasons[0].includes('Weak')) {
    allReasons.push(...flowReasons);
  }
  
  // 4. Temporal
  allReasons.push(...getTemporalReasons(input));
  
  // 5. Evidence
  allReasons.push(...getEvidenceReasons(input));
  
  // Limit to max 6 reasons
  return allReasons.slice(0, 6);
}

/**
 * Get short reasons for Telegram (2-3 most important)
 */
export function getShortReasons(
  input: ConfidenceInput,
  breakdown: ConfidenceBreakdown
): string[] {
  const reasons: string[] = [];
  
  // 1. Coverage (if high)
  if (breakdown.coverage >= 70) {
    reasons.push(`High coverage (${breakdown.coverage}%)`);
  }
  
  // 2. Verified actors (if any)
  const verified = (input.actorSources || []).filter(s => s === 'verified').length;
  if (verified > 0) {
    reasons.push('Verified actor');
  }
  
  // 3. Strong flow (if applicable)
  const netFlow = Math.abs(input.netFlowUsd || 0);
  if (netFlow >= 1_000_000) {
    reasons.push('Strong flow');
  }
  
  // 4. Temporal stability
  if (input.window === '7d' || input.has7dSupport) {
    reasons.push('Stable pattern');
  }
  
  // Return top 3
  return reasons.slice(0, 3);
}
