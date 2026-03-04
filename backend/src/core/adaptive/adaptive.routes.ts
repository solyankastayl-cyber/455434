/**
 * Adaptive Routes
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './adaptive.service.js';
import {
  GetWeightsQuery,
  GetConfidenceParams,
  GetStrategyParams,
  GetExplainParams,
} from './adaptive.schema.js';
import { ADAPTIVE_VERSION } from '../../config/env.js';

export async function adaptiveRoutes(app: FastifyInstance): Promise<void> {
  // Add adaptive version header to all responses
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Adaptive-Version', ADAPTIVE_VERSION);
  });
  
  /**
   * GET /api/adaptive/weights
   * Get current adaptive weights
   */
  app.get('/weights', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = GetWeightsQuery.parse(request.query);
    
    const weights = await service.getWeights(query.scope);
    
    return { ok: true, data: weights, count: weights.length, adaptiveVersion: ADAPTIVE_VERSION };
  });
  
  /**
   * GET /api/adaptive/weights/effective
   * Get effective score weights (for scoring calculations)
   */
  app.get('/weights/effective', async () => {
    const weights = await service.getEffectiveScoreWeights();
    return { ok: true, data: weights };
  });
  
  /**
   * GET /api/adaptive/confidence/:address
   * Get confidence calibration for address (via decision type)
   */
  app.get('/confidence/:address', async (request: FastifyRequest) => {
    const params = GetConfidenceParams.parse(request.params);
    
    // Get decision for this address to find decision type
    const explanation = await service.getAdaptiveExplanation(params.address);
    
    return {
      ok: true,
      data: {
        calibration: explanation.confidenceCalibration,
        address: params.address,
      },
    };
  });
  
  /**
   * GET /api/adaptive/strategy/:type
   * Get strategy reliability
   */
  app.get('/strategy/:type', async (request: FastifyRequest) => {
    const params = GetStrategyParams.parse(request.params);
    
    const reliability = await service.getStrategyReliability(params.type);
    
    if (!reliability) {
      return { ok: true, data: null, message: 'Strategy type not found' };
    }
    
    return { ok: true, data: reliability };
  });
  
  /**
   * GET /api/adaptive/strategies
   * Get all strategy reliabilities
   */
  app.get('/strategies', async () => {
    const strategies = await service.getAllStrategyReliabilities();
    return { ok: true, data: strategies, count: strategies.length };
  });
  
  /**
   * GET /api/adaptive/explain/:address
   * Get adaptive explanation for address (debug/transparency)
   */
  app.get('/explain/:address', async (request: FastifyRequest) => {
    const params = GetExplainParams.parse(request.params);
    
    const explanation = await service.getAdaptiveExplanation(params.address);
    
    return { ok: true, data: explanation };
  });
  
  /**
   * POST /api/adaptive/recompute
   * Force recompute of adaptive system (admin)
   */
  app.post('/recompute', async () => {
    const result = await service.forceRecompute();
    return { ok: true, data: result };
  });
  
  /**
   * GET /api/adaptive/stats
   * Get adaptive statistics
   */
  app.get('/stats', async () => {
    const stats = await service.getAdaptiveStats();
    return { ok: true, data: stats };
  });
}
