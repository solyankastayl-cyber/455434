/**
 * ERC-20 Transfer Indexer
 * Fetches and stores ERC-20 Transfer events from Ethereum
 * 
 * Transfer event signature:
 * Transfer(address indexed from, address indexed to, uint256 value)
 * Topic0: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
 */
import { EthereumRpc, EthLog } from './ethereum.rpc.js';
import { ERC20LogModel } from './logs_erc20.model.js';
import { SyncStateModel } from './sync_state.model.js';

// ERC-20 Transfer event topic
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Sync key for ERC-20 transfers
const SYNC_KEY = 'erc20_transfers';

// Maximum blocks to fetch per batch (reduced for public RPC limits)
const MAX_BLOCKS_PER_BATCH = 10;

// Default start block (recent blocks to avoid huge initial sync)
const DEFAULT_START_OFFSET = 50; // Start 50 blocks behind current

export interface SyncResult {
  fromBlock: number;
  toBlock: number;
  logsCount: number;
  newLogsCount: number;
  duration: number;
}

/**
 * Parse ERC-20 Transfer log
 */
function parseTransferLog(log: EthLog): {
  token: string;
  from: string;
  to: string;
  amount: string;
} | null {
  // Validate log has required topics for ERC20 Transfer
  if (!log.topics || log.topics.length < 3) {
    return null;
  }

  // Topic[0] = Transfer signature
  // Topic[1] = from address (padded to 32 bytes)
  // Topic[2] = to address (padded to 32 bytes)
  // Data = amount (uint256)

  const from = '0x' + log.topics[1].slice(26).toLowerCase();
  const to = '0x' + log.topics[2].slice(26).toLowerCase();
  const token = log.address.toLowerCase();
  
  // Parse amount from data (handle empty or zero data)
  let amount = '0';
  if (log.data && log.data !== '0x' && log.data !== '0x0') {
    try {
      amount = BigInt(log.data).toString();
    } catch {
      amount = '0';
    }
  }

  return { token, from, to, amount };
}

/**
 * Get or create sync state
 */
async function getSyncState(rpc: EthereumRpc): Promise<{ lastBlock: number; isNew: boolean }> {
  const state = await SyncStateModel.findOne({ key: SYNC_KEY });
  
  if (state) {
    return { lastBlock: state.lastBlock, isNew: false };
  }

  // Create new state starting from recent blocks
  const currentBlock = await rpc.getBlockNumber();
  const startBlock = Math.max(0, currentBlock - DEFAULT_START_OFFSET);
  
  await SyncStateModel.create({
    key: SYNC_KEY,
    lastBlock: startBlock,
    metadata: { startedAt: new Date(), initialBlock: startBlock },
  });

  return { lastBlock: startBlock, isNew: true };
}

/**
 * Update sync state
 */
async function updateSyncState(lastBlock: number): Promise<void> {
  await SyncStateModel.updateOne(
    { key: SYNC_KEY },
    { 
      $set: { 
        lastBlock,
        lastProcessedAt: new Date(),
      } 
    }
  );
}

/**
 * Sync ERC-20 Transfer events
 * Main indexer function - call periodically
 */
