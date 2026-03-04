/**
 * Outcome Simulator Service (Block S1)
 * 
 * Генерирует outcomes без ожидания рынка, на основе логики Rules Engine.
 * Все данные маркируются как SIMULATED.
 * 
 * Принцип: Не симулируем цены, симулируем "прошедшее время".
 * ML учится на логике системы, Rules остаются source of truth.
 */
import { OutcomeSnapshotModel } from './outcome_snapshot.model.js';
import { OutcomeResultModel } from './outcome_result.model.js';
import { OutcomeLabelModel } from './outcome_label.model.js';
import { OutcomeAttributionModel } from './outcome_attribution.model.js';
import { TrainingSampleModel } from '../ml/training_sample.model.js';

// ============================================================
// SIMULATION CONFIGURATION
// ============================================================

const SIMULATION_VERSION = 'S1.0';

interface SimulationConfig {
  // BUY thresholds
  buySuccessMinConfidence: number;
  buySuccessMinActorScore: number;
  buySuccessMaxRisk: number;
  buyFailMaxConfidence: number;
  buyFailMinRisk: number;
  
  // WATCH thresholds
  watchSuccessMinConfidence: number;
  watchSuccessMaxConfidence: number;
  watchFailHighVolatility: number;
  
  // SELL thresholds
  sellSuccessMaxActorScore: number;
  sellSuccessMinConfidence: number;
  sellFailMaxConfidence: number;
  
  // Noise & variance
  noiseLevel: number; // 0-1, adds randomness
  severityBase: number;
  severityVariance: number;
}

const DEFAULT_CONFIG: SimulationConfig = {
  // BUY
  buySuccessMinConfidence: 70,
  buySuccessMinActorScore: 2,
  buySuccessMaxRisk: 40,
  buyFailMaxConfidence: 40,
  buyFailMinRisk: 60,
  
  // WATCH
  watchSuccessMinConfidence: 50,
  watchSuccessMaxConfidence: 70,
  watchFailHighVolatility: 15,
  
  // SELL
  sellSuccessMaxActorScore: -2,
  sellSuccessMinConfidence: 60,
  sellFailMaxConfidence: 40,
  
  // Noise
  noiseLevel: 0.15,
  severityBase: 0.5,
  severityVariance: 0.3,
};

// ============================================================
// OUTCOME SIMULATION RULES (S2)
// ============================================================

type SimulatedOutcome = 'SUCCESS' | 'FLAT' | 'FAIL';

interface SimulationResult {
  outcome: SimulatedOutcome;
  deltaPct: number;
  severity: number;
  reasons: string[];
}

/**
 * Simulate outcome for BUY bucket
 */
function simulateBuyOutcome(
  snapshot: any,
  config: SimulationConfig
): SimulationResult {
  const { confidence, risk, actorSignalScore } = snapshot;
  const reasons: string[] = [];
  
  // SUCCESS: High confidence + positive signals + low risk
  if (
    confidence >= config.buySuccessMinConfidence &&
    (actorSignalScore || 0) >= config.buySuccessMinActorScore &&
    risk <= config.buySuccessMaxRisk
  ) {
    const baseDelta = 5 + Math.random() * 15; // +5% to +20%
    reasons.push('High confidence with positive actor signals');
    reasons.push('Risk within acceptable range');
    
    return {
      outcome: 'SUCCESS',
      deltaPct: baseDelta * (1 + config.noiseLevel * (Math.random() - 0.5)),
      severity: config.severityBase + Math.random() * config.severityVariance,
      reasons,
    };
  }
  
  // FAIL: Low confidence OR high risk
  if (
    confidence <= config.buyFailMaxConfidence ||
    risk >= config.buyFailMinRisk
  ) {
    const baseDelta = -5 - Math.random() * 15; // -5% to -20%
    reasons.push(confidence <= config.buyFailMaxConfidence 
      ? 'Low confidence for BUY decision'
      : 'High risk level');
    
    return {
      outcome: 'FAIL',
      deltaPct: baseDelta * (1 + config.noiseLevel * (Math.random() - 0.5)),
      severity: config.severityBase + Math.random() * config.severityVariance,
      reasons,
    };
  }
  
  // FLAT: Middle ground
  reasons.push('Mixed signals, no clear direction');
  return {
    outcome: 'FLAT',
    deltaPct: (Math.random() - 0.5) * 6, // -3% to +3%
    severity: 0.2 + Math.random() * 0.2,
    reasons,
  };
}

