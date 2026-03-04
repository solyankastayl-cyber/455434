/**
 * S10.W Step 6 — LABS-05: Whale Risk Analysis Service
 * 
 * Analyzes whale patterns and their statistical impact:
 * - What happens after high-risk whale patterns?
 * - Cascade rates, stress escalation, regime degradation
 * - Lift vs baseline
 * 
 * NO SIGNALS, NO PREDICTIONS — only statistical analysis.
 */

import { getDb } from '../../../db/mongodb.js';
import { WhalePatternId } from '../whales/patterns/whale-pattern.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface WhaleRiskAnalysisParams {
  symbol?: string;
  horizon: '5m' | '15m' | '1h' | '4h';
  window?: number; // max observations to analyze
  pattern?: WhalePatternId | 'ALL';
  riskThreshold?: number;
  regimeFilter?: string;
}

export interface OutcomeFlags {
  cascadeOccurred: boolean;
  stressEscalated: boolean;
  regimeDegraded: boolean;
  volatilitySpike: boolean;
  anyImpact: boolean;
}

export interface RiskBucketStats {
  bucket: 'LOW' | 'MID' | 'HIGH';
  count: number;
  impactRate: number;
  cascadeRate: number;
  stressEscalationRate: number;
  regimeDegradationRate: number;
  volatilitySpikeRate: number;
  avgTimeToImpactMs?: number;
}

export interface PatternRiskStats {
  patternId: WhalePatternId;
  totalCount: number;
  activeCount: number;
  avgRiskScore: number;
  buckets: RiskBucketStats[];
  lift: number | null; // impactRate(HIGH) / impactRate(LOW)
}

export interface WhaleRiskSummary {
  params: WhaleRiskAnalysisParams;
  totalObservations: number;
  usablePairs: number;
  patternStats: PatternRiskStats[];
  overallStats: {
    avgImpactRate: number;
    avgCascadeRate: number;
    avgStressRate: number;
    highRiskCount: number;
    falsePositiveRate: number;
  };
  insights: string[];
  computedAt: number;
}

export interface WhaleRiskCase {
  observationId: string;
  symbol: string;
  timestamp: number;
  patternId: WhalePatternId;
  riskScore: number;
  riskLevel: 'LOW' | 'MID' | 'HIGH';
  outcome: OutcomeFlags;
  horizonMs: number;
  indicators: Record<string, number>;
}

export interface WhaleRiskMatrix {
  horizons: string[];
  buckets: string[];
  data: Record<string, Record<string, {
    impactRate: number;
    cascadeRate: number;
    count: number;
  }>>;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const HORIZON_MS: Record<string, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
};

const RISK_BUCKETS = {
  LOW: { min: 0, max: 0.4 },
  MID: { min: 0.4, max: 0.7 },
  HIGH: { min: 0.7, max: 1.0 },
};

// Thresholds for outcome detection
const STRESS_ESCALATION_THRESHOLD = 0.20;
const VOLATILITY_SPIKE_THRESHOLD = 0.20;

// ═══════════════════════════════════════════════════════════════
// REGIME RANKING (for degradation detection)
// ═══════════════════════════════════════════════════════════════

const REGIME_RANK: Record<string, number> = {
  'STRONG_TREND': 5,
  'HEALTHY_PULLBACK': 4,
  'CONSOLIDATION': 3,
  'WEAK_TREND': 2,
  'REVERSAL': 1,
  'CRISIS': 0,
};

function getRegimeRank(regime: string): number {
  return REGIME_RANK[regime] ?? 3;
}

// ═══════════════════════════════════════════════════════════════
// RISK BUCKET HELPER
// ═══════════════════════════════════════════════════════════════

function getRiskBucket(riskScore: number): 'LOW' | 'MID' | 'HIGH' {
  if (riskScore >= 0.7) return 'HIGH';
  if (riskScore >= 0.4) return 'MID';
  return 'LOW';
}

