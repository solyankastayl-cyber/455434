/**
 * Strategy Reliability Repository
 */
import {
  StrategyReliabilityModel,
  IStrategyReliability,
  STRATEGY_TYPES,
  BASE_STRATEGY_RELIABILITY,
  RELIABILITY_THRESHOLDS,
} from './strategy_reliability.model.js';

/**
 * Get or create reliability record
 */
export async function getOrCreateReliability(
  strategyType: string
): Promise<IStrategyReliability> {
  const existing = await StrategyReliabilityModel.findOne({ strategyType });
  
  if (existing) return existing;
  
  const baseReliability = BASE_STRATEGY_RELIABILITY[strategyType] || 0.5;
  
  const reliability = new StrategyReliabilityModel({
    strategyType,
    reliabilityScore: baseReliability,
    baseReliability,
    lastCalculatedAt: new Date(),
  });
  
  return reliability.save();
}

/**
 * Get reliability by strategy type
 */
export async function getReliability(
  strategyType: string
): Promise<IStrategyReliability | null> {
  return StrategyReliabilityModel
    .findOne({ strategyType })
    .lean() as unknown as Promise<IStrategyReliability | null>;
}

/**
 * Update reliability with new outcome
 */
export async function recordOutcome(
  strategyType: string,
  outcome: 'positive' | 'negative' | 'neutral',
  confidence: number
): Promise<IStrategyReliability | null> {
  const reliability = await StrategyReliabilityModel.findOne({ strategyType });
  
  if (!reliability) return null;
  
  // Update counters
  reliability.performance.totalDecisions += 1;
  
  switch (outcome) {
    case 'positive':
      reliability.performance.positiveOutcomes += 1;
      break;
    case 'negative':
      reliability.performance.negativeOutcomes += 1;
      break;
    case 'neutral':
      reliability.performance.neutralOutcomes += 1;
      break;
  }
  
  // Recalculate outcome rate
  const total = reliability.performance.totalDecisions;
  reliability.performance.outcomeRate = total > 0
    ? reliability.performance.positiveOutcomes / total
    : 0;
  
  // Update average confidence
  reliability.performance.avgConfidence = 
    ((total - 1) * reliability.performance.avgConfidence + confidence) / total;
  
  // Update actual accuracy
  const actuallyCorrect = outcome === 'positive' ? 1 : 0;
  reliability.performance.avgActualAccuracy = 
    ((total - 1) * reliability.performance.avgActualAccuracy + actuallyCorrect) / total;
  
  // Confidence-accuracy gap
  reliability.performance.confidenceAccuracyGap = 
    reliability.performance.avgConfidence - reliability.performance.avgActualAccuracy;
  
  reliability.sampleSize = total;
  
  await reliability.save();
  return reliability;
}

/**
 * Recalculate reliability score
 */
