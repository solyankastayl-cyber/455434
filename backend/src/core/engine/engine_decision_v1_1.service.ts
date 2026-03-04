/**
 * Engine Rules v1.1 (Targeted Improvements)
 * 
 * Принцип: v1.1 = stricter, not smarter
 * 
 * НЕ меняем:
 * - архитектуру
 * - API контракты
 * - семантику BUY/SELL/NEUTRAL
 * 
 * МЕНЯЕМ:
 * - пороги (thresholds)
 * - веса (weights)
 * - конфликтные правила
 * - penalty rules
 * - stability rules
 * 
 * Версия: 1.1.0
 */
import { EngineDecisionModel } from './engine_decision.model.js';
import crypto from 'crypto';

// ============ v1.1 CONFIGURATION ============

export const ENGINE_CONFIG_V1_1 = {
  version: '1.1.0',
  
  // 1. Evidence Thresholds (stricter)
  evidence: {
    // Hard zones
    minForAnyDecision: 50,       // Evidence < 50 → NEUTRAL (жёстко)
    softZoneMax: 65,             // Evidence 50-65 → NEUTRAL (soft zone)
    conditionalZoneMax: 80,      // Evidence 65-80 → BUY/SELL (conditional)
    strongZone: 80,              // Evidence ≥ 80 → BUY/SELL (strong)
    
    // Source weights (max per source)
    sourceWeights: {
      actorSignals: 0.30,        // max 30%
      corridorDeviations: 0.25,  // max 25%
      contextParticipation: 0.25,// max 25%
      tokenLevelSignals: 0.20,   // max 20%
    },
    
    // Hard rule: single source cap
    maxSingleSourceContribution: 40, // no source can give >40% Evidence
    
    // Minimum sources for BUY/SELL
    minSourcesForDecision: 2,
  },
  
  // 2. Coverage Thresholds (stricter)
  coverage: {
    hardMinimum: 40,             // Coverage < 40 → NEUTRAL (без исключений)
    softMinimum: 60,             // Coverage 40-60 → conditional
    normalZone: 60,              // Coverage ≥ 60 → нормальный режим
    
    // Conditional zone requirements
    conditionalZoneRequirements: {
      minEvidence: 75,           // При 40-60 coverage нужен evidence ≥ 75
      maxRisk: 35,               // И risk ≤ 35
    },
  },
  
  // 3. Direction Thresholds
  direction: {
    weakThreshold: 20,           // |direction| < 20 = "weak"
    strongThreshold: 40,         // |direction| ≥ 40 = "strong"
    
    // Forbidden combinations
    forbidden: {
      buyWithNegativeDirection: -20,   // BUY при direction < -20 запрещён
      sellWithPositiveDirection: 20,   // SELL при direction > +20 запрещён
    },
  },
  
  // 4. Risk Thresholds (жёстче)
  risk: {
    hardCap: 75,                 // Risk ≥ 75 → NEUTRAL (lock)
    highRiskZone: 60,            // Risk 60-75 → BUY/SELL только если evidence ≥ 80
    normalZone: 40,              // Risk < 40 → нормальный режим
    
    // High risk zone requirements
    highRiskRequirements: {
      minEvidence: 80,
    },
  },
  
  // 5. Penalty Weights
  penalties: {
    lowCoverage: 15,             // Coverage < 50 → -15 Evidence
    highRisk: 20,                // Risk > 65 → -20 Evidence  
    signalConflict: 25,          // Conflicting signals → -25 Evidence
    recentFlip: 10,              // Decision flip < 6h → -10 Evidence
    singleSource: 15,            // Only 1 data source → -15 Evidence
  },
  
  // 6. Conflict Detection
  conflicts: {
    // These signal combinations = conflict
    conflictingSignals: [
      ['inflow_deviation', 'outflow_deviation'],
      ['behavior_regime_shift', 'flow_deviation'],
    ],
    // Conflict penalties
    conflictRiskPenalty: 15,     // risk += 15 при conflict
  },
  
  // 7. Stability Rules
  stability: {
    cooldownHours: 2,            // Min 2h между BUY/SELL
    flipPreventionHours: 6,      // Нельзя BUY→SELL или SELL→BUY за 6h
    flipEvidencePenalty: 10,     // Evidence -= 10 при flip
    flipRiskPenalty: 10,         // Risk += 10 при flip
  },
  
  // 8. Explainability Requirements
  explainability: {
    minSupportingFacts: 3,       // BUY/SELL требует ≥3 facts
    minRiskNotes: 1,             // BUY/SELL требует ≥1 risk note
    minDistinctSources: 2,       // BUY/SELL требует ≥2 источника
  },
};

// ============ v1.1 TYPES ============

