/**
 * P5.8 — REGIME-CONDITIONED CALIBRATION ROUTES
 * 
 * Endpoints:
 * - POST /api/macro-engine/v2/calibration/run?mode=regime-conditioned
 * - GET  /api/macro-engine/v2/calibration/weights?mode=regime-conditioned
 * - POST /api/macro-engine/v2/calibration/promote-rc
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { 
  getRCCalibrationService,
  RCCalibrationRequest,
  HorizonKey,
  RegimeKey,
} from './rc_calibration.service.js';

export async function registerRCCalibrationRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/macro-engine/v2/calibration/run-rc
  // Run regime-conditioned calibration
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/api/macro-engine/v2/calibration/run-rc', async (
    request: FastifyRequest<{
      Body: Partial<RCCalibrationRequest>;
    }>,
    reply: FastifyReply
  ) => {
    const body = request.body || {};
    
    const calibrationRequest: RCCalibrationRequest = {
      asset: body.asset || 'dxy',
      from: body.from || '2018-01-01',
      to: body.to || new Date().toISOString().split('T')[0],
      stepDays: body.stepDays || 7,
      horizons: (body.horizons as HorizonKey[]) || ['30D', '90D', '180D', '365D'],
      lags: body.lags || [10, 30, 60, 90, 120, 180],
      minRegimeCoverage: body.minRegimeCoverage || 0.10,
      minSamplesPerRegime: body.minSamplesPerRegime || 20,
      seed: body.seed || 42,
    };
    
    try {
      const service = getRCCalibrationService();
      const result = await service.runCalibration(calibrationRequest);
      
      return reply.send({ ok: true, data: result });
    } catch (e) {
      console.error('[RC Calibration Route] Error:', (e as Error).message);
      return reply.status(500).send({
        ok: false,
        error: 'RC_CALIBRATION_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/v2/calibration/weights-rc
  // Get regime-conditioned weights
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/macro-engine/v2/calibration/weights-rc', async (
    request: FastifyRequest<{
      Querystring: { 
        horizon?: string;
        regime?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    const { horizon, regime } = request.query;
    
    try {
      const service = getRCCalibrationService();
      const active = service.getActiveVersion();
      
      if (!active) {
        return reply.send({
          ok: true,
          data: {
            active: false,
            message: 'No RC calibration active. Run calibration first.',
          },
        });
      }
      
      // If specific horizon/regime requested
      if (horizon && regime) {
        const weights = service.getWeightsForContext(
          horizon as HorizonKey,
          regime as RegimeKey
        );
        
        return reply.send({
          ok: true,
          data: {
            versionId: active.versionId,
            horizon,
            regime,
            weights,
          },
        });
      }
      
      // Return full weights structure
      return reply.send({
        ok: true,
        data: {
          versionId: active.versionId,
          mode: 'regime-conditioned',
          horizons: active.horizons,
          regimes: active.regimes,
          weights: active.weights,
          diagnostics: active.diagnostics,
          metrics: active.metrics,
        },
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'RC_WEIGHTS_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/macro-engine/v2/calibration/promote-rc
  // Promote RC version
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/api/macro-engine/v2/calibration/promote-rc', async (
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
      const service = getRCCalibrationService();
      const result = await service.promoteVersion(versionId);
      
      return reply.send({ ok: true, data: result });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'RC_PROMOTE_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/v2/calibration/rc-status
  // Get RC calibration status
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/macro-engine/v2/calibration/rc-status', async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const service = getRCCalibrationService();
      const active = service.getActiveVersion();
      
      return reply.send({
        ok: true,
        data: {
          hasActive: !!active,
          versionId: active?.versionId || null,
          mode: active ? 'regime-conditioned' : 'none',
          horizons: active?.horizons || [],
          regimes: active?.regimes || [],
          metricsPreview: active?.metrics 
            ? Object.fromEntries(
                Object.entries(active.metrics).map(([h, m]) => [
                  h,
                  { v2HitRate: m.v2.hitRate, deltaPp: m.delta.hitRate }
                ])
              )
            : null,
        },
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'RC_STATUS_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  console.log('[RC Calibration] Routes registered');
}
