/**
 * Trust Snapshots Service (Phase 15.4)
 * 
 * Creates UI-ready trust indicators with human-readable explanations.
 */
import { Types } from 'mongoose';
import {
  TrustSnapshotModel,
  ITrustSnapshot,
  TargetType,
  TRUST_BADGES,
} from './trust_snapshots.model.js';
import {
  SignalReputationModel,
  MIN_SIGNAL_SAMPLE_SIZE,
} from './signal_reputation.model.js';
import {
  StrategyReputationModel,
  MIN_STRATEGY_SAMPLE_SIZE,
} from './strategy_reputation.model.js';
import {
  ActorReputationModel,
  MIN_ACTOR_SAMPLE_SIZE,
} from './actor_reputation.model.js';

/**
 * Generate trust snapshot for a signal
 */
export async function generateSignalSnapshot(
  signalId: Types.ObjectId | string
): Promise<ITrustSnapshot> {
  const sid = typeof signalId === 'string' ? new Types.ObjectId(signalId) : signalId;
  const rep = await SignalReputationModel.findOne({ signalId: sid });
  
  if (!rep) {
    return await TrustSnapshotModel.findOneAndUpdate(
      { targetType: 'signal', targetId: sid.toString() },
      {
        $set: {
          targetType: 'signal',
          targetId: sid.toString(),
          trustScore: 50,
          badges: [TRUST_BADGES.NEW_SIGNAL],
          explanation: 'No historical data available yet for this signal.',
          strengths: [],
          weaknesses: ['No track record'],
          recommendation: 'Monitor for performance data before making decisions.',
          dataQuality: {
            hasSufficientData: false,
            sampleSize: 0,
            confidence: 0,
            warning: 'New signal - wait for market reactions',
          },
          context: {},
          updatedAt: new Date(),
          computedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    ).exec();
  }
  
  // Generate badges
  const badges: string[] = [];
  if (rep.successRate >= 70) badges.push(TRUST_BADGES.HIGH_ACCURACY);
  if (rep.consistency >= 70) badges.push(TRUST_BADGES.CONSISTENT);
  if (rep.sampleSize >= MIN_SIGNAL_SAMPLE_SIZE * 3) badges.push(TRUST_BADGES.PROVEN_TRACK_RECORD);
  if (rep.sampleSize < MIN_SIGNAL_SAMPLE_SIZE) badges.push(TRUST_BADGES.LIMITED_DATA);
  if (rep.consistency < 50) badges.push(TRUST_BADGES.VOLATILE_PERFORMANCE);
  
  // Best/worst regimes
  const regimes = Object.entries(rep.regimePerformance);
  const bestRegime = regimes.reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
  const worstRegime = regimes.reduce((a, b) => (b[1] < a[1] ? b : a), ['', 100]);
  
  // Strengths
  const strengths: string[] = [];
  if (rep.successRate >= 70) strengths.push(`Historically accurate: ${rep.successRate.toFixed(0)}%`);
  if (rep.avgPriceImpact > 5) strengths.push(`Strong price impact: ${rep.avgPriceImpact.toFixed(1)}%`);
  if (rep.consistency >= 70) strengths.push('Consistent performance');
  
  // Weaknesses
  const weaknesses: string[] = [];
  if (rep.sampleSize < MIN_SIGNAL_SAMPLE_SIZE) weaknesses.push('Low sample size - early signal');
  if (rep.successRate < 50) weaknesses.push('Below 50% success rate');
  if (rep.consistency < 50) weaknesses.push('Inconsistent results');
  if (worstRegime[1] < 40) weaknesses.push(`Underperforms in ${worstRegime[0]} markets`);
  
  // Explanation
  let explanation = `This signal has a ${rep.successRate.toFixed(0)}% success rate based on ${rep.sampleSize} market reactions. `;
  if (bestRegime[0]) {
    explanation += `Performs best in ${bestRegime[0]} markets (${bestRegime[1].toFixed(0)}%). `;
  }
  
  // Recommendation
  let recommendation = '';
  if (rep.trustScore >= 70) {
    recommendation = 'Strong signal - consider acting on it.';
  } else if (rep.trustScore >= 50) {
    recommendation = 'Moderate signal - use with other indicators.';
  } else {
    recommendation = 'Weak signal - proceed with caution.';
  }
  
  return await TrustSnapshotModel.findOneAndUpdate(
    { targetType: 'signal', targetId: sid.toString() },
    {
      $set: {
        targetType: 'signal',
        targetId: sid.toString(),
        trustScore: rep.trustScore,
        badges,
        explanation,
        strengths,
        weaknesses,
        recommendation,
        dataQuality: {
          hasSufficientData: rep.sampleSize >= MIN_SIGNAL_SAMPLE_SIZE,
          sampleSize: rep.sampleSize,
          confidence: Math.min(1, rep.sampleSize / MIN_SIGNAL_SAMPLE_SIZE),
          warning: rep.sampleSize < MIN_SIGNAL_SAMPLE_SIZE
            ? `Need ${MIN_SIGNAL_SAMPLE_SIZE - rep.sampleSize} more reactions for reliable assessment`
            : undefined,
        },
        context: {
          bestIn: bestRegime[0] || undefined,
          worstIn: worstRegime[1] < 50 ? worstRegime[0] : undefined,
        },
        updatedAt: new Date(),
        computedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  ).exec();
}

/**
 * Generate trust snapshot for a strategy
 */
export async function generateStrategySnapshot(
  strategyType: string
): Promise<ITrustSnapshot> {
  const rep = await StrategyReputationModel.findOne({ strategyType });
  
  if (!rep) {
    return await TrustSnapshotModel.findOneAndUpdate(
      { targetType: 'strategy', targetId: strategyType },
      {
        $set: {
          targetType: 'strategy',
          targetId: strategyType,
          trustScore: 50,
          badges: [TRUST_BADGES.LIMITED_DATA],
          explanation: 'No historical data for this strategy yet.',
          strengths: [],
          weaknesses: ['No track record'],
          recommendation: 'Insufficient data to evaluate strategy.',
          dataQuality: {
            hasSufficientData: false,
            sampleSize: 0,
            confidence: 0,
          },
          context: {},
          updatedAt: new Date(),
          computedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    ).exec();
  }
  
  const badges: string[] = [];
  if (rep.successRate >= 70) badges.push(TRUST_BADGES.HIGH_ACCURACY);
  if (rep.reliabilityTier === 'A') badges.push(TRUST_BADGES.PROVEN_TRACK_RECORD);
  if (rep.totalSignals < MIN_STRATEGY_SAMPLE_SIZE) badges.push(TRUST_BADGES.LIMITED_DATA);
  
  const regimes = Object.entries(rep.regimePerformance);
  const bestRegime = regimes.reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
  const worstRegime = regimes.reduce((a, b) => (b[1] < a[1] ? b : a), ['', 100]);
  
  const strengths: string[] = [];
  if (rep.successRate >= 60) strengths.push(`${rep.successRate.toFixed(0)}% success rate`);
  if (rep.consistency >= 70) strengths.push('Consistent strategy');
  if (rep.reliabilityTier === 'A') strengths.push('Top tier reliability');
  
  const weaknesses: string[] = [];
  if (rep.totalSignals < MIN_STRATEGY_SAMPLE_SIZE) weaknesses.push('Limited signal history');
  if (rep.successRate < 50) weaknesses.push('Below 50% success rate');
  if (worstRegime[1] < 40) weaknesses.push(`Weak in ${worstRegime[0]} markets`);
  
  const explanation = `This strategy has generated ${rep.totalSignals} signals with a ${rep.successRate.toFixed(0)}% confirmation rate. Reliability tier: ${rep.reliabilityTier}.`;
  
  let recommendation = '';
  if (rep.reliabilityTier === 'A') {
    recommendation = 'Excellent strategy - highly reliable.';
  } else if (rep.reliabilityTier === 'B') {
    recommendation = 'Good strategy - use with confidence.';
  } else if (rep.reliabilityTier === 'C') {
    recommendation = 'Fair strategy - combine with other signals.';
  } else {
    recommendation = 'Weak strategy - use with caution.';
  }
  
  return await TrustSnapshotModel.findOneAndUpdate(
    { targetType: 'strategy', targetId: strategyType },
    {
      $set: {
        targetType: 'strategy',
        targetId: strategyType,
        trustScore: rep.trustScore,
        badges,
        explanation,
        strengths,
        weaknesses,
        recommendation,
        dataQuality: {
          hasSufficientData: rep.totalSignals >= MIN_STRATEGY_SAMPLE_SIZE,
          sampleSize: rep.totalSignals,
          confidence: rep.confidence,
        },
        context: {
          bestIn: bestRegime[0] || undefined,
          worstIn: worstRegime[1] < 50 ? worstRegime[0] : undefined,
        },
        updatedAt: new Date(),
        computedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  ).exec();
}

/**
 * Generate trust snapshot for an actor
 */
export async function generateActorSnapshot(
  address: string
): Promise<ITrustSnapshot> {
  const addr = address.toLowerCase();
  const rep = await ActorReputationModel.findOne({ address: addr });
  
  if (!rep) {
    return await TrustSnapshotModel.findOneAndUpdate(
      { targetType: 'actor', targetId: addr },
      {
        $set: {
          targetType: 'actor',
          targetId: addr,
          trustScore: 50,
          badges: [TRUST_BADGES.LIMITED_DATA],
          explanation: 'No historical performance data for this actor.',
          strengths: [],
          weaknesses: ['No track record'],
          recommendation: 'Wait for performance history before following.',
          dataQuality: {
            hasSufficientData: false,
            sampleSize: 0,
            confidence: 0,
          },
          context: {},
          updatedAt: new Date(),
          computedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    ).exec();
  }
  
  const badges: string[] = [];
  if (rep.historicalAccuracy >= 70) badges.push(TRUST_BADGES.HIGH_ACCURACY);
  if (rep.reliabilityTier === 'A') badges.push(TRUST_BADGES.PROVEN_TRACK_RECORD);
  if (rep.consistency >= 70) badges.push(TRUST_BADGES.CONSISTENT);
  if (rep.regimeFit >= 70) badges.push(TRUST_BADGES.ADAPTS_WELL);
  if (rep.drawdown > 20) badges.push(TRUST_BADGES.HIGH_DRAWDOWN);
  if (rep.sampleSize < MIN_ACTOR_SAMPLE_SIZE) badges.push(TRUST_BADGES.LIMITED_DATA);
  
  const regimes = Object.entries(rep.regimeStrengths);
  const bestRegime = regimes.reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
  
  const strengths: string[] = [];
  if (rep.historicalAccuracy >= 70) strengths.push(`${rep.historicalAccuracy.toFixed(0)}% accuracy`);
  if (rep.riskAdjustedReturn > 1) strengths.push('Positive risk-adjusted returns');
  if (rep.regimeFit >= 70) strengths.push('Adapts well to different markets');
  
  const weaknesses: string[] = [];
  if (rep.sampleSize < MIN_ACTOR_SAMPLE_SIZE) weaknesses.push('Limited signal history');
  if (rep.drawdown > 20) weaknesses.push(`High drawdown: ${rep.drawdown.toFixed(1)}%`);
  if (rep.historicalAccuracy < 50) weaknesses.push('Below 50% accuracy');
  
  const explanation = `This actor has generated ${rep.totalSignals} signals with ${rep.historicalAccuracy.toFixed(0)}% accuracy. Reliability tier: ${rep.reliabilityTier}.`;
  
  let recommendation = '';
  if (rep.reliabilityTier === 'A') {
    recommendation = 'Highly reliable actor - strong follow candidate.';
  } else if (rep.reliabilityTier === 'B') {
    recommendation = 'Reliable actor - consider following.';
  } else if (rep.reliabilityTier === 'C') {
    recommendation = 'Moderate actor - monitor before following.';
  } else {
    recommendation = 'Weak performer - follow with caution.';
  }
  
  return await TrustSnapshotModel.findOneAndUpdate(
    { targetType: 'actor', targetId: addr },
    {
      $set: {
        targetType: 'actor',
        targetId: addr,
        trustScore: rep.trustScore,
        badges,
        explanation,
        strengths,
        weaknesses,
        recommendation,
        dataQuality: {
          hasSufficientData: rep.sampleSize >= MIN_ACTOR_SAMPLE_SIZE,
          sampleSize: rep.sampleSize,
          confidence: rep.confidence,
        },
        context: {
          bestIn: bestRegime[0] || undefined,
        },
        updatedAt: new Date(),
        computedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  ).exec();
}

/**
 * Get trust snapshot
 */
export async function getTrustSnapshot(
  targetType: TargetType,
  targetId: string
): Promise<ITrustSnapshot | null> {
  return await TrustSnapshotModel.findOne({ targetType, targetId }).exec();
}

/**
 * Get all snapshots for a type
 */
export async function getTrustSnapshotsByType(
  targetType: TargetType,
  limit: number = 100
): Promise<ITrustSnapshot[]> {
  return await TrustSnapshotModel.find({ targetType })
    .sort({ trustScore: -1 })
    .limit(limit)
    .exec();
}
