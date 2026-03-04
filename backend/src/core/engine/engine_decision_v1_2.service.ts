/**
 * Engine Rules v1.2 (Simulation-driven Threshold Tuning)
 * 
 * v1.2 = v1.1 + tuned thresholds based on simulation results
 * 
 * НЕ меняем:
 * - архитектуру
 * - семантику BUY/SELL/NEUTRAL
 * - frozen parameters
 * 
 * МЕНЯЕМ (simulation-validated):
 * - Evidence thresholds (slightly relaxed)
 * - Risk thresholds (slightly relaxed)
 * - Coverage soft minimum (slightly relaxed)
 * - Direction thresholds (slightly relaxed)
 * 
 * Версия: 1.2.0
 */
import { EngineDecisionModel } from './engine_decision.model.js';
import { ENGINE_CONFIG as V1_1_CONFIG } from './engine_decision_v1_1.service.js';
import crypto from 'crypto';

// ============ v1.2 CONFIGURATION (TUNED) ============

export const ENGINE_CONFIG_V1_2 = {
  version: '1.2.0',
  basedOn: '1.1.0',
  
  // 1. Evidence Thresholds (slightly relaxed)
  evidence: {
    // TUNED: Allow decisions at slightly lower evidence
    minForAnyDecision: 48,       // v1.1: 50 → v1.2: 48
    softZoneMax: 62,             // v1.1: 65 → v1.2: 62
    conditionalZoneMax: 78,      // v1.1: 80 → v1.2: 78
    strongZone: 78,              // v1.1: 80 → v1.2: 78
    
    // FROZEN: Source weights unchanged
    sourceWeights: V1_1_CONFIG.evidence.sourceWeights,
    maxSingleSourceContribution: 40,
    minSourcesForDecision: 2,
  },
  
  // 2. Coverage Thresholds (slightly relaxed soft minimum)
  coverage: {
    hardMinimum: 40,             // ❄️ FROZEN - safety critical
    softMinimum: 58,             // v1.1: 60 → v1.2: 58
    normalZone: 58,              // v1.1: 60 → v1.2: 58
    
    // FROZEN: Conditional zone requirements
    conditionalZoneRequirements: {
      minEvidence: 73,           // v1.1: 75 → v1.2: 73
      maxRisk: 37,               // v1.1: 35 → v1.2: 37
    },
  },
  
  // 3. Direction Thresholds (slightly relaxed)
  direction: {
    weakThreshold: 18,           // v1.1: 20 → v1.2: 18
    strongThreshold: 38,         // v1.1: 40 → v1.2: 38
    
    // FROZEN: Forbidden combinations
    forbidden: V1_1_CONFIG.direction.forbidden,
  },
  
  // 4. Risk Thresholds (slightly relaxed)
  risk: {
    hardCap: 72,                 // v1.1: 75 → v1.2: 72
    highRiskZone: 58,            // v1.1: 60 → v1.2: 58
    normalZone: 38,              // v1.1: 40 → v1.2: 38
    
    // TUNED: High risk zone requirements
    highRiskRequirements: {
      minEvidence: 78,           // v1.1: 80 → v1.2: 78
    },
  },
  
  // 5. Penalty Weights (mostly frozen, some tuned)
  penalties: {
    lowCoverage: 15,             // ❄️ FROZEN
    highRisk: 22,                // v1.1: 20 → v1.2: 22 (increased)
    signalConflict: 28,          // v1.1: 25 → v1.2: 28 (increased)
    recentFlip: 12,              // v1.1: 10 → v1.2: 12 (increased)
    singleSource: 15,            // ❄️ FROZEN
  },
  
  // 6. Conflict Detection (FROZEN)
  conflicts: V1_1_CONFIG.conflicts,
  
  // 7. Stability Rules (FROZEN)
  stability: V1_1_CONFIG.stability,
  
  // 8. Explainability Requirements (FROZEN)
  explainability: V1_1_CONFIG.explainability,
};

// ============ TYPES (same as v1.1) ============

export type Decision = 'BUY' | 'SELL' | 'NEUTRAL';
export type ConfidenceBand = 'LOW' | 'MEDIUM' | 'HIGH';