/**
 * Simulate outcome for WATCH bucket
 */
function simulateWatchOutcome(
  snapshot: any,
  config: SimulationConfig
): SimulationResult {
  const { confidence, conflictDetected, actorSignalScore } = snapshot;
  const reasons: string[] = [];
  
  // SUCCESS: Stable conditions maintained
  if (
    confidence >= config.watchSuccessMinConfidence &&
    confidence <= config.watchSuccessMaxConfidence &&
    !conflictDetected
  ) {
    const baseDelta = (Math.random() - 0.5) * 4; // -2% to +2%
    reasons.push('Stability maintained as expected');
    
    return {
      outcome: 'SUCCESS',
      deltaPct: baseDelta,
      severity: 0.3 + Math.random() * 0.2,
      reasons,
    };
  }
  
  // FAIL: Unexpected volatility or conflicts
  if (conflictDetected || Math.abs(actorSignalScore || 0) > 5) {
    const direction = (actorSignalScore || 0) > 0 ? 1 : -1;
    const baseDelta = direction * (8 + Math.random() * 12); // ±8% to ±20%
    reasons.push('Unexpected price movement while on WATCH');
    if (conflictDetected) reasons.push('Conflict signals present');
    
    return {
      outcome: 'FAIL',
      deltaPct: baseDelta,
      severity: 0.5 + Math.random() * 0.3,
      reasons,
    };
  }
  
  // FLAT: Default stable state
  reasons.push('Market remained stable, WATCH appropriate');
  return {
    outcome: 'FLAT',
    deltaPct: (Math.random() - 0.5) * 3,
    severity: 0.2 + Math.random() * 0.1,
    reasons,
  };
}

/**
 * Simulate outcome for SELL bucket
 */
function simulateSellOutcome(
  snapshot: any,
  config: SimulationConfig
): SimulationResult {
  const { confidence, actorSignalScore } = snapshot;
  const reasons: string[] = [];
  
  // SUCCESS: SELL was correct - price dropped
  if (
    (actorSignalScore || 0) <= config.sellSuccessMaxActorScore &&
    confidence >= config.sellSuccessMinConfidence
  ) {
    const baseDelta = -8 - Math.random() * 15; // -8% to -23%
    reasons.push('SELL signal confirmed by price drop');
    reasons.push('Negative actor signals validated');
    
    return {
      outcome: 'SUCCESS',
      deltaPct: baseDelta * (1 + config.noiseLevel * (Math.random() - 0.5)),
      severity: config.severityBase + Math.random() * config.severityVariance,
      reasons,
    };
  }
  
  // FAIL: SELL was wrong - price went up
  if (confidence <= config.sellFailMaxConfidence) {
    const baseDelta = 5 + Math.random() * 10; // +5% to +15%
    reasons.push('SELL signal was premature');
    reasons.push('Low confidence led to wrong exit');
    
    return {
      outcome: 'FAIL',
      deltaPct: baseDelta * (1 + config.noiseLevel * (Math.random() - 0.5)),
      severity: config.severityBase + Math.random() * config.severityVariance,
      reasons,
    };
  }
  
  // FLAT: Neutral outcome
  reasons.push('Price remained stable after SELL');
  return {
    outcome: 'FLAT',
    deltaPct: (Math.random() - 0.5) * 5,
    severity: 0.25 + Math.random() * 0.15,
    reasons,
  };
}

