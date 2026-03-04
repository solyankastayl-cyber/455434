/**
 * Action Explanations Routes (Phase 13.4)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as service from './action_explain.service.js';

export async function actionExplainRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/explain/action/:id
   * Explain a queued action
   */
  app.get('/action/:id', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    
    const explanation = await service.explainAction(id);
    if (!explanation) {
      return { ok: false, error: 'Action not found' };
    }
    
    return { ok: true, data: explanation };
  });
  
  /**
   * GET /api/explain/suggestion/:id
   * Explain a suggestion
   */
  app.get('/suggestion/:id', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    
    const explanation = await service.explainSuggestion(id);
    if (!explanation) {
      return { ok: false, error: 'Suggestion not found' };
    }
    
    return { ok: true, data: explanation };
  });
  
  /**
   * GET /api/explain/portfolio/:id
   * Explain portfolio performance
   */
  app.get('/portfolio/:id', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    
    const explanation = await service.explainPortfolioPerformance(id);
    if (!explanation) {
      return { ok: false, error: 'Portfolio not found' };
    }
    
    return { ok: true, data: explanation };
  });
  
  app.log.info('Action Explain routes registered');
}
