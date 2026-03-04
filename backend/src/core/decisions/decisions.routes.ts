/**
 * Decisions Routes
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as service from './decisions.service.js';
import {
  GetDecisionParams,
  GetDecisionHistoryQuery,
  GetRecommendedQuery,
} from './decisions.schema.js';

export async function decisionsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/decisions/actor/:address
   * Get or generate decision for actor
   */
  app.get('/actor/:address', async (request: FastifyRequest) => {
    const params = GetDecisionParams.parse(request.params);
    
    // Try to get existing decision
    let decision = await service.getActorDecision(params.address);
    
    // Generate if not exists or expired
    if (!decision) {
      decision = await service.generateActorDecision(params.address);
    }
    
    return { ok: true, data: decision };
  });
  
  /**
   * POST /api/decisions/actor/:address/refresh
   * Force regenerate decision
   */
  app.post('/actor/:address/refresh', async (request: FastifyRequest) => {
    const params = GetDecisionParams.parse(request.params);
    
    const decision = await service.generateActorDecision(params.address);
    
    return { ok: true, data: decision };
  });
  
  /**
   * GET /api/decisions/actor/:address/history
   * Get decision history for actor
   */
  app.get('/actor/:address/history', async (request: FastifyRequest) => {
    const params = GetDecisionParams.parse(request.params);
    const query = GetDecisionHistoryQuery.parse(request.query);
    
    const history = await service.getDecisionHistory('actor', params.address, query.limit);
    
    return { ok: true, data: history, count: history.length };
  });
  
  /**
   * GET /api/decisions/recommended/follow
   * Get recommended actors to follow
   */
  app.get('/recommended/follow', async (request: FastifyRequest) => {
    const query = GetRecommendedQuery.parse(request.query);
    
    const decisions = await service.getRecommendedFollows(query.limit);
    
    return { ok: true, data: decisions, count: decisions.length };
  });
  
  /**
   * GET /api/decisions/recommended/copy
   * Get recommended strategies to copy
   */
  app.get('/recommended/copy', async (request: FastifyRequest) => {
    const query = GetRecommendedQuery.parse(request.query);
    
    const decisions = await service.getRecommendedCopies(query.limit);
    
    return { ok: true, data: decisions, count: decisions.length };
  });
  
  /**
   * GET /api/decisions/stats
   * Get decisions statistics
   */
  app.get('/stats', async () => {
    const stats = await service.getStats();
    return { ok: true, data: stats };
  });
}
