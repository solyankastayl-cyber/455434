/**
 * Engine Decision Service (P1 - Sprint 4)
 * 
 * Rule-based decision engine v1
 * 
 * Scoring:
 * 1. Evidence Score (0-100) - "Насколько это стоит учитывать?"
 * 2. Direction Score (-100..+100) - направление движения (НЕ bullish/bearish)
 * 3. Risk Score (0-100) - "Почему нельзя доверять полностью?"
 * 
 * Decision:
 * - BUY: Evidence ≥ 65, Direction ≥ +25, Risk ≤ 45
 * - SELL: Evidence ≥ 65, Direction ≤ -25, Risk ≤ 45
 * - NEUTRAL: всё остальное
 */
import { EngineInput, EngineSignal, EngineContext, EngineActor } from './engine_input.service.js';
import { EngineDecisionModel } from './engine_decision.model.js';
import crypto from 'crypto';

export type Decision = 'BUY' | 'SELL' | 'NEUTRAL';
export type ConfidenceBand = 'LOW' | 'MEDIUM' | 'HIGH';

export interface DecisionScores {
  evidence: number;     // 0-100
  direction: number;    // -100..+100
  risk: number;         // 0-100
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
}

export interface EngineDecision {
  id: string;
  inputId: string;
  decision: Decision;
  confidenceBand: ConfidenceBand;
  scores: DecisionScores;
  reasoning: DecisionReasoning;
  explainability: DecisionExplainability;
  createdAt: Date;
}

// ============ SCORING FUNCTIONS ============

/**
 * Evidence Score (0-100)
 * "Насколько это вообще стоит учитывать?"
 */
function calculateEvidenceScore(input: EngineInput): { score: number; breakdown: string[] } {
  const breakdown: string[] = [];
  let score = 0;
  
  // 1. Signal Type Score (max 30)
  const signalTypes = new Set(input.signals.map(s => s.type));
  const uniqueTypes = signalTypes.size;
  
  if (uniqueTypes >= 3) {
    score += 30;
    breakdown.push(`${uniqueTypes} signal types detected (+30)`);
  } else if (uniqueTypes === 2) {
    score += 20;
    breakdown.push(`${uniqueTypes} signal types detected (+20)`);
  } else if (uniqueTypes === 1) {
    score += 10;
    breakdown.push(`${uniqueTypes} signal type detected (+10)`);
  }
  
  // 2. Source Diversity (max 25)
  const uniqueActors = input.actors.length;
  
  if (uniqueActors >= 3) {
    score += 25;
    breakdown.push(`${uniqueActors} actors involved (+25)`);
  } else if (uniqueActors === 2) {
    score += 15;
    breakdown.push(`${uniqueActors} actors involved (+15)`);
  } else if (uniqueActors === 1) {
    score += 5;
    breakdown.push(`${uniqueActors} actor involved (+5)`);
  }
  
  // 3. Coverage Score (max 25)
  const avgCoverage = input.coverage.overall;
  const coverageScore = Math.round(avgCoverage * 0.25);
  score += coverageScore;
  breakdown.push(`Coverage ${avgCoverage}% (+${coverageScore})`);
  
  // 4. Context Overlap (max 20)
  const maxOverlap = input.contexts.length > 0 
    ? Math.max(...input.contexts.map(c => c.overlapScore))
    : 0;
  
  if (maxOverlap >= 5) {
    score += 20;
    breakdown.push(`High context overlap ${maxOverlap} (+20)`);
  } else if (maxOverlap >= 4) {
    score += 15;
    breakdown.push(`Context overlap ${maxOverlap} (+15)`);
  } else if (maxOverlap >= 3) {
    score += 10;
    breakdown.push(`Context overlap ${maxOverlap} (+10)`);
  }
  
  // 5. Concentration Penalty (max -20)
  const topCorridor = input.graphStats.topCorridors[0];
  if (topCorridor && topCorridor.pctOfTotal > 70) {
    score -= 20;
    breakdown.push(`Single corridor dominance ${topCorridor.pctOfTotal}% (-20)`);
  } else if (topCorridor && topCorridor.pctOfTotal > 50) {
    score -= 10;
    breakdown.push(`Corridor concentration ${topCorridor.pctOfTotal}% (-10)`);
  }
  
  return {
    score: Math.max(0, Math.min(100, score)),
    breakdown,
  };
}

