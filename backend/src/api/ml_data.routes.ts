/**
 * ML Data API Routes
 * 
 * Endpoints for ML dataset management and export
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  runDecisionSnapshot,
  backfillOutcomes,
  getDatasetStats,
  exportMLDataset,
} from '../core/ml_data/index.js';
import { getJobStatus } from '../jobs/ml_data.jobs.js';
import type { EngineWindow } from '../core/engine_v2/index.js';
import type { Horizon } from '../core/ml_data/label_classifier.js';

const VALID_WINDOWS = ['1h', '6h', '24h', '7d'];
const VALID_HORIZONS = ['1h', '6h', '24h', '72h', '7d'];

export async function mlDataRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/ml/datasets/stats
   * 
   * Get ML dataset statistics
   */
  app.get('/ml/datasets/stats', async () => {
    try {
      const stats = await getDatasetStats();
      const jobStatus = await getJobStatus();
      
      return {
        ok: true,
        data: {
          ...stats,
          jobs: jobStatus,
        },
      };
    } catch (error) {
      app.log.error(error, '[ML Data] Stats error');
      return {
        ok: false,
        error: 'ML_DATA_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  /**
   * GET /api/ml/datasets/engine-decisions
   * 
   * Export ML-ready dataset
   */
  app.get('/ml/datasets/engine-decisions', async (request: FastifyRequest) => {
    const query = request.query as {
      window?: string;
      horizon?: string;
      from?: string;
      to?: string;
      limit?: string;
    };
    
    const window = (VALID_WINDOWS.includes(query.window ?? '')
      ? query.window
      : '24h') as EngineWindow;
    
    const horizon = (VALID_HORIZONS.includes(query.horizon ?? '')
      ? query.horizon
      : '24h') as Horizon;
    
    const limit = Math.min(parseInt(query.limit ?? '1000', 10), 10000);
    
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    
    try {
      const dataset = await exportMLDataset({
        window,
        horizon,
        from,
        to,
        limit,
      });
      
      return {
        ok: true,
        count: dataset.length,
        params: { window, horizon, limit },
        data: dataset,
      };
    } catch (error) {
      app.log.error(error, '[ML Data] Export error');
      return {
        ok: false,
        error: 'ML_DATA_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  /**
   * POST /api/ml/jobs/decision-snapshot
   * 
   * Trigger decision snapshot job manually
   */
  app.post('/ml/jobs/decision-snapshot', async (request: FastifyRequest) => {
    const body = request.body as {
      window?: string;
      limit?: number;
    } ?? {};
    
    const window = (VALID_WINDOWS.includes(body.window ?? '')
      ? body.window
      : '24h') as EngineWindow;
    
    const limit = Math.min(body.limit ?? 50, 200);
    
    try {
      app.log.info(`[ML Data] Starting decision snapshot: window=${window}, limit=${limit}`);
      
      const result = await runDecisionSnapshot(window, limit);
      
      return {
        ok: true,
        data: result,
      };
    } catch (error) {
      app.log.error(error, '[ML Data] Snapshot job error');
      return {
        ok: false,
        error: 'ML_JOB_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  /**
   * POST /api/ml/jobs/outcome-backfill
   * 
   * Trigger outcome backfill job manually
   */
  app.post('/ml/jobs/outcome-backfill', async (request: FastifyRequest) => {
    const body = request.body as {
      limit?: number;
    } ?? {};
    
    const limit = Math.min(body.limit ?? 100, 500);
    
    try {
      app.log.info(`[ML Data] Starting outcome backfill: limit=${limit}`);
      
      const result = await backfillOutcomes(limit);
      
      return {
        ok: true,
        data: result,
      };
    } catch (error) {
      app.log.error(error, '[ML Data] Backfill job error');
      return {
        ok: false,
        error: 'ML_JOB_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  app.log.info('ML Data routes registered');
}
