/**
 * Signal Reaction Service (Phase 14B.1-14B.3)
 * 
 * Computes market reactions to signals and updates confidence.
 */
import { SignalReactionModel, ISignalReaction, ReactionWindow, ReactionType, REACTION_THRESHOLDS, getWindowMs, getExpectedDirection } from './signal_reaction.model.js';
import { SignalModel, ISignal } from '../signals/signals.model.js';
import { PricePointModel, parsePrice } from '../market/price_points.model.js';
import { getMarketMetrics } from '../market/market_metrics.service.js';
import { getRegimeAwareConfidenceImpact } from '../market_regimes/market_regime.service.js';
import mongoose from 'mongoose';

/**
 * Compute reaction for a signal
 */
export async function computeSignalReaction(
  signal: ISignal,
  window: ReactionWindow
): Promise<ISignalReaction | null> {
  const windowMs = getWindowMs(window);
  const signalTime = signal.triggeredAt;
  const afterTime = new Date(signalTime.getTime() + windowMs);
  
  // Check if we have enough time passed
  if (afterTime > new Date()) {
    return null; // Not enough time has passed
  }
  
  // Get asset address from signal
  const assetAddress = signal.entityType === 'address' 
    ? signal.entityId 
    : signal.relatedAddresses[0];
  
  if (!assetAddress) return null;
  
  // Get price before (at signal time)
  const priceBefore = await PricePointModel.findOne({
    assetAddress: assetAddress.toLowerCase(),
    chain: signal.chain,
    timestamp: { $lte: signalTime },
  }).sort({ timestamp: -1 });
  
  // Get price after (at window end)
  const priceAfter = await PricePointModel.findOne({
    assetAddress: assetAddress.toLowerCase(),
    chain: signal.chain,
    timestamp: { $lte: afterTime },
  }).sort({ timestamp: -1 });
  
  if (!priceBefore || !priceAfter) {
    return null; // No price data available
  }
  
  const priceBeforeValue = parsePrice(priceBefore.priceUsd);
  const priceAfterValue = parsePrice(priceAfter.priceUsd);
  
  if (priceBeforeValue <= 0) return null;
  
  // Calculate price delta
  const priceDeltaPct = ((priceAfterValue - priceBeforeValue) / priceBeforeValue) * 100;
  
  // Get volatility (from market metrics if available)
  let volatilityBefore = 0;
  let volatilityAfter = 0;
  
  try {
    const metricsBefore = await getMarketMetrics(assetAddress, signal.chain, '1h');
    if (metricsBefore) {
      volatilityBefore = metricsBefore.volatility * 100; // Convert to percentage
    }
    
    // Note: volatilityAfter would need historical metrics, using same for now
    volatilityAfter = volatilityBefore;
  } catch (err) {
    // Metrics not available, continue without
  }
  
  // Determine expected direction
  const expectedDirection = getExpectedDirection(signal.signalType);
  
  // Check if direction matched
  let directionMatched = false;
  if (expectedDirection === 'up') {
    directionMatched = priceDeltaPct > 0;
  } else if (expectedDirection === 'down') {
    directionMatched = priceDeltaPct < 0;
  } else {
    directionMatched = true; // 'any' direction always matches
  }
  
  // Check if magnitude is significant
  const magnitudeSignificant = Math.abs(priceDeltaPct) > REACTION_THRESHOLDS.significantMovePct;
  
  // Determine reaction type
  let reactionType: ReactionType;
  let confidenceImpact: number;
  
  if (Math.abs(priceDeltaPct) < REACTION_THRESHOLDS.noiseThresholdPct) {
    // Below noise threshold
    reactionType = 'neutral';
    confidenceImpact = REACTION_THRESHOLDS.neutralImpact;
  } else if (directionMatched && magnitudeSignificant) {
    // Significant move in expected direction
    reactionType = 'confirmed';
    confidenceImpact = REACTION_THRESHOLDS.confirmedImpact;
  } else if (!directionMatched && magnitudeSignificant) {
    // Significant move in opposite direction
    reactionType = 'failed';
    confidenceImpact = REACTION_THRESHOLDS.failedImpact;
  } else {
    // Small move or mixed signals
    reactionType = 'neutral';
    confidenceImpact = REACTION_THRESHOLDS.neutralImpact;
  }
  
  // Discount confidence impact in high volatility
  if (volatilityBefore > REACTION_THRESHOLDS.highVolatilityPct) {
    confidenceImpact *= 0.5; // Halved the impact in high volatility
  }
  
  // Apply regime-aware adjustment (Phase 14C.3)
  let regimeExplanation = '';
  try {
    const regimeAdjustment = await getRegimeAwareConfidenceImpact(
      assetAddress,
      signal.chain,
      confidenceImpact,
      reactionType
    );
    confidenceImpact = regimeAdjustment.adjustedImpact;
    regimeExplanation = regimeAdjustment.explanation;
  } catch (err) {
    // Continue without regime adjustment
  }
  
  // Upsert the reaction
  const reaction = await SignalReactionModel.findOneAndUpdate(
    {
      signalId: signal._id,
      reactionWindow: window,
    },
    {
      $set: {
        assetAddress: assetAddress.toLowerCase(),
        chain: signal.chain,
        priceBefore: priceBeforeValue,
        priceAfter: priceAfterValue,
        priceDeltaPct,
        priceTimestampBefore: priceBefore.timestamp,
        priceTimestampAfter: priceAfter.timestamp,
        volatilityBefore,
        volatilityAfter,
        volatilityDeltaPct: volatilityBefore > 0 
          ? ((volatilityAfter - volatilityBefore) / volatilityBefore) * 100 
          : 0,
        reactionType,
        directionMatched,
        magnitudeSignificant,
        confidenceImpact,
        signalType: signal.signalType,
        signalSeverity: signal.severityScore,
        signalConfidenceOriginal: signal.confidence,
        computedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );
  
  return reaction;
}

/**
 * Update signal confidence based on reactions
 */
export async function updateSignalConfidence(
  signalId: string
): Promise<{ newConfidence: number; totalImpact: number } | null> {
  const signal = await SignalModel.findById(signalId);
  if (!signal) return null;
  
  // Get all reactions for this signal
  const reactions = await SignalReactionModel.find({ signalId: signal._id });
  
  if (reactions.length === 0) {
    return { newConfidence: signal.confidence, totalImpact: 0 };
  }
  
  // Calculate total confidence impact
  // Weight shorter windows more heavily (more recent reaction)
  const windowWeights: Record<ReactionWindow, number> = {
    '5m': 0.4,
    '15m': 0.3,
    '1h': 0.2,
    '4h': 0.1,
  };
  
  let totalImpact = 0;
  let totalWeight = 0;
  
  for (const reaction of reactions) {
    const weight = windowWeights[reaction.reactionWindow] || 0.1;
    totalImpact += reaction.confidenceImpact * weight;
    totalWeight += weight;
  }
  
  if (totalWeight > 0) {
    totalImpact = totalImpact / totalWeight;
  }
  
  // Apply impact to confidence
  const baseConfidence = signal.confidence;
  let newConfidence = baseConfidence + totalImpact;
  
  // Clamp to [0.1, 1.0] - never go below 0.1
  newConfidence = Math.max(0.1, Math.min(1.0, newConfidence));
  
  // Update signal confidence
  await SignalModel.updateOne(
    { _id: signal._id },
    { $set: { confidence: newConfidence } }
  );
  
  return { newConfidence, totalImpact };
}

/**
 * Get reaction for a signal
 */
export async function getSignalReaction(
  signalId: string,
  window?: ReactionWindow
): Promise<ISignalReaction | ISignalReaction[] | null> {
  if (window) {
    return SignalReactionModel.findOne({
      signalId: new mongoose.Types.ObjectId(signalId),
      reactionWindow: window,
    });
  }
  
  return SignalReactionModel.find({
    signalId: new mongoose.Types.ObjectId(signalId),
  }).sort({ reactionWindow: 1 });
}

/**
 * Get validation summary for a signal
 */
export async function getSignalValidation(signalId: string) {
  const reactions = await SignalReactionModel.find({
    signalId: new mongoose.Types.ObjectId(signalId),
  });
  
  if (reactions.length === 0) {
    return {
      status: 'pending',
      validated: false,
      reactions: [],
      summary: null,
    };
  }
  
  // Determine overall validation status
  const confirmed = reactions.filter(r => r.reactionType === 'confirmed').length;
  const failed = reactions.filter(r => r.reactionType === 'failed').length;
  const neutral = reactions.filter(r => r.reactionType === 'neutral').length;
  
  let overallStatus: 'confirmed' | 'failed' | 'neutral' | 'mixed';
  
  if (confirmed > failed && confirmed > neutral) {
    overallStatus = 'confirmed';
  } else if (failed > confirmed && failed > neutral) {
    overallStatus = 'failed';
  } else if (neutral >= confirmed && neutral >= failed) {
    overallStatus = 'neutral';
  } else {
    overallStatus = 'mixed';
  }
  
  // Calculate average price change
  const avgPriceChange = reactions.reduce((sum, r) => sum + r.priceDeltaPct, 0) / reactions.length;
  
  // Get best and worst window
  const sorted = [...reactions].sort((a, b) => b.confidenceImpact - a.confidenceImpact);
  
  return {
    status: overallStatus,
    validated: true,
    reactions: reactions.map(r => ({
      window: r.reactionWindow,
      reactionType: r.reactionType,
      priceDeltaPct: r.priceDeltaPct,
      confidenceImpact: r.confidenceImpact,
    })),
    summary: {
      confirmed,
      failed,
      neutral,
      avgPriceChangePct: avgPriceChange,
      bestWindow: sorted[0]?.reactionWindow,
      worstWindow: sorted[sorted.length - 1]?.reactionWindow,
    },
  };
}

/**
 * Get validation stats
 */
export async function getValidationStats(days: number = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const stats = await SignalReactionModel.aggregate([
    {
      $match: {
        computedAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: {
          signalType: '$signalType',
          reactionType: '$reactionType',
        },
        count: { $sum: 1 },
        avgPriceChange: { $avg: '$priceDeltaPct' },
        avgConfidenceImpact: { $avg: '$confidenceImpact' },
      },
    },
  ]);
  
  // Calculate overall accuracy per signal type
  const bySignalType: Record<string, {
    total: number;
    confirmed: number;
    failed: number;
    neutral: number;
    accuracy: number;
    avgPriceChange: number;
  }> = {};
  
  for (const stat of stats) {
    const signalType = stat._id.signalType;
    const reactionType = stat._id.reactionType;
    
    if (!bySignalType[signalType]) {
      bySignalType[signalType] = {
        total: 0,
        confirmed: 0,
        failed: 0,
        neutral: 0,
        accuracy: 0,
        avgPriceChange: 0,
      };
    }
    
    bySignalType[signalType].total += stat.count;
    bySignalType[signalType][reactionType as 'confirmed' | 'failed' | 'neutral'] = stat.count;
    bySignalType[signalType].avgPriceChange += stat.avgPriceChange * stat.count;
  }
  
  // Calculate accuracy
  for (const signalType of Object.keys(bySignalType)) {
    const data = bySignalType[signalType];
    if (data.total > 0) {
      data.accuracy = data.confirmed / (data.confirmed + data.failed) || 0;
      data.avgPriceChange = data.avgPriceChange / data.total;
    }
  }
  
  // Overall stats
  const totalReactions = await SignalReactionModel.countDocuments({
    computedAt: { $gte: since },
  });
  
  const confirmed = await SignalReactionModel.countDocuments({
    computedAt: { $gte: since },
    reactionType: 'confirmed',
  });
  
  const failed = await SignalReactionModel.countDocuments({
    computedAt: { $gte: since },
    reactionType: 'failed',
  });
  
  return {
    period: `${days}d`,
    total: totalReactions,
    confirmed,
    failed,
    neutral: totalReactions - confirmed - failed,
    overallAccuracy: confirmed / (confirmed + failed) || 0,
    bySignalType,
  };
}
