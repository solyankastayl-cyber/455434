/**
 * Trust Routes
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './trust.service.js';
import {
  GetActorTrustParams,
  GetDecisionTypeTrustParams,
  GetHighTrustQuery,
} from './trust.schema.js';

export async function trustRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/trust/system
   * Get system-wide trust score
   */
  app.get('/system', async () => {
    const trust = await service.getSystemTrust();
    
    if (!trust) {
      return { ok: true, data: null, message: 'No trust data available yet' };
    }
    
    return { ok: true, data: trust };
  });
  
  /**
   * GET /api/trust/transparency
   * Get full transparency report
   */
  app.get('/transparency', async () => {
    const report = await service.getTransparencyReport();
    return { ok: true, data: report };
  });
  
  /**
   * GET /api/trust/decision-type/:decisionType
   * Get trust for decision type
   */
  app.get('/decision-type/:decisionType', async (request: FastifyRequest) => {
    const params = GetDecisionTypeTrustParams.parse(request.params);
    
    const trust = await service.getTrustByDecisionType(params.decisionType);
    
    if (!trust) {
      return { ok: true, data: null, message: 'No trust data for this decision type' };
    }
    
    return { ok: true, data: trust };
  });
  
  /**
   * GET /api/trust/actor/:address
   * Get trust for actor
   */
  app.get('/actor/:address', async (request: FastifyRequest) => {
    const params = GetActorTrustParams.parse(request.params);
    
    const trust = await service.getTrust('actor', params.address);
    
    if (!trust) {
      return { ok: true, data: null, message: 'No trust data for this actor' };
    }
    
    return { ok: true, data: trust };
  });
  
  /**
   * GET /api/trust/high-trust-actors
   * Get actors with high trust scores
   */
  app.get('/high-trust-actors', async (request: FastifyRequest) => {
    const query = GetHighTrustQuery.parse(request.query);
    
    const actors = await service.getHighTrustActors(query.limit);
    
    return { ok: true, data: actors, count: actors.length };
  });
  
  /**
   * POST /api/trust/calculate/system
   * Recalculate system trust (admin)
   */
  app.post('/calculate/system', async () => {
    const trust = await service.calculateSystemTrust();
    return { ok: true, data: trust };
  });
  
  /**
   * POST /api/trust/calculate/actor/:address
   * Recalculate actor trust (admin)
   */
  app.post('/calculate/actor/:address', async (request: FastifyRequest) => {
    const params = GetActorTrustParams.parse(request.params);
    
    const trust = await service.calculateActorTrust(params.address);
    
    return { ok: true, data: trust };
  });
  
  /**
   * GET /api/trust/stats
   * Get trust statistics
   */
  app.get('/stats', async () => {
    const stats = await service.getStats();
    return { ok: true, data: stats };
  });
}
