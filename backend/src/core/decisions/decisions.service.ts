/**
 * Decision Engine Service
 * 
 * Core decision logic:
 * - accumulation_sniper + intensity_spike + low risk → FOLLOW
 * - wash_detected + risk high → IGNORE
 * - strategy_shift + influence_jump → WATCH
 */
import {
  IDecision,
  DecisionScope,
  DecisionType,
  RiskLevel,
  Timeframe,
} from './decisions.model.js';
import * as repo from './decisions.repository.js';
import { ActorProfileModel } from '../profiles/actor_profiles.model.js';
import { StrategyProfileModel } from '../strategies/strategy_profiles.model.js';
import { StrategySignalModel } from '../strategy_signals/strategy_signals.model.js';
import { ScoreModel } from '../scores/scores.model.js';

/**
 * Decision rule result
 */
interface DecisionRuleResult {
  decisionType: DecisionType;
  confidence: number;
  rationale: string[];
  riskLevel: RiskLevel;
  suggestedAllocation?: number;
  timeframe: Timeframe;
}

/**
 * Generate decision for an actor
 */
export async function generateActorDecision(address: string): Promise<IDecision> {
  const addr = address.toLowerCase();
  
  // Gather data
  const [profile, strategy, score, recentSignals] = await Promise.all([
    ActorProfileModel.findOne({ address: addr }).lean(),
    StrategyProfileModel.findOne({ address: addr }).sort({ updatedAt: -1 }).lean(),
    ScoreModel.findOne({ subjectId: addr, window: '7d' }).lean(),
    StrategySignalModel.find({ actorAddress: addr })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);
  
  // Apply decision rules
  const result = applyDecisionRules({
    strategyType: strategy?.strategyType,
    confidence: strategy?.confidence || 0,
    stability: strategy?.stability || 0,
    compositeScore: score?.compositeScore || 50,
    riskScore: score?.riskScore || 50,
    intensityScore: score?.intensityScore || 50,
    influenceScore: score?.influenceScore || 50,
    recentSignalTypes: recentSignals.map(s => s.type),
    bundleBreakdown: strategy?.bundleBreakdown,
  });
  
  // Create decision
  return repo.createDecision({
    scope: 'actor',
    refId: addr,
    decisionType: result.decisionType,
    confidence: result.confidence,
    rationale: result.rationale,
    riskLevel: result.riskLevel,
    suggestedAllocation: result.suggestedAllocation,
    timeframe: result.timeframe,
    context: {
      strategyType: strategy?.strategyType,
      compositeScore: score?.compositeScore,
      tier: profile?.scores?.tier,
      recentSignals: recentSignals.map(s => s._id.toString()),
    },
  });
}

/**
 * Apply decision rules based on metrics
 */
function applyDecisionRules(data: {
  strategyType?: string;
  confidence: number;
  stability: number;
  compositeScore: number;
  riskScore: number;
  intensityScore: number;
  influenceScore: number;
  recentSignalTypes: string[];
  bundleBreakdown?: {
    accumulationRatio: number;
    distributionRatio: number;
    washRatio: number;
    rotationRatio: number;
  };
}): DecisionRuleResult {
  const rationale: string[] = [];
  let decisionType: DecisionType = 'watch';
  let confidence = 0.5;
  let riskLevel: RiskLevel = 'medium';
  let suggestedAllocation: number | undefined;
  let timeframe: Timeframe = 'mid';
  
  // Determine risk level
  if (data.riskScore >= 70) {
    riskLevel = 'high';
    rationale.push('High risk score detected');
  } else if (data.riskScore <= 30) {
    riskLevel = 'low';
    rationale.push('Low risk profile');
  }
  
  // Check for wash trading (IGNORE)
  if (data.bundleBreakdown?.washRatio && data.bundleBreakdown.washRatio > 0.3) {
    decisionType = 'ignore';
    confidence = 0.8;
    rationale.push('Significant wash trading detected (>30%)');
    rationale.push('Unreliable actor - avoid');
    return { decisionType, confidence, rationale, riskLevel, timeframe: 'short' };
  }
  
  // High risk + any negative signals (IGNORE or REDUCE)
  if (riskLevel === 'high') {
    if (data.recentSignalTypes.includes('strategy_risk_spike')) {
      decisionType = 'reduce_exposure';
      confidence = 0.75;
      rationale.push('Recent risk spike signal');
      rationale.push('Recommend reducing exposure');
      return { decisionType, confidence, rationale, riskLevel, timeframe: 'short' };
    }
    
    decisionType = 'watch';
    confidence = 0.6;
    rationale.push('High risk - monitoring recommended');
  }
  
  // Accumulation Sniper with good metrics (FOLLOW or COPY)
  if (data.strategyType === 'accumulation_sniper') {
    if (data.confidence >= 0.7 && data.stability >= 0.6 && riskLevel !== 'high') {
      const hasIntensitySpike = data.recentSignalTypes.includes('strategy_intensity_spike');
      
      if (hasIntensitySpike && data.influenceScore >= 60) {
        decisionType = 'copy';
        confidence = 0.85;
        suggestedAllocation = 5;
        timeframe = 'mid';
        rationale.push('High-confidence accumulation sniper detected');
        rationale.push('Recent intensity spike indicates active accumulation');
        rationale.push('Strong influence score supports conviction');
      } else {
        decisionType = 'follow';
        confidence = 0.75;
        timeframe = 'mid';
        rationale.push('Confirmed accumulation strategy');
        rationale.push('Good stability suggests reliable pattern');
      }
      return { decisionType, confidence, rationale, riskLevel, suggestedAllocation, timeframe };
    }
  }
  
  // Distribution Whale (WATCH or REDUCE)
  if (data.strategyType === 'distribution_whale') {
    if (data.confidence >= 0.7) {
      decisionType = 'watch';
      confidence = 0.7;
      timeframe = 'short';
      rationale.push('Distribution whale detected');
      rationale.push('Actor may be exiting positions');
      rationale.push('Watch for market impact');
      
      if (data.bundleBreakdown?.distributionRatio && data.bundleBreakdown.distributionRatio > 0.7) {
        decisionType = 'reduce_exposure';
        rationale.push('Heavy distribution in progress (>70%)');
      }
      return { decisionType, confidence, rationale, riskLevel, timeframe };
    }
  }
  
  // Rotation Trader (WATCH)
  if (data.strategyType === 'rotation_trader') {
    decisionType = 'watch';
    confidence = 0.65;
    timeframe = 'short';
    rationale.push('Rotation trader identified');
    rationale.push('Frequent position changes - difficult to copy');
    rationale.push('Watch for sector/asset rotation signals');
    return { decisionType, confidence, rationale, riskLevel, timeframe };
  }
  
  // Strategy Shift signals (WATCH)
  if (data.recentSignalTypes.includes('strategy_shift')) {
    decisionType = 'watch';
    confidence = 0.7;
    timeframe = 'short';
    rationale.push('Recent strategy shift detected');
    rationale.push('Wait for new pattern to stabilize');
    return { decisionType, confidence, rationale, riskLevel, timeframe };
  }
  
  // High influence + good score (FOLLOW)
  if (data.influenceScore >= 70 && data.compositeScore >= 65 && riskLevel !== 'high') {
    decisionType = 'follow';
    confidence = 0.7;
    timeframe = 'mid';
    rationale.push('High influence actor with good composite score');
    rationale.push('Worth monitoring for market insights');
    return { decisionType, confidence, rationale, riskLevel, timeframe };
  }
  
  // Strategy confirmed (FOLLOW)
  if (data.recentSignalTypes.includes('strategy_confirmed') && data.confidence >= 0.7) {
    decisionType = 'follow';
    confidence = 0.75;
    timeframe = 'mid';
    rationale.push('Strategy recently confirmed');
    rationale.push('Reliable pattern identified');
    return { decisionType, confidence, rationale, riskLevel, timeframe };
  }
  
  // Default: WATCH
  rationale.push('Insufficient data for strong recommendation');
  rationale.push('Monitoring advised until clearer patterns emerge');
  
  return { decisionType, confidence, rationale, riskLevel, timeframe };
}

/**
 * Get decision for actor
 */
export async function getActorDecision(address: string): Promise<IDecision | null> {
  return repo.getLatestDecision('actor', address);
}

/**
 * Get decision history
 */
export async function getDecisionHistory(
  scope: DecisionScope,
  refId: string,
  limit: number = 20
): Promise<IDecision[]> {
  return repo.getDecisionHistory(scope, refId, limit);
}

/**
 * Get recommended follows
 */
export async function getRecommendedFollows(limit: number = 20): Promise<IDecision[]> {
  return repo.getDecisionsByType('follow', limit);
}

/**
 * Get recommended copies
 */
export async function getRecommendedCopies(limit: number = 10): Promise<IDecision[]> {
  return repo.getDecisionsByType('copy', limit);
}

/**
 * Get stats
 */
export async function getStats() {
  return repo.getDecisionsStats();
}
