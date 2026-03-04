/**
 * Approval Routes
 * 
 * API endpoints for Approval Gate.
 * 
 * GET  /api/live/approval/status   - Get approval statistics
 * GET  /api/live/approval/approved - Get approved facts only
 * GET  /api/live/approval/all      - Get all facts (debug)
 * POST /api/live/approval/run      - Run approval manually
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  getApprovalStats,
  getApprovedFacts,
  getAllFacts,
  processToken,
} from '../services/approval-gate.service.js';
import {
  startApprovalWorker,
  stopApprovalWorker,
  runApprovalOnce,
  getApprovalWorkerStatus,
} from '../worker/approval.worker.js';
import { CANARY_TOKENS } from '../../live_ingestion.types.js';
import type { WindowSize } from '../../models/live_aggregate_window.model.js';
import type { ApprovalStatus } from '../approval.types.js';

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  
  // ==================== STATUS ====================
  
  /**
   * GET /api/live/approval/status
   * Get approval statistics
   */
  app.get('/live/approval/status', async () => {
    try {
      const stats = await getApprovalStats();
      
      return {
        ok: true,
        data: stats,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get approval stats',
        details: err.message,
      };
    }
  });
  
  // ==================== GET FACTS ====================
  
  /**
   * GET /api/live/approval/approved
   * Get approved facts only (for Drift / ML)
   */
  app.get('/live/approval/approved', async (request: FastifyRequest) => {
    const query = request.query as {
      token?: string;
      window?: string;
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
      const limit = query.limit ? parseInt(query.limit) : 50;
      
      const facts = await getApprovedFacts({
        tokenAddress,
        window,
        limit,
      });
      
      return {
        ok: true,
        data: {
          count: facts.length,
          facts,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get approved facts',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/live/approval/all
   * Get all facts (including quarantined/rejected) for debugging
   */
  app.get('/live/approval/all', async (request: FastifyRequest) => {
    const query = request.query as {
      token?: string;
      window?: string;
      status?: string;
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
      const status = query.status as ApprovalStatus | undefined;
      const limit = query.limit ? parseInt(query.limit) : 50;
      
      const facts = await getAllFacts({
        tokenAddress,
        window,
        status,
        limit,
      });
      
      return {
        ok: true,
        data: {
          count: facts.length,
          facts,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get facts',
        details: err.message,
      };
    }
  });
  
  // ==================== WORKER CONTROL ====================
  
  /**
   * POST /api/live/approval/worker/start
   * Start the approval worker
   */
  app.post('/live/approval/worker/start', async () => {
    try {
      const result = startApprovalWorker();
      return {
        ok: result.ok,
        data: { message: result.message },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to start approval worker',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/live/approval/worker/stop
   * Stop the approval worker
   */
  app.post('/live/approval/worker/stop', async () => {
    try {
      const result = stopApprovalWorker();
      return {
        ok: result.ok,
        data: { message: result.message },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to stop approval worker',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/live/approval/worker/status
   * Get approval worker status
   */
  app.get('/live/approval/worker/status', async () => {
    try {
      const status = getApprovalWorkerStatus();
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
   * POST /api/live/approval/run
   * Run approval manually (single run)
   */
  app.post('/live/approval/run', async () => {
    try {
      const result = await runApprovalOnce();
      
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
        error: 'Failed to run approval',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/live/approval/token/:symbol
   * Run approval for a specific token
   */
  app.post('/live/approval/token/:symbol', async (request: FastifyRequest) => {
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
        const result = await processToken(token.address, token.symbol, window);
        results.push(result);
      }
      
      const totals = {
        processed: results.reduce((s, r) => s + r.processed, 0),
        approved: results.reduce((s, r) => s + r.approved, 0),
        quarantined: results.reduce((s, r) => s + r.quarantined, 0),
        rejected: results.reduce((s, r) => s + r.rejected, 0),
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
        error: 'Failed to process token',
        details: err.message,
      };
    }
  });
  
  app.log.info('[Approval Gate] Routes registered');
}