// ═══════════════════════════════════════════════════════════════
// MAIN ANALYSIS SERVICE
// ═══════════════════════════════════════════════════════════════

/**
 * Get whale risk analysis summary.
 */
export async function getWhaleRiskSummary(
  params: WhaleRiskAnalysisParams
): Promise<WhaleRiskSummary> {
  const {
    symbol,
    horizon,
    window = 2000,
    pattern = 'ALL',
    riskThreshold = 0.7,
    regimeFilter,
  } = params;
  
  const horizonMs = HORIZON_MS[horizon];
  const db = await getDb();
  
  // Build query for whale pattern history
  const patternFilter: Record<string, any> = {};
  if (symbol) patternFilter.symbol = symbol.toUpperCase();
  if (pattern !== 'ALL') patternFilter.patternId = pattern;
  
  // Get pattern history
  const patternHistory = await db.collection('exchange_whale_patterns')
    .find(patternFilter)
    .sort({ timestamp: -1 })
    .limit(window)
    .toArray();
  
  // Get observations for outcome analysis
  const observationFilter: Record<string, any> = {};
  if (symbol) observationFilter.symbol = symbol.toUpperCase();
  if (regimeFilter) observationFilter['regime.type'] = regimeFilter;
  
  const observations = await db.collection('exchange_observations')
    .find(observationFilter)
    .sort({ timestamp: -1 })
    .limit(window * 2) // Need more for horizon pairing
    .toArray();
  
  // Build observation lookup by timestamp
  const obsMap = new Map<number, any>();
  for (const obs of observations) {
    obsMap.set(obs.timestamp, obs);
  }
  
  // Analyze each pattern entry
  const patternAnalysis: Map<WhalePatternId, {
    entries: Array<{
      riskScore: number;
      bucket: 'LOW' | 'MID' | 'HIGH';
      outcome: OutcomeFlags;
      timeToImpact?: number;
    }>;
  }> = new Map();
  
  let usablePairs = 0;
  
  for (const entry of patternHistory) {
    if (!entry.active) continue;
    
    const t0 = entry.timestamp;
    const t1Target = t0 + horizonMs;
    
    // Find observation at t0 and t1
    const obs0 = findClosestObservation(obsMap, t0, 60000); // within 1 min
    const obs1 = findClosestObservation(obsMap, t1Target, 60000);
    
    if (!obs0 || !obs1) continue;
    
    usablePairs++;
    
    // Calculate outcome
    const outcome = calculateOutcome(obs0, obs1);
    const bucket = getRiskBucket(entry.riskScore);
    
    // Add to pattern analysis
    if (!patternAnalysis.has(entry.patternId)) {
      patternAnalysis.set(entry.patternId, { entries: [] });
    }
    
    patternAnalysis.get(entry.patternId)!.entries.push({
      riskScore: entry.riskScore,
      bucket,
      outcome,
      timeToImpact: outcome.anyImpact ? (obs1.timestamp - obs0.timestamp) : undefined,
    });
  }
  
  // Build stats per pattern
  const patternStats: PatternRiskStats[] = [];
  
  const patternIds: WhalePatternId[] = ['WHALE_TRAP_RISK', 'FORCED_SQUEEZE_RISK', 'BAIT_AND_FLIP'];
  
  for (const patternId of patternIds) {
    const analysis = patternAnalysis.get(patternId);
    
    if (!analysis || analysis.entries.length === 0) {
      patternStats.push({
        patternId,
        totalCount: 0,
        activeCount: 0,
        avgRiskScore: 0,
        buckets: [],
        lift: null,
      });
      continue;
    }
    
    const entries = analysis.entries;
    const bucketStats = calculateBucketStats(entries);
    
    // Calculate lift
    const lowBucket = bucketStats.find(b => b.bucket === 'LOW');
    const highBucket = bucketStats.find(b => b.bucket === 'HIGH');
    let lift: number | null = null;
    
    if (lowBucket && highBucket && lowBucket.impactRate > 0) {
      lift = highBucket.impactRate / lowBucket.impactRate;
    }
    
    patternStats.push({
      patternId,
      totalCount: entries.length,
      activeCount: entries.filter(e => e.riskScore >= 0.4).length,
      avgRiskScore: entries.reduce((sum, e) => sum + e.riskScore, 0) / entries.length,
      buckets: bucketStats,
      lift,
    });
  }
  
  // Calculate overall stats
  const allEntries = Array.from(patternAnalysis.values()).flatMap(a => a.entries);
  const highRiskEntries = allEntries.filter(e => e.bucket === 'HIGH');
  const falsePositives = highRiskEntries.filter(e => !e.outcome.anyImpact);
  
  const overallStats = {
    avgImpactRate: allEntries.length > 0 
      ? allEntries.filter(e => e.outcome.anyImpact).length / allEntries.length 
      : 0,
    avgCascadeRate: allEntries.length > 0
      ? allEntries.filter(e => e.outcome.cascadeOccurred).length / allEntries.length
      : 0,
    avgStressRate: allEntries.length > 0
      ? allEntries.filter(e => e.outcome.stressEscalated).length / allEntries.length
      : 0,
    highRiskCount: highRiskEntries.length,
    falsePositiveRate: highRiskEntries.length > 0
      ? falsePositives.length / highRiskEntries.length
      : 0,
  };
  
  // Generate insights
  const insights = generateInsights(patternStats, overallStats);
  
  return {
    params,
    totalObservations: patternHistory.length,
    usablePairs,
    patternStats,
    overallStats,
    insights,
    computedAt: Date.now(),
  };
}

