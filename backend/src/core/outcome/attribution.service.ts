/**
 * Attribution Engine Service (Block F3)
 * 
 * Рассчитывает attribution для каждого outcome:
 * - Какие сигналы помогли (dominant)
 * - Какие сигналы подвели (misleading)
 * - Чего не хватило (missing/blind spots)
 * - Как изменить confidence
 * 
 * Pure function: Snapshot + Outcome → Attribution
 * Rule-based, НЕ ML
 */
import { OutcomeAttributionModel } from './outcome_attribution.model.js';
import { OutcomeSnapshotModel } from './outcome_snapshot.model.js';
import { OutcomeResultModel } from './outcome_result.model.js';
import { OutcomeLabelModel } from './outcome_label.model.js';

/**
 * Calculate attribution for outcome
 * Core F3 logic
 */
export async function calculateAttribution(
  snapshotId: string,
  resultId: string,
  labelId: string
): Promise<any> {
  // Fetch all required data
  const [snapshot, result, label] = await Promise.all([
    OutcomeSnapshotModel.findById(snapshotId).lean(),
    OutcomeResultModel.findById(resultId).lean(),
    OutcomeLabelModel.findById(labelId).lean(),
  ]);
  
  if (!snapshot || !result || !label) {
    throw new Error('Missing data for attribution');
  }
  
  // Calculate signal contributions
  const contributions = calculateSignalContributions(snapshot, result, label);
  
  // Apply attribution rules
  const attribution = applyAttributionRules(
    snapshot,
    result,
    label,
    contributions
  );
  
  // Save attribution
  const saved = await OutcomeAttributionModel.create({
    snapshotId: snapshot._id,
    resultId: result._id,
    labelId: label._id,
    tokenAddress: snapshot.tokenAddress,
    symbol: snapshot.symbol,
    bucket: snapshot.bucket,
    outcome: label.outcome,
    severity: label.severity,
    windowHours: result.windowHours,
    signalContributions: contributions,
    dominantSignals: attribution.dominantSignals,
    misleadingSignals: attribution.misleadingSignals,
    missingSignals: attribution.missingSignals,
    confidenceDelta: attribution.confidenceDelta,
    reasons: attribution.reasons,
    decidedAt: snapshot.decidedAt,
  });
  
  console.log(`[F3] Attribution: ${snapshot.symbol} ${snapshot.bucket} ${label.outcome} → δconf ${attribution.confidenceDelta}`);
  
  return saved;
}

/**
 * Calculate signal contributions
 * Formula: contribution = signalWeight × normalizedStrength × severity
 */
function calculateSignalContributions(
  snapshot: any,
  result: any,
  label: any
): any {
  const { actorSignalScore, confidence, risk, coverage } = snapshot;
  const { deltaPct, severity } = label;
  
  // DEX Flow contribution
  let dexFlowContrib = 0;
  if (snapshot.dexFlowActive) {
    // Если DEX flow был активен и цена изменилась в ожидаемом направлении
    const expectedDirection = snapshot.bucket === 'BUY' ? 1 : snapshot.bucket === 'SELL' ? -1 : 0;
    const actualDirection = deltaPct > 0 ? 1 : deltaPct < 0 ? -1 : 0;
    const alignment = expectedDirection === actualDirection ? 1 : -1;
    
    dexFlowContrib = Math.abs(actorSignalScore || 0) * 0.02 * alignment * severity;
  }
  
  // Whale contribution
  let whaleContrib = 0;
  if (snapshot.whaleSignalsActive) {
    const expectedDirection = snapshot.bucket === 'BUY' ? 1 : snapshot.bucket === 'SELL' ? -1 : 0;
    const actualDirection = deltaPct > 0 ? 1 : deltaPct < 0 ? -1 : 0;
    const alignment = expectedDirection === actualDirection ? 1 : -1;
    
    whaleContrib = 0.3 * alignment * severity;
  }
  
  // Conflict penalty
  let conflictContrib = 0;
  if (snapshot.conflictDetected) {
    conflictContrib = -0.4 * severity;
  }
  
  // Momentum (price change aligned with decision)
  let momentumContrib = 0;
  const momentumStrength = Math.abs(deltaPct) / 10; // Normalize to 0-1 range
  if (snapshot.bucket === 'BUY' && deltaPct > 0) {
    momentumContrib = momentumStrength * severity;
  } else if (snapshot.bucket === 'SELL' && deltaPct < 0) {
    momentumContrib = momentumStrength * severity;
  } else {
    momentumContrib = -momentumStrength * severity * 0.5;
  }
  
  // Volatility (high volatility = risk)
  const volatilityContrib = -Math.abs(result.volatility || 0) * 0.01 * severity;
  
  // Liquidity (coverage proxy)
  const liquidityContrib = (coverage / 100) * 0.2 * severity;
  
  return {
    dexFlow: Math.round(dexFlowContrib * 100) / 100,
    whale: Math.round(whaleContrib * 100) / 100,
    conflict: Math.round(conflictContrib * 100) / 100,
    momentum: Math.round(momentumContrib * 100) / 100,
    volatility: Math.round(volatilityContrib * 100) / 100,
    liquidity: Math.round(liquidityContrib * 100) / 100,
  };
}

/**
 * Apply attribution rules based on bucket and outcome
 */
