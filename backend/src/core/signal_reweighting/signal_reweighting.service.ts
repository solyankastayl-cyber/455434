/**
 * Signal Reweighting Service v1.1
 * 
 * Adaptive calibration of signal weights based on outcome effectiveness.
 * 
 * Key principles:
 * - NOT ML training - explainable rule-based adjustment
 * - Two-level reweighting: signal type + components
 * - Safety gates: ±25% corridor, drift freeze
 * - Outcome-driven: TRUE_POSITIVE → strengthen, FALSE_POSITIVE → weaken
 * - Adaptive LR: based on drift level and sample count
 */
import { 
  SignalType,
  SignalComponent,
  SignalEffectiveness,
  OutcomeVerdict,
  ReweightingAdjustment,
  REWEIGHTING_POLICIES,
  calculateEffectiveLR,
  calculateSampleStability,
} from './signal_reweighting.types.js';
import * as repo from './signal_reweighting.repository.js';
import { OutcomeObservationModel } from '../learning/models/OutcomeObservation.model.js';
import { AttributionOutcomeLinkModel } from '../learning/models/attribution_outcome_link.model.js';
import { env } from '../../config/env.js';

/**
 * Initialize signal reweighting system
 */
export async function initializeSignalReweighting(): Promise<void> {
  console.log('[Signal Reweighting] Initializing system...');
  await repo.initializeSignalWeights();
  console.log('[Signal Reweighting] System initialized');
}

/**
 * Get signal effectiveness statistics
 * Analyzes outcomes to determine how well each signal type performs
 */
export async function getSignalEffectiveness(
  signalType: SignalType,
  horizon: '7d' | '30d' = '7d'
): Promise<SignalEffectiveness | null> {
  // Get all attribution links for this signal type
  const links = await AttributionOutcomeLinkModel.find({
    signalType: signalType.toLowerCase(),
    horizon,
  }).lean();
  
  if (links.length === 0) {
    return null;
  }
  
  // Count outcomes
  let truePositives = 0;
  let falsePositives = 0;
  let delayedTrue = 0;
  let missed = 0;
  
  for (const link of links) {
    switch (link.verdict) {
      case 'TRUE_POSITIVE':
        truePositives++;
        break;
      case 'FALSE_POSITIVE':
        falsePositives++;
        break;
      case 'DELAYED_TRUE':
        delayedTrue++;
        break;
      case 'MISSED':
        missed++;
        break;
    }
  }
  
  const totalSamples = links.length;
  const totalPredicted = truePositives + falsePositives + delayedTrue;
  const totalActual = truePositives + delayedTrue + missed;
  
  // Calculate metrics
  const precision = totalPredicted > 0 ? truePositives / totalPredicted : 0;
  const recall = totalActual > 0 ? truePositives / totalActual : 0;
  const f1Score = (precision + recall) > 0 ? 
    (2 * precision * recall) / (precision + recall) : 0;
  
  // Get current weight
  const weight = await repo.getSignalWeight(signalType);
  const currentWeight = weight?.typeWeight.current || 0;
  const baseWeight = weight?.typeWeight.base || 0;
  
  // Calculate sample stability
  const sampleStability = calculateSampleStability(totalSamples);
  
  // Determine drift level (simplified - should integrate with LI-5 drift)
  const drift = Math.abs(currentWeight - baseWeight);
  let driftLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  
  if (drift < 0.05) {
    driftLevel = 'LOW';
  } else if (drift < 0.10) {
    driftLevel = 'MEDIUM';
  } else if (drift < 0.15) {
    driftLevel = 'HIGH';
  } else {
    driftLevel = 'CRITICAL';
  }
  
  // Determine if ready for adjustment
  const minSamples = 30; // Minimum samples needed
  const readyForAdjustment = 
    totalSamples >= minSamples && 
    driftLevel !== 'CRITICAL' &&
    !weight?.typeWeight;
  
  let reasonIfNotReady: string | undefined;
  if (totalSamples < minSamples) {
    reasonIfNotReady = `Insufficient samples: ${totalSamples}/${minSamples}`;
  } else if (driftLevel === 'CRITICAL') {
    reasonIfNotReady = 'Drift level is CRITICAL - weight frozen';
  }
  
  return {
    signalType,
    totalSamples,
    truePositives,
    falsePositives,
    delayedTrue,
    missed,
    precision,
    recall,
    f1Score,
    sampleStability,
    driftLevel,
    currentWeight,
    baseWeight,
    drift,
    readyForAdjustment,
    reasonIfNotReady,
  };
}

