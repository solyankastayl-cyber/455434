/**
 * Engine Feature Extractor (v2 Preparation)
 * 
 * Единый feature vector для Rules и ML
 * Feature extractor детерминирован, не ML
 * 
 * Используется для:
 * - Rules Engine v1.1/v2
 * - ML Scoring Layer (когда включен)
 * - KPI calculations
 */
import { EngineInput } from './engine_decision_v1_1.service.js';

// ============ FEATURE VECTOR TYPE ============

export interface EngineFeatureVector {
  // Core metrics
  coverage: number;                    // 0-100
  evidenceRaw: number;                 // 0-100 (before penalties)
  riskRaw: number;                     // 0-100 (before adjustments)
  direction: number;                   // -100..+100
  
  // Quality metrics
  conflictsCount: number;              // 0+
  distinctSources: number;             // 0-4
  penaltiesCount: number;              // 0+
  
  // Actor metrics
  actorParticipationScore: number;     // 0-100
  actorCount: number;                  // 0+
  actorTypeDistribution: {             // normalized distribution
    exchange: number;
    fund: number;
    market_maker: number;
    whale: number;
    other: number;
  };
  
  // Context metrics
  contextOverlapScore: number;         // 0-10
  contextCount: number;                // 0+
  
  // Signal metrics
  signalDiversity: number;             // 0-1 (entropy-like)
  signalSeverityAvg: number;           // 0-1
  highSeverityRatio: number;           // 0-1
  
  // Graph metrics
  corridorConcentration: number;       // 0-1 (Herfindahl-like)
  totalCorridorVolume: number;         // USD
  graphDensity: number;                // edges/nodes ratio
  
  // Temporal metrics
  volatilityRegime: 'low' | 'normal' | 'high';
  hourOfDay: number;                   // 0-23
  dayOfWeek: number;                   // 0-6
  
  // Historical (optional, for ML)
  historicalDecisionOutcome?: number;  // lagged outcome metric
  previousDecision?: 'BUY' | 'SELL' | 'NEUTRAL';
  timeSincePreviousDecision?: number;  // hours
}

// ============ FEATURE EXTRACTION ============

/**
 * Extract feature vector from EngineInput
 */
