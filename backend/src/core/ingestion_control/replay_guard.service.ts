/**
 * Replay Guard Service (P0.1)
 * 
 * Manages idempotent block range processing.
 * Prevents duplicate processing, handles failures, enables recovery.
 */

import {
  ReplayGuardModel,
  IReplayGuardDocument,
  ReplayStatus,
  FailedRangeModel,
  IFailedRangeDocument
} from './replay_guard.model.js';

// ============================================
// Configuration
// ============================================

const CONFIG = {
  MAX_RETRY_COUNT: 3,
  RETRY_DELAY_MS: 60000,  // 1 minute between retries
  STALE_IN_PROGRESS_MS: 5 * 60 * 1000,  // 5 minutes = stale
  CLEANUP_AGE_DAYS: 7
};

// ============================================
// Begin/End Window Processing
// ============================================

/**
 * Begin processing a block window
 * Returns false if already processed or in progress
 */
export async function beginWindow(
  chain: string,
  fromBlock: number,
  toBlock: number,
  workerId?: string
): Promise<{ canProcess: boolean; reason?: string }> {
  const chainUpper = chain.toUpperCase();
  
  // Check if already processed
  const existing = await ReplayGuardModel.findOne({
    chain: chainUpper,
    fromBlock,
    toBlock
  });
  
  if (existing) {
    if (existing.status === 'DONE') {
      return { canProcess: false, reason: 'Already processed' };
    }
    
    if (existing.status === 'IN_PROGRESS') {
      // Check if stale
      const ageMs = Date.now() - existing.startedAt.getTime();
      if (ageMs < CONFIG.STALE_IN_PROGRESS_MS) {
        return { canProcess: false, reason: 'Currently in progress' };
      }
      // Stale - allow retry
      console.log(`[ReplayGuard] Stale in-progress entry for ${chainUpper} ${fromBlock}-${toBlock}, allowing retry`);
    }
    
    // FAILED or stale IN_PROGRESS - update for retry
    await ReplayGuardModel.updateOne(
      { chain: chainUpper, fromBlock, toBlock },
      {
        $set: {
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          workerId,
          error: undefined,
          finishedAt: undefined
        },
        $inc: { retryCount: 1 }
      }
    );
    
    return { canProcess: true };
  }
  
  // Create new entry
  try {
    await ReplayGuardModel.create({
      chain: chainUpper,
      fromBlock,
      toBlock,
      status: 'IN_PROGRESS',
      startedAt: new Date(),
      workerId,
      eventsFound: 0,
      eventsIngested: 0,
      retryCount: 0
    });
    
    return { canProcess: true };
  } catch (error: any) {
    // Duplicate key error = race condition
    if (error.code === 11000) {
      return { canProcess: false, reason: 'Race condition - another process started' };
    }
    throw error;
  }
}

/**
 * Mark window as successfully processed
 */
export async function markDone(
  chain: string,
  fromBlock: number,
  toBlock: number,
  stats: { eventsFound: number; eventsIngested: number }
): Promise<void> {
  const chainUpper = chain.toUpperCase();
  const finishedAt = new Date();
  
  const result = await ReplayGuardModel.findOneAndUpdate(
    { chain: chainUpper, fromBlock, toBlock },
    {
      $set: {
        status: 'DONE',
        eventsFound: stats.eventsFound,
        eventsIngested: stats.eventsIngested,
        finishedAt
      }
    },
    { new: true }
  );
  
  if (result) {
    const durationMs = finishedAt.getTime() - result.startedAt.getTime();
    await ReplayGuardModel.updateOne(
      { chain: chainUpper, fromBlock, toBlock },
      { $set: { durationMs } }
    );
  }
  
  // Remove from failed ranges if exists
  await FailedRangeModel.updateOne(
    { chain: chainUpper, fromBlock, toBlock },
    { $set: { resolved: true } }
  );
}

/**
 * Mark window as failed
 */
export async function markFailed(
  chain: string,
  fromBlock: number,
  toBlock: number,
  error: string
): Promise<void> {
  const chainUpper = chain.toUpperCase();
  
  await ReplayGuardModel.updateOne(
    { chain: chainUpper, fromBlock, toBlock },
    {
      $set: {
        status: 'FAILED',
        error,
        finishedAt: new Date()
      }
    }
  );
  
  // Record in failed ranges for retry
  await recordFailedRange(chainUpper, fromBlock, toBlock, error);
}

/**
 * Mark window as partially processed
 */
export async function markPartial(
  chain: string,
  fromBlock: number,
  toBlock: number,
  processedUpTo: number,
  error: string
): Promise<void> {
  const chainUpper = chain.toUpperCase();
  
  await ReplayGuardModel.updateOne(
    { chain: chainUpper, fromBlock, toBlock },
    {
      $set: {
        status: 'PARTIAL',
        error: `Processed up to block ${processedUpTo}: ${error}`,
        finishedAt: new Date()
      }
    }
  );
  
  // Record remaining range as failed
  if (processedUpTo < toBlock) {
    await recordFailedRange(chainUpper, processedUpTo + 1, toBlock, error);
  }
}

// ============================================
// Query Functions
// ============================================

/**
 * Check if a range has been processed
 */
export async function isProcessed(
  chain: string,
  fromBlock: number,
  toBlock: number
): Promise<boolean> {
  const entry = await ReplayGuardModel.findOne({
    chain: chain.toUpperCase(),
    fromBlock,
    toBlock,
    status: 'DONE'
  });
  
  return !!entry;
}

/**
 * Check if any part of a range overlaps with processed ranges
 */
