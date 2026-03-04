/**
 * Live Drift Routes
 * 
 * API endpoints for Drift Summary.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  getDriftStats,
  getDriftSummaries,
  getLatestDrift,
  getDriftMLReadyStatus,
  computeTokenDrift,
} from '../services/liveDrift.service.js';
import {
  startDriftWorker,
  stopDriftWorker,
  runDriftOnce,
  getDriftWorkerStatus,
} from '../workers/liveDrift.worker.js';
import { CANARY_TOKENS } from '../../live_ingestion.types.js';
import type { WindowSize } from '../../services/window_calculator.js';
import type { DriftLevel } from '../drift.types.js';

export async function liveDriftRoutes(app: FastifyInstance): Promise<void> {
  
  // ==================== STATUS ====================
  
  /**
   * GET /api/live/drift/status
   * Get drift statistics
   */
  app.get('/live/drift/status', async () => {
    try {
      const stats = await getDriftStats();
      
      return {
        ok: true,
        data: stats,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get drift stats',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/live/drift/ml-ready
   * Get ML readiness status based on drift
   */
  app.get('/live/drift/ml-ready', async () => {
    try {
      const mlStatus = await getDriftMLReadyStatus();
      
      return {
        ok: true,
        data: mlStatus,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get ML ready status',
        details: err.message,
      };
    }
  });
  
  // ==================== READ SUMMARIES ====================
  
  /**
   * GET /api/live/drift/summary
   * Get drift summaries
   */
  app.get('/live/drift/summary', async (request: FastifyRequest) => {
    const query = request.query as {
      token?: string;
      window?: string;
      level?: string;
      limit?: string;
    };
    
    try {
      let tokenAddress: string | undefined;
      if (query.token) {
        const token = CANARY_TOKENS.find(
          t => t.symbol.toLowerCase() === query.token!.toLowerCase() ||
               t.address.toLowerCase() === query.token!.toLowerCase()
        );
        tokenAddress = token?.address;
      }
      
      const window = query.window as WindowSize | undefined;
      const level = query.level as DriftLevel | undefined;
      const limit = query.limit ? parseInt(query.limit) : 50;
      
      const summaries = await getDriftSummaries({
        tokenAddress,
        window,
        level,
        limit,
      });
      
      return {
        ok: true,
        data: {
          count: summaries.length,
          summaries,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get drift summaries',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/live/drift/latest
   * Get latest drift per token per window
   */
  app.get('/live/drift/latest', async () => {
    try {
      const latest = await getLatestDrift();
      
      return {
        ok: true,
        data: {
          count: latest.length,
          summaries: latest,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get latest drift',
        details: err.message,
      };
    }
  });
  
  // ==================== WORKER CONTROL ====================
  
  /**
   * POST /api/live/drift/worker/start
   * Start the drift worker
   */
  app.post('/live/drift/worker/start', async () => {
    try {
      const result = startDriftWorker();
      return {
        ok: result.ok,
        data: { message: result.message },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to start drift worker',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/live/drift/worker/stop
   * Stop the drift worker
   */
  app.post('/live/drift/worker/stop', async () => {
    try {
      const result = stopDriftWorker();
      return {
        ok: result.ok,
        data: { message: result.message },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to stop drift worker',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/live/drift/worker/status
   * Get drift worker status
   */
  app.get('/live/drift/worker/status', async () => {
    try {
      const status = getDriftWorkerStatus();
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
   * POST /api/live/drift/run
   * Run drift computation manually
   */
  app.post('/live/drift/run', async () => {
    try {
      const result = await runDriftOnce();
      
      return {
        ok: result.ok,
        data: {
          totals: result.totals,
          durationMs: result.durationMs,
          results: result.results,
        },
        error: result.error,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to run drift computation',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/live/drift/token/:symbol
   * Compute drift for a specific token
   */
  app.post('/live/drift/token/:symbol', async (request: FastifyRequest) => {
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
      
      for (const window of ['1h', '6h', '24h'] as const) {
        const result = await computeTokenDrift(token.address, token.symbol, window);
        results.push(result);
      }
      
      const totals = {
        computed: results.reduce((s, r) => s + r.computed, 0),
        skipped: results.reduce((s, r) => s + r.skipped, 0),
      };
      
      return {
        ok: true,
        data: {
          token: token.symbol,
          totals,
          results,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to compute drift',
        details: err.message,
      };
    }
  });
  
  app.log.info('[Live Drift] Routes registered');
}