export function extractFeatures(input: EngineInput): EngineFeatureVector {
  // Core metrics
  const coverage = input.coverage.overall;
  
  // Calculate raw evidence
  let evidenceRaw = 0;
  if (input.signals.length > 0) evidenceRaw += 25;
  if (input.contexts.length > 0) evidenceRaw += 25;
  if (input.actors.length > 0) evidenceRaw += 25;
  if (input.graphStats.totalEdges > 0) evidenceRaw += 25;
  
  // Calculate raw risk
  let riskRaw = 0;
  if (coverage < 50) riskRaw += 40;
  else if (coverage < 70) riskRaw += 20;
  if (input.contexts.length === 0) riskRaw += 20;
  if (input.actors.length <= 1) riskRaw += 15;
  
  // Calculate direction
  let direction = 0;
  for (const signal of input.signals) {
    if (signal.metric === 'inflow') direction += signal.deviation * 10;
    else if (signal.metric === 'outflow') direction -= signal.deviation * 10;
  }
  direction = Math.max(-100, Math.min(100, direction));
  
  // Conflict detection
  const signalTypes = new Set(input.signals.map(s => s.type));
  let conflictsCount = 0;
  if (signalTypes.has('inflow_deviation') && signalTypes.has('outflow_deviation')) conflictsCount++;
  const hasInflow = input.signals.some(s => s.metric === 'inflow');
  const hasOutflow = input.signals.some(s => s.metric === 'outflow');
  if (hasInflow && hasOutflow) conflictsCount++;
  
  // Distinct sources
  let distinctSources = 0;
  if (input.signals.length > 0) distinctSources++;
  if (input.contexts.length > 0) distinctSources++;
  if (input.actors.length > 0) distinctSources++;
  if (input.graphStats.totalEdges > 0) distinctSources++;
  
  // Actor metrics
  const actorTypeDistribution = {
    exchange: 0, fund: 0, market_maker: 0, whale: 0, other: 0,
  };
  for (const actor of input.actors) {
    const type = actor.type as keyof typeof actorTypeDistribution;
    if (actorTypeDistribution[type] !== undefined) {
      actorTypeDistribution[type]++;
    } else {
      actorTypeDistribution.other++;
    }
  }
  // Normalize
  const totalActors = input.actors.length || 1;
  for (const key of Object.keys(actorTypeDistribution) as Array<keyof typeof actorTypeDistribution>) {
    actorTypeDistribution[key] /= totalActors;
  }
  
  const actorParticipationScore = Math.min(100, input.actors.length * 15);
  
  // Context metrics
  const contextOverlapScore = input.contexts.length > 0
    ? Math.max(...input.contexts.map(c => c.overlapScore))
    : 0;
  
  // Signal metrics
  const signalTypeCount = signalTypes.size;
  const signalDiversity = signalTypeCount > 0 ? Math.min(1, signalTypeCount / 5) : 0;
  
  const severityMap: Record<string, number> = { low: 0.33, medium: 0.66, high: 1 };
  const signalSeverityAvg = input.signals.length > 0
    ? input.signals.reduce((sum, s) => sum + (severityMap[s.severity] || 0.33), 0) / input.signals.length
    : 0;
  
  const highSeverityCount = input.signals.filter(s => s.severity === 'high').length;
  const highSeverityRatio = input.signals.length > 0 ? highSeverityCount / input.signals.length : 0;
  
  // Graph metrics
  const topCorridors = input.graphStats.topCorridors;
  let corridorConcentration = 0;
  if (topCorridors.length > 0) {
    // Herfindahl-like index
    const totalPct = topCorridors.reduce((sum, c) => sum + c.pctOfTotal, 0);
    corridorConcentration = topCorridors.reduce((sum, c) => sum + Math.pow(c.pctOfTotal / (totalPct || 1), 2), 0);
  }
  
  const totalCorridorVolume = topCorridors.reduce((sum, c) => sum + c.volumeUsd, 0);
  
  const graphDensity = input.graphStats.totalNodes > 0
    ? input.graphStats.totalEdges / input.graphStats.totalNodes
    : 0;
  
  // Temporal metrics
  const now = new Date();
  let volatilityRegime: 'low' | 'normal' | 'high' = 'normal';
  if (input.signals.length > 10) volatilityRegime = 'high';
  else if (input.signals.length < 2) volatilityRegime = 'low';
  
  return {
    coverage,
    evidenceRaw,
    riskRaw,
    direction,
    conflictsCount,
    distinctSources,
    penaltiesCount: 0, // Set externally after v1.1 rules
    actorParticipationScore,
    actorCount: input.actors.length,
    actorTypeDistribution,
    contextOverlapScore,
    contextCount: input.contexts.length,
    signalDiversity,
    signalSeverityAvg,
    highSeverityRatio,
    corridorConcentration,
    totalCorridorVolume,
    graphDensity,
    volatilityRegime,
    hourOfDay: now.getUTCHours(),
    dayOfWeek: now.getUTCDay(),
  };
}

/**
 * Convert feature vector to flat array for ML
 */
export function featureVectorToArray(features: EngineFeatureVector): number[] {
  return [
    features.coverage / 100,
    features.evidenceRaw / 100,
    features.riskRaw / 100,
    (features.direction + 100) / 200, // normalize to 0-1
    features.conflictsCount / 5,
    features.distinctSources / 4,
    features.penaltiesCount / 10,
    features.actorParticipationScore / 100,
    features.actorCount / 10,
    features.actorTypeDistribution.exchange,
    features.actorTypeDistribution.fund,
    features.actorTypeDistribution.market_maker,
    features.actorTypeDistribution.whale,
    features.actorTypeDistribution.other,
    features.contextOverlapScore / 10,
    features.contextCount / 10,
    features.signalDiversity,
    features.signalSeverityAvg,
    features.highSeverityRatio,
    features.corridorConcentration,
    features.totalCorridorVolume / 1000000, // normalize to millions
    features.graphDensity / 10,
    features.volatilityRegime === 'low' ? 0 : features.volatilityRegime === 'normal' ? 0.5 : 1,
    features.hourOfDay / 24,
    features.dayOfWeek / 7,
  ];
}

/**
 * Get feature names (for explainability)
 */
export function getFeatureNames(): string[] {
  return [
    'coverage',
    'evidence_raw',
    'risk_raw',
    'direction',
    'conflicts_count',
    'distinct_sources',
    'penalties_count',
    'actor_participation_score',
    'actor_count',
    'actor_type_exchange',
    'actor_type_fund',
    'actor_type_market_maker',
    'actor_type_whale',
    'actor_type_other',
    'context_overlap_score',
    'context_count',
    'signal_diversity',
    'signal_severity_avg',
    'high_severity_ratio',
    'corridor_concentration',
    'total_corridor_volume',
    'graph_density',
    'volatility_regime',
    'hour_of_day',
    'day_of_week',
  ];
}