/**
 * Main simulation function
 */
function simulateOutcome(
  snapshot: any,
  config: SimulationConfig = DEFAULT_CONFIG
): SimulationResult {
  switch (snapshot.bucket) {
    case 'BUY':
      return simulateBuyOutcome(snapshot, config);
    case 'SELL':
      return simulateSellOutcome(snapshot, config);
    case 'WATCH':
    default:
      return simulateWatchOutcome(snapshot, config);
  }
}

// ============================================================
// SIGNAL CONTRIBUTION SIMULATION
// ============================================================

function simulateSignalContributions(
  snapshot: any,
  outcome: SimulatedOutcome
): any {
  const isPositiveOutcome = outcome === 'SUCCESS';
  const isNegativeOutcome = outcome === 'FAIL';
  
  // Create realistic signal contributions based on outcome
  // For SUCCESS: positive signals are positive, for FAIL: positive signals are negative
  const baseMultiplier = isPositiveOutcome ? 1 : isNegativeOutcome ? -0.8 : 0.1;
  
  // Generate more varied and correlated contributions
  const dexFlowBase = 0.25 + Math.random() * 0.35;
  const whaleBase = 0.20 + Math.random() * 0.30;
  const momentumBase = 0.15 + Math.random() * 0.25;
  
  return {
    dexFlow: dexFlowBase * baseMultiplier * (1 + (Math.random() - 0.5) * 0.4),
    whale: whaleBase * baseMultiplier * (1 + (Math.random() - 0.5) * 0.4),
    conflict: isNegativeOutcome 
      ? -(0.15 + Math.random() * 0.25) 
      : snapshot.conflictDetected 
        ? -(0.1 + Math.random() * 0.15) 
        : 0,
    momentum: momentumBase * baseMultiplier * (1 + (Math.random() - 0.5) * 0.4),
    volatility: isNegativeOutcome 
      ? -(0.1 + Math.random() * 0.15) 
      : -(Math.random() * 0.08),
    liquidity: Math.max(0.05, (snapshot.coverage || 30) / 100 * 0.3),
  };
}

function determineSimulatedSignals(
  contributions: any,
  outcome: SimulatedOutcome
): { dominant: string[]; misleading: string[]; missing: string[] } {
  const dominant: string[] = [];
  const misleading: string[] = [];
  const missing: string[] = [];
  
  for (const [signal, value] of Object.entries(contributions)) {
    const v = value as number;
    if (Math.abs(v) < 0.05) continue;
    
    if (outcome === 'SUCCESS') {
      if (v > 0.1) dominant.push(signal);
      else if (v < -0.1) misleading.push(signal);
    } else if (outcome === 'FAIL') {
      if (v > 0.1) misleading.push(signal);
      else if (v < -0.1) dominant.push(signal);
    }
  }
  
  // Add missing signals for low coverage
  if (contributions.liquidity < 0.1) {
    missing.push('low_coverage');
  }
  
  return { dominant, misleading, missing };
}

// ============================================================
// MAIN SIMULATION PIPELINE
// ============================================================

export interface SimulationStats {
  snapshotsProcessed: number;
  resultsCreated: number;
  labelsCreated: number;
  attributionsCreated: number;
  samplesCreated: number;
  byOutcome: { SUCCESS: number; FLAT: number; FAIL: number };
  byBucket: { BUY: number; WATCH: number; SELL: number };
  duration_ms: number;
}

/**
 * Run full simulation on all unprocessed snapshots
 */