/**
 * Process outcome for signal reweighting
 * Called when a new outcome is attributed to signals
 */
export async function processOutcomeForReweighting(
  outcomeId: string,
  signalType: SignalType,
  verdict: OutcomeVerdict
): Promise<ReweightingAdjustment | null> {
  // Get policy for this verdict
  const policy = REWEIGHTING_POLICIES[verdict];
  
  if (policy.action === 'none') {
    return null; // No adjustment needed
  }
  
  // Get signal effectiveness
  const effectiveness = await getSignalEffectiveness(signalType);
  
  if (!effectiveness || !effectiveness.readyForAdjustment) {
    console.log(`[Signal Reweighting] Not ready to adjust ${signalType}: ${effectiveness?.reasonIfNotReady}`);
    return null;
  }
  
  // Calculate adaptive learning rate
  const adaptiveLR = calculateEffectiveLR(
    env.ADAPTIVE_LEARNING_RATE || 0.02,
    effectiveness.driftLevel,
    effectiveness.totalSamples
  );
  
  // Calculate delta
  const direction = policy.action === 'strengthen' ? 1 : -1;
  const delta = direction * policy.multiplier * adaptiveLR.effectiveLR;
  
  // Convert verdict to feedback score for repository
  const feedbackScore = policy.action === 'strengthen' ? 1 : -1;
  
  // Apply adjustment
  const result = await repo.adjustSignalWeight(
    signalType,
    'type_weight',
    delta,
    `Outcome ${verdict} for ${outcomeId}`,
    feedbackScore
  );
  
  if (!result.weight) {
    return null;
  }
  
  return {
    signalType,
    oldWeight: result.weight.currentWeight - delta,
    newWeight: result.weight.currentWeight,
    delta,
    policy,
    learningRate: adaptiveLR,
    hitBoundary: result.hitBoundary,
    frozen: result.frozen,
    reason: `${verdict}: ${policy.action} with LR=${adaptiveLR.effectiveLR.toFixed(4)}`,
    timestamp: new Date(),
  };
}

/**
 * Batch reweighting - process multiple outcomes at once
 * Called by scheduled job
 */
