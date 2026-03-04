/**
 * Strategy Signals Service
 * Business logic for strategy signals
 */
import {
  IStrategySignal,
  StrategySignalType,
  calculateStrategySeverity,
  generateDedupKey,
  calculateDedupUntil,
  generateStrategyExplanation,
} from './strategy_signals.model.js';
import * as repo from './strategy_signals.repository.js';
import { IStrategyProfile } from '../strategies/strategy_profiles.model.js';
import { IScore } from '../scores/scores.model.js';

/**
 * Trigger thresholds
 */
const THRESHOLDS = {
  // strategy_detected
  DETECTED_MIN_CONFIDENCE: 0.65,
  DETECTED_MIN_STABILITY: 0.55,
  
  // strategy_confirmed
  CONFIRMED_MIN_CONFIDENCE: 0.75,
  CONFIRMED_MIN_STABILITY: 0.70,
  
  // strategy_shift
  SHIFT_CONFIDENCE_DELTA: 0.15,
  
  // strategy_phase_change
  PHASE_MIN_STABILITY: 0.6,
  
  // intensity/risk spikes
  SPIKE_THRESHOLD: 20, // 20 point jump
};

export interface ProcessStrategyInput {
  profile: IStrategyProfile;
  previousProfile?: IStrategyProfile | null;
  score?: IScore | null;
  previousScore?: IScore | null;
}

/**
 * Process a strategy profile and generate signals if needed
 */
