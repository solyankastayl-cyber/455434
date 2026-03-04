/**
 * Live Aggregates Routes
 * 
 * READ-ONLY API for accessing time-window aggregates.
 * 
 * NO POST for creating aggregates (use worker)
 * NO derived metrics (confidence, risk, etc.)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  getAggregates,
  getLatestAggregates,
  getAggregationStats,
  aggregateToken,
} from '../services/live_aggregation.service.js';
import {
  startAggregationWorker,
  stopAggregationWorker,
  runAggregationOnce,
  getAggregationWorkerStatus,
} from '../workers/live_aggregation.worker.js';
import { CANARY_TOKENS } from '../live_ingestion.types.js';
import type { WindowSize } from '../models/live_aggregate_window.model.js';

export async function liveAggregatesRoutes(app: FastifyInstance): Promise<void> {
  
  // ==================== READ AGGREGATES ====================
  
  /**
   * GET /api/live/aggregates
   * Get aggregates (optionally filtered by token/window)
   */
  app.get('/live/aggregates', async (request: FastifyRequest) => {
    const query = request.query as {
      token?: string;
      window?: string;
      limit?: string;
    };
    
    try {
      // Resolve token address
      let tokenAddress: string | undefined;
      if (query.token) {
        const token = CANARY_TOKENS.find(
          t => t.symbol.toLowerCase() === query.token!.toLowerCase() ||
               t.address.toLowerCase() === query.token!.toLowerCase()
        );
        tokenAddress = token?.address;
      }
      
      // Validate window
      let window: WindowSize | undefined;
      if (query.window) {
        if (!['1h', '6h', '24h'].includes(query.window)) {
          return {
            ok: false,
            error: 'Invalid window',
            details: 'Window must be: 1h, 6h, or 24h',
          };
        }
        window = query.window as WindowSize;
      }
      
      const limit = query.limit ? parseInt(query.limit) : 50;
      
      const aggregates = await getAggregates({
        tokenAddress,
        window,
        limit,
      });
      
      return {
        ok: true,
        data: {
          count: aggregates.length,
          aggregates,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get aggregates',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/live/aggregates/latest
   * Get latest aggregate per token per window
   */
  app.get('/live/aggregates/latest', async () => {
    try {
      const aggregates = await getLatestAggregates();
      
      return {
        ok: true,
        data: {
          count: aggregates.length,
          aggregates,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get latest aggregates',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/live/aggregates/stats
   * Get aggregation statistics
   */
  app.get('/live/aggregates/stats', async () => {
    try {
      const stats = await getAggregationStats();
      
      return {
        ok: true,
        data: stats,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get aggregation stats',
        details: err.message,
      };
    }
  });
  
  // ==================== WORKER CONTROL ====================
  
  /**
   * POST /api/live/aggregates/worker/start
   * Start the aggregation worker
   */
  app.post('/live/aggregates/worker/start', async () => {
    try {
      const result = startAggregationWorker();
      return {
        ok: result.ok,
        data: { message: result.message },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to start aggregation worker',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/live/aggregates/worker/stop
   * Stop the aggregation worker
   */
  app.post('/live/aggregates/worker/stop', async () => {
    try {
      const result = stopAggregationWorker();
      return {
        ok: result.ok,
        data: { message: result.message },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to stop aggregation worker',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/live/aggregates/worker/status
   * Get aggregation worker status
   */
  app.get('/live/aggregates/worker/status', async () => {
    try {
      const status = getAggregationWorkerStatus();
      return {
        ok: true,
        data: status,
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
   * POST /api/live/aggregates/run
   * Run aggregation manually (single run)
   */
  app.post('/live/aggregates/run', async () => {
    try {
      const result = await runAggregationOnce();
      
      return {
        ok: result.ok,
        data: {
          totalWindowsCreated: result.totalWindowsCreated,
          totalEventsProcessed: result.totalEventsProcessed,
          durationMs: result.durationMs,
          results: result.results,
        },
        error: result.error,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to run aggregation',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/live/aggregates/token/:symbol
   * Run aggregation for a specific token (all windows)
   */
  app.post('/live/aggregates/token/:symbol', async (request: FastifyRequest) => {
    const params = request.params as { symbol: string };
    
    const token = CANARY_TOKENS.find(
      t => t.symbol.toLowerCase() === params.symbol.toLowerCase() ||
           t.address.toLowerCase() === params.symbol.toLowerCase()
    );
    
    if (!token) {
      return {
        ok: false,
        error: 'Token not found',
        details: `Available: ${CANARY_TOKENS.map(t => t.symbol).join(', ')}`,
      };
    }
    
    try {
      const results = [];
      
      for (const window of ['1h', '6h', '24h'] as WindowSize[]) {
        const result = await aggregateToken(token.address, window);
        results.push(result);
      }
      
      const totalCreated = results.reduce((sum, r) => sum + r.windowsCreated, 0);
      const totalEvents = results.reduce((sum, r) => sum + r.eventsProcessed, 0);
      const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
      
      return {
        ok: true,
        data: {
          token: token.symbol,
          totalWindowsCreated: totalCreated,
          totalEventsProcessed: totalEvents,
          durationMs: totalDuration,
          results,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to aggregate token',
        details: err.message,
      };
    }
  });
  
  app.log.info('[Live Aggregates] Routes registered');
}
