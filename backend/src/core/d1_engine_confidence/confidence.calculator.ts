/**
 * ETAP 7.1 — Confidence Calculator
 * 
 * Rules-based confidence scoring for signals.
 * 
 * Formula (FIXED):
 *   confidence = 
 *     0.30 * coverageScore +
 *     0.25 * actorQualityScore +
 *     0.20 * flowStrengthScore +
 *     0.15 * temporalStabilityScore +
 *     0.10 * evidenceCountScore
 * 
 * P0.1: Actor Weight (structural) - exchanges/MMs weighted higher
 * P0.2: Multi-Actor Confirmation - ≥2 actors with weight ≥1.2
 * P0.3: Confidence cap at 79 if actorsScore < 50
 * P1.3: Temporal decay - confidence decays over time
 * P1.5: Explainability trace - full audit trail
 * P2.B: Cluster confirmation - multi-cluster anti-manipulation rules
 * 
 * NO ML. Deterministic. Explainable.
 */
import {
  ConfidenceInput,
  ConfidenceResult,
  ConfidenceBreakdown,
  ConfidenceLabel,
  ActorWeightInfo,
  CONFIDENCE_WEIGHTS,
  CONFIDENCE_THRESHOLDS,
} from './confidence.types.js';
import { generateReasons } from './confidence.reasons.js';
import { applyTemporalDecay } from './temporal.decay.js';
import { ConfidenceTrace, ConfidencePenalty, createConfidenceTrace } from './confidence.trace.js';

// P2.B: Cluster confirmation
import { buildActorClusters } from './cluster_builder.js';
import { 
  evaluateClusterConfirmation, 
  applyClusterPenalties,
  explainClusterPenalties 
} from './cluster_confirmation.rules.js';
import type { ActorForCluster, ClusterConfirmationResult } from './cluster_confirmation.types.js';

// ==================== P0.1: ACTOR WEIGHT CALCULATOR ====================

/**
 * Calculate structural weight for a single actor
 * 
 * Formula:
 *   actorWeight = 0.4 * isExchangeOrMM + 0.3 * flowSharePct + 
 *                 0.2 * connectivityDegree + 0.1 * historicalActivity
 */
export function calculateActorWeight(actor: ActorWeightInfo): number {
  const exchangeBonus = actor.isExchangeOrMM ? 1.0 : 0.0;
  
  const weight = 
    0.4 * exchangeBonus +
    0.3 * Math.min(1, actor.flowSharePct) +
    0.2 * Math.min(1, actor.connectivityDegree) +
    0.1 * Math.min(1, actor.historicalActivity);
  
  return Math.min(1, Math.max(0, weight));
}

/**
 * Build actor weights from basic actor info
 * Used when detailed weights not provided
 */
function buildActorWeightsFromSources(
  sources: Array<'verified' | 'attributed' | 'behavioral'>
): ActorWeightInfo[] {
  return sources.map((source, idx) => {
    // Estimate based on source level
    const isVerified = source === 'verified';
    const isAttributed = source === 'attributed';
    
    return {
      actorId: `actor_${idx}`,
      actorType: isVerified ? 'exchange' : isAttributed ? 'fund' : 'trader',
      sourceLevel: source,
      isExchangeOrMM: isVerified,  // Assume verified = exchange/MM
      flowSharePct: isVerified ? 0.7 : isAttributed ? 0.4 : 0.2,
      connectivityDegree: isVerified ? 0.8 : isAttributed ? 0.5 : 0.3,
      historicalActivity: isVerified ? 0.9 : isAttributed ? 0.6 : 0.4,
      weight: 0, // Will be calculated
    };
  }).map(actor => ({
    ...actor,
    weight: calculateActorWeight(actor),
  }));
}

// ==================== P0.2: MULTI-ACTOR CONFIRMATION ====================

interface MultiActorConfirmation {
  actorCount: number;
  totalWeight: number;
  diverseTypes: boolean;      // Not all from same type
  meetsRequirements: boolean; // ≥2 actors AND weight ≥1.2 AND diverse
}

/**
 * Check multi-actor confirmation requirements for HIGH confidence
 * 
 * Requirements:
 * - ≥ 2 actors
 * - ∑ actorWeight ≥ 1.2
 * - Not all from same source group
 */