function applyAttributionRules(
  snapshot: any,
  result: any,
  label: any,
  contributions: any
): {
  dominantSignals: string[];
  misleadingSignals: string[];
  missingSignals: string[];
  confidenceDelta: number;
  reasons: string[];
} {
  const { bucket, outcome, severity } = label;
  const reasons: string[] = [];
  
  let dominantSignals: string[] = [];
  let misleadingSignals: string[] = [];
  let missingSignals: string[] = [];
  let confidenceDelta = 0;
  
  // Sort contributions by absolute value
  const sortedContribs = Object.entries(contributions)
    .sort(([, a], [, b]) => Math.abs(b as number) - Math.abs(a as number));
  
  // Identify dominant signals (positive contribution)
  dominantSignals = sortedContribs
    .filter(([, value]) => (value as number) > 0.1)
    .map(([key]) => key);
  
  // Identify misleading signals (negative contribution)
  misleadingSignals = sortedContribs
    .filter(([, value]) => (value as number) < -0.1)
    .map(([key]) => key);
  
  // Apply bucket-specific rules
  if (bucket === 'BUY') {
    if (outcome === 'SUCCESS') {
      // BUY SUCCESS: Signals that pushed score up → dominant
      confidenceDelta = Math.min(10, 5 + Math.round(severity * 5));
      reasons.push(`BUY successful: signals aligned with price growth`);
      
      if (dominantSignals.length === 0) {
        missingSignals.push('weak_signals');
        reasons.push('Success despite weak signals (luck?)');
      }
    } else if (outcome === 'FAIL') {
      // BUY FAIL: Signals that increased confidence but contradicted reality
      confidenceDelta = -Math.min(20, 10 + Math.round(severity * 10));
      reasons.push(`BUY failed: signals misled the decision`);
      
      if (snapshot.confidence > 60) {
        misleadingSignals = [...new Set([...misleadingSignals, 'high_confidence'])];
        reasons.push('High confidence was misleading');
      }
    }
  } else if (bucket === 'WATCH') {
    if (outcome === 'FAIL') {
      // WATCH FAIL: Strong price move + weak signals = blind spot
      if (Math.abs(result.deltaPct) > 10) {
        missingSignals.push('price_movement_detection');
        reasons.push(`Missed significant price move (${result.deltaPct.toFixed(1)}%)`);
        confidenceDelta = -5;
      }
    } else if (outcome === 'SUCCESS') {
      // WATCH SUCCESS: Stability maintained
      confidenceDelta = Math.min(8, 3 + Math.round(severity * 5));
      reasons.push('WATCH successful: stability maintained');
    }
  } else { // SELL
    if (outcome === 'SUCCESS') {
      // SELL SUCCESS: Exit signals were correct
      confidenceDelta = Math.min(10, 5 + Math.round(severity * 5));
      reasons.push(`SELL successful: risk signals were correct`);
    } else if (outcome === 'FAIL') {
      // SELL FAIL: Exit signals absent or weak
      confidenceDelta = -Math.min(15, 8 + Math.round(severity * 7));
      reasons.push(`SELL failed: exit signals were premature or wrong`);
      
      if (snapshot.risk < 50) {
        misleadingSignals = [...new Set([...misleadingSignals, 'low_risk'])];
        reasons.push('Low risk score was misleading');
      }
    }
  }
  
  // Coverage factor
  if (snapshot.coverageLevel === 'LOW') {
    missingSignals.push('low_coverage');
    confidenceDelta -= 3;
    reasons.push('Low coverage limited decision quality');
  }
  
  return {
    dominantSignals,
    misleadingSignals,
    missingSignals,
    confidenceDelta: Math.max(-20, Math.min(20, confidenceDelta)),
    reasons,
  };
}

/**
 * Get attribution statistics
 */
export async function getAttributionStats(windowHours?: number) {
  const matchStage: any = {};
  if (windowHours) {
    matchStage.windowHours = windowHours;
  }
  
  const stats = await OutcomeAttributionModel.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: { bucket: '$bucket', outcome: '$outcome' },
        count: { $sum: 1 },
        avgConfidenceDelta: { $avg: '$confidenceDelta' },
        dominantSignalsFreq: { $push: '$dominantSignals' },
        misleadingSignalsFreq: { $push: '$misleadingSignals' },
      },
    },
  ]);
  
  // Count signal frequencies
  const signalFrequencies: any = {
    dominant: {},
    misleading: {},
  };
  
  for (const stat of stats) {
    // Count dominant signals
    for (const signals of stat.dominantSignalsFreq) {
      for (const signal of signals) {
        signalFrequencies.dominant[signal] = (signalFrequencies.dominant[signal] || 0) + 1;
      }
    }
    
    // Count misleading signals
    for (const signals of stat.misleadingSignalsFreq) {
      for (const signal of signals) {
        signalFrequencies.misleading[signal] = (signalFrequencies.misleading[signal] || 0) + 1;
      }
    }
  }
  
  // Sort by frequency
  const topDominant = Object.entries(signalFrequencies.dominant)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 5);
  
  const topMisleading = Object.entries(signalFrequencies.misleading)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 5);
  
  return {
    byBucket: stats,
    topDominantSignals: topDominant,
    topMisleadingSignals: topMisleading,
  };
}

/**
 * Get attribution for token
 */
export async function getTokenAttribution(
  tokenAddress: string,
  limit = 10
) {
  return OutcomeAttributionModel.find({
    tokenAddress: tokenAddress.toLowerCase(),
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}