export async function runOutcomeSimulation(
  windowHours: 24 | 72 | 168 = 24,
  config: SimulationConfig = DEFAULT_CONFIG
): Promise<SimulationStats> {
  console.log(`[Simulation S1] Starting outcome simulation for T+${windowHours}h window...`);
  const startTime = Date.now();
  
  const stats: SimulationStats = {
    snapshotsProcessed: 0,
    resultsCreated: 0,
    labelsCreated: 0,
    attributionsCreated: 0,
    samplesCreated: 0,
    byOutcome: { SUCCESS: 0, FLAT: 0, FAIL: 0 },
    byBucket: { BUY: 0, WATCH: 0, SELL: 0 },
    duration_ms: 0,
  };
  
  try {
    // Find snapshots without simulated results
    const existingResults = await OutcomeResultModel.find({
      source: 'simulated',
      windowHours,
    }).distinct('snapshotId');
    
    const snapshots = await OutcomeSnapshotModel.find({
      _id: { $nin: existingResults },
    }).lean();
    
    console.log(`[Simulation S1] Found ${snapshots.length} snapshots to process`);
    
    for (const snapshot of snapshots) {
      try {
        // Simulate outcome
        const simResult = simulateOutcome(snapshot, config);
        stats.byOutcome[simResult.outcome]++;
        stats.byBucket[snapshot.bucket as keyof typeof stats.byBucket]++;
        
        // Create OutcomeResult (F1 equivalent)
        const result = await OutcomeResultModel.create({
          snapshotId: snapshot._id,
          tokenAddress: snapshot.tokenAddress,
          symbol: snapshot.symbol,
          bucket: snapshot.bucket,
          windowHours,
          priceAtDecision: snapshot.priceAtDecision || 1,
          priceAfter: (snapshot.priceAtDecision || 1) * (1 + simResult.deltaPct / 100),
          deltaPct: Math.round(simResult.deltaPct * 100) / 100,
          volatility: Math.abs(simResult.deltaPct) * 0.5,
          trackedAt: new Date(),
          decidedAt: snapshot.decidedAt,
          evaluatedAt: new Date(),
          // S3: Simulation marker
          source: 'simulated',
          simulationVersion: SIMULATION_VERSION,
        });
        stats.resultsCreated++;
        
        // Create OutcomeLabel (F2 equivalent)
        const label = await OutcomeLabelModel.create({
          snapshotId: snapshot._id,
          resultId: result._id,
          tokenAddress: snapshot.tokenAddress,
          symbol: snapshot.symbol,
          bucket: snapshot.bucket,
          outcome: simResult.outcome,
          severity: Math.round(simResult.severity * 100) / 100,
          deltaPct: simResult.deltaPct,
          windowHours,
          reasons: simResult.reasons,
          // S3: Simulation marker
          source: 'simulated',
          simulationVersion: SIMULATION_VERSION,
        });
        stats.labelsCreated++;
        
        // Simulate signal contributions
        const contributions = simulateSignalContributions(snapshot, simResult.outcome);
        const signals = determineSimulatedSignals(contributions, simResult.outcome);
        
        // Calculate confidence delta
        let confidenceDelta = 0;
        if (simResult.outcome === 'SUCCESS') {
          confidenceDelta = 3 + Math.round(simResult.severity * 7);
        } else if (simResult.outcome === 'FAIL') {
          confidenceDelta = -(5 + Math.round(simResult.severity * 10));
        }
        
        // Create Attribution (F3 equivalent)
        const attribution = await OutcomeAttributionModel.create({
          snapshotId: snapshot._id,
          resultId: result._id,
          labelId: label._id,
          tokenAddress: snapshot.tokenAddress,
          symbol: snapshot.symbol,
          bucket: snapshot.bucket,
          outcome: simResult.outcome,
          severity: simResult.severity,
          windowHours,
          signalContributions: contributions,
          dominantSignals: signals.dominant,
          misleadingSignals: signals.misleading,
          missingSignals: signals.missing,
          confidenceDelta,
          reasons: simResult.reasons,
          decidedAt: snapshot.decidedAt,
          // S3: Simulation marker
          source: 'simulated',
          simulationVersion: SIMULATION_VERSION,
        });
        stats.attributionsCreated++;
        
        // Calculate quality score - более щедрая формула для SIM данных
        let qualityScore = 0.55; // Базовый score выше для симуляции
        if (snapshot.coverageLevel === 'HIGH') qualityScore += 0.15;
        else if (snapshot.coverageLevel === 'MEDIUM') qualityScore += 0.08;
        else qualityScore -= 0.05;
        
        // Severity влияет положительно
        qualityScore += simResult.severity * 0.15;
        
        // Сигналы влияют, но меньше пенализируем
        if (signals.dominant.length > 0) qualityScore += 0.1;
        if (signals.misleading.length > 3) qualityScore -= 0.1;
        if (signals.missing.length > 4) qualityScore -= 0.1;
        
        // Бонус за non-FLAT outcome (более информативно)
        if (simResult.outcome !== 'FLAT') qualityScore += 0.1;
        
        qualityScore = Math.max(0.3, Math.min(1, qualityScore));
        
        // Quality gate
        if (qualityScore >= 0.3 && simResult.severity >= 0.2) {
          // Create Training Sample (F4 equivalent)
          await TrainingSampleModel.create({
            snapshotId: snapshot._id,
            attributionId: attribution._id,
            tokenAddress: snapshot.tokenAddress,
            symbol: snapshot.symbol,
            features: {
              dexFlow: contributions.dexFlow,
              whale: contributions.whale,
              conflict: contributions.conflict,
              momentum: contributions.momentum,
              volatility: contributions.volatility,
              liquidity: contributions.liquidity,
              coverage: snapshot.coverage || 0,
              confidence: snapshot.confidence,
              risk: snapshot.risk,
            },
            bucket: snapshot.bucket,
            engineMode: snapshot.engineMode || 'rules_only',
            signalFreshness: snapshot.signalFreshness?.engine?.freshness || 'unknown',
            outcomeLabel: simResult.outcome,
            severity: simResult.severity,
            deltaPct: simResult.deltaPct,
            dominantSignals: signals.dominant,
            misleadingSignals: signals.misleading,
            confidenceDelta,
            qualityScore,
            // Spread timestamps across 10 days for time coverage simulation
            timestamp: new Date(Date.now() - Math.random() * 10 * 24 * 60 * 60 * 1000),
            windowHours,
            usedInTraining: false,
            // S3: Simulation marker
            source: 'simulated',
            simulationVersion: SIMULATION_VERSION,
          });
          stats.samplesCreated++;
        }
        
        stats.snapshotsProcessed++;
        
      } catch (err) {
        console.error(`[Simulation S1] Failed to process snapshot ${snapshot._id}:`, err);
      }
    }
    
    stats.duration_ms = Date.now() - startTime;
    
    console.log(`[Simulation S1] Complete in ${stats.duration_ms}ms`);
    console.log(`[Simulation S1] Results: ${stats.resultsCreated}, Labels: ${stats.labelsCreated}`);
    console.log(`[Simulation S1] Attributions: ${stats.attributionsCreated}, Samples: ${stats.samplesCreated}`);
    console.log(`[Simulation S1] Outcomes: SUCCESS=${stats.byOutcome.SUCCESS}, FLAT=${stats.byOutcome.FLAT}, FAIL=${stats.byOutcome.FAIL}`);
    
    return stats;
    
  } catch (err: any) {
    console.error('[Simulation S1] Failed:', err);
    throw err;
  }
}

