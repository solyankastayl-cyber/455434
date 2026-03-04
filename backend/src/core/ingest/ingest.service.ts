/**
 * ETAP 6.1 — Ingest Service
 * 
 * Core service for raw ERC-20 transfer ingestion.
 * 
 * Features:
 * - Cursor-based incremental ingestion
 * - Guardrails: maxBlocksPerRun, maxLogs, maxDuration
 * - Deduplication via unique index
 * - Audit logging
 * 
 * IMPORTANT: This service does NOT trigger Graph rebuild or Signal Engine.
 * It only collects raw data for later aggregation.
 */
import { EthereumRpc, EthLog } from '../../onchain/ethereum/ethereum.rpc.js';
import { RawTransferModel } from './raw_transfer.model.js';
import { IngestCursorModel } from './ingest_cursor.model.js';
import { IngestRunModel } from './ingest_run.model.js';
import { env } from '../../config/env.js';

// ==================== CONSTANTS ====================

// ERC-20 Transfer event topic
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Guardrails (to prevent excessive resource usage)
const GUARDRAILS = {
  MAX_BLOCKS_PER_RUN: 500,   // Reduced for public RPC limits
  MAX_LOGS_PER_RUN: 50000,
  MAX_DURATION_MS: 25000,
};

// Window configurations
const WINDOW_CONFIG: Record<string, { lookbackBlocks: number; cronInterval: string }> = {
  '24h': { lookbackBlocks: 500, cronInterval: '*/5 * * * *' },     // Start small, catch up
  '7d': { lookbackBlocks: 500, cronInterval: '*/15 * * * *' },     // Start small
  '30d': { lookbackBlocks: 500, cronInterval: '0 * * * *' },       // Start small
};

// ==================== TYPES ====================

export interface IngestRequest {
  chain: string;
  window: string;
  mode: 'incremental' | 'backfill';
}

export interface IngestResult {
  jobId: string;
  status: 'started' | 'completed' | 'failed';
  chain: string;
  window: string;
  mode: string;
  fromBlock?: number;
  toBlock?: number;
  inserted?: number;
  skippedDuplicates?: number;
  errors?: number;
  duration?: number;
  message?: string;
}

export interface IngestStatus {
  chain: string;
  window: string;
  lastCursor: {
    blockNumber: number;
    blockTime: string;
  } | null;
  lastRun: {
    jobId: string;
    startedAt: string;
    finishedAt: string | null;
    inserted: number;
    skippedDuplicates: number;
    errors: number;
    status: string;
  } | null;
  health: 'ok' | 'stale' | 'error';
}

// ==================== HELPERS ====================

/**
 * Parse ERC-20 Transfer log
 */
function parseTransferLog(log: EthLog): {
  from: string;
  to: string;
  token: string;
  amountRaw: string;
} | null {
  if (!log.topics || log.topics.length < 3) {
    return null;
  }

  const from = '0x' + log.topics[1].slice(26).toLowerCase();
  const to = '0x' + log.topics[2].slice(26).toLowerCase();
  const token = log.address.toLowerCase();
  
  let amountRaw = '0';
  if (log.data && log.data !== '0x' && log.data !== '0x0') {
    try {
      amountRaw = BigInt(log.data).toString();
    } catch {
      amountRaw = '0';
    }
  }

  return { from, to, token, amountRaw };
}

/**
 * Generate unique job ID
 */