export interface DecisionScores {
  evidence: number;
  direction: number;
  risk: number;
  rawEvidence?: number;
  rawRisk?: number;
}

export interface DecisionReasoning {
  primaryContext: {
    id: string;
    headline: string;
    whyItMatters: string;
  } | null;
  supportingFacts: string[];
  riskNotes: string[];
}

export interface DecisionExplainability {
  signalsUsed: string[];
  actorsUsed: string[];
  contextsUsed: string[];
  coverageSnapshot: {
    contexts: number;
    actors: number;
    signals: number;
    overall: number;
  };
  distinctSources: number;
  conflictsDetected: string[];
  penaltiesApplied: string[];
}

export interface EngineDecisionV1_2 {
  id: string;
  inputId: string;
  decision: Decision;
  confidenceBand: ConfidenceBand;
  scores: DecisionScores;
  reasoning: DecisionReasoning;
  explainability: DecisionExplainability;
  createdAt: Date;
  engineVersion: string;
  neutralReason?: string;
}

export interface EngineInput {
  id: string;
  asset: {
    address: string;
    symbol?: string;
    name?: string;
    verified?: boolean;
    chain?: string;
  };
  window: string;
  signals: {
    id: string;
    type: string;
    deviation: number;
    severity: 'low' | 'medium' | 'high';
    source: string;
    metric?: string;
  }[];
  contexts: {
    id: string;
    overlapScore: number;
    primarySignalType: string;
    involvedActors: string[];
    affectedAssets?: string[];
    summary: string;
    window?: string;
  }[];
  actors: {
    slug: string;
    type: string;
    flowDirection: 'inflow' | 'outflow' | 'balanced';
    signalCount: number;
    contextCount: number;
  }[];
  graphStats: {
    totalNodes: number;
    totalEdges: number;
    topCorridors: {
      from: string;
      to: string;
      volumeUsd: number;
      pctOfTotal: number;
    }[];
  };
  coverage: {
    contexts: number;
    actors: number;
    signals: number;
    overall: number;
  };
  createdAt: Date;
}

// ============ v1.2 CONFLICT DETECTION (same as v1.1) ============

function detectSignalConflicts(signals: EngineInput['signals']): string[] {
  const conflicts: string[] = [];
  const signalTypes = new Set(signals.map(s => s.type));
  
  for (const [type1, type2] of ENGINE_CONFIG_V1_2.conflicts.conflictingSignals) {
    if (signalTypes.has(type1) && signalTypes.has(type2)) {
      conflicts.push(`${type1} vs ${type2}`);
    }
  }
  
  const hasInflow = signals.some(s => s.metric === 'inflow');
  const hasOutflow = signals.some(s => s.metric === 'outflow');
  if (hasInflow && hasOutflow) {
    conflicts.push('simultaneous inflow and outflow');
  }
  
  return conflicts;
}

function countDistinctSources(input: EngineInput): number {
  const sources = new Set<string>();
  if (input.signals.length > 0) sources.add('signals');
  if (input.contexts.length > 0) sources.add('contexts');
  if (input.actors.length > 0) sources.add('actors');
  if (input.graphStats.totalEdges > 0) sources.add('graph');
  return sources.size;
}

// ============ v1.2 SCORING FUNCTIONS ============