/**
 * Get simulation statistics
 */
export async function getSimulationStats(): Promise<{
  simulated: {
    results: number;
    labels: number;
    attributions: number;
    samples: number;
  };
  live: {
    results: number;
    labels: number;
    attributions: number;
    samples: number;
  };
  ratio: number;
}> {
  const [simResults, liveResults, simLabels, liveLabels, simAttr, liveAttr, simSamples, liveSamples] = 
    await Promise.all([
      OutcomeResultModel.countDocuments({ source: 'simulated' }),
      OutcomeResultModel.countDocuments({ source: { $ne: 'simulated' } }),
      OutcomeLabelModel.countDocuments({ source: 'simulated' }),
      OutcomeLabelModel.countDocuments({ source: { $ne: 'simulated' } }),
      OutcomeAttributionModel.countDocuments({ source: 'simulated' }),
      OutcomeAttributionModel.countDocuments({ source: { $ne: 'simulated' } }),
      TrainingSampleModel.countDocuments({ source: 'simulated' }),
      TrainingSampleModel.countDocuments({ source: { $ne: 'simulated' } }),
    ]);
  
  const totalSamples = simSamples + liveSamples;
  const ratio = totalSamples > 0 ? liveSamples / totalSamples : 0;
  
  return {
    simulated: {
      results: simResults,
      labels: simLabels,
      attributions: simAttr,
      samples: simSamples,
    },
    live: {
      results: liveResults,
      labels: liveLabels,
      attributions: liveAttr,
      samples: liveSamples,
    },
    ratio: Math.round(ratio * 100) / 100,
  };
}

