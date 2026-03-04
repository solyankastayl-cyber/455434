/**
 * S10.LABS-03 — Pattern → Cascade Risk Service
 * 
 * Analyzes which patterns are DANGEROUS vs NOISE.
 * 
 * RULES:
 * - Pattern ≠ signal
 * - Pattern ≠ regime
 * - Pattern = local behavioral structure
 * - We analyze RISK, not direction
 * - NO predictions, NO signals
 */

import { MongoClient, Db, Collection } from 'mongodb';
import {
  Horizon,
  Window,
  HORIZON_MS,
  HORIZON_MS_MOCK,
  WINDOW_MS,
  CASCADE_THRESHOLDS,
} from './labs.types.js';
import { RegimeType, ExchangeObservationRow, ExchangePattern } from '../observation/observation.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface PatternRiskQuery {
  symbol: string;
  pattern?: string;  // Optional: filter by specific pattern
  horizon: Horizon;
  window: Window;
  regimeFilter?: RegimeType;
  minSamples: number;
}

export interface PatternEffects {
  cascadeRate: number;       // % of cases with liquidation cascade
  stressEscalation: number;  // % of cases with stress increase
  regimeDegradation: number; // % of cases transitioning to bad regimes
}

export interface PatternRiskProfile {
  pattern: string;
  samples: number;
  riskScore: number;         // 0..1 composite score
  confidence: number;        // 0..1 based on sample size
  effects: PatternEffects;
  medianTimeToImpact: number; // ms
  falsePositiveRate: number; // % of patterns with no impact
  regimeContext: {
    regime: RegimeType;
    count: number;
    pct: number;
  }[];
  notes: string[];
}

export interface PatternRiskResponse {
  ok: boolean;
  meta: {
    symbol: string;
    horizon: Horizon;
    window: Window;
    regimeFilter: RegimeType | null;
    generatedAt: string;
  };
  totals: {
    observations: number;
    patternsAnalyzed: number;
    totalPatternOccurrences: number;
  };
  patterns: PatternRiskProfile[];
  ranking: {
    dangerous: string[];
    moderate: string[];
    noise: string[];
  };
}

// ═══════════════════════════════════════════════════════════════
// DATABASE CONNECTION
// ═══════════════════════════════════════════════════════════════

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'intelligence_engine';
const COLLECTION_NAME = 'exchange_observations';

let db: Db | null = null;
let collection: Collection<ExchangeObservationRow> | null = null;