export async function processStrategyForSignals(
  input: ProcessStrategyInput
): Promise<IStrategySignal[]> {
  const { profile, previousProfile, score, previousScore } = input;
  const signals: repo.CreateStrategySignalInput[] = [];
  
  const window = profile.preferredWindow || '7d';
  
  // Build evidence from current state
  const evidence: IStrategySignal['evidence'] = {
    behaviorScore: score?.behaviorScore || 50,
    intensityScore: score?.intensityScore || 50,
    consistencyScore: score?.consistencyScore || 50,
    riskScore: score?.riskScore || 50,
    influenceScore: score?.influenceScore || 50,
    compositeScore: score?.compositeScore || 50,
    confidence: profile.confidence,
    stability: profile.stability,
    accumulationRatio: profile.bundleBreakdown.accumulationRatio,
    distributionRatio: profile.bundleBreakdown.distributionRatio,
    washRatio: profile.bundleBreakdown.washRatio,
    rotationRatio: profile.bundleBreakdown.rotationRatio,
  };
  
  // Calculate base severity
  const severity = calculateStrategySeverity(
    evidence.intensityScore,
    evidence.influenceScore,
    evidence.behaviorScore,
    evidence.riskScore,
    profile.strategyType,
    profile.confidence
  );
  
  // ========== CHECK TRIGGERS ==========
  
  // 1. Strategy Detected (first time or new strategy)
  if (!previousProfile) {
    if (
      profile.confidence >= THRESHOLDS.DETECTED_MIN_CONFIDENCE &&
      profile.stability >= THRESHOLDS.DETECTED_MIN_STABILITY
    ) {
      const type: StrategySignalType = 'strategy_detected';
      const dedupKey = generateDedupKey(profile.address, type, window);
      
      if (!(await repo.isDuplicate(dedupKey))) {
        signals.push({
          actorAddress: profile.address,
          chain: profile.chain,
          window,
          type,
          strategyType: profile.strategyType,
          severity,
          confidence: profile.confidence,
          stability: profile.stability,
          dedupKey,
          dedupUntil: calculateDedupUntil(type),
          explanation: generateStrategyExplanation(type, profile.strategyType, undefined, profile.confidence, profile.stability),
          evidence,
        });
      }
    }
  }
  
  // 2. Strategy Confirmed (stability crossed threshold)
  if (
    profile.confidence >= THRESHOLDS.CONFIRMED_MIN_CONFIDENCE &&
    profile.stability >= THRESHOLDS.CONFIRMED_MIN_STABILITY
  ) {
    const wasNotConfirmed = !previousProfile ||
      previousProfile.confidence < THRESHOLDS.CONFIRMED_MIN_CONFIDENCE ||
      previousProfile.stability < THRESHOLDS.CONFIRMED_MIN_STABILITY;
    
    if (wasNotConfirmed) {
      const type: StrategySignalType = 'strategy_confirmed';
      const dedupKey = generateDedupKey(profile.address, type, window);
      
      if (!(await repo.isDuplicate(dedupKey))) {
        signals.push({
          actorAddress: profile.address,
          chain: profile.chain,
          window,
          type,
          strategyType: profile.strategyType,
          severity: severity + 10, // Bonus for confirmed
          confidence: profile.confidence,
          stability: profile.stability,
          dedupKey,
          dedupUntil: calculateDedupUntil(type),
          explanation: generateStrategyExplanation(type, profile.strategyType, undefined, profile.confidence, profile.stability),
          evidence: {
            ...evidence,
            confidenceDelta: previousProfile ? profile.confidence - previousProfile.confidence : 0,
            stabilityDelta: previousProfile ? profile.stability - previousProfile.stability : 0,
          },
        });
      }
    }
  }
  
  // 3. Strategy Shift (type changed)
  if (
    previousProfile &&
    previousProfile.strategyType !== profile.strategyType &&
    profile.confidence - (previousProfile.confidence || 0) >= THRESHOLDS.SHIFT_CONFIDENCE_DELTA
  ) {
    const type: StrategySignalType = 'strategy_shift';
    const dedupKey = generateDedupKey(profile.address, type, window);
    
    if (!(await repo.isDuplicate(dedupKey))) {
      signals.push({
        actorAddress: profile.address,
        chain: profile.chain,
        window,
        type,
        strategyType: profile.strategyType,
        previousStrategyType: previousProfile.strategyType,
        severity: severity + 15, // Important event
        confidence: profile.confidence,
        stability: profile.stability,
        dedupKey,
        dedupUntil: calculateDedupUntil(type),
        explanation: generateStrategyExplanation(type, profile.strategyType, previousProfile.strategyType, profile.confidence),
        evidence: {
          ...evidence,
          confidenceDelta: profile.confidence - previousProfile.confidence,
        },
      });
    }
  }
  
  // 4. Strategy Phase Change (bundle type shift)
  if (
    previousProfile &&
    profile.stability >= THRESHOLDS.PHASE_MIN_STABILITY
  ) {
    const prevAccum = previousProfile.bundleBreakdown.accumulationRatio;
    const prevDistrib = previousProfile.bundleBreakdown.distributionRatio;
    const currAccum = profile.bundleBreakdown.accumulationRatio;
    const currDistrib = profile.bundleBreakdown.distributionRatio;
    
    // Detect phase flip (accumulation dominant <-> distribution dominant)
    const wasAccumulating = prevAccum > prevDistrib + 0.2;
    const wasDistributing = prevDistrib > prevAccum + 0.2;
    const isAccumulating = currAccum > currDistrib + 0.2;
    const isDistributing = currDistrib > currAccum + 0.2;
    
    if ((wasAccumulating && isDistributing) || (wasDistributing && isAccumulating)) {
      const type: StrategySignalType = 'strategy_phase_change';
      const dedupKey = generateDedupKey(profile.address, type, window);
      
      if (!(await repo.isDuplicate(dedupKey))) {
        signals.push({
          actorAddress: profile.address,
          chain: profile.chain,
          window,
          type,
          strategyType: profile.strategyType,
          severity,
          confidence: profile.confidence,
          stability: profile.stability,
          dedupKey,
          dedupUntil: calculateDedupUntil(type),
          explanation: generateStrategyExplanation(type, profile.strategyType, undefined, profile.confidence, profile.stability),
          evidence,
        });
      }
    }
  }
  
  // 5. Intensity Spike
  if (previousScore && score) {
    const intensityDelta = score.intensityScore - previousScore.intensityScore;
    
    if (intensityDelta >= THRESHOLDS.SPIKE_THRESHOLD) {
      const type: StrategySignalType = 'strategy_intensity_spike';
      const dedupKey = generateDedupKey(profile.address, type, window);
      
      if (!(await repo.isDuplicate(dedupKey))) {
        signals.push({
          actorAddress: profile.address,
          chain: profile.chain,
          window,
          type,
          strategyType: profile.strategyType,
          severity: severity + Math.min(20, intensityDelta / 2),
          confidence: profile.confidence,
          stability: profile.stability,
          dedupKey,
          dedupUntil: calculateDedupUntil(type),
          explanation: generateStrategyExplanation(type, profile.strategyType),
          evidence: {
            ...evidence,
            scoreDelta: intensityDelta,
          },
        });
      }
    }
  }
  
  // 6. Risk Spike
  if (previousScore && score) {
    const riskDelta = score.riskScore - previousScore.riskScore;
    
    if (riskDelta >= THRESHOLDS.SPIKE_THRESHOLD) {
      const type: StrategySignalType = 'strategy_risk_spike';
      const dedupKey = generateDedupKey(profile.address, type, window);
      
      if (!(await repo.isDuplicate(dedupKey))) {
        signals.push({
          actorAddress: profile.address,
          chain: profile.chain,
          window,
          type,
          strategyType: profile.strategyType,
          severity: severity + 10,
          confidence: profile.confidence,
          stability: profile.stability,
          dedupKey,
          dedupUntil: calculateDedupUntil(type),
          explanation: generateStrategyExplanation(type, profile.strategyType),
          evidence: {
            ...evidence,
            scoreDelta: riskDelta,
          },
        });
      }
    }
  }
  
  // 7. Influence Jump
  if (previousScore && score) {
    const influenceDelta = score.influenceScore - previousScore.influenceScore;
    
    if (influenceDelta >= THRESHOLDS.SPIKE_THRESHOLD) {
      const type: StrategySignalType = 'strategy_influence_jump';
      const dedupKey = generateDedupKey(profile.address, type, window);
      
      if (!(await repo.isDuplicate(dedupKey))) {
        signals.push({
          actorAddress: profile.address,
          chain: profile.chain,
          window,
          type,
          strategyType: profile.strategyType,
          severity: severity + Math.min(15, influenceDelta / 3),
          confidence: profile.confidence,
          stability: profile.stability,
          dedupKey,
          dedupUntil: calculateDedupUntil(type),
          explanation: generateStrategyExplanation(type, profile.strategyType),
          evidence: {
            ...evidence,
            scoreDelta: influenceDelta,
          },
        });
      }
    }
  }
  
  // ========== SAVE SIGNALS ==========
  if (signals.length > 0) {
    const createdSignals = await repo.createManyStrategySignals(signals);
    
    // Invalidate snapshots for strategy_shift events (living system feel)
    for (const signal of createdSignals) {
      if (signal.type === 'strategy_shift' && signal.previousStrategyType) {
        try {
          const { onStrategyShift } = await import('../snapshots/snapshot_invalidation.service.js');
          await onStrategyShift(
            signal.actorAddress, 
            signal.previousStrategyType, 
            signal.strategyType
          );
        } catch (err) {
          // Non-critical
          console.error('[Strategy Signals] Snapshot invalidation failed:', err);
        }
      }
    }
    
    return createdSignals;
  }
  
  return [];
}

/**
 * Get latest strategy signals with filters
 */
export async function getLatestSignals(
  filters: repo.StrategySignalFilters = {},
  limit: number = 50,
  offset: number = 0
): Promise<IStrategySignal[]> {
  return repo.getLatestStrategySignals(filters, limit, offset);
}

/**
 * Get signals for address
 */
export async function getSignalsByAddress(
  address: string,
  limit: number = 50
): Promise<IStrategySignal[]> {
  return repo.getStrategySignalsByAddress(address, limit);
}

/**
 * Get signals stats
 */
export async function getStats() {
  return repo.getStrategySignalsStats();
}
