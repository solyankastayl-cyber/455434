/**
 * Signal Reputation Service (Phase 15.1)
 * 
 * Calculates trust scores for signals based on market reactions.
 */
import { Types } from 'mongoose';
import {
  SignalReputationModel,
  ISignalReputation,
  SIGNAL_TRUST_WEIGHTS,
  MIN_SIGNAL_SAMPLE_SIZE,
  SIGNAL_DECAY_HALFLIFE,
} from './signal_reputation.model.js';
import { SignalReactionModel } from '../signal_reactions/signal_reaction.model.js';
import { MarketRegimeModel } from '../market_regimes/market_regime.model.js';

/**
 * Calculate reputation for a signal
 */
export async function calculateSignalReputation(
  signalId: Types.ObjectId | string
): Promise<ISignalReputation> {
  const sid = typeof signalId === 'string' ? new Types.ObjectId(signalId) : signalId;
  
  // Get all reactions for this signal
  const reactions = await SignalReactionModel.find({ signalId: sid }).lean();
  
  if (reactions.length === 0) {
    // No reactions yet - return default reputation
    return await SignalReputationModel.findOneAndUpdate(
      { signalId: sid },
      {
        $set: {
          signalId: sid,
          successRate: 50,
          avgPriceImpact: 0,
          volatilityAdjusted: 50,
          decayScore: 1,
          trustScore: 50,
          sampleSize: 0,
          consistency: 50,
          regimePerformance: {
            trend_up: 0,
            trend_down: 0,
            range: 0,
            high_volatility: 0,
          },
          regimeDifficultyBonus: 0,
          lastUpdatedAt: new Date(),
          computedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    ).exec();
  }
  
  // Calculate success rate
  const confirmedCount = reactions.filter(r => r.reactionType === 'confirmed').length;
  const successRate = (confirmedCount / reactions.length) * 100;
  
  // Calculate average price impact (absolute value)
  const avgPriceImpact =
    reactions.reduce((sum, r) => sum + Math.abs(r.priceDeltaPct), 0) / reactions.length;
  
  // Get market regimes for each reaction
  const regimeBreakdown: Record<string, { confirmed: number; total: number }> = {
    trend_up: { confirmed: 0, total: 0 },
    trend_down: { confirmed: 0, total: 0 },
    range: { confirmed: 0, total: 0 },
    high_volatility: { confirmed: 0, total: 0 },
  };
  
  for (const reaction of reactions) {
    // Find regime at reaction time
    const regime = await MarketRegimeModel.findOne({
      assetAddress: reaction.assetAddress,
      timestamp: { $lte: reaction.priceTimestampAfter },
    })
      .sort({ timestamp: -1 })
      .limit(1)
      .lean();
    
    if (regime) {
      const regimeType = regime.regime;
      if (regimeBreakdown[regimeType]) {
        regimeBreakdown[regimeType].total++;
        if (reaction.reactionType === 'confirmed') {
          regimeBreakdown[regimeType].confirmed++;
        }
      }
    }
  }
  
  // Calculate regime performance
  const regimePerformance = {
    trend_up:
      regimeBreakdown.trend_up.total > 0
        ? (regimeBreakdown.trend_up.confirmed / regimeBreakdown.trend_up.total) * 100
        : 0,
    trend_down:
      regimeBreakdown.trend_down.total > 0
        ? (regimeBreakdown.trend_down.confirmed / regimeBreakdown.trend_down.total) * 100
        : 0,
    range:
      regimeBreakdown.range.total > 0
        ? (regimeBreakdown.range.confirmed / regimeBreakdown.range.total) * 100
        : 0,
    high_volatility:
      regimeBreakdown.high_volatility.total > 0
        ? (regimeBreakdown.high_volatility.confirmed / regimeBreakdown.high_volatility.total) * 100
        : 0,
  };
  
  // Calculate volatility-adjusted success rate
  const avgVolatility =
    reactions.reduce((sum, r) => sum + r.volatilityAfter, 0) / reactions.length;
  const volatilityAdjusted = successRate * Math.max(0.5, Math.min(1.5, 1 + avgVolatility / 100));
  
  // Calculate consistency (inverse of variance)
  const impactVariance =
    reactions.reduce((sum, r) => {
      const diff = Math.abs(r.priceDeltaPct) - avgPriceImpact;
      return sum + diff * diff;
    }, 0) / reactions.length;
  const consistency = Math.max(0, 100 - Math.sqrt(impactVariance) * 10);
  
  // Calculate regime difficulty bonus
  // Bonus for performing well in difficult regimes (high volatility, downtrends)
  const difficultyWeights = {
    trend_up: 0.8,
    trend_down: 1.2,
    range: 1.0,
    high_volatility: 1.5,
  };
  
  let weightedPerformance = 0;
  let totalWeight = 0;
  
  for (const [regime, perf] of Object.entries(regimePerformance)) {
    const weight = difficultyWeights[regime as keyof typeof difficultyWeights] || 1;
    const count = regimeBreakdown[regime].total;
    if (count > 0) {
      weightedPerformance += perf * weight * count;
      totalWeight += weight * count;
    }
  }
  
  const regimeDifficultyBonus = totalWeight > 0 ? (weightedPerformance / totalWeight - successRate) : 0;
  
  // Calculate time decay
  const firstReaction = reactions.sort((a, b) =>
    a.priceTimestampBefore.getTime() - b.priceTimestampBefore.getTime()
  )[0];
  const daysSinceFirst =
    (Date.now() - firstReaction.priceTimestampBefore.getTime()) / (1000 * 60 * 60 * 24);
  const decayScore = Math.pow(0.5, daysSinceFirst / SIGNAL_DECAY_HALFLIFE);
  
  // Calculate final trust score
  const trustScore = Math.min(
    100,
    Math.max(
      0,
      SIGNAL_TRUST_WEIGHTS.successRate * successRate +
        SIGNAL_TRUST_WEIGHTS.avgPriceImpact * Math.min(100, avgPriceImpact * 10) +
        SIGNAL_TRUST_WEIGHTS.regimeDifficultyBonus * Math.min(100, regimeDifficultyBonus + 50) +
        SIGNAL_TRUST_WEIGHTS.consistency * consistency
    )
  );
  
  // Save or update
  return await SignalReputationModel.findOneAndUpdate(
    { signalId: sid },
    {
      $set: {
        signalId: sid,
        successRate,
        avgPriceImpact,
        volatilityAdjusted,
        decayScore,
        trustScore,
        sampleSize: reactions.length,
        consistency,
        regimePerformance,
        regimeDifficultyBonus,
        lastUpdatedAt: new Date(),
        computedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  ).exec();
}

/**
 * Get signal reputation
 */
export async function getSignalReputation(
  signalId: Types.ObjectId | string
): Promise<ISignalReputation | null> {
  const sid = typeof signalId === 'string' ? new Types.ObjectId(signalId) : signalId;
  return await SignalReputationModel.findOne({ signalId: sid }).exec();
}

/**
 * Get top signals by trust score
 */
export async function getTopSignals(limit: number = 50): Promise<ISignalReputation[]> {
  return await SignalReputationModel.find({
    sampleSize: { $gte: MIN_SIGNAL_SAMPLE_SIZE },
  })
    .sort({ trustScore: -1, sampleSize: -1 })
    .limit(limit)
    .exec();
}

/**
 * Get signal reputation stats
 */
export async function getSignalReputationStats(): Promise<{
  total: number;
  avgTrustScore: number;
  avgSuccessRate: number;
  withSufficientData: number;
}> {
  const [total, avgAgg, sufficient] = await Promise.all([
    SignalReputationModel.countDocuments(),
    SignalReputationModel.aggregate([
      {
        $group: {
          _id: null,
          avgTrust: { $avg: '$trustScore' },
          avgSuccess: { $avg: '$successRate' },
        },
      },
    ]),
    SignalReputationModel.countDocuments({ sampleSize: { $gte: MIN_SIGNAL_SAMPLE_SIZE } }),
  ]);
  
  return {
    total,
    avgTrustScore: avgAgg[0]?.avgTrust || 0,
    avgSuccessRate: avgAgg[0]?.avgSuccess || 0,
    withSufficientData: sufficient,
  };
}
