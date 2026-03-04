/**
 * Live Ingestion Routes
 * 
 * API endpoints for LIVE ingestion control plane.
 * 
 * Endpoints:
 * - GET  /api/live/status       - Get ingestion status
 * - POST /api/live/toggle       - Enable/disable ingestion
 * - POST /api/live/run-once     - Run single ingestion cycle (testing)
 * - POST /api/live/reset-kill   - Reset kill switch (recovery)
 * - POST /api/live/worker/start - Start continuous worker
 * - POST /api/live/worker/stop  - Stop continuous worker
 * - POST /api/live/backfill     - Run micro-backfill for a token
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  getLiveIngestionStatus,
  toggleLiveIngestion,
  resetKillSwitch,
  isIngestionEnabled,
  getCursor,
  updateCursor,
  initializeCursors,
  updateCycleMetrics,
} from './live_ingestion.service.js';
import { CANARY_TOKENS, CHAIN_CONFIG, RANGE_CONFIG, TRANSFER_TOPIC, type RunOnceResult } from './live_ingestion.types.js';
import { LiveEventRawModel } from './live_event_raw.model.js';
import {
  startWorker,
  stopWorker,
  getWorkerStatus,
  runOneCycle,
  runMicroBackfill,
} from './workers/live_ingestion.worker.js';
import { getProviderStats } from './providers/live_rpc_manager.js';

export async function liveIngestionRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/live/status
   * Get comprehensive ingestion status
   */
  app.get('/live/status', async () => {
    try {
      const status = await getLiveIngestionStatus();
      
      return {
        ok: true,
        data: status,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get live status',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/live/toggle
   * Enable or disable ingestion
   */
  app.post('/live/toggle', async (request: FastifyRequest) => {
    const body = request.body as { enabled: boolean };
    
    if (typeof body.enabled !== 'boolean') {
      return {
        ok: false,
        error: 'Invalid request',
        details: 'enabled must be a boolean',
      };
    }
    
    try {
      const result = await toggleLiveIngestion(body.enabled);
      
      return {
        ok: true,
        data: result,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to toggle ingestion',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/live/reset-kill
   * Reset kill switch (manual recovery after investigation)
   */
  app.post('/live/reset-kill', async () => {
    try {
      await resetKillSwitch();
      
      return {
        ok: true,
        data: {
          message: 'Kill switch reset successfully',
          note: 'Ingestion remains disabled. Use /api/live/toggle to enable.',
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to reset kill switch',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/live/run-once
   * Run a single ingestion cycle for testing
   * 
   * Body:
   * - token?: string (address or symbol) - defaults to WETH
   * - fromBlock?: number
   * - toBlock?: number
   */
  app.post('/live/run-once', async (request: FastifyRequest) => {
    const body = request.body as {
      token?: string;
      fromBlock?: number;
      toBlock?: number;
    };
    
    const startTime = Date.now();
    
    try {
      // Find token
      let tokenConfig = CANARY_TOKENS[0]; // Default to WETH
      
      if (body.token) {
        const inputToken = body.token.toLowerCase();
        const found = CANARY_TOKENS.find(
          t => t.address.toLowerCase() === inputToken || t.symbol.toLowerCase() === inputToken
        );
        if (found) {
          tokenConfig = found;
        } else {
          return {
            ok: false,
            error: 'Token not found in canary list',
            details: `Available: ${CANARY_TOKENS.map(t => t.symbol).join(', ')}`,
          };
        }
      }
      
      // Get RPC providers from env
      const infuraUrl = process.env.INFURA_RPC_URL;
      const ankrUrl = process.env.ANKR_RPC_URL;
      
      if (!infuraUrl && !ankrUrl) {
        return {
          ok: false,
          error: 'No RPC provider configured',
          details: 'Set INFURA_RPC_URL or ANKR_RPC_URL in environment',
        };
      }
      
      const rpcUrl = infuraUrl || ankrUrl;
      const provider = infuraUrl ? 'infura' : 'ankr';
      
      // Get current block number
      const blockResponse = await fetch(rpcUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1,
        }),
      });
      
      const blockData = await blockResponse.json() as { result: string };
      const currentBlock = parseInt(blockData.result, 16);
      const safeHead = currentBlock - CHAIN_CONFIG.CONFIRMATIONS;
      
      // Determine block range
      const fromBlock = body.fromBlock ?? safeHead - 100; // Last 100 blocks by default
      const toBlock = body.toBlock ?? safeHead;
      
      // Validate range
      if (toBlock - fromBlock > RANGE_CONFIG.RANGE_MAX) {
        return {
          ok: false,
          error: 'Range too large',
          details: `Max range is ${RANGE_CONFIG.RANGE_MAX} blocks`,
        };
      }
      
      // Fetch logs
      const logsResponse = await fetch(rpcUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getLogs',
          params: [{
            address: tokenConfig.address,
            fromBlock: '0x' + fromBlock.toString(16),
            toBlock: '0x' + toBlock.toString(16),
            topics: [TRANSFER_TOPIC],
          }],
          id: 2,
        }),
      });
      
      const logsData = await logsResponse.json() as { result?: any[]; error?: any };
      
      if (logsData.error) {
        // Update error metrics
        await updateCycleMetrics({
          errors: 1,
          error: logsData.error.message || 'RPC error',
          provider,
        });
        
        return {
          ok: false,
          error: 'RPC error',
          details: logsData.error.message || JSON.stringify(logsData.error),
        };
      }
      
      const logs = logsData.result || [];
      
      // Store raw events
      let inserted = 0;
      let duplicates = 0;
      
      for (const log of logs) {
        const blockNumber = parseInt(log.blockNumber, 16);
        const logIndex = parseInt(log.logIndex, 16);
        
        // Parse transfer data
        const from = '0x' + log.topics[1].slice(26);
        const to = '0x' + log.topics[2].slice(26);
        const amount = log.data;
        
        try {
          // Upsert with dedup
          const result = await LiveEventRawModel.updateOne(
            {
              chainId: CHAIN_CONFIG.CHAIN_ID,
              tokenAddress: tokenConfig.address.toLowerCase(),
              blockNumber,
              logIndex,
            },
            {
              $set: {
                chainId: CHAIN_CONFIG.CHAIN_ID,
                tokenAddress: tokenConfig.address.toLowerCase(),
                blockNumber,
                txHash: log.transactionHash.toLowerCase(),
                logIndex,
                from: from.toLowerCase(),
                to: to.toLowerCase(),
                amount,
                timestamp: new Date(), // TODO: Get actual block timestamp
                tags: [],
                ingestedAt: new Date(),
              },
            },
            { upsert: true }
          );
          
          if (result.upsertedCount > 0) {
            inserted++;
          } else {
            duplicates++;
          }
        } catch (err: any) {
          // Handle duplicate key errors gracefully
          if (err.code === 11000) {
            duplicates++;
          } else {
            throw err;
          }
        }
      }
      
      const latency_ms = Date.now() - startTime;
      
      // Update metrics
      await updateCycleMetrics({
        eventsIngested: inserted,
        duplicates,
        lastBlock: toBlock,
        provider,
      });
      
      // Update cursor
      await updateCursor(tokenConfig.address, toBlock, {
        providerUsed: provider,
        mode: 'tail',
      });
      
      const result: RunOnceResult = {
        ok: true,
        summary: {
          token: tokenConfig.symbol,
          fromBlock,
          toBlock,
          fetched: logs.length,
          inserted,
          duplicates,
          latency_ms,
          provider,
        },
      };
      
      return result;
      
    } catch (err: any) {
      // Update error metrics
      await updateCycleMetrics({
        errors: 1,
        error: err.message,
      });
      
      return {
        ok: false,
        error: 'Run-once failed',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/live/init-cursors
   * Initialize cursors for all canary tokens at a given block
   */
  app.post('/live/init-cursors', async (request: FastifyRequest) => {
    const body = request.body as { startBlock?: number };
    
    try {
      // Get current block if not specified
      let startBlock = body.startBlock;
      
      if (!startBlock) {
        const infuraUrl = process.env.INFURA_RPC_URL;
        const ankrUrl = process.env.ANKR_RPC_URL;
        const rpcUrl = infuraUrl || ankrUrl;
        
        if (!rpcUrl) {
          return {
            ok: false,
            error: 'No RPC provider configured',
          };
        }
        
        const blockResponse = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_blockNumber',
            params: [],
            id: 1,
          }),
        });
        
        const blockData = await blockResponse.json() as { result: string };
        const currentBlock = parseInt(blockData.result, 16);
        
        // Start from 6 hours ago (micro-backfill)
        const blocksBack = CHAIN_CONFIG.MICRO_BACKFILL_HOURS * CHAIN_CONFIG.BLOCKS_PER_HOUR;
        startBlock = currentBlock - CHAIN_CONFIG.CONFIRMATIONS - blocksBack;
      }
      
      await initializeCursors(startBlock);
      
      return {
        ok: true,
        data: {
          message: `Cursors initialized at block ${startBlock}`,
          tokens: CANARY_TOKENS.map(t => t.symbol),
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to initialize cursors',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/live/cursors
   * Get all cursor states
   */
  app.get('/live/cursors', async () => {
    try {
      const cursors = [];
      
      for (const token of CANARY_TOKENS) {
        const cursor = await getCursor(token.address);
        cursors.push({
          symbol: token.symbol,
          address: token.address,
          ...cursor,
        });
      }
      
      return {
        ok: true,
        data: { cursors },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get cursors',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/live/raw-events
   * Get recent raw events (for debugging)
   */
  app.get('/live/raw-events', async (request: FastifyRequest) => {
    const query = request.query as {
      token?: string;
      limit?: string;
    };
    
    try {
      const filter: any = {};
      
      if (query.token) {
        // Find by symbol or address
        const token = CANARY_TOKENS.find(
          t => t.symbol.toLowerCase() === query.token!.toLowerCase() ||
               t.address.toLowerCase() === query.token!.toLowerCase()
        );
        if (token) {
          filter.tokenAddress = token.address.toLowerCase();
        }
      }
      
      const limit = Math.min(parseInt(query.limit || '50'), 100);
      
      const events = await LiveEventRawModel.find(filter)
        .sort({ ingestedAt: -1 })
        .limit(limit)
        .select('-_id -__v');
      
      return {
        ok: true,
        data: {
          count: events.length,
          events,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get raw events',
        details: err.message,
      };
    }
  });
  
  // ==================== WORKER CONTROL ====================
  
  /**
   * POST /api/live/worker/start
   * Start the continuous ingestion worker
   */
  app.post('/live/worker/start', async () => {
    try {
      const result = await startWorker();
      return {
        ok: result.ok,
        data: { message: result.message },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to start worker',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/live/worker/stop
   * Stop the continuous ingestion worker
   */
  app.post('/live/worker/stop', async () => {
    try {
      const result = stopWorker();
      return {
        ok: result.ok,
        data: { message: result.message },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to stop worker',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/live/worker/status
   * Get worker status and provider stats
   */
  app.get('/live/worker/status', async () => {
    try {
      const workerStatus = getWorkerStatus();
      
      return {
        ok: true,
        data: workerStatus,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get worker status',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/live/cycle
   * Run a single ingestion cycle manually (all tokens)
   */
  app.post('/live/cycle', async () => {
    try {
      const result = await runOneCycle();
      
      return {
        ok: result.ok,
        data: result.summary,
        error: result.error,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to run cycle',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/live/backfill
   * Run micro-backfill for a specific token
   */
  app.post('/live/backfill', async (request: FastifyRequest) => {
    const body = request.body as { token?: string };
    
    if (!body.token) {
      return {
        ok: false,
        error: 'Missing token parameter',
        details: 'Provide token symbol (e.g., WETH) or address',
      };
    }
    
    try {
      const result = await runMicroBackfill(body.token);
      
      return {
        ok: result.ok,
        data: {
          token: result.token,
          fromBlock: result.fromBlock,
          toBlock: result.toBlock,
          inserted: result.inserted,
          duplicates: result.duplicates,
          durationMs: result.durationMs,
        },
        error: result.error,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to run backfill',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/live/providers
   * Get RPC provider health stats
   */
  app.get('/live/providers', async () => {
    try {
      const stats = getProviderStats();
      
      return {
        ok: true,
        data: stats,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get provider stats',
        details: err.message,
      };
    }
  });
  
  app.log.info('[Live Ingestion] Routes registered');
}