async function getCollection(): Promise<Collection<ExchangeObservationRow>> {
  if (collection) return collection;
  
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  collection = db.collection<ExchangeObservationRow>(COLLECTION_NAME);
  
  return collection;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Risk score weights (LOCKED formula)
const RISK_WEIGHTS = {
  cascade: 0.4,
  stress: 0.3,
  degradation: 0.3,
};

// Stress escalation threshold
const STRESS_ESCALATION_THRESHOLD = 0.15; // Δstress > 0.15

// Degraded regimes
const DEGRADED_REGIMES: RegimeType[] = ['EXHAUSTION', 'SHORT_SQUEEZE', 'LONG_SQUEEZE', 'DISTRIBUTION'];

// Confidence threshold for sample size
const CONFIDENCE_SAMPLE_THRESHOLD = 50;

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

export async function calculatePatternRisk(
  query: PatternRiskQuery
): Promise<PatternRiskResponse> {
  const coll = await getCollection();
  
  const now = Date.now();
  const windowMs = WINDOW_MS[query.window];
  const startTime = now - windowMs;
  
  // ─────────────────────────────────────────────────────────────
  // Step 1: Fetch all observations in window
  // ─────────────────────────────────────────────────────────────
  
  const observations = await coll
    .find({
      symbol: query.symbol.toUpperCase(),
      timestamp: { $gte: startTime },
    })
    .sort({ timestamp: 1 })
    .toArray();
  
  const totalObservations = observations.length;
  
  // Detect if mock data
  let isMockData = false;
  if (observations.length >= 2) {
    const avgGap = (observations[observations.length - 1].timestamp - observations[0].timestamp) 
                   / (observations.length - 1);
    isMockData = avgGap < 1000;
  }
  
  const horizonMs = isMockData ? HORIZON_MS_MOCK[query.horizon] : HORIZON_MS[query.horizon];
  
  // ─────────────────────────────────────────────────────────────
  // Step 2: Build pattern occurrences with outcomes
  // ─────────────────────────────────────────────────────────────
  
  interface PatternOccurrence {
    t0: ExchangeObservationRow;
    t1: ExchangeObservationRow | null;
    pattern: string;
    regime: RegimeType;
    timeToImpact: number | null;
    hadCascade: boolean;
    stressEscalated: boolean;
    regimeDegraded: boolean;
  }
  
  const occurrences: PatternOccurrence[] = [];
  
  for (let i = 0; i < observations.length; i++) {
    const t0 = observations[i];
    const patterns = t0.patterns || [];
    
    // Skip if regime filter doesn't match
    const currentRegime = t0.regime?.type || 'NEUTRAL';
    if (query.regimeFilter && currentRegime !== query.regimeFilter) continue;
    
    // Find t1: first observation >= t0 + horizon
    const targetTs = t0.timestamp + horizonMs;
    let t1: ExchangeObservationRow | null = null;
    for (let j = i + 1; j < observations.length; j++) {
      if (observations[j].timestamp >= targetTs) {
        t1 = observations[j];
        break;
      }
    }
    
    // Process each pattern in this observation
    for (const patternData of patterns) {
      const patternName = patternData.patternId || patternData.name || 'UNKNOWN';
      
      // Skip if filtering by specific pattern
      if (query.pattern && patternName !== query.pattern) continue;
      
      // Calculate outcomes
      let hadCascade = false;
      let stressEscalated = false;
      let regimeDegraded = false;
      let timeToImpact: number | null = null;
      
      if (t1) {
        // Check cascade
        const cascadeT1 = t1.liquidations?.cascadeActive || 
                         (t1.liquidations?.intensity ?? 0) >= CASCADE_THRESHOLDS.intensityMin;
        hadCascade = cascadeT1;
        
        // Check stress escalation
        const stress0 = getMarketStress(t0);
        const stress1 = getMarketStress(t1);
        stressEscalated = (stress1 - stress0) > STRESS_ESCALATION_THRESHOLD;
        
        // Check regime degradation
        const regime1 = t1.regime?.type || 'NEUTRAL';
        regimeDegraded = DEGRADED_REGIMES.includes(regime1) && currentRegime !== regime1;
        
        // Calculate time to impact (if any impact occurred)
        if (hadCascade || stressEscalated || regimeDegraded) {
          timeToImpact = t1.timestamp - t0.timestamp;
        }
      }
      
      occurrences.push({
        t0,
        t1,
        pattern: patternName,
        regime: currentRegime,
        timeToImpact,
        hadCascade,
        stressEscalated,
        regimeDegraded,
      });
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // Step 3: Group by pattern and calculate risk profiles
  // ─────────────────────────────────────────────────────────────
  
  const patternGroups = new Map<string, PatternOccurrence[]>();
  
  for (const occ of occurrences) {
    if (!patternGroups.has(occ.pattern)) {
      patternGroups.set(occ.pattern, []);
    }
    patternGroups.get(occ.pattern)!.push(occ);
  }
  
  // ─────────────────────────────────────────────────────────────
  // Step 4: Calculate risk profile for each pattern
  // ─────────────────────────────────────────────────────────────
  
  const patterns: PatternRiskProfile[] = [];
  
  const patternKeys = Array.from(patternGroups.keys());
  for (const patternName of patternKeys) {
    const occs = patternGroups.get(patternName)!;
    
    if (occs.length < query.minSamples) continue;
    
    const profile = calculatePatternProfile(patternName, occs);
    patterns.push(profile);
  }
  
  // Sort by risk score descending
  patterns.sort((a, b) => b.riskScore - a.riskScore);
  
  // ─────────────────────────────────────────────────────────────
  // Step 5: Create ranking
  // ─────────────────────────────────────────────────────────────
  
  const ranking = {
    dangerous: patterns.filter(p => p.riskScore >= 0.6).map(p => p.pattern),
    moderate: patterns.filter(p => p.riskScore >= 0.3 && p.riskScore < 0.6).map(p => p.pattern),
    noise: patterns.filter(p => p.riskScore < 0.3).map(p => p.pattern),
  };
  
  // ─────────────────────────────────────────────────────────────
  // Step 6: Build response
  // ─────────────────────────────────────────────────────────────
  
  return {
    ok: true,
    meta: {
      symbol: query.symbol.toUpperCase(),
      horizon: query.horizon,
      window: query.window,
      regimeFilter: query.regimeFilter || null,
      generatedAt: new Date().toISOString(),
    },
    totals: {
      observations: totalObservations,
      patternsAnalyzed: patterns.length,
      totalPatternOccurrences: occurrences.length,
    },
    patterns,
    ranking,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function getMarketStress(obs: ExchangeObservationRow): number {
  // Try to compute from indicators
  const indicators = obs.indicators || {};
  
  // Estimate stress from volatility, crowding, liquidation intensity
  const volatility = indicators['atr_normalized']?.value ?? 0;
  const crowding = indicators['position_crowding']?.value ?? 0;
  const liqIntensity = obs.liquidations?.intensity ?? 0;
  
  // Simple weighted average
  return (Math.abs(volatility) * 0.3 + crowding * 0.3 + liqIntensity * 0.4);
}

function calculatePatternProfile(
  patternName: string,
  occs: Array<{
    regime: RegimeType;
    timeToImpact: number | null;
    hadCascade: boolean;
    stressEscalated: boolean;
    regimeDegraded: boolean;
  }>
): PatternRiskProfile {
  const samples = occs.length;
  
  // Count effects
  let cascadeCount = 0;
  let stressCount = 0;
  let degradeCount = 0;
  let noImpactCount = 0;
  const timeToImpacts: number[] = [];
  
  // Count regime context
  const regimeCounts = new Map<RegimeType, number>();
  
  for (const occ of occs) {
    if (occ.hadCascade) cascadeCount++;
    if (occ.stressEscalated) stressCount++;
    if (occ.regimeDegraded) degradeCount++;
    
    if (!occ.hadCascade && !occ.stressEscalated && !occ.regimeDegraded) {
      noImpactCount++;
    }
    
    if (occ.timeToImpact !== null) {
      timeToImpacts.push(occ.timeToImpact);
    }
    
    regimeCounts.set(occ.regime, (regimeCounts.get(occ.regime) || 0) + 1);
  }
  
  // Calculate rates
  const cascadeRate = cascadeCount / samples;
  const stressEscalation = stressCount / samples;
  const regimeDegradation = degradeCount / samples;
  const falsePositiveRate = noImpactCount / samples;
  
  // Calculate risk score (LOCKED formula)
  const riskScore = Math.min(1,
    cascadeRate * RISK_WEIGHTS.cascade +
    stressEscalation * RISK_WEIGHTS.stress +
    regimeDegradation * RISK_WEIGHTS.degradation
  );
  
  // Calculate confidence
  const confidence = Math.min(1, samples / CONFIDENCE_SAMPLE_THRESHOLD);
  
  // Calculate median time to impact
  timeToImpacts.sort((a, b) => a - b);
  const medianTimeToImpact = timeToImpacts.length > 0
    ? timeToImpacts[Math.floor(timeToImpacts.length / 2)]
    : 0;
  
  // Build regime context
  const regimeContext: { regime: RegimeType; count: number; pct: number }[] = [];
  const regimeKeys = Array.from(regimeCounts.keys());
  for (const regime of regimeKeys) {
    const count = regimeCounts.get(regime)!;
    regimeContext.push({
      regime,
      count,
      pct: Math.round((count / samples) * 100),
    });
  }
  regimeContext.sort((a, b) => b.count - a.count);
  
  // Generate notes
  const notes = generatePatternNotes(patternName, riskScore, cascadeRate, stressEscalation, falsePositiveRate);
  
  return {
    pattern: patternName,
    samples,
    riskScore,
    confidence,
    effects: {
      cascadeRate,
      stressEscalation,
      regimeDegradation,
    },
    medianTimeToImpact,
    falsePositiveRate,
    regimeContext,
    notes,
  };
}

function generatePatternNotes(
  pattern: string,
  riskScore: number,
  cascadeRate: number,
  stressRate: number,
  falsePositiveRate: number
): string[] {
  const notes: string[] = [];
  const readableName = pattern.replace(/_/g, ' ');
  
  // Risk level note
  if (riskScore >= 0.6) {
    notes.push(`${readableName} is statistically associated with elevated risk`);
  } else if (riskScore >= 0.3) {
    notes.push(`${readableName} shows moderate risk association`);
  } else {
    notes.push(`${readableName} has low statistical impact (potential noise)`);
  }
  
  // Cascade note
  if (cascadeRate > 0.3) {
    notes.push(`High cascade association (${(cascadeRate * 100).toFixed(0)}%)`);
  }
  
  // Stress note
  if (stressRate > 0.4) {
    notes.push(`Frequently followed by stress escalation (${(stressRate * 100).toFixed(0)}%)`);
  }
  
  // False positive note
  if (falsePositiveRate > 0.6) {
    notes.push(`Often no measurable impact (${(falsePositiveRate * 100).toFixed(0)}% false positive)`);
  }
  
  return notes;
}

console.log('[S10.LABS-03] Pattern Risk Service loaded');