export async function hasOverlap(
  chain: string,
  fromBlock: number,
  toBlock: number
): Promise<{ hasOverlap: boolean; overlappingRanges: Array<{ from: number; to: number }> }> {
  const chainUpper = chain.toUpperCase();
  
  // Find any ranges that overlap
  const overlapping = await ReplayGuardModel.find({
    chain: chainUpper,
    status: 'DONE',
    $or: [
      // Our range contains existing range
      { fromBlock: { $gte: fromBlock }, toBlock: { $lte: toBlock } },
      // Existing range contains our range
      { fromBlock: { $lte: fromBlock }, toBlock: { $gte: toBlock } },
      // Overlap at start
      { fromBlock: { $lt: fromBlock }, toBlock: { $gte: fromBlock, $lte: toBlock } },
      // Overlap at end
      { fromBlock: { $gte: fromBlock, $lte: toBlock }, toBlock: { $gt: toBlock } }
    ]
  }).lean();
  
  return {
    hasOverlap: overlapping.length > 0,
    overlappingRanges: overlapping.map(r => ({ from: r.fromBlock, to: r.toBlock }))
  };
}

/**
 * Get in-progress entries (for monitoring)
 */
export async function getInProgress(chain?: string): Promise<IReplayGuardDocument[]> {
  const query: any = { status: 'IN_PROGRESS' };
  if (chain) {
    query.chain = chain.toUpperCase();
  }
  
  return ReplayGuardModel.find(query).sort({ startedAt: -1 }).lean();
}

/**
 * Get recent entries for a chain
 */
export async function getRecentEntries(
  chain: string,
  limit: number = 100
): Promise<IReplayGuardDocument[]> {
  return ReplayGuardModel.find({ chain: chain.toUpperCase() })
    .sort({ fromBlock: -1 })
    .limit(limit)
    .lean();
}

// ============================================
// Failed Range Management
// ============================================

/**
 * Record a failed range for later retry
 */
async function recordFailedRange(
  chain: string,
  fromBlock: number,
  toBlock: number,
  reason: string
): Promise<void> {
  const chainUpper = chain.toUpperCase();
  
  await FailedRangeModel.findOneAndUpdate(
    { chain: chainUpper, fromBlock, toBlock },
    {
      $set: {
        reason,
        lastRetryAt: new Date(),
        nextRetryAt: new Date(Date.now() + CONFIG.RETRY_DELAY_MS),
        resolved: false
      },
      $inc: { retryCount: 1 },
      $setOnInsert: { chain: chainUpper, fromBlock, toBlock }
    },
    { upsert: true }
  );
}

/**
 * Get failed ranges ready for retry
 */
export async function getFailedRangesForRetry(
  chain?: string,
  limit: number = 10
): Promise<IFailedRangeDocument[]> {
  const query: any = {
    resolved: false,
    retryCount: { $lt: CONFIG.MAX_RETRY_COUNT },
    $or: [
      { nextRetryAt: { $lte: new Date() } },
      { nextRetryAt: { $exists: false } }
    ]
  };
  
  if (chain) {
    query.chain = chain.toUpperCase();
  }
  
  return FailedRangeModel.find(query)
    .sort({ retryCount: 1, fromBlock: 1 })
    .limit(limit)
    .lean();
}

/**
 * Get all unresolved failed ranges
 */
export async function getUnresolvedFailedRanges(chain?: string): Promise<IFailedRangeDocument[]> {
  const query: any = { resolved: false };
  if (chain) {
    query.chain = chain.toUpperCase();
  }
  
  return FailedRangeModel.find(query).sort({ fromBlock: 1 }).lean();
}

/**
 * Mark failed range as resolved
 */
export async function resolveFailedRange(
  chain: string,
  fromBlock: number,
  toBlock: number
): Promise<void> {
  await FailedRangeModel.updateOne(
    { chain: chain.toUpperCase(), fromBlock, toBlock },
    { $set: { resolved: true } }
  );
}

// ============================================
// Cleanup & Maintenance
// ============================================

/**
 * Clean up old entries
 */
export async function cleanupOldEntries(): Promise<{ deleted: number }> {
  const cutoffDate = new Date(Date.now() - CONFIG.CLEANUP_AGE_DAYS * 24 * 60 * 60 * 1000);
  
  const result = await ReplayGuardModel.deleteMany({
    status: 'DONE',
    finishedAt: { $lt: cutoffDate }
  });
  
  // Also clean resolved failed ranges
  await FailedRangeModel.deleteMany({
    resolved: true,
    lastRetryAt: { $lt: cutoffDate }
  });
  
  return { deleted: result.deletedCount };
}

/**
 * Reset stale in-progress entries
 */
export async function resetStaleEntries(): Promise<{ reset: number }> {
  const staleTime = new Date(Date.now() - CONFIG.STALE_IN_PROGRESS_MS);
  
  const result = await ReplayGuardModel.updateMany(
    { status: 'IN_PROGRESS', startedAt: { $lt: staleTime } },
    { $set: { status: 'FAILED', error: 'Stale - timed out' } }
  );
  
  return { reset: result.modifiedCount };
}

// ============================================
// Statistics
// ============================================

/**
 * Get replay guard statistics
 */
export async function getReplayStats(): Promise<{
  total: number;
  done: number;
  inProgress: number;
  failed: number;
  partial: number;
  failedRangesUnresolved: number;
}> {
  const [statusCounts, failedRanges] = await Promise.all([
    ReplayGuardModel.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    FailedRangeModel.countDocuments({ resolved: false })
  ]);
  
  const counts = statusCounts.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {} as Record<string, number>);
  
  return {
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    done: counts['DONE'] || 0,
    inProgress: counts['IN_PROGRESS'] || 0,
    failed: counts['FAILED'] || 0,
    partial: counts['PARTIAL'] || 0,
    failedRangesUnresolved: failedRanges
  };
}