export async function batchReweighting(
  horizon: '7d' | '30d' = '7d',
  lookbackHours: number = 24
): Promise<{
  processed: number;
  adjustments: ReweightingAdjustment[];
  errors: string[];
}> {
  const start = Date.now();
  const adjustments: ReweightingAdjustment[] = [];
  const errors: string[] = [];
  
  console.log(`[Signal Reweighting] Starting batch reweighting (horizon=${horizon}, lookback=${lookbackHours}h)...`);
  
  // Get recent attribution links
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  
  const links = await AttributionOutcomeLinkModel.find({
    horizon,
    createdAt: { $gt: since },
    verdict: { $in: ['TRUE_POSITIVE', 'FALSE_POSITIVE', 'DELAYED_TRUE', 'MISSED'] },
  }).lean();
  
  console.log(`[Signal Reweighting] Found ${links.length} attribution links to process`);
  
  // Group by signal type
  const bySignalType = new Map<SignalType, typeof links>();
  
  for (const link of links) {
    const signalType = link.signalType.toUpperCase() as SignalType;
    if (!bySignalType.has(signalType)) {
      bySignalType.set(signalType, []);
    }
    bySignalType.get(signalType)!.push(link);
  }
  
  // Process each signal type
  for (const [signalType, typeLinks] of bySignalType.entries()) {
    try {
      // Aggregate verdicts
      const verdictCounts = new Map<OutcomeVerdict, number>();
      
      for (const link of typeLinks) {
        const verdict = link.verdict as OutcomeVerdict;
        verdictCounts.set(verdict, (verdictCounts.get(verdict) || 0) + 1);
      }
      
      // Calculate net adjustment based on all verdicts
      const effectiveness = await getSignalEffectiveness(signalType, horizon);
      
      if (!effectiveness || !effectiveness.readyForAdjustment) {
        console.log(`[Signal Reweighting] Skipping ${signalType}: ${effectiveness?.reasonIfNotReady}`);
        continue;
      }
      
      // Calculate weighted average delta
      let netDelta = 0;
      let netFeedbackScore = 0;
      
      for (const [verdict, count] of verdictCounts.entries()) {
        const policy = REWEIGHTING_POLICIES[verdict];
        if (policy.action === 'none') continue;
        
        const direction = policy.action === 'strengthen' ? 1 : -1;
        netDelta += direction * policy.multiplier * count;
        netFeedbackScore += direction * count;
      }
      
      // Normalize by total count
      netDelta /= typeLinks.length;
      netFeedbackScore /= typeLinks.length;
      
      // Apply adaptive LR
      const adaptiveLR = calculateEffectiveLR(
        env.ADAPTIVE_LEARNING_RATE || 0.02,
        effectiveness.driftLevel,
        effectiveness.totalSamples
      );
      
      netDelta *= adaptiveLR.effectiveLR;
      
      // Apply adjustment
      const result = await repo.adjustSignalWeight(
        signalType,
        'type_weight',
        netDelta,
        `Batch reweighting: ${typeLinks.length} outcomes processed`,
        netFeedbackScore
      );
      
      if (result.weight) {
        adjustments.push({
          signalType,
          oldWeight: result.weight.currentWeight - netDelta,
          newWeight: result.weight.currentWeight,
          delta: netDelta,
          policy: REWEIGHTING_POLICIES.TRUE_POSITIVE, // Representative
          learningRate: adaptiveLR,
          hitBoundary: result.hitBoundary,
          frozen: result.frozen,
          reason: `Batch: ${typeLinks.length} outcomes, net delta ${netDelta.toFixed(4)}`,
          timestamp: new Date(),
        });
        
        console.log(`[Signal Reweighting] Adjusted ${signalType}: ${netDelta.toFixed(4)} (${typeLinks.length} outcomes)`);
      }
      
    } catch (err: any) {
      const error = `Error processing ${signalType}: ${err.message}`;
      console.error(`[Signal Reweighting] ${error}`);
      errors.push(error);
    }
  }
  
  const duration = Date.now() - start;
  console.log(`[Signal Reweighting] Batch complete: ${adjustments.length} adjustments, ${errors.length} errors (${duration}ms)`);
  
  return {
    processed: links.length,
    adjustments,
    errors,
  };
}

/**
 * Get all signal weights with effectiveness
 */
export async function getAllSignalWeightsWithEffectiveness(
  horizon: '7d' | '30d' = '7d'
): Promise<Array<{
  signalType: SignalType;
  weight: any;
  effectiveness: SignalEffectiveness | null;
}>> {
  const weights = await repo.getAllSignalWeights();
  
  const results = [];
  
  for (const weight of weights) {
    const effectiveness = await getSignalEffectiveness(weight.signalType, horizon);
    
    results.push({
      signalType: weight.signalType,
      weight,
      effectiveness,
    });
  }
  
  return results;
}

/**
 * Get signal reweighting stats
 */
export async function getSignalReweightingStats() {
  const weightStats = await repo.getSignalWeightsStats();
  const frozenWeights = await repo.getFrozenSignalWeights();
  
  return {
    version: 'v1.1',
    weights: weightStats,
    frozenCount: frozenWeights.length,
    frozen: frozenWeights.map(w => ({
      signalType: w.scopeId,
      component: w.key,
      reason: w.frozenReason,
      frozenAt: w.frozenAt,
    })),
  };
}

/**
 * Reset signal weight
 */
export async function resetSignalWeight(
  signalType: SignalType,
  component?: SignalComponent
): Promise<boolean> {
  if (component) {
    return repo.resetSignalWeight(signalType, component);
  } else {
    // Reset type weight
    return repo.resetSignalWeight(signalType, 'type_weight');
  }
}
