/**
 * P1.5: Confidence Explainability Trace
 * 
 * Provides full audit trail for confidence scoring.
 * Enables UI to show:
 * "Confidence = 83 → -9 decay → -7 diversity penalty → final = 67"
 */

/**
 * Individual penalty applied to confidence
 */
export interface ConfidencePenalty {
  type: string;
  reason: string;
  multiplier: number; // e.g., 0.85 for 15% penalty
  impact: number;     // Points lost
}

/**
 * Full confidence calculation trace
 */
export interface ConfidenceTrace {
  // Base scores
  baseScore: number;
  actorScore: number;
  coverageScore: number;
  flowScore: number;
  temporalScore: number;
  evidenceScore: number;
  
  // Weights applied
  weights: {
    coverage: number;
    actors: number;
    flow: number;
    temporal: number;
    evidence: number;
  };
  
  // Weighted score before penalties
  weightedScore: number;
  
  // Penalties applied
  penalties: ConfidencePenalty[];
  
  // Total penalty impact
  totalPenaltyImpact: number;
  
  // Decay info
  decayApplied: boolean;
  decayFactor: number;
  hoursElapsed: number;
  
  // Guards applied
  cappedByActorGuard: boolean;
  capValue?: number;
  
  // Final result
  finalScore: number;
  label: string;
  
  // Timestamp
  calculatedAt: Date;
}

/**
 * Create trace from calculation result
 */
export function createConfidenceTrace(params: {
  breakdown: {
    coverage: number;
    actors: number;
    flow: number;
    temporal: number;
    evidence: number;
  };
  weights: {
    coverage: number;
    actors: number;
    flow: number;
    temporal: number;
    evidence: number;
  };
  penalties?: ConfidencePenalty[];
  decayFactor?: number;
  hoursElapsed?: number;
  cappedByActorGuard?: boolean;
  capValue?: number;
  finalScore: number;
  label: string;
}): ConfidenceTrace {
  const { breakdown, weights, penalties = [], finalScore, label } = params;
  
  // Calculate weighted score
  const weightedScore = Math.round(
    breakdown.coverage * weights.coverage +
    breakdown.actors * weights.actors +
    breakdown.flow * weights.flow +
    breakdown.temporal * weights.temporal +
    breakdown.evidence * weights.evidence
  );
  
  // Calculate total penalty impact
  const totalPenaltyImpact = penalties.reduce((sum, p) => sum + p.impact, 0);
  
  return {
    baseScore: weightedScore,
    actorScore: breakdown.actors,
    coverageScore: breakdown.coverage,
    flowScore: breakdown.flow,
    temporalScore: breakdown.temporal,
    evidenceScore: breakdown.evidence,
    weights,
    weightedScore,
    penalties,
    totalPenaltyImpact,
    decayApplied: (params.decayFactor ?? 1) < 1,
    decayFactor: params.decayFactor ?? 1,
    hoursElapsed: params.hoursElapsed ?? 0,
    cappedByActorGuard: params.cappedByActorGuard ?? false,
    capValue: params.capValue,
    finalScore,
    label,
    calculatedAt: new Date(),
  };
}

/**
 * Format trace for human-readable output
 */
export function formatTraceExplanation(trace: ConfidenceTrace): string {
  const parts: string[] = [];
  
  parts.push(`Base: ${trace.weightedScore}`);
  
  if (trace.penalties.length > 0) {
    for (const p of trace.penalties) {
      parts.push(`${p.reason}: -${p.impact}`);
    }
  }
  
  if (trace.decayApplied) {
    const decayImpact = Math.round(trace.weightedScore * (1 - trace.decayFactor));
    parts.push(`Decay (${trace.hoursElapsed}h): -${decayImpact}`);
  }
  
  if (trace.cappedByActorGuard) {
    parts.push(`Cap (low actors): max ${trace.capValue}`);
  }
  
  parts.push(`Final: ${trace.finalScore}`);
  
  return parts.join(' → ');
}

/**
 * Get trace summary for UI tooltip
 */
export function getTraceSummary(trace: ConfidenceTrace): string[] {
  const summary: string[] = [];
  
  summary.push(`Coverage: ${trace.coverageScore}%`);
  summary.push(`Actors: ${trace.actorScore}%`);
  summary.push(`Flow: ${trace.flowScore}%`);
  summary.push(`Temporal: ${trace.temporalScore}%`);
  
  if (trace.penalties.length > 0) {
    summary.push(`Penalties: ${trace.penalties.map(p => p.type).join(', ')}`);
  }
  
  if (trace.decayApplied) {
    summary.push(`Decay: ${Math.round((1 - trace.decayFactor) * 100)}%`);
  }
  
  if (trace.cappedByActorGuard) {
    summary.push(`Capped at ${trace.capValue} (actor guard)`);
  }
  
  return summary;
}
