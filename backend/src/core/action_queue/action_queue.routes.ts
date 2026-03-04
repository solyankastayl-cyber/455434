/**
 * Action Queue Routes (Phase 13.2)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as service from './action_queue.service.js';
import { z } from 'zod';

const QueueActionBody = z.object({
  source: z.object({
    type: z.enum(['signal', 'strategy_signal', 'alert', 'decision', 'playbook', 'manual']),
    id: z.string(),
    playbookId: z.string().optional(),
  }),
  actionType: z.enum(['watch', 'follow', 'unfollow', 'add_to_watchlist', 'remove_from_watchlist', 'create_alert_rule', 'notify', 'paper_entry', 'paper_exit', 'simulate_copy', 'open_entity']),
  target: z.object({
    type: z.enum(['actor', 'token', 'entity', 'strategy']),
    id: z.string(),
    label: z.string().optional(),
  }),
  payload: z.record(z.any()).optional(),
  priority: z.number().min(1).max(5).optional(),
  explanation: z.string(),
  scheduledAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

const ProcessSignalBody = z.object({
  id: z.string(),
  type: z.string(),
  severity: z.number(),
  confidence: z.number(),
  stability: z.number().optional(),
  strategyType: z.string().optional(),
  risk: z.number().optional(),
  influence: z.number().optional(),
  score: z.number().optional(),
  actorAddress: z.string().optional(),
  tokenAddress: z.string().optional(),
  intensity: z.number().optional(),
});

export async function actionQueueRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/actions/queue
   * Get user's action queue
   */
  app.get('/queue', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const query = request.query as { status?: string; limit?: string };
    
    const actions = await service.getActionQueue(userId, {
      status: query.status as any,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
    
    return { ok: true, data: actions, count: actions.length };
  });
  
  /**
   * POST /api/action-queue/queue
   * Manually queue an action
   */
  app.post('/queue', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const body = QueueActionBody.parse(request.body);
    
    const result = await service.queueAction(userId, {
      ...body,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
    
    return { 
      ok: result.queued, 
      data: result.action,
      queued: result.queued,
      skipped: result.skipped,
      skipReason: result.skipReason,
      message: result.message,
    };
  });
  
  /**
   * POST /api/action-queue/process-signal
   * Process a signal through user's playbooks
   * 
   * IMPORTANT: This ONLY queues actions, does NOT auto-execute them.
   * Use ?dryRun=true to see what would be queued without writing to DB.
   */
  app.post('/process-signal', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const query = request.query as { dryRun?: string };
    const body = ProcessSignalBody.parse(request.body);
    
    const dryRun = query.dryRun === 'true' || query.dryRun === '1';
    
    const result = await service.processSignalThroughPlaybooks(userId, body, dryRun);
    return { 
      ok: true, 
      dryRun,
      data: result,
    };
  });
  
  /**
   * GET /api/action-queue/stats
   * Get action queue statistics
   */
  app.get('/stats', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const stats = await service.getActionQueueStats(userId);
    return { ok: true, data: stats };
  });
  
  /**
   * POST /api/actions/:id/run
   * Manually execute an action
   */
  app.post('/:id/run', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    
    const action = await service.executeAction(id);
    if (!action) {
      return { ok: false, error: 'Action not found' };
    }
    
    return { ok: true, data: action };
  });
  
  /**
   * POST /api/actions/:id/cancel
   * Cancel an action
   */
  app.post('/:id/cancel', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string };
    
    const action = await service.cancelAction(id, userId, body?.reason);
    if (!action) {
      return { ok: false, error: 'Action not found' };
    }
    
    return { ok: true, data: action };
  });
  
  app.log.info('Action Queue routes registered');
}
