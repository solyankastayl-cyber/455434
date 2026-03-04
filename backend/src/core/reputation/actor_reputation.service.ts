/**
 * Actor Reputation Service (Phase 15.3)
 */
import {
  ActorReputationModel,
  IActorReputation,
  ACTOR_TRUST_WEIGHTS,
  getActorReliabilityTier,
  MIN_ACTOR_SAMPLE_SIZE,
} from './actor_reputation.model.js';
import { SignalReactionModel } from '../signal_reactions/signal_reaction.model.js';
import { SignalModel } from '../signals/signals.model.js';
import { StrategyProfileModel } from '../strategies/strategy_profiles.model.js';
import { MarketRegimeModel } from '../market_regimes/market_regime.model.js';

export async function calculateActorReputation(
  address: string
): Promise<IActorReputation> {
  const addr = address.toLowerCase();
  
  // Get strategy profile for this actor
  const profile = await StrategyProfileModel.findOne({ address: addr }).lean();
  
  // Get signals from this actor
  const signals = await SignalModel.find({ fromAddress: addr }).lean();
  const signalIds = signals.map(s => s._id);
  
  // Get reactions
  const reactions = await SignalReactionModel.find({
    signalId: { $in: signalIds },
  }).lean();
  
  if (reactions.length === 0) {
    return await ActorReputationModel.findOneAndUpdate(
      { address: addr },
      {
        $set: {
          address: addr,
          strategyMix: { accumulation: 0, distribution: 0, rotation: 0, other: 0 },
          historicalAccuracy: 50,
          avgSignalImpact: 0,
          avgImpactAdjusted: 0,
          drawdown: 0,
          riskAdjustedReturn: 0,
          regimeStrengths: { trend_up: 0, trend_down: 0, range: 0, high_volatility: 0 },
          regimeFit: 50,
          trustScore: 50,
          reliabilityTier: 'D',
          totalSignals: 0,
          confirmedSignals: 0,
          sampleSize: 0,
          consistency: 50,
          confidence: 0,
          lastUpdatedAt: new Date(),
          computedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    ).exec();
  }
  
  // Strategy mix
  const strategyMix = {
    accumulation: profile?.patterns?.accumulation || 0,
    distribution: profile?.patterns?.distribution || 0,
    rotation: profile?.patterns?.rotation || 0,
    other: 100 - ((profile?.patterns?.accumulation || 0) + (profile?.patterns?.distribution || 0) + (profile?.patterns?.rotation || 0)),
  };
  
  // Historical accuracy
  const confirmedSignals = reactions.filter(r => r.reactionType === 'confirmed').length;
  const totalSignals = signals.length;
  const historicalAccuracy = totalSignals > 0 ? (confirmedSignals / totalSignals) * 100 : 50;
  
  // Average signal impact
  const avgSignalImpact = reactions.length > 0
    ? reactions.reduce((sum, r) => sum + Math.abs(r.priceDeltaPct), 0) / reactions.length
    : 0;
  
  // Regime breakdown
  const regimeBreakdown: Record<string, { confirmed: number; total: number; impact: number }> = {
    trend_up: { confirmed: 0, total: 0, impact: 0 },
    trend_down: { confirmed: 0, total: 0, impact: 0 },
    range: { confirmed: 0, total: 0, impact: 0 },
    high_volatility: { confirmed: 0, total: 0, impact: 0 },
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
      regimeBreakdown[regime.regime].impact += Math.abs(reaction.priceDeltaPct);
      if (reaction.reactionType === 'confirmed') {
        regimeBreakdown[regime.regime].confirmed++;
      }
    }
  }
  
  // Regime strengths (success rate * avg impact)
  const regimeStrengths = {
    trend_up: regimeBreakdown.trend_up.total > 0
      ? ((regimeBreakdown.trend_up.confirmed / regimeBreakdown.trend_up.total) *
         (regimeBreakdown.trend_up.impact / regimeBreakdown.trend_up.total))
      : 0,
    trend_down: regimeBreakdown.trend_down.total > 0
      ? ((regimeBreakdown.trend_down.confirmed / regimeBreakdown.trend_down.total) *
         (regimeBreakdown.trend_down.impact / regimeBreakdown.trend_down.total))
      : 0,
    range: regimeBreakdown.range.total > 0
      ? ((regimeBreakdown.range.confirmed / regimeBreakdown.range.total) *
         (regimeBreakdown.range.impact / regimeBreakdown.range.total))
      : 0,
    high_volatility: regimeBreakdown.high_volatility.total > 0
      ? ((regimeBreakdown.high_volatility.confirmed / regimeBreakdown.high_volatility.total) *
         (regimeBreakdown.high_volatility.impact / regimeBreakdown.high_volatility.total))
      : 0,
  };
  
  // Regime fit (variance in regime performance)
  const strengths = Object.values(regimeStrengths);
  const avgStrength = strengths.reduce((a, b) => a + b, 0) / strengths.length;
  const variance = strengths.reduce((sum, s) => sum + Math.pow(s - avgStrength, 2), 0) / strengths.length;
  const regimeFit = Math.max(0, 100 - Math.sqrt(variance) * 10);
  
  // Impact adjusted for market conditions
  const avgImpactAdjusted = avgStrength;
  
  // Drawdown (max consecutive losses)
  let maxDrawdown = 0;
  let currentDrawdown = 0;
  for (const reaction of reactions.sort((a, b) => 
    a.priceTimestampAfter.getTime() - b.priceTimestampAfter.getTime()
  )) {
    if (reaction.reactionType === 'failed') {
      currentDrawdown += Math.abs(reaction.priceDeltaPct);
      maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
    } else {
      currentDrawdown = 0;
    }
  }
  const drawdown = maxDrawdown;
  
  // Risk-adjusted return
  const totalReturn = reactions.reduce((sum, r) => sum + r.priceDeltaPct, 0);
  const riskAdjustedReturn = drawdown > 0 ? totalReturn / drawdown : totalReturn;
  
  // Consistency
  const impactVariance = reactions.reduce((sum, r) => {
    const diff = Math.abs(r.priceDeltaPct) - avgSignalImpact;
    return sum + diff * diff;
  }, 0) / reactions.length;
  const consistency = Math.max(0, 100 - Math.sqrt(impactVariance) * 5);
  
  // Confidence
  const confidence = Math.min(1, Math.sqrt(totalSignals / MIN_ACTOR_SAMPLE_SIZE));
  
  // Trust score
  const trustScore = Math.min(100, Math.max(0,
    ACTOR_TRUST_WEIGHTS.historicalAccuracy * historicalAccuracy +
    ACTOR_TRUST_WEIGHTS.avgImpactAdjusted * Math.min(100, avgImpactAdjusted * 10) +
    ACTOR_TRUST_WEIGHTS.regimeFit * regimeFit +
    ACTOR_TRUST_WEIGHTS.riskAdjustedReturn * Math.min(50, Math.max(-50, riskAdjustedReturn * 10) + 50) -
    ACTOR_TRUST_WEIGHTS.drawdownPenalty * Math.min(100, drawdown)
  ));
  
  const reliabilityTier = getActorReliabilityTier(trustScore);
  
  return await ActorReputationModel.findOneAndUpdate(
    { address: addr },
    {
      $set: {
        address: addr,
        strategyMix,
        historicalAccuracy,
        avgSignalImpact,
        avgImpactAdjusted,
        drawdown,
        riskAdjustedReturn,
        regimeStrengths,
        regimeFit,
        trustScore,
        reliabilityTier,
        totalSignals,
        confirmedSignals,
        sampleSize: reactions.length,
        consistency,
        confidence,
        lastUpdatedAt: new Date(),
        computedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  ).exec();
}

export async function getActorReputation(
  address: string
): Promise<IActorReputation | null> {
  return await ActorReputationModel.findOne({ address: address.toLowerCase() }).exec();
}

export async function getTopActors(limit: number = 50): Promise<IActorReputation[]> {
  return await ActorReputationModel.find({
    sampleSize: { $gte: MIN_ACTOR_SAMPLE_SIZE },
  })
    .sort({ trustScore: -1 })
    .limit(limit)
    .exec();
}

export async function getActorReputationStats() {
  const [total, avgAgg] = await Promise.all([
    ActorReputationModel.countDocuments(),
    ActorReputationModel.aggregate([{
      $group: {
        _id: null,
        avgTrust: { $avg: '$trustScore' },
        avgAccuracy: { $avg: '$historicalAccuracy' },
      },
    }]),
  ]);
  
  return {
    total,
    avgTrustScore: avgAgg[0]?.avgTrust || 0,
    avgAccuracy: avgAgg[0]?.avgAccuracy || 0,
  };
}
