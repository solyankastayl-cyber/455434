/**
 * Outcome Snapshot Service (Block F - F0)
 * 
 * Фиксирует момент принятия решения системой
 * Вызывается из ranking_v2.service после bucket assignment
 */
import { OutcomeSnapshotModel } from './outcome_snapshot.model.js';
import { v4 as uuidv4 } from 'uuid';

export interface SnapshotInput {
  tokenAddress: string;
  symbol: string;
  chainId: number;
  
  // Decision
  bucket: 'BUY' | 'WATCH' | 'SELL';
  decisionScore: number;
  confidence: number;
  risk: number;
  
  // Context
  coverage: number;
  coverageLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  engineMode: 'rules_only' | 'rules_with_actors' | 'rules_with_engine' | 'rules_with_ml';
  
  // Signals
  activeSignals: string[];
  actorSignalScore?: number;
  dexFlowActive: boolean;
  whaleSignalsActive: boolean;
  conflictDetected: boolean;
  
  // Market data
  priceAtDecision: number;
  marketCapAtDecision: number;
  volumeAtDecision: number;
  
  // Optional
  rankingRunId?: string;
}

/**
 * Create outcome snapshot
 * Returns snapshot ID for future tracking
 */
export async function createOutcomeSnapshot(
  input: SnapshotInput
): Promise<string> {
  try {
    const snapshot = await OutcomeSnapshotModel.create({
      ...input,
      tokenAddress: input.tokenAddress.toLowerCase(),
      decidedAt: new Date(),
      tracked24h: false,
      tracked72h: false,
      tracked7d: false,
    });

    console.log(`[Outcome F0] Snapshot created: ${input.symbol} → ${input.bucket} (score: ${input.decisionScore.toFixed(0)})`);
    
    return snapshot._id.toString();
  } catch (error) {
    console.error('[Outcome F0] Failed to create snapshot:', error);
    throw error;
  }
}

/**
 * Get snapshots ready for tracking at specific window
 */
export async function getSnapshotsForTracking(
  windowHours: 24 | 72 | 168
): Promise<any[]> {
  const now = new Date();
  const windowMs = windowHours * 60 * 60 * 1000;
  const cutoffTime = new Date(now.getTime() - windowMs);
  
  // Determine which field to check
  let trackedField: string;
  if (windowHours === 24) trackedField = 'tracked24h';
  else if (windowHours === 72) trackedField = 'tracked72h';
  else trackedField = 'tracked7d';
  
  // Find snapshots that:
  // 1. Were decided before cutoff time
  // 2. Haven't been tracked for this window yet
  const snapshots = await OutcomeSnapshotModel.find({
    decidedAt: { $lte: cutoffTime },
    [trackedField]: false,
  })
    .sort({ decidedAt: 1 })
    .limit(100) // Process in batches
    .lean();
  
  return snapshots;
}

/**
 * Mark snapshot as tracked for specific window
 */
export async function markSnapshotTracked(
  snapshotId: string,
  windowHours: 24 | 72 | 168
): Promise<void> {
  let updateField: any = {};
  
  if (windowHours === 24) updateField.tracked24h = true;
  else if (windowHours === 72) updateField.tracked72h = true;
  else updateField.tracked7d = true;
  
  await OutcomeSnapshotModel.updateOne(
    { _id: snapshotId },
    { $set: updateField }
  );
}

/**
 * Get snapshot by ID
 */
export async function getSnapshot(snapshotId: string) {
  return OutcomeSnapshotModel.findById(snapshotId).lean();
}

/**
 * Get recent snapshots for analysis
 */
export async function getRecentSnapshots(
  limit = 100,
  bucket?: 'BUY' | 'WATCH' | 'SELL'
) {
  const filter: any = {};
  if (bucket) {
    filter.bucket = bucket;
  }
  
  return OutcomeSnapshotModel.find(filter)
    .sort({ decidedAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get snapshots for specific token
 */
export async function getTokenSnapshots(
  tokenAddress: string,
  limit = 20
) {
  return OutcomeSnapshotModel.find({
    tokenAddress: tokenAddress.toLowerCase(),
  })
    .sort({ decidedAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get snapshot statistics
 */
export async function getSnapshotStats() {
  const [total, byBucket, recentCount, pendingTracking] = await Promise.all([
    OutcomeSnapshotModel.countDocuments(),
    OutcomeSnapshotModel.aggregate([
      { $group: { _id: '$bucket', count: { $sum: 1 } } },
    ]),
    OutcomeSnapshotModel.countDocuments({
      decidedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }),
    OutcomeSnapshotModel.countDocuments({
      tracked7d: false,
      decidedAt: { $lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    }),
  ]);
  
  const bucketCounts = byBucket.reduce((acc: any, item: any) => {
    acc[item._id] = item.count;
    return acc;
  }, {});
  
  return {
    total,
    buckets: {
      BUY: bucketCounts.BUY || 0,
      WATCH: bucketCounts.WATCH || 0,
      SELL: bucketCounts.SELL || 0,
    },
    recent24h: recentCount,
    pendingTracking,
  };
}