function calculateEvidenceScoreV1_2(
  input: EngineInput,
  conflicts: string[]
): { score: number; rawScore: number; breakdown: string[]; penaltiesApplied: string[] } {
  const config = ENGINE_CONFIG_V1_2;
  const breakdown: string[] = [];
  const penaltiesApplied: string[] = [];
  let score = 0;
  
  const sourceScores: Record<string, number> = {
    actorSignals: 0,
    corridorDeviations: 0,
    contextParticipation: 0,
    tokenLevelSignals: 0,
  };
  
  // Actor Signals
  const uniqueActorSignals = new Set(input.signals.map(s => s.source)).size;
  if (uniqueActorSignals >= 3) {
    sourceScores.actorSignals = 30;
    breakdown.push(`${uniqueActorSignals} unique actor signals (+30)`);
  } else if (uniqueActorSignals === 2) {
    sourceScores.actorSignals = 20;
    breakdown.push(`${uniqueActorSignals} unique actor signals (+20)`);
  } else if (uniqueActorSignals === 1) {
    sourceScores.actorSignals = 10;
    breakdown.push(`${uniqueActorSignals} unique actor signal (+10)`);
  }
  
  // Corridor Deviations
  const corridorActivity = input.graphStats.topCorridors.length;
  if (corridorActivity >= 3) {
    sourceScores.corridorDeviations = 25;
    breakdown.push(`${corridorActivity} corridor activities (+25)`);
  } else if (corridorActivity === 2) {
    sourceScores.corridorDeviations = 15;
    breakdown.push(`${corridorActivity} corridor activities (+15)`);
  } else if (corridorActivity === 1) {
    sourceScores.corridorDeviations = 8;
    breakdown.push(`${corridorActivity} corridor activity (+8)`);
  }
  
  // Context Participation
  const contextCount = input.contexts.length;
  const maxOverlap = contextCount > 0 
    ? Math.max(...input.contexts.map(c => c.overlapScore))
    : 0;
    
  if (contextCount >= 2 && maxOverlap >= 4) {
    sourceScores.contextParticipation = 25;
    breakdown.push(`${contextCount} contexts, overlap ${maxOverlap} (+25)`);
  } else if (contextCount >= 1 && maxOverlap >= 3) {
    sourceScores.contextParticipation = 15;
    breakdown.push(`${contextCount} context(s), overlap ${maxOverlap} (+15)`);
  } else if (contextCount >= 1) {
    sourceScores.contextParticipation = 8;
    breakdown.push(`${contextCount} context(s) (+8)`);
  }
  
  // Token-Level Signals
  const signalTypeCount = new Set(input.signals.map(s => s.type)).size;
  if (signalTypeCount >= 3) {
    sourceScores.tokenLevelSignals = 20;
    breakdown.push(`${signalTypeCount} signal types (+20)`);
  } else if (signalTypeCount === 2) {
    sourceScores.tokenLevelSignals = 12;
    breakdown.push(`${signalTypeCount} signal types (+12)`);
  } else if (signalTypeCount === 1) {
    sourceScores.tokenLevelSignals = 6;
    breakdown.push(`${signalTypeCount} signal type (+6)`);
  }
  
  // Apply source caps
  for (const [source, sourceScore] of Object.entries(sourceScores)) {
    const capped = Math.min(sourceScore, config.evidence.maxSingleSourceContribution);
    score += capped;
    if (sourceScore > capped) {
      penaltiesApplied.push(`${source} capped at ${config.evidence.maxSingleSourceContribution}`);
    }
  }
  
  const rawScore = score;
  
  // Apply penalties
  if (input.coverage.overall < 50) {
    score -= config.penalties.lowCoverage;
    penaltiesApplied.push(`Low coverage (<50%): -${config.penalties.lowCoverage}`);
  }
  
  if (conflicts.length > 0) {
    score -= config.penalties.signalConflict;
    penaltiesApplied.push(`Signal conflicts (${conflicts.length}): -${config.penalties.signalConflict}`);
  }
  
  const distinctSources = countDistinctSources(input);
  if (distinctSources <= 1) {
    score -= config.penalties.singleSource;
    penaltiesApplied.push(`Single source only: -${config.penalties.singleSource}`);
  }
  
  return {
    score: Math.max(0, Math.min(100, score)),
    rawScore,
    breakdown,
    penaltiesApplied,
  };
}

