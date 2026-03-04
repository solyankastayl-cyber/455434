/**
 * Build Relations Job
 * Transforms transfers (L2) into aggregated relations (L3)
 * 
 * Key logic:
 * - Group transfers by (from, to, window)
 * - Calculate density score
 * - Upsert relation record
 * - Mark transfers as processed
 * 
 * This is what turns 1000 transfers into 1 "thick corridor"
 */
import { TransferModel, ITransfer } from '../core/transfers/transfers.model.js';
import { transfersRepository } from '../core/transfers/transfers.repository.js';
import { relationsRepository } from '../core/relations/relations.repository.js';
import { 
  RelationWindow, 
  RelationDirection, 
  WINDOW_DAYS 
} from '../core/relations/relations.model.js';

// Batch size for processing transfers
const BATCH_SIZE = 1000;

// Windows to build relations for
const WINDOWS: RelationWindow[] = ['1d', '7d', '30d'];

export interface BuildRelationsResult {
  processedTransfers: number;
  relationsCreated: number;
  relationsUpdated: number;
  duration: number;
}

/**
 * Group transfers by (from, to) pair
 */
interface TransferGroup {
  from: string;
  to: string;
  transfers: ITransfer[];
  interactionCount: number;
  volumeRaw: bigint;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * Get transfers within a time window
 */
function getWindowStart(window: RelationWindow): Date {
  const now = new Date();
  const days = WINDOW_DAYS[window];
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Group transfers by (from, to) pair
 */
function groupTransfers(transfers: ITransfer[]): Map<string, TransferGroup> {
  const groups = new Map<string, TransferGroup>();

  for (const t of transfers) {
    const key = `${t.from}:${t.to}`;

    if (!groups.has(key)) {
      groups.set(key, {
        from: t.from,
        to: t.to,
        transfers: [],
        interactionCount: 0,
        volumeRaw: 0n,
        firstSeenAt: t.timestamp,
        lastSeenAt: t.timestamp,
      });
    }

    const group = groups.get(key)!;
    group.transfers.push(t);
    group.interactionCount++;
    
    try {
      group.volumeRaw += BigInt(t.amountRaw);
    } catch {
      // Skip invalid amounts
    }

    if (t.timestamp < group.firstSeenAt) {
      group.firstSeenAt = t.timestamp;
    }
    if (t.timestamp > group.lastSeenAt) {
      group.lastSeenAt = t.timestamp;
    }
  }

  return groups;
}

/**
 * Determine direction based on bidirectional analysis
 */
function determineDirection(
  groups: Map<string, TransferGroup>,
  from: string,
  to: string
): RelationDirection {
  const forwardKey = `${from}:${to}`;
  const reverseKey = `${to}:${from}`;

  const hasForward = groups.has(forwardKey);
  const hasReverse = groups.has(reverseKey);

  if (hasForward && hasReverse) {
    return 'bi';
  }
  return 'out'; // Default to out since we're processing from->to
}

/**
 * Build relations from unprocessed transfers
 * Main job function
 */
export async function buildRelations(): Promise<BuildRelationsResult> {
  const startTime = Date.now();

  // Get unprocessed transfers
  const unprocessedTransfers = await transfersRepository.findUnprocessed(BATCH_SIZE);

  if (unprocessedTransfers.length === 0) {
    return {
      processedTransfers: 0,
      relationsCreated: 0,
      relationsUpdated: 0,
      duration: Date.now() - startTime,
    };
  }

  console.log(`[Build Relations] Processing ${unprocessedTransfers.length} transfers`);

  // Group transfers
  const groups = groupTransfers(unprocessedTransfers);

  console.log(`[Build Relations] Found ${groups.size} unique (from, to) pairs`);

  // Build relations for each window
  let totalCreated = 0;
  let totalUpdated = 0;

  for (const window of WINDOWS) {
    const windowStart = getWindowStart(window);

    // Prepare relations for this window
    const relationsToUpsert: Array<{
      from: string;
      to: string;
      chain: 'ethereum';
      window: RelationWindow;
      direction: RelationDirection;
      interactionCount: number;
      volumeRaw: string;
      firstSeenAt: Date;
      lastSeenAt: Date;
      source: 'erc20';
    }> = [];

    for (const [, group] of groups) {
      // Filter transfers within window
      const windowTransfers = group.transfers.filter(
        (t) => t.timestamp >= windowStart
      );

      if (windowTransfers.length === 0) continue;

      // Recalculate metrics for window
      let volumeRaw = 0n;
      let firstSeenAt = windowTransfers[0].timestamp;
      let lastSeenAt = windowTransfers[0].timestamp;

      for (const t of windowTransfers) {
        try {
          volumeRaw += BigInt(t.amountRaw);
        } catch {
          // Skip invalid
        }
        if (t.timestamp < firstSeenAt) firstSeenAt = t.timestamp;
        if (t.timestamp > lastSeenAt) lastSeenAt = t.timestamp;
      }

      relationsToUpsert.push({
        from: group.from,
        to: group.to,
        chain: 'ethereum',
        window,
        direction: determineDirection(groups, group.from, group.to),
        interactionCount: windowTransfers.length,
        volumeRaw: volumeRaw.toString(),
        firstSeenAt,
        lastSeenAt,
        source: 'erc20',
      });
    }

    // Bulk upsert relations
    if (relationsToUpsert.length > 0) {
      const result = await relationsRepository.bulkUpsert(relationsToUpsert);
      totalCreated += result.upsertedCount;
      totalUpdated += result.modifiedCount;

      console.log(
        `[Build Relations] Window ${window}: ${result.upsertedCount} created, ` +
        `${result.modifiedCount} updated`
      );
    }
  }

  // Mark transfers as processed
  const transferIds = unprocessedTransfers.map((t) => t._id.toString());
  await transfersRepository.markProcessed(transferIds);

  const duration = Date.now() - startTime;
  console.log(
    `[Build Relations] Processed ${unprocessedTransfers.length} transfers, ` +
    `${totalCreated} relations created, ${totalUpdated} updated (${duration}ms)`
  );

  return {
    processedTransfers: unprocessedTransfers.length,
    relationsCreated: totalCreated,
    relationsUpdated: totalUpdated,
    duration,
  };
}

/**
 * Rebuild all relations from scratch
 * Use with caution - resets all processed flags
 */
export async function rebuildAllRelations(): Promise<void> {
  console.log('[Build Relations] Starting full rebuild...');

  // Reset all transfers to unprocessed
  await TransferModel.updateMany(
    {},
    { $set: { processed: false, processedAt: null } }
  );

  // Process in batches
  let totalProcessed = 0;
  let hasMore = true;

  while (hasMore) {
    const result = await buildRelations();
    totalProcessed += result.processedTransfers;

    if (result.processedTransfers === 0) {
      hasMore = false;
    }

    // Small delay to avoid overwhelming the DB
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`[Build Relations] Full rebuild complete. Processed ${totalProcessed} transfers.`);
}

/**
 * Get build job status
 */
export async function getBuildRelationsStatus(): Promise<{
  unprocessedTransfers: number;
  totalRelations: number;
  byWindow: Record<string, number>;
}> {
  const [unprocessed, stats] = await Promise.all([
    TransferModel.countDocuments({ processed: false }),
    relationsRepository.getStats(),
  ]);

  return {
    unprocessedTransfers: unprocessed,
    totalRelations: stats.totalRelations,
    byWindow: stats.byWindow,
  };
}