function checkMultiActorConfirmation(actorWeights: ActorWeightInfo[]): MultiActorConfirmation {
  const actorCount = actorWeights.length;
  const totalWeight = actorWeights.reduce((sum, a) => sum + a.weight, 0);
  
  // Check diversity: not all same source level
  const sourceLevels = new Set(actorWeights.map(a => a.sourceLevel));
  const actorTypes = new Set(actorWeights.map(a => a.actorType));
  const diverseTypes = sourceLevels.size > 1 || actorTypes.size > 1;
  
  // All requirements must be met for HIGH confidence
  const meetsRequirements = 
    actorCount >= 2 &&
    totalWeight >= 1.2 &&
    diverseTypes;
  
  return {
    actorCount,
    totalWeight,
    diverseTypes,
    meetsRequirements,
  };
}

// ==================== P0.3: ACTOR DIVERSITY PENALTY ====================

/**
 * Calculate diversity penalty if all actors are same type
 * Returns multiplier (0.85 if no diversity, 1.0 otherwise)
 */
function getActorDiversityMultiplier(actorWeights: ActorWeightInfo[]): number {
  if (actorWeights.length <= 1) return 1.0;
  
  const types = new Set(actorWeights.map(a => a.actorType));
  
  // All same type = penalty
  if (types.size === 1) {
    return 0.85;
  }
  
  return 1.0;
}

// ==================== COMPONENT CALCULATORS ====================

/**
 * Calculate coverage score (0-100)
 * Based on snapshot coverage percentage
 */
function calculateCoverageScore(input: ConfidenceInput): number {
  const coverage = input.snapshotCoverage || 0;
  
  // Normalize from 0-100 to 0-100 (already percentage)
  // But if stored as 0-1, convert
  const normalizedCoverage = coverage > 1 ? coverage : coverage * 100;
  
  return Math.min(100, Math.max(0, normalizedCoverage));
}

/**
 * Calculate actor quality score (0-100)
 * Based on actor structural weights (P0.1)
 */
function calculateActorQualityScore(input: ConfidenceInput): number {
  // Get or build actor weights
  const actorWeights = input.actorWeights || 
    buildActorWeightsFromSources(input.actorSources || []);
  
  if (actorWeights.length === 0) {
    return 25; // Low default if no actors
  }
  
  // P0.1: Use structural weights
  const totalWeight = actorWeights.reduce((sum, a) => sum + a.weight, 0);
  
  // Multi-actor confirmation check
  const confirmation = checkMultiActorConfirmation(actorWeights);
  
  // Base score from weights: totalWeight mapped to 0-80 range
  // Each unit of weight = ~40 points, capped at 80 base
  let score = Math.min(80, totalWeight * 40);
  
  // Bonus for meeting multi-actor requirements (up to +20)
  if (confirmation.meetsRequirements) {
    score += 20;
  } else if (confirmation.actorCount >= 2) {
    score += 10; // Partial bonus for 2+ actors
  }
  
  // Apply diversity penalty if all same type
  const diversityMultiplier = getActorDiversityMultiplier(actorWeights);
  score *= diversityMultiplier;
  
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Calculate flow strength score (0-100)
 * Based on net flow USD normalized
 */
function calculateFlowStrengthScore(input: ConfidenceInput): number {
  const netFlow = Math.abs(input.netFlowUsd || 0);
  const totalFlow = (input.inflowUsd || 0) + (input.outflowUsd || 0);
  
  // Normalize: min = $100k, max = $50M for full score
  const MIN_FLOW = 100_000;      // $100k
  const MAX_FLOW = 50_000_000;   // $50M
  
  if (netFlow < MIN_FLOW) {
    return 20; // Minimum score for weak flows
  }
  
  // Linear interpolation
  const normalized = (netFlow - MIN_FLOW) / (MAX_FLOW - MIN_FLOW);
  const score = 20 + normalized * 80; // 20-100 range
  
  return Math.min(100, Math.max(20, score));
}

/**
 * Calculate temporal stability score (0-100)
 * Based on window and cross-window support
 */
function calculateTemporalStabilityScore(input: ConfidenceInput): number {
  const window = input.window;
  const has7dSupport = input.has7dSupport || false;
  
  // 7d window = highest stability
  if (window === '7d') {
    return 90;
  }
  
  // 24h + 7d support = high stability
  if (window === '24h' && has7dSupport) {
    return 80;
  }
  
  // 24h only = moderate
  if (window === '24h') {
    return 60;
  }
  
  // 30d = good
  if (window === '30d') {
    return 85;
  }
  
  return 50; // Default
}

/**
 * Calculate evidence count score (0-100)
 * Based on number of metrics/evidence in signal
 */
function calculateEvidenceCountScore(input: ConfidenceInput): number {
  const metrics = input.evidenceMetrics || {};
  const metricsCount = Object.keys(metrics).length;
  
  // Each metric = 25 points, base 30, max 100
  const score = Math.min(100, 30 + metricsCount * 25);
  
  return score;
}

// ==================== LABEL CALCULATOR ====================

/**
 * Determine confidence label from score
 */
function getConfidenceLabel(score: number): ConfidenceLabel {
  if (score >= CONFIDENCE_THRESHOLDS.HIGH) return 'HIGH';
  if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) return 'MEDIUM';
  if (score >= CONFIDENCE_THRESHOLDS.LOW) return 'LOW';
  return 'HIDDEN';
}

