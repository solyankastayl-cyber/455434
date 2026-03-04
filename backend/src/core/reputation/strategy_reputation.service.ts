/**
 * Strategy Reputation Service (Phase 15.2)
 */
import {
  StrategyReputationModel,
  IStrategyReputation,
  STRATEGY_TRUST_WEIGHTS,
  getReliabilityTier,
  MIN_STRATEGY_SAMPLE_SIZE,
} from './strategy_reputation.model.js';
import { StrategyType } from '../strategies/strategy_profiles.model.js';
import { SignalReactionModel } from '../signal_reactions/signal_reaction.model.js';
import { SignalModel } from '../signals/signals.model.js';
import { StrategyProfileModel } from '../strategies/strategy_profiles.model.js';
import { MarketRegimeModel } from '../market_regimes/market_regime.model.js';

export async function calculateStrategyReputation(
  strategyType: StrategyType
): Promise<IStrategyReputation> {
  // Get all strategy profiles of this type
  const profiles = await StrategyProfileModel.find({ strategyType }).lean();
  
  if (profiles.length === 0) {
    return await StrategyReputationModel.findOneAndUpdate(
      { strategyType },
      {
        $set: {
          strategyType,
          totalSignals: 0,
          confirmedSignals: 0,
          successRate: 50,
          avgPnL: 0,
          regimePerformance: { trend_up: 0, trend_down: 0, range: 0, high_volatility: 0 },
          trustScore: 50,
          confidence: 0,
          consistency: 50,
          signalVolumeConfidence: 0,
          regimeAdjustedPerformance: 50,
          reliabilityTier: 'D',
          lastUpdatedAt: new Date(),
          computedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    ).exec();
  }
  
  // Get addresses for this strategy
  const addresses = profiles.map(p => p.address);
  
  // Get signals from these addresses
  const signals = await SignalModel.find({
    fromAddress: { $in: addresses },
  }).lean();
  
  const signalIds = signals.map(s => s._id);
  
  // Get reactions for these signals
  const reactions = await SignalReactionModel.find({
    signalId: { $in: signalIds },
  }).lean();
  
  const totalSignals = signals.length;
  const confirmedSignals = reactions.filter(r => r.reactionType === 'confirmed').length;
  const successRate = totalSignals > 0 ? (confirmedSignals / totalSignals) * 100 : 50;
  
  // Calculate avg PnL (simplified - using price impact)
  const avgPnL = reactions.length > 0
    ? reactions.reduce((sum, r) => sum + r.priceDeltaPct, 0) / reactions.length
    : 0;
  
  // Regime breakdown
  const regimeBreakdown: Record<string, { confirmed: number; total: number }> = {
    trend_up: { confirmed: 0, total: 0 },
    trend_down: { confirmed: 0, total: 0 },
    range: { confirmed: 0, total: 0 },
    high_volatility: { confirmed: 0, total: 0 },
  };
  
  for (const reaction of reactions) {
    const regime = await MarketRegimeModel.findOne({
      assetAddress: reaction.assetAddress,
      timestamp: { $lte: reaction.priceTimestampAfter },
    })
      .sort({ timestamp: -1 })
      .limit(1)
      .lean();
    
    if (regime && regimeBreakdown[regime.regime]) {
      regimeBreakdown[regime.regime].total++;
      if (reaction.reactionType === 'confirmed') {
        regimeBreakdown[regime.regime].confirmed++;
      }
    }
  }
  
  const regimePerformance = {
    trend_up: regimeBreakdown.trend_up.total > 0
      ? (regimeBreakdown.trend_up.confirmed / regimeBreakdown.trend_up.total) * 100 : 0,
    trend_down: regimeBreakdown.trend_down.total > 0
      ? (regimeBreakdown.trend_down.confirmed / regimeBreakdown.trend_down.total) * 100 : 0,
    range: regimeBreakdown.range.total > 0
      ? (regimeBreakdown.range.confirmed / regimeBreakdown.range.total) * 100 : 0,
    high_volatility: regimeBreakdown.high_volatility.total > 0
      ? (regimeBreakdown.high_volatility.confirmed / regimeBreakdown.high_volatility.total) * 100 : 0,
  };
  
  // Consistency
  const pnlVariance = reactions.length > 1
    ? reactions.reduce((sum, r) => {
        const diff = r.priceDeltaPct - avgPnL;
        return sum + diff * diff;
      }, 0) / reactions.length
    : 0;
  const consistency = Math.max(0, 100 - Math.sqrt(pnlVariance) * 5);
  
  // Signal volume confidence
  const signalVolumeConfidence = Math.min(1, totalSignals / MIN_STRATEGY_SAMPLE_SIZE);
  
  // Regime-adjusted performance
  const difficultyWeights = { trend_up: 0.8, trend_down: 1.2, range: 1.0, high_volatility: 1.5 };
  let weightedPerf = 0;
  let totalWeight = 0;
  
  for (const [regime, perf] of Object.entries(regimePerformance)) {
    const weight = difficultyWeights[regime as keyof typeof difficultyWeights] || 1;
    const count = regimeBreakdown[regime].total;
    if (count > 0) {
      weightedPerf += perf * weight;
      totalWeight += weight;
    }
  }
  
  const regimeAdjustedPerformance = totalWeight > 0 ? weightedPerf / totalWeight : successRate;
  
  // Statistical confidence (based on sample size)
  const confidence = Math.min(1, Math.sqrt(totalSignals / MIN_STRATEGY_SAMPLE_SIZE));
  
  // Trust score
  const trustScore = Math.min(100, Math.max(0,
    STRATEGY_TRUST_WEIGHTS.successRate * successRate +
    STRATEGY_TRUST_WEIGHTS.regimeAdjustedPerformance * regimeAdjustedPerformance +
    STRATEGY_TRUST_WEIGHTS.consistency * consistency +
    STRATEGY_TRUST_WEIGHTS.signalVolumeConfidence * signalVolumeConfidence * 100
  ));
  
  const reliabilityTier = getReliabilityTier(trustScore);
  
  return await StrategyReputationModel.findOneAndUpdate(
    { strategyType },
    {
      $set: {
        strategyType,
        totalSignals,
        confirmedSignals,
        successRate,
        avgPnL,
        regimePerformance,
        trustScore,
        confidence,
        consistency,
        signalVolumeConfidence,
        regimeAdjustedPerformance,
        reliabilityTier,
        lastUpdatedAt: new Date(),
        computedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  ).exec();
}

export async function getStrategyReputation(
  strategyType: StrategyType
): Promise<IStrategyReputation | null> {
  return await StrategyReputationModel.findOne({ strategyType }).exec();
}

export async function getTopStrategies(limit: number = 20): Promise<IStrategyReputation[]> {
  return await StrategyReputationModel.find({
    totalSignals: { $gte: MIN_STRATEGY_SAMPLE_SIZE },
  })
    .sort({ trustScore: -1 })
    .limit(limit)
    .exec();
}

export async function getStrategyReputationStats() {
  const [total, avgAgg] = await Promise.all([
    StrategyReputationModel.countDocuments(),
    StrategyReputationModel.aggregate([{
      $group: {
        _id: null,
        avgTrust: { $avg: '$trustScore' },
        avgSuccess: { $avg: '$successRate' },
      },
    }]),
  ]);
  
  return {
    total,
    avgTrustScore: avgAgg[0]?.avgTrust || 0,
    avgSuccessRate: avgAgg[0]?.avgSuccess || 0,
  };
}
