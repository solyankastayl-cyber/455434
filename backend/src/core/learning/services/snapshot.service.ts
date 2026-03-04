/**
 * Snapshot Service
 * 
 * Creates PredictionSnapshot from ranking decisions.
 * Called after successful ranking compute.
 * 
 * IMMUTABLE snapshots - created once, never modified.
 */
import { PredictionSnapshotModel, type IPredictionSnapshot } from '../models/PredictionSnapshot.model.js';
import { LiveDriftSummaryModel } from '../../live/drift/models/liveDriftSummary.model.js';
import { v4 as uuidv4 } from 'uuid';
import type { Bucket, DriftLevel } from '../learning.types.js';

// ==================== TYPES ====================

export interface RankingInput {
  tokenAddress: string;
  tokenSymbol: string;
  bucket: Bucket;
  score: number;
  confidence: number;
  risk?: number;
  price: number;
  volume?: number;
  marketCap?: number;
  actorSignalScore?: number;
}

export interface SnapshotResult {
  created: boolean;
  snapshotId: string;
  alreadyExists?: boolean;
}

// ==================== SNAPSHOT CREATION ====================

/**
 * Generate unique snapshot ID
 */
function generateSnapshotId(tokenAddress: string, decidedAt: Date): string {
  const dateStr = decidedAt.toISOString().slice(0, 10).replace(/-/g, '');
  const hourStr = decidedAt.getUTCHours().toString().padStart(2, '0');
  return `${tokenAddress.slice(0, 10)}_${dateStr}_${hourStr}_${uuidv4().slice(0, 8)}`;
}

/**
 * Get latest drift for token
 */
async function getLatestDrift(tokenAddress: string): Promise<{ level: DriftLevel; score: number }> {
  const drift = await LiveDriftSummaryModel.findOne({
    tokenAddress: tokenAddress.toLowerCase(),
  })
    .sort({ computedAt: -1 })
    .lean();
  
  if (!drift) {
    return { level: 'LOW', score: 0 };
  }
  
  return {
    level: drift.level as DriftLevel,
    score: drift.drift.composite,
  };
}

/**
 * Create a prediction snapshot from ranking result
 */
export async function createSnapshot(input: RankingInput): Promise<SnapshotResult> {
  const decidedAt = new Date();
  const snapshotId = generateSnapshotId(input.tokenAddress, decidedAt);
  
  // Check if recent snapshot exists (within 1 hour)
  const oneHourAgo = new Date(decidedAt.getTime() - 60 * 60 * 1000);
  const existingSnapshot = await PredictionSnapshotModel.findOne({
    'token.address': input.tokenAddress.toLowerCase(),
    decidedAt: { $gte: oneHourAgo },
  });
  
  if (existingSnapshot) {
    return {
      created: false,
      snapshotId: existingSnapshot.snapshotId,
      alreadyExists: true,
    };
  }
  
  // Get drift context
  const drift = await getLatestDrift(input.tokenAddress);
  
  // Create snapshot
  await PredictionSnapshotModel.create({
    snapshotId,
    token: {
      address: input.tokenAddress.toLowerCase(),
      symbol: input.tokenSymbol,
    },
    decision: {
      bucket: input.bucket,
      score: input.score,
      confidence: input.confidence,
      risk: input.risk || 0,
    },
    engineContext: {
      engineVersion: 'v2',
      engineMode: 'rules_with_actors',
      actorSignalScore: input.actorSignalScore || 0,
    },
    liveContext: {
      driftLevel: drift.level,
      driftScore: drift.score,
    },
    market: {
      priceAtDecision: input.price,
      volumeAtDecision: input.volume || 0,
      marketCapAtDecision: input.marketCap,
    },
    decidedAt,
    createdAt: new Date(),
  });
  
  return {
    created: true,
    snapshotId,
  };
}

/**
 * Create snapshots for multiple rankings (batch)
 */
export async function createSnapshotsBatch(inputs: RankingInput[]): Promise<{
  created: number;
  skipped: number;
  snapshots: SnapshotResult[];
}> {
  const results: SnapshotResult[] = [];
  let created = 0;
  let skipped = 0;
  
  for (const input of inputs) {
    const result = await createSnapshot(input);
    results.push(result);
    
    if (result.created) {
      created++;
    } else {
      skipped++;
    }
  }
  
  return { created, skipped, snapshots: results };
}

// ==================== QUERY ====================

/**
 * Get snapshots pending outcomes
 */
export async function getSnapshotsPendingOutcomes(limit: number = 100): Promise<IPredictionSnapshot[]> {
  // Find snapshots without full outcomes
  const snapshots = await PredictionSnapshotModel.find({})
    .sort({ decidedAt: -1 })
    .limit(limit)
    .lean();
  
  return snapshots;
}

/**
 * Get snapshot by ID
 */
export async function getSnapshotById(snapshotId: string): Promise<IPredictionSnapshot | null> {
  return PredictionSnapshotModel.findOne({ snapshotId }).lean();
}

/**
 * Get snapshots by token
 */
export async function getSnapshotsByToken(
  tokenAddress: string,
  limit: number = 50
): Promise<IPredictionSnapshot[]> {
  return PredictionSnapshotModel.find({
    'token.address': tokenAddress.toLowerCase(),
  })
    .sort({ decidedAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get snapshot statistics
 */
export async function getSnapshotStats(): Promise<{
  total: number;
  byBucket: Record<string, number>;
  last24h: number;
  last7d: number;
}> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const [total, bucketCounts, last24h, last7d] = await Promise.all([
    PredictionSnapshotModel.countDocuments(),
    PredictionSnapshotModel.aggregate([
      { $group: { _id: '$decision.bucket', count: { $sum: 1 } } },
    ]),
    PredictionSnapshotModel.countDocuments({ decidedAt: { $gte: twentyFourHoursAgo } }),
    PredictionSnapshotModel.countDocuments({ decidedAt: { $gte: sevenDaysAgo } }),
  ]);
  
  const byBucket: Record<string, number> = { BUY: 0, WATCH: 0, SELL: 0 };
  bucketCounts.forEach(b => {
    if (b._id in byBucket) {
      byBucket[b._id] = b.count;
    }
  });
  
  return { total, byBucket, last24h, last7d };
}
