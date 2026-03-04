/**
 * Trust Repository
 */
import {
  TrustModel,
  ITrust,
  TrustLevel,
  getTrustLevel,
  TRUST_VALIDITY_HOURS,
} from './trust.model.js';

export interface UpdateTrustInput {
  subjectType: 'decision_type' | 'actor' | 'strategy' | 'system';
  subjectId: string;
  components: ITrust['components'];
  stats: ITrust['stats'];
}

/**
 * Calculate trust score from components
 */
function calculateTrustScore(components: ITrust['components']): number {
  // Weighted average
  const weights = {
    accuracyScore: 0.4,
    consistencyScore: 0.2,
    timelinessScore: 0.15,
    feedbackScore: 0.25,
  };
  
  return (
    components.accuracyScore * weights.accuracyScore +
    components.consistencyScore * weights.consistencyScore +
    components.timelinessScore * weights.timelinessScore +
    components.feedbackScore * weights.feedbackScore
  );
}

/**
 * Calculate confidence interval
 */
function calculateConfidence(
  score: number,
  sampleSize: number
): ITrust['confidence'] {
  // Simple confidence interval based on sample size
  const baseMargin = 20;
  const marginReduction = Math.min(sampleSize / 100, 0.8);
  const margin = baseMargin * (1 - marginReduction);
  
  return {
    lower: Math.max(0, score - margin),
    upper: Math.min(100, score + margin),
    level: 0.95,
  };
}

/**
 * Determine trend
 */
function determineTrend(
  currentScore: number,
  previousScore?: number
): 'improving' | 'stable' | 'declining' {
  if (!previousScore) return 'stable';
  
  const diff = currentScore - previousScore;
  if (diff > 5) return 'improving';
  if (diff < -5) return 'declining';
  return 'stable';
}

/**
 * Update or create trust record
 */
export async function upsertTrust(input: UpdateTrustInput): Promise<ITrust> {
  const existing = await TrustModel.findOne({
    subjectType: input.subjectType,
    subjectId: input.subjectId.toLowerCase(),
  });
  
  const trustScore = calculateTrustScore(input.components);
  const trustLevel = getTrustLevel(trustScore);
  const confidence = calculateConfidence(trustScore, input.stats.sampleSize);
  const trend = determineTrend(trustScore, existing?.trustScore);
  
  const validUntil = new Date(Date.now() + TRUST_VALIDITY_HOURS * 60 * 60 * 1000);
  
  if (existing) {
    return TrustModel.findByIdAndUpdate(
      existing._id,
      {
        $set: {
          trustScore,
          trustLevel,
          components: input.components,
          stats: input.stats,
          trend,
          previousScore: existing.trustScore,
          confidence,
          calculatedAt: new Date(),
          validUntil,
        },
      },
      { new: true }
    ).lean() as Promise<ITrust>;
  }
  
  const trust = new TrustModel({
    subjectType: input.subjectType,
    subjectId: input.subjectId.toLowerCase(),
    trustScore,
    trustLevel,
    components: input.components,
    stats: input.stats,
    trend,
    confidence,
    calculatedAt: new Date(),
    validUntil,
  });
  
  return trust.save();
}

/**
 * Get trust by subject
 */
export async function getTrust(
  subjectType: string,
  subjectId: string
): Promise<ITrust | null> {
  return TrustModel.findOne({
    subjectType,
    subjectId: subjectId.toLowerCase(),
  }).lean();
}

/**
 * Get system trust (global)
 */
export async function getSystemTrust(): Promise<ITrust | null> {
  return TrustModel.findOne({
    subjectType: 'system',
    subjectId: 'global',
  }).lean();
}

/**
 * Get trust by decision type
 */
export async function getTrustByDecisionType(
  decisionType: string
): Promise<ITrust | null> {
  return TrustModel.findOne({
    subjectType: 'decision_type',
    subjectId: decisionType.toLowerCase(),
  }).lean();
}

/**
 * Get all trust records by type
 */
export async function getTrustByType(
  subjectType: string,
  limit: number = 100
): Promise<ITrust[]> {
  return TrustModel
    .find({ subjectType })
    .sort({ trustScore: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get high trust actors
 */
export async function getHighTrustActors(limit: number = 50): Promise<ITrust[]> {
  return TrustModel
    .find({
      subjectType: 'actor',
      trustLevel: { $in: ['high', 'very_high'] },
    })
    .sort({ trustScore: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get trust stats
 */
export async function getTrustStats(): Promise<{
  total: number;
  byLevel: Record<TrustLevel, number>;
  byType: Record<string, number>;
  avgScore: number;
  improving: number;
  declining: number;
}> {
  const [total, byLevelAgg, byTypeAgg, avgAgg, trendAgg] = await Promise.all([
    TrustModel.countDocuments(),
    TrustModel.aggregate([
      { $group: { _id: '$trustLevel', count: { $sum: 1 } } },
    ]),
    TrustModel.aggregate([
      { $group: { _id: '$subjectType', count: { $sum: 1 } } },
    ]),
    TrustModel.aggregate([
      { $group: { _id: null, avg: { $avg: '$trustScore' } } },
    ]),
    TrustModel.aggregate([
      { $group: { _id: '$trend', count: { $sum: 1 } } },
    ]),
  ]);
  
  const byLevel: Record<TrustLevel, number> = {
    'low': 0,
    'medium': 0,
    'high': 0,
    'very_high': 0,
  };
  for (const item of byLevelAgg) byLevel[item._id as TrustLevel] = item.count;
  
  const byType: Record<string, number> = {};
  for (const item of byTypeAgg) byType[item._id] = item.count;
  
  const trends: Record<string, number> = {};
  for (const item of trendAgg) trends[item._id] = item.count;
  
  return {
    total,
    byLevel,
    byType,
    avgScore: avgAgg[0]?.avg || 0,
    improving: trends['improving'] || 0,
    declining: trends['declining'] || 0,
  };
}