function generateJobId(): string {
  return `ingest_${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

// ==================== MAIN SERVICE ====================

/**
 * Get or initialize cursor for a chain/window
 */
export async function getCursor(chain: string, window: string): Promise<{
  blockNumber: number;
  blockTime: Date;
} | null> {
  const cursor = await IngestCursorModel.findOne({
    chain,
    feed: 'erc20_transfers',
    window,
  });

  if (!cursor) {
    return null;
  }

  return {
    blockNumber: cursor.lastBlockNumber,
    blockTime: cursor.lastBlockTime,
  };
}

/**
 * Update cursor after successful ingest
 */
async function updateCursor(
  chain: string,
  window: string,
  blockNumber: number,
  blockTime: Date
): Promise<void> {
  await IngestCursorModel.findOneAndUpdate(
    { chain, feed: 'erc20_transfers', window },
    {
      $set: {
        lastBlockNumber: blockNumber,
        lastBlockTime: blockTime,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

/**
 * Initialize cursor for first-time ingestion
 */
export async function initializeCursor(
  rpc: EthereumRpc,
  chain: string,
  window: string
): Promise<number> {
  const currentBlock = await rpc.getBlockNumber();
  const config = WINDOW_CONFIG[window];
  
  if (!config) {
    throw new Error(`Unknown window: ${window}`);
  }

  // Start from (currentBlock - lookbackBlocks)
  const startBlock = Math.max(0, currentBlock - config.lookbackBlocks);
  const blockTime = await rpc.getBlockTimestamp(startBlock);

  await IngestCursorModel.findOneAndUpdate(
    { chain, feed: 'erc20_transfers', window },
    {
      $setOnInsert: {
        chain,
        feed: 'erc20_transfers',
        window,
        lastBlockNumber: startBlock,
        lastBlockTime: blockTime,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  console.log(`[Ingest] Cursor initialized for ${chain}/${window} at block ${startBlock}`);
  return startBlock;
}

/**
 * Run incremental ingest
 * 
 * This is the main ingest function. It:
 * 1. Gets current cursor position
 * 2. Fetches logs from RPC
 * 3. Writes to raw_transfers (with dedup)
 * 4. Updates cursor
 * 5. Logs run to ingest_runs
 */
export async function runIngest(
  rpc: EthereumRpc,
  request: IngestRequest
): Promise<IngestResult> {
  const { chain, window, mode } = request;
  const jobId = generateJobId();
  const startTime = Date.now();

  // Create run record
  await IngestRunModel.create({
    jobId,
    chain,
    window,
    mode,
    startedAt: new Date(),
    status: 'running',
  });

  try {
    // Get or initialize cursor
    let cursor = await getCursor(chain, window);
    
    if (!cursor) {
      const startBlock = await initializeCursor(rpc, chain, window);
      cursor = { blockNumber: startBlock, blockTime: new Date() };
    }

    // Get current head
    const latestBlock = await rpc.getBlockNumber();
    const fromBlock = cursor.blockNumber + 1;
    
    // Nothing to sync
    if (fromBlock > latestBlock) {
      await IngestRunModel.findOneAndUpdate(
        { jobId },
        {
          $set: {
            finishedAt: new Date(),
            status: 'completed',
            fromBlock: cursor.blockNumber,
            toBlock: cursor.blockNumber,
          },
        }
      );

      return {
        jobId,
        status: 'completed',
        chain,
        window,
        mode,
        message: 'Already up to date',
        duration: Date.now() - startTime,
      };
    }

    // Apply guardrails
    let toBlock = Math.min(fromBlock + GUARDRAILS.MAX_BLOCKS_PER_RUN - 1, latestBlock);

    console.log(`[Ingest] ${chain}/${window}: Fetching blocks ${fromBlock}-${toBlock}`);

    // Fetch logs with adaptive batch size
    let logs: EthLog[] = [];
    let currentToBlock = toBlock;
    let attempts = 0;

    while (attempts < 5) {
      try {
        logs = await rpc.getLogs({
          fromBlock: '0x' + fromBlock.toString(16),
          toBlock: '0x' + currentToBlock.toString(16),
          topics: [TRANSFER_TOPIC],
        });

        // Check guardrail
        if (logs.length > GUARDRAILS.MAX_LOGS_PER_RUN) {
          // Reduce batch size
          const newRange = Math.floor((currentToBlock - fromBlock + 1) / 2);
          if (newRange < 10) break;
          currentToBlock = fromBlock + newRange - 1;
          attempts++;
          continue;
        }

        toBlock = currentToBlock;
        break;
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        
        // Handle various RPC result limit errors
        if (errorMessage.includes('10000 results') || 
            errorMessage.includes('-32005') ||
            errorMessage.includes('max results') ||
            errorMessage.includes('-32602') ||
            errorMessage.includes('query exceeds')) {
          const newRange = Math.floor((currentToBlock - fromBlock + 1) / 2);
          if (newRange < 10) break;
          currentToBlock = fromBlock + newRange - 1;
          attempts++;
          console.log(`[Ingest] Reducing batch to ${newRange} blocks due to RPC limit`);
        } else {
          throw err;
        }
      }
    }

    console.log(`[Ingest] ${chain}/${window}: Found ${logs.length} Transfer events`);

    // Check duration guardrail
    if (Date.now() - startTime > GUARDRAILS.MAX_DURATION_MS * 0.5) {
      // Reduce scope if taking too long
      const halfLogs = Math.floor(logs.length / 2);
      if (halfLogs > 0) {
        logs = logs.slice(0, halfLogs);
        toBlock = parseInt(logs[logs.length - 1].blockNumber, 16);
      }
    }

    // Get block timestamps
    const blockTimestamps = new Map<number, Date>();
    const uniqueBlocks = [...new Set(logs.map(log => parseInt(log.blockNumber, 16)))];
    
    for (let i = 0; i < uniqueBlocks.length; i += 10) {
      const batch = uniqueBlocks.slice(i, i + 10);
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

      // Check duration guardrail
      if (Date.now() - startTime > GUARDRAILS.MAX_DURATION_MS) {
        console.log(`[Ingest] Duration limit reached, stopping early`);
        break;
      }
    }

    // Prepare bulk operations
    const bulkOps = [];
    let inserted = 0;
    let skippedDuplicates = 0;
    let errors = 0;
    const errorSamples: string[] = [];

    for (const log of logs) {
      const parsed = parseTransferLog(log);
      if (!parsed) continue;

      const blockNumber = parseInt(log.blockNumber, 16);
      const logIndex = parseInt(log.logIndex, 16);
      const txHash = log.transactionHash.toLowerCase();
      const blockTime = blockTimestamps.get(blockNumber) || new Date();

      bulkOps.push({
        updateOne: {
          filter: { chain, txHash, logIndex },
          update: {
            $setOnInsert: {
              chain,
              txHash,
              logIndex,
              blockNumber,
              blockTime,
              from: parsed.from,
              to: parsed.to,
              token: parsed.token,
              amountRaw: parsed.amountRaw,
              source: 'rpc',
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    // Execute bulk write
    if (bulkOps.length > 0) {
      try {
        const result = await RawTransferModel.bulkWrite(bulkOps, { ordered: false });
        inserted = result.upsertedCount;
        skippedDuplicates = bulkOps.length - result.upsertedCount;
      } catch (err: unknown) {
        // Handle duplicate key errors gracefully
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes('duplicate key')) {
          skippedDuplicates = bulkOps.length;
        } else {
          errors++;
          errorSamples.push(errorMessage.substring(0, 200));
        }
      }
    }

    // Get final block timestamp for cursor
    const finalBlockTime = blockTimestamps.get(toBlock) || new Date();

    // Update cursor
    await updateCursor(chain, window, toBlock, finalBlockTime);

    // Update run record
    const duration = Date.now() - startTime;
    await IngestRunModel.findOneAndUpdate(
      { jobId },
      {
        $set: {
          finishedAt: new Date(),
          status: errors > 0 ? 'failed' : 'completed',
          fromBlock,
          toBlock,
          inserted,
          skippedDuplicates,
          errors,
          errorSamples,
        },
      }
    );

    console.log(`[Ingest] ${chain}/${window}: Inserted ${inserted}, skipped ${skippedDuplicates} in ${duration}ms`);

    return {
      jobId,
      status: 'completed',
      chain,
      window,
      mode,
      fromBlock,
      toBlock,
      inserted,
      skippedDuplicates,
      errors,
      duration,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    await IngestRunModel.findOneAndUpdate(
      { jobId },
      {
        $set: {
          finishedAt: new Date(),
          status: 'failed',
          errors: 1,
          errorSamples: [errorMessage.substring(0, 500)],
        },
      }
    );

    console.error(`[Ingest] ${chain}/${window}: Failed - ${errorMessage}`);

    return {
      jobId,
      status: 'failed',
      chain,
      window,
      mode,
      message: errorMessage,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Get ingest status for a chain/window
 */
export async function getIngestStatus(chain: string, window: string): Promise<IngestStatus> {
  const cursor = await IngestCursorModel.findOne({
    chain,
    feed: 'erc20_transfers',
    window,
  });

  const lastRun = await IngestRunModel.findOne({
    chain,
    window,
  }).sort({ startedAt: -1 });

  // Determine health
  let health: 'ok' | 'stale' | 'error' = 'ok';
  
  if (lastRun) {
    if (lastRun.status === 'failed') {
      health = 'error';
    } else if (lastRun.finishedAt) {
      const hoursSinceLastRun = (Date.now() - lastRun.finishedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastRun > 1) {
        health = 'stale';
      }
    }
  }

  return {
    chain,
    window,
    lastCursor: cursor ? {
      blockNumber: cursor.lastBlockNumber,
      blockTime: cursor.lastBlockTime.toISOString(),
    } : null,
    lastRun: lastRun ? {
      jobId: lastRun.jobId,
      startedAt: lastRun.startedAt.toISOString(),
      finishedAt: lastRun.finishedAt?.toISOString() || null,
      inserted: lastRun.inserted,
      skippedDuplicates: lastRun.skippedDuplicates,
      errors: lastRun.errors,
      status: lastRun.status,
    } : null,
    health,
  };
}

/**
 * Get sample of raw transfers
 */
export async function getSampleTransfers(
  chain: string,
  limit: number = 50
): Promise<Array<{
  txHash: string;
  from: string;
  to: string;
  token: string;
  amountRaw: string;
  blockTime: string;
}>> {
  const transfers = await RawTransferModel
    .find({ chain })
    .sort({ blockTime: -1 })
    .limit(limit)
    .lean();

  return transfers.map(t => ({
    txHash: t.txHash,
    from: t.from,
    to: t.to,
    token: t.token,
    amountRaw: t.amountRaw,
    blockTime: t.blockTime.toISOString(),
  }));
}

/**
 * Get transfer counts by window
 */
export async function getTransferCounts(chain: string): Promise<{
  total: number;
  last24h: number;
  last7d: number;
  last30d: number;
}> {
  const now = new Date();
  const day = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const month = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [total, last24h, last7d, last30d] = await Promise.all([
    RawTransferModel.countDocuments({ chain }),
    RawTransferModel.countDocuments({ chain, blockTime: { $gte: day } }),
    RawTransferModel.countDocuments({ chain, blockTime: { $gte: week } }),
    RawTransferModel.countDocuments({ chain, blockTime: { $gte: month } }),
  ]);

  return { total, last24h, last7d, last30d };
}
