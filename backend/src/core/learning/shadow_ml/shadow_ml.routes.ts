/**
 * Shadow ML Routes
 * 
 * ETAP 4: API endpoints for Shadow ML.
 * 
 * NO INFLUENCE ON SCORE/BUCKET - shadow mode only.
 * 
 * Endpoints:
 * - GET /api/learning/shadow/status - ML service status
 * - POST /api/learning/shadow/train - Train model
 * - POST /api/learning/shadow/infer - Run inference
 * - GET /api/learning/shadow/eval/:horizon - Get evaluation
 * - GET /api/learning/shadow/predictions - List predictions
 * - GET /api/learning/shadow/stats - Prediction statistics
 * - GET /api/learning/shadow/calibration/:snapshotId/:horizon - Get calibration
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  isShadowMLAvailable,
  getShadowMLStatus,
  trainModel,
  runInference,
  evaluate,
  getCalibration,
  getPredictionsByToken,
  getPredictionStats,
} from './shadow_ml.service.js';
import { ShadowPredictionModel } from './shadow_prediction.model.js';
import type { Horizon } from '../learning.types.js';

// ==================== ROUTE HANDLERS ====================

export async function shadowMLRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/learning/shadow/status
   * Get ML service status
   */
  app.get('/learning/shadow/status', async (_request, reply: FastifyReply) => {
    try {
      const status = await getShadowMLStatus();
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
   * POST /api/learning/shadow/train
   * Train shadow model
   */
  app.post('/learning/shadow/train', async (
    request: FastifyRequest<{
      Body: {
        horizon?: string;
        min_samples?: number;
        force_retrain?: boolean;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const horizon = (request.body?.horizon || '7d') as Horizon;
      const minSamples = request.body?.min_samples || 50;
      const forceRetrain = request.body?.force_retrain || false;
      
      const result = await trainModel(horizon, minSamples, forceRetrain);
      
      return reply.send({
        ok: result.success,
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
   * POST /api/learning/shadow/infer
   * Run shadow inference
   */
  app.post('/learning/shadow/infer', async (
    request: FastifyRequest<{
      Body: {
        horizon?: string;
        limit?: number;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const horizon = (request.body?.horizon || '7d') as Horizon;
      const limit = request.body?.limit || 100;
      
      const result = await runInference(horizon, limit);
      
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
   * GET /api/learning/shadow/eval/:horizon
   * Get evaluation report
   */
  app.get('/learning/shadow/eval/:horizon', async (
    request: FastifyRequest<{
      Params: { horizon: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const horizon = request.params.horizon as Horizon;
      const report = await evaluate(horizon);
      
      return reply.send({
        ok: true,
        data: report,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/learning/shadow/predictions
   * List predictions
   */
  app.get('/learning/shadow/predictions', async (
    request: FastifyRequest<{
      Querystring: {
        token?: string;
        horizon?: string;
        limit?: string;
        offset?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { token, horizon, limit = '50', offset = '0' } = request.query;
      
      const query: any = {};
      if (token) query.tokenAddress = token.toLowerCase();
      if (horizon) query.horizon = horizon;
      
      const [predictions, total] = await Promise.all([
        ShadowPredictionModel.find(query)
          .sort({ predicted_at: -1 })
          .skip(parseInt(offset))
          .limit(parseInt(limit))
          .lean(),
        ShadowPredictionModel.countDocuments(query),
      ]);
      
      return reply.send({
        ok: true,
        data: {
          predictions: predictions.map(p => ({
            ...p,
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
   * GET /api/learning/shadow/stats
   * Get prediction statistics
   */
  app.get('/learning/shadow/stats', async (
    request: FastifyRequest<{
      Querystring: { horizon?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const horizon = request.query.horizon as Horizon | undefined;
      const stats = await getPredictionStats(horizon);
      
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
   * GET /api/learning/shadow/calibration/:snapshotId/:horizon
   * Get calibration for specific snapshot
   */
  app.get('/learning/shadow/calibration/:snapshotId/:horizon', async (
    request: FastifyRequest<{
      Params: { snapshotId: string; horizon: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { snapshotId, horizon } = request.params;
      const calibration = await getCalibration(snapshotId, horizon as Horizon);
      
      if (!calibration) {
        return reply.status(404).send({
          ok: false,
          error: 'Calibration not found',
        });
      }
      
      return reply.send({
        ok: true,
        data: calibration,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  app.log.info('[ShadowML] Routes registered: /api/learning/shadow/*');
}