/**
 * Clear all simulated data (for reset)
 */
export async function clearSimulatedData(): Promise<{
  deletedResults: number;
  deletedLabels: number;
  deletedAttributions: number;
  deletedSamples: number;
}> {
  const [r1, r2, r3, r4] = await Promise.all([
    OutcomeResultModel.deleteMany({ source: 'simulated' }),
    OutcomeLabelModel.deleteMany({ source: 'simulated' }),
    OutcomeAttributionModel.deleteMany({ source: 'simulated' }),
    TrainingSampleModel.deleteMany({ source: 'simulated' }),
  ]);
  
  return {
    deletedResults: r1.deletedCount || 0,
    deletedLabels: r2.deletedCount || 0,
    deletedAttributions: r3.deletedCount || 0,
    deletedSamples: r4.deletedCount || 0,
  };
}

/**
 * Generate synthetic BUY bucket samples for ML training diversity
 * 
 * Problem: Real system rarely produces BUY (conservative thresholds)
 * Solution: Create realistic synthetic BUY samples based on what
 *           "ideal BUY conditions" would look like
 * 
 * These are marked as source='simulated' and are NOT used to change
 * production rules - only for ML training diversity.
 */
export async function generateSyntheticBuySamples(
  count: number = 200,
  successRate: number = 0.6, // 60% SUCCESS, 25% FLAT, 15% FAIL for realistic distribution
): Promise<{ created: number; byOutcome: Record<string, number> }> {
  console.log(`[Simulation] Generating ${count} synthetic BUY samples...`);
  
  const byOutcome = { SUCCESS: 0, FLAT: 0, FAIL: 0 };
  let created = 0;
  
  // Get sample tokens from existing snapshots
  const existingTokens = await OutcomeSnapshotModel.aggregate([
    { $group: { _id: { tokenAddress: '$tokenAddress', symbol: '$symbol' } } },
    { $limit: 50 }
  ]);
  
  if (existingTokens.length === 0) {
    console.log('[Simulation] No tokens found for synthetic BUY generation');
    return { created: 0, byOutcome };
  }
  
  for (let i = 0; i < count; i++) {
    try {
      // Pick a random token
      const tokenData = existingTokens[Math.floor(Math.random() * existingTokens.length)]._id;
      
      // Generate "ideal BUY" features
      const confidence = 70 + Math.random() * 25; // 70-95 (high confidence)
      const risk = 15 + Math.random() * 20; // 15-35 (low risk)
      const actorSignalScore = 3 + Math.random() * 12; // 3-15 (positive actor signals)
      const coverage = 60 + Math.random() * 35; // 60-95%
      
      // Features consistent with BUY decision
      const dexFlowContrib = 0.15 + Math.random() * 0.3; // Positive DEX flow
      const whaleContrib = 0.1 + Math.random() * 0.25; // Whale accumulation
      const conflictContrib = -(Math.random() * 0.1); // Low/no conflict
      const momentumContrib = 0.1 + Math.random() * 0.2; // Positive momentum
      
      // Determine outcome based on rate
      const roll = Math.random();
      let outcome: 'SUCCESS' | 'FLAT' | 'FAIL';
      let deltaPct: number;
      let severity: number;
      
      if (roll < successRate) {
        // SUCCESS: BUY was correct
        outcome = 'SUCCESS';
        deltaPct = 5 + Math.random() * 20; // +5% to +25%
        severity = 0.5 + Math.random() * 0.4;
      } else if (roll < successRate + 0.25) {
        // FLAT: No significant movement
        outcome = 'FLAT';
        deltaPct = (Math.random() - 0.5) * 6; // -3% to +3%
        severity = 0.2 + Math.random() * 0.2;
      } else {
        // FAIL: BUY was wrong
        outcome = 'FAIL';
        deltaPct = -5 - Math.random() * 15; // -5% to -20%
        severity = 0.5 + Math.random() * 0.3;
      }
      
      byOutcome[outcome]++;
      
      // Calculate quality score
      let qualityScore = 0.6;
      if (coverage >= 80) qualityScore += 0.15;
      else if (coverage >= 60) qualityScore += 0.08;
      qualityScore += severity * 0.1;
      if (outcome !== 'FLAT') qualityScore += 0.1;
      qualityScore = Math.max(0.4, Math.min(1, qualityScore));
      
      // Calculate confidence delta
      const confidenceDelta = outcome === 'SUCCESS' 
        ? 5 + Math.random() * 10 
        : outcome === 'FAIL' 
          ? -10 - Math.random() * 15 
          : (Math.random() - 0.5) * 5;
      
      // Determine dominant/misleading signals
      const dominant: string[] = [];
      const misleading: string[] = [];
      
      if (outcome === 'SUCCESS') {
        if (dexFlowContrib > 0.2) dominant.push('dexFlow');
        if (whaleContrib > 0.15) dominant.push('whale');
        if (momentumContrib > 0.15) dominant.push('momentum');
      } else if (outcome === 'FAIL') {
        if (dexFlowContrib > 0.2) misleading.push('dexFlow');
        if (whaleContrib > 0.15) misleading.push('whale');
        if (momentumContrib > 0.15) misleading.push('momentum');
      }
      
      // Create synthetic training sample
      await TrainingSampleModel.create({
        snapshotId: null, // No real snapshot
        attributionId: null,
        tokenAddress: tokenData.tokenAddress,
        symbol: tokenData.symbol,
        features: {
          dexFlow: dexFlowContrib,
          whale: whaleContrib,
          conflict: conflictContrib,
          momentum: momentumContrib,
          volatility: 0.05 + Math.random() * 0.1,
          liquidity: coverage / 100 * 0.5,
          coverage,
          confidence,
          risk,
        },
        bucket: 'BUY',
        engineMode: 'rules_with_actors',
        signalFreshness: Math.random() > 0.3 ? 'fresh' : 'realtime',
        outcomeLabel: outcome,
        severity,
        deltaPct: Math.round(deltaPct * 100) / 100,
        dominantSignals: dominant,
        misleadingSignals: misleading,
        confidenceDelta: Math.round(confidenceDelta * 100) / 100,
        qualityScore: Math.round(qualityScore * 100) / 100,
        timestamp: new Date(Date.now() - Math.random() * 10 * 24 * 60 * 60 * 1000),
        windowHours: 24,
        usedInTraining: false,
        source: 'simulated',
        simulationVersion: 'S1.1-synthetic-buy',
      });
      
      created++;
      
    } catch (err) {
      console.error('[Simulation] Failed to create synthetic BUY sample:', err);
    }
  }
  
  console.log(`[Simulation] Created ${created} synthetic BUY samples`);
  console.log(`[Simulation] Distribution: SUCCESS=${byOutcome.SUCCESS}, FLAT=${byOutcome.FLAT}, FAIL=${byOutcome.FAIL}`);
  
  return { created, byOutcome };
}
