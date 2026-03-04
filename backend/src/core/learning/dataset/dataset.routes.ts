/**
 * Dataset Routes
 * 
 * ETAP 3.4: API endpoints for ML training dataset.
 * 
 * Endpoints:
 * - POST /api/learning/dataset/build - Build samples
 * - GET /api/learning/dataset/stats - Dataset statistics
 * - GET /api/learning/dataset/samples - List samples
 * - GET /api/learning/dataset/quality - Quality alerts
 * - GET /api/learning/dataset/schema - Schema info
 * - POST /api/learning/dataset/export/jsonl - Export JSONL
 * - POST /api/learning/dataset/export/csv - Export CSV
 * - GET /api/learning/dataset/builds - Recent build runs
 * - GET /api/learning/dataset/worker/status - Worker status
 * - POST /api/learning/dataset/worker/start|stop - Worker control
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  runDatasetBuild,
  getSamples,
  getRecentBuildRuns,
} from './dataset_builder.service.js';
import {
  getDatasetStats,
  checkDatasetQuality,
  getSkipReasonStats,
} from './dataset_quality.service.js';
import {
  exportJSONL,
  exportCSV,
  getSchemaInfo,
} from './dataset_export.service.js';
import {
  startDatasetWorker,
  stopDatasetWorker,
  getDatasetWorkerStatus,
  runDatasetWorkerOnce,
} from './dataset_builder.worker.js';
import type { DatasetBuildConfig } from '../types/dataset.types.js';
import type { Horizon } from '../learning.types.js';

// ==================== ROUTE HANDLERS ====================

export async function datasetRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/learning/dataset/build
   * Trigger dataset build
   */
  app.post('/learning/dataset/build', async (
    request: FastifyRequest<{
      Body: Partial<DatasetBuildConfig>;
    }>,
    reply: FastifyReply
  ) => {
    try {
      const config: DatasetBuildConfig = {
        horizons: request.body?.horizons || ['1d', '7d', '30d'],
        mode: request.body?.mode || 'incremental',
        limit: request.body?.limit || 500,
        since: request.body?.since ? new Date(request.body.since) : undefined,
        until: request.body?.until ? new Date(request.body.until) : undefined,
        includeNoLive: request.body?.includeNoLive ?? true,
        includeCriticalDrift: request.body?.includeCriticalDrift ?? false,
      };
      
      const result = await runDatasetBuild(config);
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/learning/dataset/stats
   * Get dataset statistics
   */
  app.get('/learning/dataset/stats', async (_request, reply: FastifyReply) => {
    try {
      const stats = await getDatasetStats();
      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/learning/dataset/samples
   * List samples with filters
   */
  app.get('/learning/dataset/samples', async (
    request: FastifyRequest<{
      Querystring: {
        horizon?: string;
        bucket?: string;
        verdict?: string;
        trainEligible?: string;
        limit?: string;
        offset?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { horizon, bucket, verdict, trainEligible, limit = '50', offset = '0' } = request.query;
      
      const { samples, total } = await getSamples({
        horizon: horizon as Horizon,
        bucket,
        verdict,
        trainEligible: trainEligible === 'true' ? true : trainEligible === 'false' ? false : undefined,
        limit: parseInt(limit),
        offset: parseInt(offset),
      });
      
      return reply.send({
        ok: true,
        data: {
          samples: samples.map(s => ({
            ...s,
            _id: undefined,
          })),
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/learning/dataset/quality
   * Get quality alerts
   */
  app.get('/learning/dataset/quality', async (_request, reply: FastifyReply) => {
    try {
      const [alerts, skipReasons] = await Promise.all([
        checkDatasetQuality(),
        getSkipReasonStats(),
      ]);
      
      return reply.send({
        ok: true,
        data: {
          alerts,
          skipReasons,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/learning/dataset/schema
   * Get dataset schema info
   */
  app.get('/learning/dataset/schema', async (_request, reply: FastifyReply) => {
    try {
      const schema = getSchemaInfo();
      return reply.send({
        ok: true,
        data: schema,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/learning/dataset/export/jsonl
   * Export dataset as JSONL
   */
  app.post('/learning/dataset/export/jsonl', async (
    request: FastifyRequest<{
      Body: {
        trainEligibleOnly?: boolean;
        horizons?: string[];
        bucket?: string;
        verdict?: string;
        limit?: number;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const jsonl = await exportJSONL({
        trainEligibleOnly: request.body?.trainEligibleOnly ?? true,
        horizons: request.body?.horizons as Horizon[],
        bucket: request.body?.bucket,
        verdict: request.body?.verdict,
        limit: request.body?.limit || 10000,
        includeMetadata: true,
      });
      
      reply.header('Content-Type', 'application/x-ndjson');
      reply.header('Content-Disposition', 'attachment; filename=dataset.jsonl');
      return reply.send(jsonl);
      
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/learning/dataset/export/csv
   * Export dataset as CSV
   */
  app.post('/learning/dataset/export/csv', async (
    request: FastifyRequest<{
      Body: {
        trainEligibleOnly?: boolean;
        horizons?: string[];
        bucket?: string;
        verdict?: string;
        limit?: number;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const csv = await exportCSV({
        trainEligibleOnly: request.body?.trainEligibleOnly ?? true,
        horizons: request.body?.horizons as Horizon[],
        bucket: request.body?.bucket,
        verdict: request.body?.verdict,
        limit: request.body?.limit || 10000,
      });
      
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', 'attachment; filename=dataset.csv');
      return reply.send(csv);
      
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/learning/dataset/builds
   * Get recent build runs
   */
  app.get('/learning/dataset/builds', async (
    request: FastifyRequest<{
      Querystring: { limit?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const limit = parseInt(request.query.limit || '10');
      const builds = await getRecentBuildRuns(limit);
      
      return reply.send({
        ok: true,
        data: {
          builds: builds.map(b => ({
            ...b,
            _id: undefined,
          })),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ==================== WORKER ENDPOINTS ====================
  
  /**
   * GET /api/learning/dataset/worker/status
   * Get dataset worker status
   */
  app.get('/learning/dataset/worker/status', async (_request, reply: FastifyReply) => {
    try {
      const status = await getDatasetWorkerStatus();
      return reply.send({
        ok: true,
        data: status,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/learning/dataset/worker/start
   * Start dataset worker
   */
  app.post('/learning/dataset/worker/start', async (_request, reply: FastifyReply) => {
    try {
      const result = startDatasetWorker();
      return reply.send({
        ok: result.success,
        message: result.message,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/learning/dataset/worker/stop
   * Stop dataset worker
   */
  app.post('/learning/dataset/worker/stop', async (_request, reply: FastifyReply) => {
    try {
      const result = stopDatasetWorker();
      return reply.send({
        ok: result.success,
        message: result.message,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/learning/dataset/run
   * Run dataset build manually
   */
  app.post('/learning/dataset/run', async (
    request: FastifyRequest<{
      Body: Partial<DatasetBuildConfig>;
    }>,
    reply: FastifyReply
  ) => {
    try {
      const result = await runDatasetWorkerOnce(request.body);
      return reply.send({
        ok: result.success,
        data: result.result,
        error: result.error,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  app.log.info('[Dataset] Routes registered: /api/learning/dataset/*');
}