// ==================== MAIN CALCULATOR ====================

/**
 * Calculate confidence for a signal
 * 
 * P0.3 GUARD: If actorsScore < 50, confidence is capped at 79 (MEDIUM MAX)
 * 
 * @param input - Confidence calculation input
 * @returns ConfidenceResult with score, label, breakdown, and reasons
 */
export function calculateConfidence(input: ConfidenceInput): ConfidenceResult {
  // Calculate each component
  const coverageScore = calculateCoverageScore(input);
  const actorsScore = calculateActorQualityScore(input);
  const flowScore = calculateFlowStrengthScore(input);
  const temporalScore = calculateTemporalStabilityScore(input);
  const evidenceScore = calculateEvidenceCountScore(input);
  
  // Build breakdown
  const breakdown: ConfidenceBreakdown = {
    coverage: Math.round(coverageScore),
    actors: Math.round(actorsScore),
    flow: Math.round(flowScore),
    temporal: Math.round(temporalScore),
    evidence: Math.round(evidenceScore),
  };
  
  // Calculate weighted score (FIXED FORMULA)
  let score = Math.round(
    CONFIDENCE_WEIGHTS.coverage * coverageScore +
    CONFIDENCE_WEIGHTS.actors * actorsScore +
    CONFIDENCE_WEIGHTS.flow * flowScore +
    CONFIDENCE_WEIGHTS.temporal * temporalScore +
    CONFIDENCE_WEIGHTS.evidence * evidenceScore
  );
  
  // P0.3 GUARD: Cap at 79 if actorsScore < 50
  // This prevents "fake" HIGH confidence without proper actor support
  if (actorsScore < 50) {
    score = Math.min(score, 79);
  }
  
  // Get label
  const label = getConfidenceLabel(score);
  
  // Generate reasons
  const reasons = generateReasons(input, breakdown);
  
  return {
    score,
    label,
    breakdown,
    reasons,
  };
}

// ==================== P1: CONFIDENCE WITH TRACE ====================

/**
 * Extended confidence input with lifecycle info
 */
export interface ConfidenceInputWithLifecycle extends ConfidenceInput {
  lastTriggeredAt?: Date;
}

/**
 * Extended result with trace
 */
export interface ConfidenceResultWithTrace extends ConfidenceResult {
  trace: ConfidenceTrace;
}

/**
 * Calculate confidence with full explainability trace
 * 
 * P1.3: Applies temporal decay based on lastTriggeredAt
 * P1.5: Returns full trace for audit/debugging
 * 
 * @param input - Extended confidence input with lifecycle info
 * @returns ConfidenceResult with trace
 */