function calculateDirectionScoreV1_2(input: EngineInput): { score: number; breakdown: string[] } {
  const breakdown: string[] = [];
  let score = 0;
  
  // Flow Component
  const flowSignals = input.signals.filter(s => s.type === 'flow_deviation');
  for (const signal of flowSignals) {
    if (signal.metric === 'inflow') {
      const contribution = Math.min(30, signal.deviation * 8);
      score += contribution;
      breakdown.push(`Inflow deviation ${signal.deviation.toFixed(1)}x (+${Math.round(contribution)})`);
    } else if (signal.metric === 'outflow') {
      const contribution = Math.min(30, signal.deviation * 8);
      score -= contribution;
      breakdown.push(`Outflow deviation ${signal.deviation.toFixed(1)}x (-${Math.round(contribution)})`);
    }
  }
  
  // Regime Shift Component
  const regimeShifts = input.signals.filter(s => s.type === 'behavior_regime_shift');
  for (const signal of regimeShifts) {
    const actor = input.actors.find(a => a.slug === signal.source);
    if (actor) {
      if (actor.flowDirection === 'inflow') {
        score += 12;
        breakdown.push(`Regime shift to inflow (${signal.source}) (+12)`);
      } else if (actor.flowDirection === 'outflow') {
        score -= 12;
        breakdown.push(`Regime shift to outflow (${signal.source}) (-12)`);
      }
    }
  }
  
  // Actor Flow Direction Aggregate
  const inflowActors = input.actors.filter(a => a.flowDirection === 'inflow').length;
  const outflowActors = input.actors.filter(a => a.flowDirection === 'outflow').length;
  const totalActors = input.actors.length;
  
  if (totalActors > 0) {
    const inflowRatio = inflowActors / totalActors;
    const outflowRatio = outflowActors / totalActors;
    
    if (inflowRatio > 0.6) {
      score += 15;
      breakdown.push(`Strong inflow consensus (${inflowActors}/${totalActors}) (+15)`);
    } else if (outflowRatio > 0.6) {
      score -= 15;
      breakdown.push(`Strong outflow consensus (${outflowActors}/${totalActors}) (-15)`);
    } else if (inflowActors > outflowActors) {
      score += 8;
      breakdown.push(`Inflow majority (${inflowActors}/${totalActors}) (+8)`);
    } else if (outflowActors > inflowActors) {
      score -= 8;
      breakdown.push(`Outflow majority (${outflowActors}/${totalActors}) (-8)`);
    }
  }
  
  return {
    score: Math.max(-100, Math.min(100, score)),
    breakdown,
  };
}

function calculateRiskScoreV1_2(
  input: EngineInput,
  conflicts: string[]
): { score: number; rawScore: number; breakdown: string[] } {
  const config = ENGINE_CONFIG_V1_2;
  const breakdown: string[] = [];
  let score = 0;
  
  // Coverage Risk
  const coverage = input.coverage.overall;
  if (coverage < 40) {
    score += 40;
    breakdown.push(`Critical low coverage ${coverage}% (+40 risk)`);
  } else if (coverage < 50) {
    score += 30;
    breakdown.push(`Low coverage ${coverage}% (+30 risk)`);
  } else if (coverage < 58) {
    score += 20;
    breakdown.push(`Partial coverage ${coverage}% (+20 risk)`);
  } else if (coverage < 70) {
    score += 10;
    breakdown.push(`Marginal coverage ${coverage}% (+10 risk)`);
  }
  
  // Conflict Risk
  if (conflicts.length >= 2) {
    score += 30;
    breakdown.push(`Multiple signal conflicts (${conflicts.length}) (+30 risk)`);
  } else if (conflicts.length === 1) {
    score += config.conflicts.conflictRiskPenalty;
    breakdown.push(`Signal conflict detected (+${config.conflicts.conflictRiskPenalty} risk)`);
  }
  
  // Signal Noise
  const recentSignals = input.signals.length;
  if (recentSignals >= 15) {
    score += 20;
    breakdown.push(`High signal noise (${recentSignals}) (+20 risk)`);
  } else if (recentSignals >= 8) {
    score += 10;
    breakdown.push(`Moderate signal activity (${recentSignals}) (+10 risk)`);
  }
  
  // Structural Fragility
  if (input.actors.length === 0) {
    score += 25;
    breakdown.push(`No actor attribution (+25 risk)`);
  } else if (input.actors.length === 1) {
    score += 15;
    breakdown.push(`Single actor source (+15 risk)`);
  }
  
  // Context Quality
  if (input.contexts.length === 0) {
    score += 20;
    breakdown.push(`No contexts available (+20 risk)`);
  } else if (input.contexts.length === 1 && input.contexts[0].overlapScore < 3) {
    score += 10;
    breakdown.push(`Weak single context (+10 risk)`);
  }
  
  return {
    score: Math.max(0, Math.min(100, score)),
    rawScore: score,
    breakdown,
  };
}

