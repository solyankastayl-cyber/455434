/**
 * V2 CALIBRATION OBJECTIVE ROUTES — P5.6 + P5.9
 * 
 * Endpoints:
 * - POST /api/macro-engine/v2/calibration/run (objective optimization)
 * - GET  /api/macro-engine/v2/calibration/active
 * - POST /api/macro-engine/v2/calibration/promote
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { 
  getV2CalibrationObjectiveService, 
  CalibrationRunRequest,
  HorizonKey,
  Objective 
} from './v2_calibration_objective.service.js';

export async function registerV2CalibrationObjectiveRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/macro-engine/v2/calibration/run
  // Run calibration with objective optimization
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/api/macro-engine/v2/calibration/run-objective', async (
    request: FastifyRequest<{
      Body: Partial<CalibrationRunRequest>;
    }>,
    reply: FastifyReply
  ) => {
    const body = request.body || {};
    
    // Build request with defaults
    const calibrationRequest: CalibrationRunRequest = {
      asset: 'dxy',
      from: body.from || '2015-01-01',
      to: body.to || new Date().toISOString().split('T')[0],
      stepDays: body.stepDays || 7,
      horizons: (body.horizons as HorizonKey[]) || ['30D', '90D', '180D', '365D'],
      objective: (body.objective as Objective) || 'HIT_RATE',
      search: body.search || {
        method: 'random',
        trials: 1500,
        seed: 42,
      },
      constraints: body.constraints || {
        sumWeights: 1.0,
        maxWeight: 0.35,
        minWeight: 0.02,
      },
      perHorizon: body.perHorizon !== false,
      asOf: body.asOf !== false,
    };
    
    try {
      const service = getV2CalibrationObjectiveService();
      const result = await service.runCalibration(calibrationRequest);
      
      return reply.send({ ok: true, data: result });
    } catch (e) {
      console.error('[V2 Calibration Route] Error:', (e as Error).message);
      return reply.status(500).send({
        ok: false,
        error: 'CALIBRATION_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/v2/calibration/active
  // Get currently active weights
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/macro-engine/v2/calibration/active', async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const service = getV2CalibrationObjectiveService();
      const active = service.getActiveVersion();
      
      return reply.send({
        ok: true,
        data: {
          activeVersionId: active.versionId,
          perHorizon: active.perHorizon,
          weights: active.weights,
        },
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'ACTIVE_WEIGHTS_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/macro-engine/v2/calibration/promote
  // Promote a calibration version to active
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/api/macro-engine/v2/calibration/promote', async (
    request: FastifyRequest<{
      Body: { versionId: string };
    }>,
    reply: FastifyReply
  ) => {
    const { versionId } = request.body || {};
    
    if (!versionId) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_VERSION_ID',
        message: 'versionId is required',
      });
    }
    
    try {
      const service = getV2CalibrationObjectiveService();
      const result = await service.promoteVersion(versionId);
      
      return reply.send({ ok: true, data: result });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'PROMOTE_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/v2/calibration/weights/:horizon
  // Get weights for specific horizon
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/macro-engine/v2/calibration/weights/:horizon', async (
    request: FastifyRequest<{
      Params: { horizon: string };
    }>,
    reply: FastifyReply
  ) => {
    const { horizon } = request.params;
    
    if (!['30D', '90D', '180D', '365D'].includes(horizon)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_HORIZON',
        message: `Horizon must be one of: 30D, 90D, 180D, 365D`,
      });
    }
    
    try {
      const service = getV2CalibrationObjectiveService();
      const weights = service.getActiveWeights(horizon as HorizonKey);
      
      return reply.send({
        ok: true,
        data: {
          horizon,
          weights,
        },
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'WEIGHTS_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  console.log('[V2 Calibration] Objective routes registered');
}