export function calculateConfidenceWithTrace(
  input: ConfidenceInputWithLifecycle
): ConfidenceResultWithTrace {
  // Calculate each component
  const coverageScore = calculateCoverageScore(input);
  const actorsScore = calculateActorQualityScore(input);
  const flowScore = calculateFlowStrengthScore(input);
  const temporalScore = calculateTemporalStabilityScore(input);
  const evidenceScore = calculateEvidenceCountScore(input);
  
  // Build breakdown
  const breakdown: ConfidenceBreakdown = {
    coverage: Math.round(coverageScore),
    actors: Math.round(actorsScore),
    flow: Math.round(flowScore),
    temporal: Math.round(temporalScore),
    evidence: Math.round(evidenceScore),
  };
  
  // Calculate weighted score
  let score = Math.round(
    CONFIDENCE_WEIGHTS.coverage * coverageScore +
    CONFIDENCE_WEIGHTS.actors * actorsScore +
    CONFIDENCE_WEIGHTS.flow * flowScore +
    CONFIDENCE_WEIGHTS.temporal * temporalScore +
    CONFIDENCE_WEIGHTS.evidence * evidenceScore
  );
  
  // Track penalties
  const penalties: ConfidencePenalty[] = [];
  let cappedByActorGuard = false;
  let capValue: number | undefined;
  let clusterConfirmation: ClusterConfirmationResult | undefined;
  
  // P2.B: Build clusters and evaluate confirmation rules
  if (input.actorWeights && input.actorWeights.length > 0) {
    // Convert ActorWeightInfo to ActorForCluster
    const actorsForCluster: ActorForCluster[] = input.actorWeights.map(a => ({
      actorId: a.actorId,
      actorType: a.actorType,
      sourceGroup: a.sourceLevel, // Use sourceLevel as sourceGroup
      weight: a.weight,
      entityId: (a as any).entityId,
      ownerId: (a as any).ownerId,
      communityId: (a as any).communityId,
      infrastructureId: (a as any).infrastructureId,
    }));
    
    // Build clusters
    const clusters = buildActorClusters(actorsForCluster);
    
    // Evaluate cluster confirmation rules
    clusterConfirmation = evaluateClusterConfirmation(clusters, actorsForCluster);
    
    // Apply cluster penalties
    const { adjustedConfidence, appliedPenalties } = applyClusterPenalties(
      score,
      clusterConfirmation.penalties
    );
    
    // Add cluster penalties to trace
    for (const ap of appliedPenalties) {
      penalties.push({
        type: ap.penalty,
        reason: explainClusterPenalties([ap.penalty])[0] || ap.penalty,
        multiplier: ap.multiplier,
        impact: ap.impact,
      });
    }
    
    score = adjustedConfidence;
  }
  
  // P0.3 GUARD: Cap at 79 if actorsScore < 50
  if (actorsScore < 50 && score > 79) {
    penalties.push({
      type: 'actor_cap',
      reason: 'Low actor score cap',
      multiplier: 79 / score,
      impact: score - 79,
    });
    cappedByActorGuard = true;
    capValue = 79;
    score = 79;
  }
  
  // P1.3: Apply temporal decay
  const { finalConfidence, decayFactor, hoursElapsed } = applyTemporalDecay(
    score,
    input.lastTriggeredAt
  );
  
  if (decayFactor < 1) {
    const decayImpact = score - finalConfidence;
    if (decayImpact > 0) {
      penalties.push({
        type: 'temporal_decay',
        reason: `${hoursElapsed}h decay`,
        multiplier: decayFactor,
        impact: decayImpact,
      });
    }
  }
  
  const finalScore = finalConfidence;
  const label = getConfidenceLabel(finalScore);
  
  // Generate reasons
  const reasons = generateReasons(input, breakdown);
  
  // Build trace
  const trace = createConfidenceTrace({
    breakdown,
    weights: CONFIDENCE_WEIGHTS,
    penalties,
    decayFactor,
    hoursElapsed,
    cappedByActorGuard,
    capValue,
    finalScore,
    label,
  });
  
  // Add P2.B cluster confirmation to trace
  if (clusterConfirmation) {
    (trace as any).clusterConfirmation = {
      clustersCount: clusterConfirmation.clustersCount,
      totalClusterWeight: clusterConfirmation.totalClusterWeight,
      topClusterWeight: clusterConfirmation.topClusterWeight,
      dominance: clusterConfirmation.dominance,
      sourceGroups: clusterConfirmation.sourceGroups,
      passed: clusterConfirmation.passed,
      failReason: clusterConfirmation.failReason,
    };
  }
  
  return {
    score: finalScore,
    label,
    breakdown,
    reasons,
    trace,
  };
}

/**
 * Check if signal should be visible (not HIDDEN)
 */
export function isSignalVisible(confidenceLabel: ConfidenceLabel): boolean {
  return confidenceLabel !== 'HIDDEN';
}

/**
 * Check if signal should be sent to Telegram
 * Only HIGH severity + HIGH/MEDIUM confidence
 */
export function shouldSendToTelegram(
  severity: string,
  confidenceLabel: ConfidenceLabel
): boolean {
  return (
    severity === 'high' &&
    (confidenceLabel === 'HIGH' || confidenceLabel === 'MEDIUM')
  );
}