/**
 * Get whale risk cases (examples).
 */
export async function getWhaleRiskCases(
  params: WhaleRiskAnalysisParams & { bucket?: 'LOW' | 'MID' | 'HIGH'; limit?: number }
): Promise<{ highRiskWithImpact: WhaleRiskCase[]; highRiskNoImpact: WhaleRiskCase[] }> {
  const {
    symbol,
    horizon,
    window = 500,
    pattern = 'ALL',
    bucket = 'HIGH',
    limit = 20,
  } = params;
  
  const horizonMs = HORIZON_MS[horizon];
  const db = await getDb();
  
  // Get pattern history
  const patternFilter: Record<string, any> = { active: true };
  if (symbol) patternFilter.symbol = symbol.toUpperCase();
  if (pattern !== 'ALL') patternFilter.patternId = pattern;
  
  // Filter by bucket
  const bucketRange = RISK_BUCKETS[bucket];
  patternFilter.riskScore = { $gte: bucketRange.min, $lt: bucketRange.max };
  
  const patternHistory = await db.collection('exchange_whale_patterns')
    .find(patternFilter)
    .sort({ timestamp: -1 })
    .limit(window)
    .toArray();
  
  // Get observations
  const observations = await db.collection('exchange_observations')
    .find(symbol ? { symbol: symbol.toUpperCase() } : {})
    .sort({ timestamp: -1 })
    .limit(window * 2)
    .toArray();
  
  const obsMap = new Map<number, any>();
  for (const obs of observations) {
    obsMap.set(obs.timestamp, obs);
  }
  
  const highRiskWithImpact: WhaleRiskCase[] = [];
  const highRiskNoImpact: WhaleRiskCase[] = [];
  
  for (const entry of patternHistory) {
    const t0 = entry.timestamp;
    const t1Target = t0 + horizonMs;
    
    const obs0 = findClosestObservation(obsMap, t0, 60000);
    const obs1 = findClosestObservation(obsMap, t1Target, 60000);
    
    if (!obs0 || !obs1) continue;
    
    const outcome = calculateOutcome(obs0, obs1);
    
    const caseEntry: WhaleRiskCase = {
      observationId: obs0._id?.toString() ?? '',
      symbol: entry.symbol,
      timestamp: entry.timestamp,
      patternId: entry.patternId,
      riskScore: entry.riskScore,
      riskLevel: getRiskBucket(entry.riskScore),
      outcome,
      horizonMs,
      indicators: {},
    };
    
    if (outcome.anyImpact && highRiskWithImpact.length < limit) {
      highRiskWithImpact.push(caseEntry);
    } else if (!outcome.anyImpact && highRiskNoImpact.length < limit) {
      highRiskNoImpact.push(caseEntry);
    }
    
    if (highRiskWithImpact.length >= limit && highRiskNoImpact.length >= limit) {
      break;
    }
  }
  
  return { highRiskWithImpact, highRiskNoImpact };
}

