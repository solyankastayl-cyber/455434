/**
 * Actions Routes
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './actions.service.js';
import { GetSuggestedQuery, ActionIdParams, GetHistoryQuery } from './actions.schema.js';

function getUserId(request: FastifyRequest): string {
  return (request.headers['x-user-id'] as string) || 'anonymous';
}

export async function actionsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/actions/suggested
   * Get suggested actions
   */
  app.get('/suggested', async (request: FastifyRequest) => {
    const userId = getUserId(request);
    const query = GetSuggestedQuery.parse(request.query);
    
    const actions = await service.getSuggestedActions(userId, query.limit);
    
    return { ok: true, data: actions, count: actions.length };
  });
  
  /**
   * POST /api/actions/:id/accept
   * Accept suggested action
   */
  app.post('/:id/accept', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = ActionIdParams.parse(request.params);
    
    const action = await service.acceptAction(params.id);
    
    if (!action) {
      return reply.status(404).send({ ok: false, error: 'Action not found' });
    }
    
    return { ok: true, data: action };
  });
  
  /**
   * POST /api/actions/:id/dismiss
   * Dismiss suggested action
   */
  app.post('/:id/dismiss', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = ActionIdParams.parse(request.params);
    
    const action = await service.dismissAction(params.id);
    
    if (!action) {
      return reply.status(404).send({ ok: false, error: 'Action not found' });
    }
    
    return { ok: true, data: action };
  });
  
  /**
   * GET /api/actions/history
   * Get user's action history
   */
  app.get('/history', async (request: FastifyRequest) => {
    const userId = getUserId(request);
    const query = GetHistoryQuery.parse(request.query);
    
    const actions = await service.getActionHistory(userId, query.limit);
    
    return { ok: true, data: actions, count: actions.length };
  });
  
  /**
   * GET /api/actions/stats
   * Get actions statistics
   */
  app.get('/stats', async () => {
    const stats = await service.getStats();
    return { ok: true, data: stats };
  });
}