export async function recalculateReliability(
  strategyType: string
): Promise<IStrategyReliability | null> {
  const reliability = await StrategyReliabilityModel.findOne({ strategyType });
  
  if (!reliability) return null;
  
  const previousScore = reliability.reliabilityScore;
  const base = reliability.baseReliability;
  const perf = reliability.performance;
  
  // Calculate new reliability score
  // Components:
  // 1. Outcome rate (40%)
  // 2. Inverse of confidence-accuracy gap (30%)
  // 3. Consistency (30%)
  
  const outcomeComponent = perf.outcomeRate * 0.4;
  
  // Gap penalty (0 gap = 1.0, 0.5 gap = 0.5)
  const gapPenalty = Math.max(0, 1 - Math.abs(perf.confidenceAccuracyGap));
  const gapComponent = gapPenalty * 0.3;
  
  const consistencyComponent = perf.consistencyScore * 0.3;
  
  let newScore = outcomeComponent + gapComponent + consistencyComponent;
  
  // Blend with base reliability (more base if low sample size)
  const sampleWeight = Math.min(reliability.sampleSize / 50, 1);
  newScore = (1 - sampleWeight) * base + sampleWeight * newScore;
  
  // Clamp to [0, 1]
  newScore = Math.max(0, Math.min(1, newScore));
  
  // Determine trend
  const delta = newScore - previousScore;
  if (Math.abs(delta) < 0.02) {
    reliability.trend = 'stable';
    reliability.trendStrength = 0;
  } else if (delta > 0) {
    reliability.trend = 'improving';
    reliability.trendStrength = Math.min(1, delta * 10);
  } else {
    reliability.trend = 'declining';
    reliability.trendStrength = Math.min(1, Math.abs(delta) * 10);
  }
  
  reliability.reliabilityScore = newScore;
  
  // Update recommendations
  reliability.recommendedForCopy = newScore >= RELIABILITY_THRESHOLDS.copyRecommended;
  reliability.recommendedForFollow = newScore >= RELIABILITY_THRESHOLDS.followRecommended;
  
  // Warning flags
  const warnings: string[] = [];
  
  if (perf.volatilityScore >= RELIABILITY_THRESHOLDS.warningVolatility) {
    warnings.push('high_volatility');
  }
  
  if (reliability.trend === 'declining' && reliability.trendStrength >= RELIABILITY_THRESHOLDS.warningDecline) {
    warnings.push('declining_trend');
  }
  
  if (Math.abs(perf.confidenceAccuracyGap) > 0.2) {
    warnings.push('confidence_mismatch');
  }
  
  if (reliability.sampleSize < 10) {
    warnings.push('low_sample_size');
  }
  
  reliability.warningFlags = warnings;
  reliability.lastCalculatedAt = new Date();
  
  await reliability.save();
  return reliability;
}

/**
 * Get all reliability records
 */
export async function getAllReliability(): Promise<IStrategyReliability[]> {
  return StrategyReliabilityModel
    .find()
    .sort({ reliabilityScore: -1 })
    .lean() as unknown as Promise<IStrategyReliability[]>;
}

/**
 * Get strategies recommended for copy
 */
export async function getCopyRecommended(): Promise<IStrategyReliability[]> {
  return StrategyReliabilityModel
    .find({ recommendedForCopy: true })
    .sort({ reliabilityScore: -1 })
    .lean() as unknown as Promise<IStrategyReliability[]>;
}

/**
 * Get strategies with warnings
 */
export async function getStrategiesWithWarnings(): Promise<IStrategyReliability[]> {
  return StrategyReliabilityModel
    .find({ warningFlags: { $ne: [] } })
    .sort({ reliabilityScore: 1 })
    .lean() as unknown as Promise<IStrategyReliability[]>;
}

/**
 * Initialize all strategy types
 */
export async function initializeAllStrategies(): Promise<void> {
  for (const strategyType of STRATEGY_TYPES) {
    await getOrCreateReliability(strategyType);
  }
}

/**
 * Get reliability stats
 */
export async function getReliabilityStats(): Promise<{
  total: number;
  avgReliability: number;
  copyRecommendedCount: number;
  followRecommendedCount: number;
  withWarnings: number;
  byTrend: Record<string, number>;
}> {
  const [total, avgAgg, countsAgg, trendAgg] = await Promise.all([
    StrategyReliabilityModel.countDocuments(),
    StrategyReliabilityModel.aggregate([
      { $group: { _id: null, avg: { $avg: '$reliabilityScore' } } },
    ]),
    StrategyReliabilityModel.aggregate([
      {
        $group: {
          _id: null,
          copyRec: { $sum: { $cond: ['$recommendedForCopy', 1, 0] } },
          followRec: { $sum: { $cond: ['$recommendedForFollow', 1, 0] } },
          withWarn: { $sum: { $cond: [{ $gt: [{ $size: '$warningFlags' }, 0] }, 1, 0] } },
        },
      },
    ]),
    StrategyReliabilityModel.aggregate([
      { $group: { _id: '$trend', count: { $sum: 1 } } },
    ]),
  ]);
  
  const byTrend: Record<string, number> = {};
  for (const item of trendAgg) byTrend[item._id] = item.count;
  
  return {
    total,
    avgReliability: avgAgg[0]?.avg || 0,
    copyRecommendedCount: countsAgg[0]?.copyRec || 0,
    followRecommendedCount: countsAgg[0]?.followRec || 0,
    withWarnings: countsAgg[0]?.withWarn || 0,
    byTrend,
  };
}