// ============ v1.2 DECISION LOGIC ============

function makeDecisionV1_2(
  scores: DecisionScores,
  input: EngineInput,
  conflicts: string[],
  distinctSources: number,
  supportingFacts: string[]
): { decision: Decision; neutralReason?: string } {
  const config = ENGINE_CONFIG_V1_2;
  const { evidence, direction, risk } = scores;
  const coverage = input.coverage.overall;
  
  // ========== HARD STOPS (NEUTRAL без исключений) ==========
  
  // Coverage < 40 → NEUTRAL (❄️ FROZEN)
  if (coverage < config.coverage.hardMinimum) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Coverage ${coverage}% below hard minimum (${config.coverage.hardMinimum}%)`,
    };
  }
  
  // Risk >= hardCap → NEUTRAL
  if (risk >= config.risk.hardCap) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Risk ${risk} exceeds hard cap (${config.risk.hardCap})`,
    };
  }
  
  // Evidence < minForAnyDecision → NEUTRAL
  if (evidence < config.evidence.minForAnyDecision) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Evidence ${evidence} below minimum (${config.evidence.minForAnyDecision})`,
    };
  }
  
  // Conflicts → NEUTRAL (❄️ FROZEN)
  if (conflicts.length > 0) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Signal conflicts detected: ${conflicts.join(', ')}`,
    };
  }
  
  // ========== SOFT ZONES ==========
  
  // Evidence in soft zone → NEUTRAL
  if (evidence < config.evidence.softZoneMax) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Evidence ${evidence} in soft zone (<${config.evidence.softZoneMax})`,
    };
  }
  
  // Coverage conditional zone
  if (coverage < config.coverage.normalZone) {
    const reqEvidence = config.coverage.conditionalZoneRequirements.minEvidence;
    const reqRisk = config.coverage.conditionalZoneRequirements.maxRisk;
    
    if (evidence < reqEvidence || risk > reqRisk) {
      return {
        decision: 'NEUTRAL',
        neutralReason: `Coverage ${coverage}% conditional zone requires evidence≥${reqEvidence} (got ${evidence}) and risk≤${reqRisk} (got ${risk})`,
      };
    }
  }
  
  // High risk zone
  if (risk >= config.risk.highRiskZone) {
    if (evidence < config.risk.highRiskRequirements.minEvidence) {
      return {
        decision: 'NEUTRAL',
        neutralReason: `High risk ${risk} requires evidence≥${config.risk.highRiskRequirements.minEvidence} (got ${evidence})`,
      };
    }
  }
  
  // Weak direction → NEUTRAL
  const isWeakDirection = Math.abs(direction) < config.direction.weakThreshold;
  if (isWeakDirection) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Weak direction (|${direction}| < ${config.direction.weakThreshold})`,
    };
  }
  
  // Insufficient sources
  if (distinctSources < config.evidence.minSourcesForDecision) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Insufficient sources (${distinctSources} < ${config.evidence.minSourcesForDecision})`,
    };
  }
  
  // Explainability requirements
  if (supportingFacts.length < config.explainability.minSupportingFacts) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Insufficient explainability (${supportingFacts.length} facts < ${config.explainability.minSupportingFacts})`,
    };
  }
  
  // ========== BUY LOGIC ==========
  // v1.2: threshold 23 instead of 25
  if (direction >= 23 && evidence >= config.evidence.softZoneMax && risk < config.risk.highRiskZone) {
    if (direction < config.direction.forbidden.buyWithNegativeDirection) {
      return {
        decision: 'NEUTRAL',
        neutralReason: `BUY forbidden with direction ${direction}`,
      };
    }
    return { decision: 'BUY' };
  }
  
  // ========== SELL LOGIC ==========
  // v1.2: threshold -23 instead of -25
  if (direction <= -23 && evidence >= config.evidence.softZoneMax && risk < config.risk.highRiskZone) {
    if (direction > config.direction.forbidden.sellWithPositiveDirection) {
      return {
        decision: 'NEUTRAL',
        neutralReason: `SELL forbidden with direction ${direction}`,
      };
    }
    return { decision: 'SELL' };
  }
  
  // ========== NEUTRAL (default) ==========
  return {
    decision: 'NEUTRAL',
    neutralReason: 'No dominant directional pattern meeting all requirements',
  };
}