/**
 * Direction Score (-100..+100)
 * НЕ bullish/bearish, только направление наблюдаемого движения
 */
function calculateDirectionScore(input: EngineInput): { score: number; breakdown: string[] } {
  const breakdown: string[] = [];
  let score = 0;
  
  // 1. Flow Component (max ±60)
  const flowSignals = input.signals.filter(s => s.type === 'flow_deviation');
  
  for (const signal of flowSignals) {
    if (signal.metric === 'inflow') {
      const contribution = Math.min(30, signal.deviation * 8);
      score += contribution;
      breakdown.push(`Inflow deviation ${signal.deviation}x (+${Math.round(contribution)})`);
    } else if (signal.metric === 'outflow') {
      const contribution = Math.min(30, signal.deviation * 8);
      score -= contribution;
      breakdown.push(`Outflow deviation ${signal.deviation}x (-${Math.round(contribution)})`);
    }
  }
  
  // 2. Regime Shift Component (±30)
  const regimeShifts = input.signals.filter(s => s.type === 'behavior_regime_shift');
  
  for (const signal of regimeShifts) {
    // Check interpretation for direction
    const source = signal.source.toLowerCase();
    // Simplified: if major actor shifts, assume directional impact
    if (input.actors.some(a => a.slug === signal.source && a.flowDirection === 'inflow')) {
      score += 15;
      breakdown.push(`Regime shift to inflow (${signal.source}) (+15)`);
    } else if (input.actors.some(a => a.slug === signal.source && a.flowDirection === 'outflow')) {
      score -= 15;
      breakdown.push(`Regime shift to outflow (${signal.source}) (-15)`);
    }
  }
  
  // 3. Actor Flow Direction Aggregate (±10)
  const inflowActors = input.actors.filter(a => a.flowDirection === 'inflow').length;
  const outflowActors = input.actors.filter(a => a.flowDirection === 'outflow').length;
  
  if (inflowActors > outflowActors) {
    score += 10;
    breakdown.push(`More inflow actors (${inflowActors}/${input.actors.length}) (+10)`);
  } else if (outflowActors > inflowActors) {
    score -= 10;
    breakdown.push(`More outflow actors (${outflowActors}/${input.actors.length}) (-10)`);
  }
  
  return {
    score: Math.max(-100, Math.min(100, score)),
    breakdown,
  };
}

/**
 * Risk Score (0-100)
 * "Почему этому нельзя доверять полностью?"
 */
function calculateRiskScore(input: EngineInput): { score: number; breakdown: string[] } {
  const breakdown: string[] = [];
  let score = 0;
  
  // 1. Low Coverage (max 40)
  const coverage = input.coverage.overall;
  
  if (coverage < 50) {
    score += 40;
    breakdown.push(`Low coverage ${coverage}% (+40 risk)`);
  } else if (coverage < 70) {
    score += 20;
    breakdown.push(`Partial coverage ${coverage}% (+20 risk)`);
  }
  
  // 2. Signal Noise (max 30)
  const recentSignals = input.signals.length;
  
  if (recentSignals >= 10) {
    score += 30;
    breakdown.push(`High signal frequency (${recentSignals}) (+30 risk)`);
  } else if (recentSignals >= 5) {
    score += 15;
    breakdown.push(`Moderate signal frequency (${recentSignals}) (+15 risk)`);
  }
  
  // 3. Structural Fragility (max 30)
  // Single actor dominance
  if (input.actors.length === 1) {
    score += 20;
    breakdown.push(`Single actor source (+20 risk)`);
  }
  
  // Single corridor dominance
  const topCorridor = input.graphStats.topCorridors[0];
  if (topCorridor && topCorridor.pctOfTotal > 60) {
    score += 10;
    breakdown.push(`Corridor concentration ${topCorridor.pctOfTotal}% (+10 risk)`);
  }
  
  // 4. Context Quality (max 20)
  if (input.contexts.length === 0) {
    score += 20;
    breakdown.push(`No contexts available (+20 risk)`);
  } else if (input.contexts.length === 1) {
    score += 10;
    breakdown.push(`Single context (+10 risk)`);
  }
  
  return {
    score: Math.max(0, Math.min(100, score)),
    breakdown,
  };
}