export type Decision = 'BUY' | 'SELL' | 'NEUTRAL';
export type ConfidenceBand = 'LOW' | 'MEDIUM' | 'HIGH';

export interface DecisionScores {
  evidence: number;      // 0-100
  direction: number;     // -100..+100
  risk: number;          // 0-100
  // v1.1: добавляем raw scores до penalties
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
  // v1.1: добавляем
  distinctSources: number;
  conflictsDetected: string[];
  penaltiesApplied: string[];
}

export interface EngineDecisionV1_1 {
  id: string;
  inputId: string;
  decision: Decision;
  confidenceBand: ConfidenceBand;
  scores: DecisionScores;
  reasoning: DecisionReasoning;
  explainability: DecisionExplainability;
  createdAt: Date;
  engineVersion: string;
  // v1.1: rejection reason if NEUTRAL
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

// ============ v1.1 CONFLICT DETECTION ============

function detectSignalConflicts(signals: EngineInput['signals']): string[] {
  const conflicts: string[] = [];
  const signalTypes = new Set(signals.map(s => s.type));
  
  for (const [type1, type2] of ENGINE_CONFIG_V1_1.conflicts.conflictingSignals) {
    if (signalTypes.has(type1) && signalTypes.has(type2)) {
      conflicts.push(`${type1} vs ${type2}`);
    }
  }
  
  // Detect inflow/outflow at same time
  const hasInflow = signals.some(s => s.metric === 'inflow');
  const hasOutflow = signals.some(s => s.metric === 'outflow');
  if (hasInflow && hasOutflow) {
    conflicts.push('simultaneous inflow and outflow');
  }
  
  return conflicts;
}

// ============ v1.1 SOURCE COUNTING ============

function countDistinctSources(input: EngineInput): number {
  const sources = new Set<string>();
  
  if (input.signals.length > 0) sources.add('signals');
  if (input.contexts.length > 0) sources.add('contexts');
  if (input.actors.length > 0) sources.add('actors');
  if (input.graphStats.totalEdges > 0) sources.add('graph');
  
  return sources.size;
}

// ============ v1.1 SCORING FUNCTIONS ============

function calculateEvidenceScoreV1_1(
  input: EngineInput,
  conflicts: string[]
): { score: number; rawScore: number; breakdown: string[]; penaltiesApplied: string[] } {
  const config = ENGINE_CONFIG_V1_1;
  const breakdown: string[] = [];
  const penaltiesApplied: string[] = [];
  let score = 0;
  
  // Per-source scores (with caps)
  const sourceScores: Record<string, number> = {
    actorSignals: 0,
    corridorDeviations: 0,
    contextParticipation: 0,
    tokenLevelSignals: 0,
  };
  
  // 1. Actor Signals (max 30)
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
  
  // 2. Corridor Deviations (max 25)
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
  
  // 3. Context Participation (max 25)
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
  
  // 4. Token-Level Signals (max 20)
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
  
  // Apply source caps (no source > 40%)
  for (const [source, sourceScore] of Object.entries(sourceScores)) {
    const capped = Math.min(sourceScore, config.evidence.maxSingleSourceContribution);
    score += capped;
    if (sourceScore > capped) {
      penaltiesApplied.push(`${source} capped at ${config.evidence.maxSingleSourceContribution}`);
    }
  }
  
  const rawScore = score;
  
  // ========== APPLY PENALTIES ==========
  
  // Coverage penalty
  if (input.coverage.overall < 50) {
    score -= config.penalties.lowCoverage;
    penaltiesApplied.push(`Low coverage (<50%): -${config.penalties.lowCoverage}`);
  }
  
  // Signal conflict penalty
  if (conflicts.length > 0) {
    score -= config.penalties.signalConflict;
    penaltiesApplied.push(`Signal conflicts (${conflicts.length}): -${config.penalties.signalConflict}`);
  }
  
  // Single source penalty
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

function calculateDirectionScoreV1_1(
  input: EngineInput
): { score: number; breakdown: string[] } {
  const breakdown: string[] = [];
  let score = 0;
  
  // 1. Flow Component (max ±60)
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
  
  // 2. Regime Shift Component (±25)
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
  
  // 3. Actor Flow Direction Aggregate (±15)
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

function calculateRiskScoreV1_1(
  input: EngineInput,
  conflicts: string[]
): { score: number; rawScore: number; breakdown: string[] } {
  const config = ENGINE_CONFIG_V1_1;
  const breakdown: string[] = [];
  let score = 0;
  
  // 1. Coverage Risk (max 40)
  const coverage = input.coverage.overall;
  
  if (coverage < 40) {
    score += 40;
    breakdown.push(`Critical low coverage ${coverage}% (+40 risk)`);
  } else if (coverage < 50) {
    score += 30;
    breakdown.push(`Low coverage ${coverage}% (+30 risk)`);
  } else if (coverage < 60) {
    score += 20;
    breakdown.push(`Partial coverage ${coverage}% (+20 risk)`);
  } else if (coverage < 70) {
    score += 10;
    breakdown.push(`Marginal coverage ${coverage}% (+10 risk)`);
  }
  
  // 2. Signal Noise/Conflict (max 30)
  if (conflicts.length >= 2) {
    score += 30;
    breakdown.push(`Multiple signal conflicts (${conflicts.length}) (+30 risk)`);
  } else if (conflicts.length === 1) {
    score += config.conflicts.conflictRiskPenalty;
    breakdown.push(`Signal conflict detected (+${config.conflicts.conflictRiskPenalty} risk)`);
  }
  
  const recentSignals = input.signals.length;
  if (recentSignals >= 15) {
    score += 20;
    breakdown.push(`High signal noise (${recentSignals}) (+20 risk)`);
  } else if (recentSignals >= 8) {
    score += 10;
    breakdown.push(`Moderate signal activity (${recentSignals}) (+10 risk)`);
  }
  
  // 3. Structural Fragility (max 25)
  if (input.actors.length === 0) {
    score += 25;
    breakdown.push(`No actor attribution (+25 risk)`);
  } else if (input.actors.length === 1) {
    score += 15;
    breakdown.push(`Single actor source (+15 risk)`);
  }
  
  const topCorridor = input.graphStats.topCorridors[0];
  if (topCorridor && topCorridor.pctOfTotal > 70) {
    score += 10;
    breakdown.push(`Extreme corridor concentration ${topCorridor.pctOfTotal}% (+10 risk)`);
  }
  
  // 4. Context Quality (max 20)
  if (input.contexts.length === 0) {
    score += 20;
    breakdown.push(`No contexts available (+20 risk)`);
  } else if (input.contexts.length === 1 && input.contexts[0].overlapScore < 3) {
    score += 10;
    breakdown.push(`Weak single context (+10 risk)`);
  }
  
  const rawScore = score;
  
  return {
    score: Math.max(0, Math.min(100, score)),
    rawScore,
    breakdown,
  };
}

// ============ v1.1 DECISION LOGIC ============

function makeDecisionV1_1(
  scores: DecisionScores,
  input: EngineInput,
  conflicts: string[],
  distinctSources: number,
  supportingFacts: string[]
): { decision: Decision; neutralReason?: string } {
  const config = ENGINE_CONFIG_V1_1;
  const { evidence, direction, risk } = scores;
  const coverage = input.coverage.overall;
  
  // ========== HARD STOPS (NEUTRAL без исключений) ==========
  
  // 1. Coverage < 40 → NEUTRAL (жёстко)
  if (coverage < config.coverage.hardMinimum) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Coverage ${coverage}% below hard minimum (${config.coverage.hardMinimum}%)`,
    };
  }
  
  // 2. Risk ≥ 75 → NEUTRAL (lock)
  if (risk >= config.risk.hardCap) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Risk ${risk} exceeds hard cap (${config.risk.hardCap})`,
    };
  }
  
  // 3. Evidence < 50 → NEUTRAL (жёстко)
  if (evidence < config.evidence.minForAnyDecision) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Evidence ${evidence} below minimum (${config.evidence.minForAnyDecision})`,
    };
  }
  
  // 4. Signal conflicts → NEUTRAL
  if (conflicts.length > 0) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Signal conflicts detected: ${conflicts.join(', ')}`,
    };
  }
  
  // ========== SOFT ZONES ==========
  
  // 5. Evidence 50-65 (soft zone) → NEUTRAL
  if (evidence < config.evidence.softZoneMax) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Evidence ${evidence} in soft zone (50-65)`,
    };
  }
  
  // 6. Coverage 40-60 (conditional zone)
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
  
  // 7. High risk zone (60-75)
  if (risk >= config.risk.highRiskZone) {
    if (evidence < config.risk.highRiskRequirements.minEvidence) {
      return {
        decision: 'NEUTRAL',
        neutralReason: `High risk ${risk} requires evidence≥${config.risk.highRiskRequirements.minEvidence} (got ${evidence})`,
      };
    }
  }
  
  // 8. Weak direction + anything = NEUTRAL
  const isWeakDirection = Math.abs(direction) < config.direction.weakThreshold;
  if (isWeakDirection) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Weak direction (|${direction}| < ${config.direction.weakThreshold})`,
    };
  }
  
  // 9. Insufficient sources
  if (distinctSources < config.evidence.minSourcesForDecision) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Insufficient sources (${distinctSources} < ${config.evidence.minSourcesForDecision})`,
    };
  }
  
  // 10. Explainability requirements
  if (supportingFacts.length < config.explainability.minSupportingFacts) {
    return {
      decision: 'NEUTRAL',
      neutralReason: `Insufficient explainability (${supportingFacts.length} facts < ${config.explainability.minSupportingFacts})`,
    };
  }
  
  // ========== BUY LOGIC ==========
  // Direction ≥ +25, Evidence ≥ 65, Risk ≤ normal
  if (direction >= 25 && evidence >= config.evidence.softZoneMax && risk < config.risk.highRiskZone) {
    // Forbidden: BUY при direction < -20
    if (direction < config.direction.forbidden.buyWithNegativeDirection) {
      return {
        decision: 'NEUTRAL',
        neutralReason: `BUY forbidden with direction ${direction} (< ${config.direction.forbidden.buyWithNegativeDirection})`,
      };
    }
    return { decision: 'BUY' };
  }
  
  // ========== SELL LOGIC ==========
  // Direction ≤ -25, Evidence ≥ 65, Risk ≤ normal
  if (direction <= -25 && evidence >= config.evidence.softZoneMax && risk < config.risk.highRiskZone) {
    // Forbidden: SELL при direction > +20
    if (direction > config.direction.forbidden.sellWithPositiveDirection) {
      return {
        decision: 'NEUTRAL',
        neutralReason: `SELL forbidden with direction ${direction} (> ${config.direction.forbidden.sellWithPositiveDirection})`,
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

// ============ v1.1 CONFIDENCE BAND ============

function calculateConfidenceBandV1_1(evidence: number, risk: number): ConfidenceBand {
  if (evidence >= 80 && risk <= 30) return 'HIGH';
  if (evidence >= 65 && risk <= 50) return 'MEDIUM';
  return 'LOW';
}

// ============ v1.1 MAIN FUNCTION ============

export async function generateDecisionV1_1(input: EngineInput): Promise<EngineDecisionV1_1> {
  const config = ENGINE_CONFIG_V1_1;
  const decisionId = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  // Detect conflicts
  const conflicts = detectSignalConflicts(input.signals);
  
  // Count distinct sources
  const distinctSources = countDistinctSources(input);
  
  // Calculate scores
  const evidenceResult = calculateEvidenceScoreV1_1(input, conflicts);
  const directionResult = calculateDirectionScoreV1_1(input);
  const riskResult = calculateRiskScoreV1_1(input, conflicts);
  
  const scores: DecisionScores = {
    evidence: evidenceResult.score,
    direction: directionResult.score,
    risk: riskResult.score,
    rawEvidence: evidenceResult.rawScore,
    rawRisk: riskResult.rawScore,
  };
  
  // Build supporting facts early for explainability check
  const supportingFacts = [
    ...evidenceResult.breakdown.slice(0, 3),
    ...directionResult.breakdown.slice(0, 2),
  ];
  
  // Make decision
  const { decision, neutralReason } = makeDecisionV1_1(
    scores,
    input,
    conflicts,
    distinctSources,
    supportingFacts
  );
  
  const confidenceBand = calculateConfidenceBandV1_1(scores.evidence, scores.risk);
  
  // Build reasoning
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
  
  // Explainability
  const explainability: DecisionExplainability = {
    signalsUsed: input.signals.map(s => s.id),
    actorsUsed: input.actors.map(a => a.slug),
    contextsUsed: input.contexts.map(c => c.id),
    coverageSnapshot: input.coverage,
    distinctSources,
    conflictsDetected: conflicts,
    penaltiesApplied: evidenceResult.penaltiesApplied,
  };
  
  const engineDecision: EngineDecisionV1_1 = {
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
  await logDecisionV1_1(input, engineDecision);
  
  return engineDecision;
}

// ============ v1.1 LOGGING ============

async function logDecisionV1_1(input: EngineInput, decision: EngineDecisionV1_1): Promise<void> {
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
      decisionId: decision.id,
      inputId: input.id,
      inputHash,
      asset: input.asset,
      window: input.window,
      decision: decision.decision,
      confidenceBand: decision.confidenceBand,
      scores: decision.scores,
      reasoning: decision.reasoning,
      explainability: decision.explainability,
      contextIds: input.contexts.map(c => c.id),
      signalIds: input.signals.map(s => s.id),
      actorSlugs: input.actors.map(a => a.slug),
      coverage: input.coverage,
      createdAt: new Date(),
      engineVersion: decision.engineVersion,
      // v1.1 additions
      neutralReason: decision.neutralReason,
      conflictsDetected: decision.explainability.conflictsDetected,
      penaltiesApplied: decision.explainability.penaltiesApplied,
    });
  } catch (err) {
    console.error('[Engine v1.1] Failed to log decision:', err);
  }
}

// ============ EXPORT CONFIG FOR EXTERNAL USE ============

export { ENGINE_CONFIG_V1_1 as ENGINE_CONFIG };
