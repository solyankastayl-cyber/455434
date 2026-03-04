/**
 * Outcome Loop Routes (Block F)
 * 
 * API для мониторинга и управления Outcome Loop
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  getSnapshotStats,
  getRecentSnapshots,
  getTokenSnapshots,
} from './outcome_snapshot.service.js';
import {
  trackOutcomesForWindow,
  getOutcomeStats,
  getAccuracyMetrics,
} from './outcome_tracker.service.js';
import {
  getAttributionStats,
  getTokenAttribution,
} from './attribution.service.js';
import {
  getDatasetStats,
  getRecentSamples,
  getTokenSamples,
  batchCreateTrainingSamples,
} from '../ml/dataset_builder.service.js';

export async function outcomeRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/outcome/snapshots/stats
   * Get snapshot statistics
   */
  app.get('/outcome/snapshots/stats', async () => {
    try {
      const stats = await getSnapshotStats();
      
      return {
        ok: true,
        data: stats,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get snapshot stats',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/outcome/snapshots/recent
   * Get recent snapshots
   */
  app.get('/outcome/snapshots/recent', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string; bucket?: string };
    
    try {
      const limit = Math.min(parseInt(query.limit || '50'), 200);
      const bucket = query.bucket?.toUpperCase() as any;
      
      const snapshots = await getRecentSnapshots(limit, bucket);
      
      return {
        ok: true,
        data: {
          snapshots,
          count: snapshots.length,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get recent snapshots',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/outcome/snapshots/token/:address
   * Get snapshots for specific token
   */
  app.get('/outcome/snapshots/token/:address', async (request: FastifyRequest) => {
    const { address } = request.params as { address: string };
    const query = request.query as { limit?: string };
    
    try {
      const limit = Math.min(parseInt(query.limit || '20'), 100);
      const snapshots = await getTokenSnapshots(address, limit);
      
      return {
        ok: true,
        data: {
          token: address,
          snapshots,
          count: snapshots.length,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get token snapshots',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/outcome/track/:window
   * Manually trigger outcome tracking for specific window
   */
  app.post('/outcome/track/:window', async (request: FastifyRequest) => {
    const { window } = request.params as { window: string };
    
    const windowHours = parseInt(window);
    if (![24, 72, 168].includes(windowHours)) {
      return {
        ok: false,
        error: 'Invalid window. Use 24, 72, or 168',
      };
    }
    
    try {
      const result = await trackOutcomesForWindow(windowHours as any);
      
      return {
        ok: true,
        data: result,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Tracking failed',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/outcome/stats
   * Get outcome statistics
   */
  app.get('/outcome/stats', async (request: FastifyRequest) => {
    const query = request.query as { window?: string };
    
    try {
      const windowHours = query.window ? parseInt(query.window) : undefined;
      const stats = await getOutcomeStats(windowHours);
      
      return {
        ok: true,
        data: stats,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get outcome stats',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/outcome/accuracy
   * Get accuracy metrics
   */
  app.get('/outcome/accuracy', async (request: FastifyRequest) => {
    const query = request.query as { window?: string };
    
    try {
      const windowHours = query.window ? parseInt(query.window) as any : 168;
      const accuracy = await getAccuracyMetrics(windowHours);
      
      if (!accuracy) {
        return {
          ok: true,
          data: {
            message: 'No data available yet. Snapshots need time to mature.',
            windowHours,
          },
        };
      }
      
      return {
        ok: true,
        data: {
          windowHours,
          accuracy,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get accuracy metrics',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/outcome/dashboard
   * Get complete outcome dashboard data
   */
  app.get('/outcome/dashboard', async () => {
    try {
      const [snapshotStats, outcomeStats, accuracy] = await Promise.all([
        getSnapshotStats(),
        getOutcomeStats(168), // 7-day window
        getAccuracyMetrics(168),
      ]);
      
      return {
        ok: true,
        data: {
          snapshots: snapshotStats,
          outcomes: outcomeStats,
          accuracy,
          status: 'active',
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get outcome dashboard',
        details: err.message,
      };
    }
  });
  
  // ============================================================
  // BLOCK F3 - ATTRIBUTION API
  // ============================================================
  
  /**
   * GET /api/outcome/attribution/stats
   * Get attribution statistics (F3)
   */
  app.get('/outcome/attribution/stats', async (request: FastifyRequest) => {
    const query = request.query as { window?: string };
    
    try {
      const windowHours = query.window ? parseInt(query.window) : undefined;
      const stats = await getAttributionStats(windowHours);
      
      return {
        ok: true,
        data: stats,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get attribution stats',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/outcome/attribution/token/:address
   * Get attribution for specific token (F3)
   */
  app.get('/outcome/attribution/token/:address', async (request: FastifyRequest) => {
    const { address } = request.params as { address: string };
    const query = request.query as { limit?: string };
    
    try {
      const limit = Math.min(parseInt(query.limit || '10'), 50);
      const attributions = await getTokenAttribution(address, limit);
      
      return {
        ok: true,
        data: {
          token: address,
          attributions,
          count: attributions.length,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get token attribution',
        details: err.message,
      };
    }
  });
  
  // ============================================================
  // BLOCK F4 - LEARNING DATASET API
  // ============================================================
  
  /**
   * GET /api/ml/dataset/stats
   * Get training dataset statistics (F4)
   */
  app.get('/ml/dataset/stats', async () => {
    try {
      const stats = await getDatasetStats();
      
      return {
        ok: true,
        data: stats,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get dataset stats',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/ml/dataset/recent
   * Get recent training samples (F4)
   */
  app.get('/ml/dataset/recent', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string; minQuality?: string };
    
    try {
      const limit = Math.min(parseInt(query.limit || '50'), 200);
      const minQuality = parseFloat(query.minQuality || '0');
      
      const samples = await getRecentSamples(limit, minQuality);
      
      return {
        ok: true,
        data: {
          samples,
          count: samples.length,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get recent samples',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/ml/dataset/token/:address
   * Get training samples for specific token (F4)
   */
  app.get('/ml/dataset/token/:address', async (request: FastifyRequest) => {
    const { address } = request.params as { address: string };
    const query = request.query as { limit?: string };
    
    try {
      const limit = Math.min(parseInt(query.limit || '20'), 100);
      const samples = await getTokenSamples(address, limit);
      
      return {
        ok: true,
        data: {
          token: address,
          samples,
          count: samples.length,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get token samples',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/ml/dataset/build/:window
   * Manually trigger batch dataset building (F4)
   */
  app.post('/ml/dataset/build/:window', async (request: FastifyRequest) => {
    const { window } = request.params as { window: string };
    
    const windowHours = parseInt(window);
    if (![24, 72, 168].includes(windowHours)) {
      return {
        ok: false,
        error: 'Invalid window. Use 24, 72, or 168',
      };
    }
    
    try {
      const result = await batchCreateTrainingSamples(windowHours as any);
      
      return {
        ok: true,
        data: result,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Dataset building failed',
        details: err.message,
      };
    }
  });
  
  app.log.info('[Outcome] Block F (F0-F4) routes registered');
}