/**
 * Calculate Confidence Band
 */
function calculateConfidenceBand(evidence: number, risk: number): ConfidenceBand {
  if (evidence >= 80 && risk <= 25) return 'HIGH';
  if (evidence >= 65 && risk <= 45) return 'MEDIUM';
  return 'LOW';
}

/**
 * Make Decision based on scores
 */
function makeDecision(scores: DecisionScores): Decision {
  const { evidence, direction, risk } = scores;
  
  // BUY: Evidence ≥ 65, Direction ≥ +25, Risk ≤ 45
  if (evidence >= 65 && direction >= 25 && risk <= 45) {
    return 'BUY';
  }
  
  // SELL: Evidence ≥ 65, Direction ≤ -25, Risk ≤ 45
  if (evidence >= 65 && direction <= -25 && risk <= 45) {
    return 'SELL';
  }
  
  // NEUTRAL: всё остальное
  return 'NEUTRAL';
}

/**
 * Build Reasoning
 */
function buildReasoning(
  input: EngineInput,
  scores: DecisionScores,
  evidenceBreakdown: string[],
  directionBreakdown: string[],
  riskBreakdown: string[]
): DecisionReasoning {
  // Primary context
  const primaryCtx = input.contexts[0];
  let primaryContext: DecisionReasoning['primaryContext'] = null;
  
  if (primaryCtx) {
    primaryContext = {
      id: primaryCtx.id,
      headline: primaryCtx.summary,
      whyItMatters: `Context includes ${primaryCtx.involvedActors.length} actors with overlap score ${primaryCtx.overlapScore}`,
    };
  }
  
  // Supporting facts (combine evidence and direction breakdowns)
  const supportingFacts = [
    ...evidenceBreakdown.slice(0, 3),
    ...directionBreakdown.slice(0, 2),
  ];
  
  // Risk notes
  const riskNotes = riskBreakdown.map(r => r.replace(/\(\+\d+ risk\)/, '').trim());
  
  return {
    primaryContext,
    supportingFacts,
    riskNotes,
  };
}

// ============ MAIN DECISION FUNCTION ============

/**
 * Generate Engine Decision from Input
 */
export async function generateDecision(input: EngineInput): Promise<EngineDecision> {
  const decisionId = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  // Calculate scores
  const evidenceResult = calculateEvidenceScore(input);
  const directionResult = calculateDirectionScore(input);
  const riskResult = calculateRiskScore(input);
  
  const scores: DecisionScores = {
    evidence: evidenceResult.score,
    direction: directionResult.score,
    risk: riskResult.score,
  };
  
  // Make decision
  const decision = makeDecision(scores);
  const confidenceBand = calculateConfidenceBand(scores.evidence, scores.risk);
  
  // Build reasoning
  const reasoning = buildReasoning(
    input,
    scores,
    evidenceResult.breakdown,
    directionResult.breakdown,
    riskResult.breakdown
  );
  
  // Explainability
  const explainability: DecisionExplainability = {
    signalsUsed: input.signals.map(s => s.id),
    actorsUsed: input.actors.map(a => a.slug),
    contextsUsed: input.contexts.map(c => c.id),
    coverageSnapshot: input.coverage,
  };
  
  const engineDecision: EngineDecision = {
    id: decisionId,
    inputId: input.id,
    decision,
    confidenceBand,
    scores,
    reasoning,
    explainability,
    createdAt: new Date(),
  };
  
  // Log decision
  await logDecision(input, engineDecision);
  
  return engineDecision;
}

/**
 * Log decision for ML training
 */
async function logDecision(input: EngineInput, decision: EngineDecision): Promise<void> {
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
      engineVersion: 'v1.0',
    });
  } catch (err) {
    console.error('[Engine] Failed to log decision:', err);
  }
}
