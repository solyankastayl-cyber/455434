/**
 * Bucket History Service (Block D - D3)
 * 
 * Manages bucket transition tracking and analysis
 */
import { BucketHistoryModel, BucketType, BucketChangeReason } from './bucket_history.model.js';
import { v4 as uuidv4 } from 'uuid';

export interface BucketTransition {
  tokenAddress: string;
  symbol: string;
  chainId: number;
  fromBucket: BucketType | null;
  toBucket: BucketType;
  reason: BucketChangeReason;
  compositeScore: number;
  confidence: number;
  risk: number;
  actorSignalScore?: number;
  conflictScore?: number;
  engineMode: 'rules_only' | 'rules_with_actors' | 'rules_with_ml';
  coverage: number;
}

/**
 * Record a bucket transition
 */
export async function recordBucketTransition(
  transition: BucketTransition
): Promise<void> {
  try {
    // Get previous transition to link
    const prevTransition = await BucketHistoryModel.findOne({
      tokenAddress: transition.tokenAddress,
      chainId: transition.chainId,
    }).sort({ timestamp: -1 }).lean();

    const transitionId = uuidv4();

    await BucketHistoryModel.create({
      ...transition,
      tokenAddress: transition.tokenAddress.toLowerCase(),
      timestamp: new Date(),
      transitionId,
      prevTransitionId: prevTransition?.transitionId,
    });

    console.log(`[Bucket History] ${transition.symbol}: ${transition.fromBucket || 'NEW'} → ${transition.toBucket} (${transition.reason})`);
  } catch (error) {
    console.error('[Bucket History] Failed to record transition:', error);
    // Don't throw - history is not critical for operation
  }
}

/**
 * Get bucket history for a token (by address or symbol)
 */
export async function getTokenBucketHistory(
  tokenIdentifier: string,
  limit = 20
) {
  // Try to find by address first, then by symbol
  const query = tokenIdentifier.startsWith('0x')
    ? { tokenAddress: tokenIdentifier.toLowerCase() }
    : { symbol: tokenIdentifier.toUpperCase() };
  
  const history = await BucketHistoryModel.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .select('-_id tokenAddress symbol fromBucket toBucket reason compositeScore confidence risk timestamp engineMode')
    .lean();

  return history;
}

/**
 * Detect if token is unstable (flipping too much)
 * C5.5 - Stability Penalty
 */
export async function detectBucketInstability(
  tokenAddress: string,
  windowHours = 24
): Promise<{
  isUnstable: boolean;
  flipsCount: number;
  penalty: number;
}> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  // Get recent transitions
  const transitions = await BucketHistoryModel.find({
    tokenAddress: tokenAddress.toLowerCase(),
    timestamp: { $gte: since },
  }).sort({ timestamp: 1 }).lean();

  if (transitions.length < 2) {
    return { isUnstable: false, flipsCount: 0, penalty: 0 };
  }

  // Count flips between BUY and WATCH (most critical)
  let flipsCount = 0;
  for (let i = 1; i < transitions.length; i++) {
    const prev = transitions[i - 1];
    const curr = transitions[i];

    // BUY ↔ WATCH flip
    if (
      (prev.toBucket === 'BUY' && curr.toBucket === 'WATCH') ||
      (prev.toBucket === 'WATCH' && curr.toBucket === 'BUY')
    ) {
      flipsCount++;
    }
  }

  // Determine if unstable
  const isUnstable = flipsCount >= 3;

  // Calculate penalty (progressive)
  let penalty = 0;
  if (flipsCount >= 5) {
    penalty = 15; // Heavy penalty
  } else if (flipsCount >= 3) {
    penalty = 10; // Moderate penalty
  }

  return { isUnstable, flipsCount, penalty };
}

/**
 * Get bucket change statistics
 * C5.1 - Bucket Change Detector
 */
export async function getBucketChangeStats(windowHours = 24) {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const transitions = await BucketHistoryModel.aggregate([
    { $match: { timestamp: { $gte: since }, fromBucket: { $ne: null } } },
    {
      $group: {
        _id: { from: '$fromBucket', to: '$toBucket' },
        count: { $sum: 1 },
        avgScore: { $avg: '$compositeScore' },
      },
    },
    { $sort: { count: -1 } },
  ]);

  // Format results
  const changes = transitions.map((t: any) => ({
    from: t._id.from,
    to: t._id.to,
    count: t.count,
    avgScore: Math.round(t.avgScore * 100) / 100,
  }));

  return {
    windowHours,
    totalChanges: changes.reduce((sum: number, c: any) => sum + c.count, 0),
    changes,
  };
}

/**
 * Get tokens that recently changed bucket
 */
export async function getRecentBucketChanges(
  limit = 20,
  sinceMinutes = 60
) {
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000);

  const changes = await BucketHistoryModel.find({
    timestamp: { $gte: since },
    fromBucket: { $ne: null }, // Exclude initial assignments
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .select('-_id symbol fromBucket toBucket reason compositeScore timestamp')
    .lean();

  return changes;
}

/**
 * Analyze bucket stability for all tokens
 */
export async function analyzeBucketStability() {
  const windowHours = 24;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  // Get all tokens with recent transitions
  const tokens = await BucketHistoryModel.distinct('tokenAddress', {
    timestamp: { $gte: since },
  });

  const unstableTokens = [];

  for (const tokenAddress of tokens) {
    const stability = await detectBucketInstability(tokenAddress, windowHours);
    
    if (stability.isUnstable) {
      const recentTransition = await BucketHistoryModel.findOne({
        tokenAddress,
      }).sort({ timestamp: -1 }).lean();

      unstableTokens.push({
        tokenAddress,
        symbol: recentTransition?.symbol,
        flipsCount: stability.flipsCount,
        penalty: stability.penalty,
      });
    }
  }

  return {
    totalAnalyzed: tokens.length,
    unstableCount: unstableTokens.length,
    unstableTokens,
  };
}