export async function syncERC20Transfers(rpc: EthereumRpc): Promise<SyncResult> {
  const startTime = Date.now();

  // Get current progress
  const { lastBlock: syncedBlock } = await getSyncState(rpc);
  const latestBlock = await rpc.getBlockNumber();

  // Calculate block range
  const fromBlock = syncedBlock + 1;
  let toBlock = Math.min(fromBlock + MAX_BLOCKS_PER_BATCH - 1, latestBlock);

  // Nothing to sync
  if (fromBlock > latestBlock) {
    return {
      fromBlock,
      toBlock: syncedBlock,
      logsCount: 0,
      newLogsCount: 0,
      duration: Date.now() - startTime,
    };
  }

  console.log(`[ERC20 Indexer] Syncing blocks ${fromBlock} to ${toBlock} (${toBlock - fromBlock + 1} blocks)`);

  // Fetch Transfer logs with adaptive batch size
  let logs: EthLog[] = [];
  let currentToBlock = toBlock;
  let attempts = 0;
  const MAX_ATTEMPTS = 5;

  while (attempts < MAX_ATTEMPTS) {
    try {
      logs = await rpc.getLogs({
        fromBlock: '0x' + fromBlock.toString(16),
        toBlock: '0x' + currentToBlock.toString(16),
        topics: [TRANSFER_TOPIC],
      });
      toBlock = currentToBlock;
      break;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      
      // If too many results, reduce batch size
      if (errorMessage.includes('10000 results') || errorMessage.includes('-32005')) {
        const newRange = Math.floor((currentToBlock - fromBlock + 1) / 2);
        if (newRange < 5) {
          // Range too small, skip this batch
          console.log(`[ERC20 Indexer] Block range too dense, skipping to next batch`);
          await updateSyncState(currentToBlock);
          return {
            fromBlock,
            toBlock: currentToBlock,
            logsCount: 0,
            newLogsCount: 0,
            duration: Date.now() - startTime,
          };
        }
        currentToBlock = fromBlock + newRange - 1;
        console.log(`[ERC20 Indexer] Reducing batch size to ${newRange} blocks`);
        attempts++;
      } else {
        throw err;
      }
    }
  }

  console.log(`[ERC20 Indexer] Found ${logs.length} Transfer events`);

  // Get block timestamps (batch for efficiency)
  const blockTimestamps = new Map<number, Date>();
  const uniqueBlocks = [...new Set(logs.map(log => parseInt(log.blockNumber, 16)))];
  
  // Fetch timestamps in parallel (limit concurrency)
  const BATCH_SIZE = 10;
  for (let i = 0; i < uniqueBlocks.length; i += BATCH_SIZE) {
    const batch = uniqueBlocks.slice(i, i + BATCH_SIZE);
    const timestamps = await Promise.all(
      batch.map(async (blockNum) => {
        try {
          const ts = await rpc.getBlockTimestamp(blockNum);
          return { blockNum, ts };
        } catch {
          return { blockNum, ts: new Date() };
        }
      })
    );
    timestamps.forEach(({ blockNum, ts }) => blockTimestamps.set(blockNum, ts));
  }

  // Process and store logs
  let newLogsCount = 0;
  const bulkOps = [];

  for (const log of logs) {
    const parsed = parseTransferLog(log);
    if (!parsed) continue; // Skip invalid logs
    
    const blockNumber = parseInt(log.blockNumber, 16);
    const logIndex = parseInt(log.logIndex, 16);
    const txHash = log.transactionHash.toLowerCase();
    const { token, from, to, amount } = parsed;
    const blockTimestamp = blockTimestamps.get(blockNumber) || new Date();

    bulkOps.push({
      updateOne: {
        filter: { txHash, logIndex },
        update: {
          $setOnInsert: {
            blockNumber,
            blockTimestamp,
            txHash,
            logIndex,
            token,
            from,
            to,
            amount,
          },
        },
        upsert: true,
      },
    });
  }

  // Execute bulk write
  if (bulkOps.length > 0) {
    const result = await ERC20LogModel.bulkWrite(bulkOps, { ordered: false });
    newLogsCount = result.upsertedCount;
  }

  // Update sync state
  await updateSyncState(toBlock);

  const duration = Date.now() - startTime;
  console.log(`[ERC20 Indexer] Processed ${logs.length} logs (${newLogsCount} new) in ${duration}ms`);

  return {
    fromBlock,
    toBlock,
    logsCount: logs.length,
    newLogsCount,
    duration,
  };
}

/**
 * Get sync status
 */
export async function getSyncStatus(rpc: EthereumRpc): Promise<{
  syncedBlock: number;
  latestBlock: number;
  blocksBehind: number;
  totalLogs: number;
}> {
  const state = await SyncStateModel.findOne({ key: SYNC_KEY });
  const latestBlock = await rpc.getBlockNumber();
  const syncedBlock = state?.lastBlock || 0;
  const totalLogs = await ERC20LogModel.countDocuments();

  return {
    syncedBlock,
    latestBlock,
    blocksBehind: latestBlock - syncedBlock,
    totalLogs,
  };
}

/**
 * Reset sync state (for debugging)
 */
export async function resetSyncState(startBlock?: number): Promise<void> {
  if (startBlock !== undefined) {
    await SyncStateModel.updateOne(
      { key: SYNC_KEY },
      { $set: { lastBlock: startBlock } },
      { upsert: true }
    );
  } else {
    await SyncStateModel.deleteOne({ key: SYNC_KEY });
  }
}
