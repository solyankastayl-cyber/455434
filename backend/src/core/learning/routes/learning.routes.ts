/**
 * Learning Routes
 * 
 * ETAP 3.1: API endpoints for Learning Intelligence.
 * 
 * Endpoints:
 * - GET /api/learning/snapshots - List prediction snapshots
 * - GET /api/learning/snapshots/:id - Get snapshot by ID
 * - GET /api/learning/snapshots/stats - Snapshot statistics
 * - GET /api/learning/outcomes - List outcomes
 * - GET /api/learning/outcomes/:snapshotId - Get outcome by snapshot ID
 * - GET /api/learning/outcomes/stats - Outcome statistics
 * - GET /api/learning/combined/:snapshotId - Get snapshot with outcome
 * - POST /api/learning/outcomes/run - Manual tracking cycle
 * - GET /api/learning/outcomes/worker/status - Worker status
 * - POST /api/learning/outcomes/worker/start - Start worker
 * - POST /api/learning/outcomes/worker/stop - Stop worker
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  getSnapshotById,
  getSnapshotsByToken,
  getSnapshotStats,
  getSnapshotsPendingOutcomes,
} from '../services/snapshot.service.js';
import {
  getOutcomeBySnapshotId,
  getOutcomesByToken,
  getOutcomeStats,
  getSnapshotWithOutcome,
} from '../services/outcome-tracker.service.js';
import {
  startOutcomeWorker,
  stopOutcomeWorker,
  getOutcomeWorkerStatus,
  runOutcomeWorkerOnce,
} from '../workers/outcome-tracker.worker.js';
import { PredictionSnapshotModel } from '../models/PredictionSnapshot.model.js';
import { OutcomeObservationModel } from '../models/OutcomeObservation.model.js';

// ==================== ROUTE HANDLERS ====================

export async function learningRoutes(app: FastifyInstance): Promise<void> {
  
  // ==================== SNAPSHOT ENDPOINTS ====================
  
  /**
   * GET /api/learning/snapshots
   * List prediction snapshots with pagination
   */
  app.get('/learning/snapshots', async (
    request: FastifyRequest<{
      Querystring: {
        token?: string;
        bucket?: string;
        limit?: string;
        offset?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { token, bucket, limit = '50', offset = '0' } = request.query;
      
      const query: any = {};
      if (token) query['token.address'] = token.toLowerCase();
      if (bucket) query['decision.bucket'] = bucket;
      
      const [snapshots, total] = await Promise.all([
        PredictionSnapshotModel.find(query)
          .sort({ decidedAt: -1 })
          .skip(parseInt(offset))
          .limit(parseInt(limit))
          .lean(),
        PredictionSnapshotModel.countDocuments(query),
      ]);
      
      return reply.send({
        ok: true,
        data: {
          snapshots: snapshots.map(s => ({
            ...s,
            _id: undefined, // Remove MongoDB _id
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
   * GET /api/learning/snapshots/stats
   * Get snapshot statistics
   */
  app.get('/learning/snapshots/stats', async (_request, reply: FastifyReply) => {
    try {
      const stats = await getSnapshotStats();
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
   * GET /api/learning/snapshots/pending
   * Get snapshots pending outcome tracking
   */
  app.get('/learning/snapshots/pending', async (
    request: FastifyRequest<{
      Querystring: { limit?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const limit = parseInt(request.query.limit || '50');
      const snapshots = await getSnapshotsPendingOutcomes(limit);
      
      return reply.send({
        ok: true,
        data: {
          snapshots: snapshots.map(s => ({
            ...s,
            _id: undefined,
          })),
          count: snapshots.length,
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
   * GET /api/learning/snapshots/:id
   * Get snapshot by ID
   */
  app.get('/learning/snapshots/:id', async (
    request: FastifyRequest<{
      Params: { id: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const snapshot = await getSnapshotById(request.params.id);
      
      if (!snapshot) {
        return reply.status(404).send({
          ok: false,
          error: 'Snapshot not found',
        });
      }
      
      return reply.send({
        ok: true,
        data: { ...snapshot, _id: undefined },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ==================== OUTCOME ENDPOINTS ====================
  
  /**
   * GET /api/learning/outcomes
   * List outcomes with pagination
   */
  app.get('/learning/outcomes', async (
    request: FastifyRequest<{
      Querystring: {
        token?: string;
        limit?: string;
        offset?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { token, limit = '50', offset = '0' } = request.query;
      
      const query: any = {};
      if (token) query.tokenAddress = token.toLowerCase();
      
      const [outcomes, total] = await Promise.all([
        OutcomeObservationModel.find(query)
          .sort({ createdAt: -1 })
          .skip(parseInt(offset))
          .limit(parseInt(limit))
          .lean(),
        OutcomeObservationModel.countDocuments(query),
      ]);
      
      return reply.send({
        ok: true,
        data: {
          outcomes: outcomes.map(o => ({
            ...o,
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
   * GET /api/learning/outcomes/stats
   * Get outcome statistics
   */
  app.get('/learning/outcomes/stats', async (_request, reply: FastifyReply) => {
    try {
      const stats = await getOutcomeStats();
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
   * GET /api/learning/outcomes/:snapshotId
   * Get outcome by snapshot ID
   */
  app.get('/learning/outcomes/:snapshotId', async (
    request: FastifyRequest<{
      Params: { snapshotId: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const outcome = await getOutcomeBySnapshotId(request.params.snapshotId);
      
      if (!outcome) {
        return reply.status(404).send({
          ok: false,
          error: 'Outcome not found',
        });
      }
      
      return reply.send({
        ok: true,
        data: { ...outcome, _id: undefined },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ==================== COMBINED ENDPOINTS ====================
  
  /**
   * GET /api/learning/combined/:snapshotId
   * Get snapshot with outcome
   */
  app.get('/learning/combined/:snapshotId', async (
    request: FastifyRequest<{
      Params: { snapshotId: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const result = await getSnapshotWithOutcome(request.params.snapshotId);
      
      if (!result) {
        return reply.status(404).send({
          ok: false,
          error: 'Snapshot not found',
        });
      }
      
      return reply.send({
        ok: true,
        data: {
          snapshot: { ...result.snapshot, _id: undefined },
          outcome: result.outcome ? { ...result.outcome, _id: undefined } : null,
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
   * GET /api/learning/outcomes/worker/status
   * Get outcome worker status
   */
  app.get('/learning/outcomes/worker/status', async (_request, reply: FastifyReply) => {
    try {
      const status = await getOutcomeWorkerStatus();
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
   * POST /api/learning/outcomes/worker/start
   * Start outcome worker
   */
  app.post('/learning/outcomes/worker/start', async (_request, reply: FastifyReply) => {
    try {
      const result = startOutcomeWorker();
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
   * POST /api/learning/outcomes/worker/stop
   * Stop outcome worker
   */
  app.post('/learning/outcomes/worker/stop', async (_request, reply: FastifyReply) => {
    try {
      const result = stopOutcomeWorker();
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
   * POST /api/learning/outcomes/run
   * Run outcome tracking cycle manually
   */
  app.post('/learning/outcomes/run', async (_request, reply: FastifyReply) => {
    try {
      const result = await runOutcomeWorkerOnce();
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
  
  app.log.info('[Learning] Routes registered: /api/learning/*');
}