function calculateConfidenceBandV1_2(evidence: number, risk: number): ConfidenceBand {
  if (evidence >= 78 && risk <= 30) return 'HIGH';
  if (evidence >= 62 && risk <= 50) return 'MEDIUM';
  return 'LOW';
}

// ============ v1.2 MAIN FUNCTION ============

export async function generateDecisionV1_2(input: EngineInput): Promise<EngineDecisionV1_2> {
  const config = ENGINE_CONFIG_V1_2;
  const decisionId = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  const conflicts = detectSignalConflicts(input.signals);
  const distinctSources = countDistinctSources(input);
  
  const evidenceResult = calculateEvidenceScoreV1_2(input, conflicts);
  const directionResult = calculateDirectionScoreV1_2(input);
  const riskResult = calculateRiskScoreV1_2(input, conflicts);
  
  const scores: DecisionScores = {
    evidence: evidenceResult.score,
    direction: directionResult.score,
    risk: riskResult.score,
    rawEvidence: evidenceResult.rawScore,
    rawRisk: riskResult.rawScore,
  };
  
  const supportingFacts = [
    ...evidenceResult.breakdown.slice(0, 3),
    ...directionResult.breakdown.slice(0, 2),
  ];
  
  const { decision, neutralReason } = makeDecisionV1_2(
    scores,
    input,
    conflicts,
    distinctSources,
    supportingFacts
  );
  
  const confidenceBand = calculateConfidenceBandV1_2(scores.evidence, scores.risk);
  
  const primaryCtx = input.contexts[0];
  const reasoning: DecisionReasoning = {
    primaryContext: primaryCtx ? {
      id: primaryCtx.id,
      headline: primaryCtx.summary,
      whyItMatters: `Context includes ${primaryCtx.involvedActors.length} actors with overlap score ${primaryCtx.overlapScore}`,
    } : null,
    supportingFacts,
    riskNotes: riskResult.breakdown.map(r => r.replace(/\(\+\d+ risk\)/, '').trim()),
  };
  
  const explainability: DecisionExplainability = {
    signalsUsed: input.signals.map(s => s.id),
    actorsUsed: input.actors.map(a => a.slug),
    contextsUsed: input.contexts.map(c => c.id),
    coverageSnapshot: input.coverage,
    distinctSources,
    conflictsDetected: conflicts,
    penaltiesApplied: evidenceResult.penaltiesApplied,
  };
  
  const engineDecision: EngineDecisionV1_2 = {
    id: decisionId,
    inputId: input.id,
    decision,
    confidenceBand,
    scores,
    reasoning,
    explainability,
    createdAt: new Date(),
    engineVersion: config.version,
    neutralReason,
  };
  
  // Log decision
  const inputHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      asset: input.asset.address,
      window: input.window,
      contextIds: input.contexts.map(c => c.id),
      signalIds: input.signals.map(s => s.id),
    }))
    .digest('hex')
    .slice(0, 16);
  
  try {
    await EngineDecisionModel.create({
      decisionId: engineDecision.id,
      inputId: input.id,
      inputHash,
      asset: input.asset,
      window: input.window,
      decision: engineDecision.decision,
      confidenceBand: engineDecision.confidenceBand,
      scores: engineDecision.scores,
      reasoning: engineDecision.reasoning,
      explainability: engineDecision.explainability,
      contextIds: input.contexts.map(c => c.id),
      signalIds: input.signals.map(s => s.id),
      actorSlugs: input.actors.map(a => a.slug),
      coverage: input.coverage,
      createdAt: new Date(),
      engineVersion: engineDecision.engineVersion,
      neutralReason: engineDecision.neutralReason,
      conflictsDetected: engineDecision.explainability.conflictsDetected,
      penaltiesApplied: engineDecision.explainability.penaltiesApplied,
    });
  } catch (err) {
    console.error('[Engine v1.2] Failed to log decision:', err);
  }
  
  return engineDecision;
}

// ============ EXPORTS ============

export { ENGINE_CONFIG_V1_2 as ENGINE_CONFIG };
