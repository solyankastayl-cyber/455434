/**
 * Build Transfers Job
 * Transforms raw ERC-20 logs into normalized transfers
 * 
 * Key principle: ONE log = ONE transfer (no aggregations)
 * 
 * This job:
 * 1. Reads unprocessed ERC-20 logs
 * 2. Creates normalized transfer records
 * 3. Marks logs as processed
 */
import { ERC20LogModel, IERC20Log } from '../onchain/ethereum/logs_erc20.model.js';
import { SyncStateModel } from '../onchain/ethereum/sync_state.model.js';
import { transfersRepository } from '../core/transfers/transfers.repository.js';

// Sync key for build transfers job
const SYNC_KEY = 'build_transfers_erc20';

// Batch size for processing
const BATCH_SIZE = 500;

export interface BuildResult {
  processed: number;
  created: number;
  skipped: number;
  duration: number;
  lastBlockProcessed: number | null;
}

/**
 * Get last processed block for this job
 */
async function getLastProcessedBlock(): Promise<number> {
  const state = await SyncStateModel.findOne({ key: SYNC_KEY });
  return state?.lastBlock || 0;
}

/**
 * Update last processed block
 */
async function updateLastProcessedBlock(blockNumber: number): Promise<void> {
  await SyncStateModel.updateOne(
    { key: SYNC_KEY },
    { $set: { lastBlock: blockNumber, lastProcessedAt: new Date() } },
    { upsert: true }
  );
}

/**
 * Transform ERC-20 log to normalized transfer
 */
function transformLog(log: IERC20Log) {
  return {
    txHash: log.txHash.toLowerCase(),
    logIndex: log.logIndex,
    blockNumber: log.blockNumber,
    timestamp: log.blockTimestamp || log.createdAt,
    from: log.from.toLowerCase(),
    to: log.to.toLowerCase(),
    assetType: 'erc20' as const,
    assetAddress: log.token.toLowerCase(),
    amountRaw: log.amount,
    amountNormalized: null as number | null, // Will be set when decimals are known
    chain: 'ethereum' as const,
    source: 'erc20_log' as const,
    sourceId: `${log.txHash.toLowerCase()}:${log.logIndex}`,
  };
}

/**
 * Build transfers from ERC-20 logs
 * Main job function - call periodically
 */
export async function buildTransfersFromERC20(): Promise<BuildResult> {
  const startTime = Date.now();

  // Get last processed block
  const lastProcessedBlock = await getLastProcessedBlock();

  // Find unprocessed logs (blocks after last processed)
  const logs = await ERC20LogModel.find({
    blockNumber: { $gt: lastProcessedBlock },
  })
    .sort({ blockNumber: 1, logIndex: 1 })
    .limit(BATCH_SIZE)
    .lean<IERC20Log[]>();

  if (logs.length === 0) {
    return {
      processed: 0,
      created: 0,
      skipped: 0,
      duration: Date.now() - startTime,
      lastBlockProcessed: lastProcessedBlock,
    };
  }

  console.log(`[Build Transfers] Processing ${logs.length} ERC-20 logs from block ${logs[0].blockNumber}`);

  // Transform logs to transfers
  const transfers = logs.map(transformLog);

  // Bulk upsert transfers
  const result = await transfersRepository.bulkUpsert(transfers);

  // Update last processed block (max block in this batch)
  const maxBlock = Math.max(...logs.map((l) => l.blockNumber));
  await updateLastProcessedBlock(maxBlock);

  const duration = Date.now() - startTime;
  console.log(
    `[Build Transfers] Processed ${logs.length} logs, created ${result.insertedCount} transfers in ${duration}ms`
  );

  return {
    processed: logs.length,
    created: result.insertedCount,
    skipped: logs.length - result.insertedCount,
    duration,
    lastBlockProcessed: maxBlock,
  };
}

/**
 * Get build job status
 */
export async function getBuildStatus(): Promise<{
  lastProcessedBlock: number;
  pendingLogs: number;
  totalTransfers: number;
}> {
  const lastProcessedBlock = await getLastProcessedBlock();

  const [pendingLogs, totalTransfers] = await Promise.all([
    ERC20LogModel.countDocuments({ blockNumber: { $gt: lastProcessedBlock } }),
    transfersRepository.getStats().then((s) => s.totalTransfers),
  ]);

  return {
    lastProcessedBlock,
    pendingLogs,
    totalTransfers,
  };
}

/**
 * Reset build job (for debugging)
 */
export async function resetBuildJob(): Promise<void> {
  await SyncStateModel.deleteOne({ key: SYNC_KEY });
}