/**
 * Get whale risk matrix (heatmap data).
 */
export async function getWhaleRiskMatrix(
  params: {
    symbol?: string;
    horizons?: string[];
    window?: number;
    pattern?: WhalePatternId | 'ALL';
  }
): Promise<WhaleRiskMatrix> {
  const {
    symbol,
    horizons = ['5m', '15m', '1h', '4h'],
    window = 2000,
    pattern = 'ALL',
  } = params;
  
  const buckets = ['LOW', 'MID', 'HIGH'];
  const data: Record<string, Record<string, { impactRate: number; cascadeRate: number; count: number }>> = {};
  
  // Initialize matrix
  for (const bucket of buckets) {
    data[bucket] = {};
    for (const h of horizons) {
      data[bucket][h] = { impactRate: 0, cascadeRate: 0, count: 0 };
    }
  }
  
  // Calculate for each horizon
  for (const h of horizons) {
    const summary = await getWhaleRiskSummary({
      symbol,
      horizon: h as '5m' | '15m' | '1h' | '4h',
      window,
      pattern,
    });
    
    // Aggregate bucket stats across all patterns
    for (const ps of summary.patternStats) {
      for (const bs of ps.buckets) {
        data[bs.bucket][h].impactRate += bs.impactRate * bs.count;
        data[bs.bucket][h].cascadeRate += bs.cascadeRate * bs.count;
        data[bs.bucket][h].count += bs.count;
      }
    }
    
    // Normalize
    for (const bucket of buckets) {
      if (data[bucket][h].count > 0) {
        data[bucket][h].impactRate /= data[bucket][h].count;
        data[bucket][h].cascadeRate /= data[bucket][h].count;
      }
    }
  }
  
  return {
    horizons,
    buckets,
    data,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function findClosestObservation(
  obsMap: Map<number, any>,
  targetTs: number,
  toleranceMs: number
): any | null {
  // Simple linear search (can be optimized with binary search)
  let closest: any = null;
  let minDiff = toleranceMs;
  
  for (const [ts, obs] of obsMap) {
    const diff = Math.abs(ts - targetTs);
    if (diff < minDiff) {
      minDiff = diff;
      closest = obs;
    }
  }
  
  return closest;
}

function calculateOutcome(obs0: any, obs1: any): OutcomeFlags {
  // Cascade occurred
  const cascadeOccurred = obs1.liquidations?.cascadeActive === true ||
    (obs1.liquidations?.cascadeState?.cascadeActive === true);
  
  // Stress escalated
  const stress0 = obs0.indicators?.['market_stress']?.value ?? obs0.aggregates?.marketStress ?? 0;
  const stress1 = obs1.indicators?.['market_stress']?.value ?? obs1.aggregates?.marketStress ?? 0;
  const stressEscalated = (stress1 - stress0) >= STRESS_ESCALATION_THRESHOLD;
  
  // Regime degraded
  const regime0Rank = getRegimeRank(obs0.regime?.type ?? 'CONSOLIDATION');
  const regime1Rank = getRegimeRank(obs1.regime?.type ?? 'CONSOLIDATION');
  const regimeDegraded = regime1Rank < regime0Rank;
  
  // Volatility spike
  const vol0 = obs0.indicators?.['atr_normalized']?.value ?? obs0.aggregates?.volatility ?? 0;
  const vol1 = obs1.indicators?.['atr_normalized']?.value ?? obs1.aggregates?.volatility ?? 0;
  const volatilitySpike = (vol1 - vol0) >= VOLATILITY_SPIKE_THRESHOLD;
  
  const anyImpact = cascadeOccurred || stressEscalated || regimeDegraded || volatilitySpike;
  
  return {
    cascadeOccurred,
    stressEscalated,
    regimeDegraded,
    volatilitySpike,
    anyImpact,
  };
}

function calculateBucketStats(
  entries: Array<{
    riskScore: number;
    bucket: 'LOW' | 'MID' | 'HIGH';
    outcome: OutcomeFlags;
    timeToImpact?: number;
  }>
): RiskBucketStats[] {
  const buckets: ('LOW' | 'MID' | 'HIGH')[] = ['LOW', 'MID', 'HIGH'];
  const stats: RiskBucketStats[] = [];
  
  for (const bucket of buckets) {
    const bucketEntries = entries.filter(e => e.bucket === bucket);
    const count = bucketEntries.length;
    
    if (count === 0) {
      stats.push({
        bucket,
        count: 0,
        impactRate: 0,
        cascadeRate: 0,
        stressEscalationRate: 0,
        regimeDegradationRate: 0,
        volatilitySpikeRate: 0,
      });
      continue;
    }
    
    const impactCount = bucketEntries.filter(e => e.outcome.anyImpact).length;
    const cascadeCount = bucketEntries.filter(e => e.outcome.cascadeOccurred).length;
    const stressCount = bucketEntries.filter(e => e.outcome.stressEscalated).length;
    const regimeCount = bucketEntries.filter(e => e.outcome.regimeDegraded).length;
    const volCount = bucketEntries.filter(e => e.outcome.volatilitySpike).length;
    
    const timesToImpact = bucketEntries
      .filter(e => e.timeToImpact !== undefined)
      .map(e => e.timeToImpact!);
    
    stats.push({
      bucket,
      count,
      impactRate: impactCount / count,
      cascadeRate: cascadeCount / count,
      stressEscalationRate: stressCount / count,
      regimeDegradationRate: regimeCount / count,
      volatilitySpikeRate: volCount / count,
      avgTimeToImpactMs: timesToImpact.length > 0
        ? timesToImpact.reduce((a, b) => a + b, 0) / timesToImpact.length
        : undefined,
    });
  }
  
  return stats;
}

function generateInsights(
  patternStats: PatternRiskStats[],
  overallStats: { avgImpactRate: number; avgCascadeRate: number; highRiskCount: number; falsePositiveRate: number }
): string[] {
  const insights: string[] = [];
  
  // Overall insight
  if (overallStats.avgImpactRate > 0.5) {
    insights.push('High whale risk patterns frequently lead to market impact');
  } else if (overallStats.avgImpactRate < 0.2) {
    insights.push('Whale risk patterns show weak correlation with market impact in this period');
  }
  
  // Per-pattern insights
  for (const ps of patternStats) {
    if (ps.lift && ps.lift > 1.5) {
      insights.push(`${ps.patternId}: High-risk occurrences are ${ps.lift.toFixed(1)}x more likely to cause impact than low-risk`);
    }
    
    const highBucket = ps.buckets.find(b => b.bucket === 'HIGH');
    if (highBucket && highBucket.cascadeRate > 0.3) {
      insights.push(`${ps.patternId}: High cascade rate (${(highBucket.cascadeRate * 100).toFixed(0)}%) when pattern is HIGH`);
    }
  }
  
  // False positive insight
  if (overallStats.falsePositiveRate > 0.6) {
    insights.push('Warning: High false positive rate - whale risk patterns may not be predictive in current market conditions');
  }
  
  return insights;
}

console.log('[S10.W] Whale Risk Analysis Service loaded');
