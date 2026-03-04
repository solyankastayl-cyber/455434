/**
 * Feedback Repository
 */
import {
  FeedbackModel,
  IFeedback,
  FeedbackType,
  FeedbackRating,
  FeedbackOutcome,
} from './feedback.model.js';

export interface CreateFeedbackInput {
  feedbackType: FeedbackType;
  sourceId: string;
  targetType: 'actor' | 'strategy' | 'signal';
  targetId: string;
  userId: string;
  rating?: FeedbackRating;
  outcome?: FeedbackOutcome;
  helpful?: boolean;
  accurate?: boolean;
  timely?: boolean;
  comments?: string;
  tags?: string[];
  context?: IFeedback['context'];
}

export interface UpdateFeedbackInput {
  rating?: FeedbackRating;
  outcome?: FeedbackOutcome;
  helpful?: boolean;
  accurate?: boolean;
  timely?: boolean;
  comments?: string;
  tags?: string[];
}

/**
 * Create or update feedback
 */
export async function upsertFeedback(input: CreateFeedbackInput): Promise<IFeedback> {
  const existing = await FeedbackModel.findOne({
    sourceId: input.sourceId,
    userId: input.userId,
  });
  
  if (existing) {
    return FeedbackModel.findByIdAndUpdate(
      existing._id,
      {
        $set: {
          rating: input.rating ?? existing.rating,
          outcome: input.outcome ?? existing.outcome,
          helpful: input.helpful ?? existing.helpful,
          accurate: input.accurate ?? existing.accurate,
          timely: input.timely ?? existing.timely,
          comments: input.comments ?? existing.comments,
          tags: input.tags ?? existing.tags,
        },
      },
      { new: true }
    ).lean() as Promise<IFeedback>;
  }
  
  const feedback = new FeedbackModel({
    ...input,
    targetId: input.targetId.toLowerCase(),
  });
  
  return feedback.save();
}

/**
 * Get feedback by source
 */
export async function getFeedbackBySource(
  sourceId: string,
  userId?: string
): Promise<IFeedback | null> {
  const query: Record<string, unknown> = { sourceId };
  if (userId) query.userId = userId;
  
  return FeedbackModel.findOne(query).lean();
}

/**
 * Get user feedback history
 */
export async function getUserFeedbackHistory(
  userId: string,
  limit: number = 50
): Promise<IFeedback[]> {
  return FeedbackModel
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get feedback for target
 */
export async function getFeedbackForTarget(
  targetId: string,
  limit: number = 100
): Promise<IFeedback[]> {
  return FeedbackModel
    .find({ targetId: targetId.toLowerCase() })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get feedback by outcome
 */
export async function getFeedbackByOutcome(
  outcome: FeedbackOutcome,
  limit: number = 100
): Promise<IFeedback[]> {
  return FeedbackModel
    .find({ outcome })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get aggregate feedback metrics for target
 */
export async function getTargetFeedbackMetrics(targetId: string): Promise<{
  totalFeedback: number;
  avgRating: number;
  helpfulRate: number;
  accuracyRate: number;
  outcomeDistribution: Record<string, number>;
  topTags: { tag: string; count: number }[];
}> {
  const addr = targetId.toLowerCase();
  
  const [count, ratings, booleans, outcomes, tags] = await Promise.all([
    FeedbackModel.countDocuments({ targetId: addr }),
    FeedbackModel.aggregate([
      { $match: { targetId: addr, rating: { $exists: true } } },
      { $group: { _id: null, avg: { $avg: '$rating' } } },
    ]),
    FeedbackModel.aggregate([
      { $match: { targetId: addr } },
      {
        $group: {
          _id: null,
          helpfulCount: { $sum: { $cond: ['$helpful', 1, 0] } },
          helpfulTotal: { $sum: { $cond: [{ $ifNull: ['$helpful', false] }, 1, 0] } },
          accurateCount: { $sum: { $cond: ['$accurate', 1, 0] } },
          accurateTotal: { $sum: { $cond: [{ $ifNull: ['$accurate', false] }, 1, 0] } },
        },
      },
    ]),
    FeedbackModel.aggregate([
      { $match: { targetId: addr } },
      { $group: { _id: '$outcome', count: { $sum: 1 } } },
    ]),
    FeedbackModel.aggregate([
      { $match: { targetId: addr } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);
  
  const avgRating = ratings[0]?.avg || 0;
  const helpfulRate = booleans[0]?.helpfulTotal > 0
    ? (booleans[0].helpfulCount / booleans[0].helpfulTotal) * 100
    : 0;
  const accuracyRate = booleans[0]?.accurateTotal > 0
    ? (booleans[0].accurateCount / booleans[0].accurateTotal) * 100
    : 0;
  
  const outcomeDistribution: Record<string, number> = {};
  for (const item of outcomes) outcomeDistribution[item._id] = item.count;
  
  const topTags = tags.map(t => ({ tag: t._id, count: t.count }));
  
  return {
    totalFeedback: count,
    avgRating,
    helpfulRate,
    accuracyRate,
    outcomeDistribution,
    topTags,
  };
}

/**
 * Get global feedback stats
 */
export async function getFeedbackStats(): Promise<{
  total: number;
  avgRating: number;
  followedRate: number;
  byType: Record<string, number>;
  byOutcome: Record<string, number>;
  recentCount: number;
}> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const [total, ratings, followed, byTypeAgg, byOutcomeAgg, recent] = await Promise.all([
    FeedbackModel.countDocuments(),
    FeedbackModel.aggregate([
      { $match: { rating: { $exists: true } } },
      { $group: { _id: null, avg: { $avg: '$rating' } } },
    ]),
    FeedbackModel.aggregate([
      {
        $group: {
          _id: null,
          followedCount: { $sum: { $cond: [{ $eq: ['$outcome', 'followed'] }, 1, 0] } },
          totalWithOutcome: { $sum: { $cond: [{ $ne: ['$outcome', 'pending'] }, 1, 0] } },
        },
      },
    ]),
    FeedbackModel.aggregate([
      { $group: { _id: '$feedbackType', count: { $sum: 1 } } },
    ]),
    FeedbackModel.aggregate([
      { $group: { _id: '$outcome', count: { $sum: 1 } } },
    ]),
    FeedbackModel.countDocuments({ createdAt: { $gt: dayAgo } }),
  ]);
  
  const avgRating = ratings[0]?.avg || 0;
  const followedRate = followed[0]?.totalWithOutcome > 0
    ? (followed[0].followedCount / followed[0].totalWithOutcome) * 100
    : 0;
  
  const byType: Record<string, number> = {};
  for (const item of byTypeAgg) byType[item._id] = item.count;
  
  const byOutcome: Record<string, number> = {};
  for (const item of byOutcomeAgg) byOutcome[item._id] = item.count;
  
  return {
    total,
    avgRating,
    followedRate,
    byType,
    byOutcome,
    recentCount: recent,
  };
}
