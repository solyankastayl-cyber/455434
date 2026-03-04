/**
 * Playbooks Routes (Phase 13.1)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as service from './playbooks.service.js';
import { z } from 'zod';

const CreatePlaybookBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  scope: z.enum(['actor', 'entity', 'token', 'strategy', 'corridor', 'global']),
  scopeTargets: z.array(z.string()).optional(),
  triggerTypes: z.array(z.string()).min(1),
  conditions: z.object({
    minSeverity: z.number().min(0).max(100).optional(),
    maxSeverity: z.number().min(0).max(100).optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    minStability: z.number().min(0).max(1).optional(),
    allowedStrategies: z.array(z.string()).optional(),
    blockedStrategies: z.array(z.string()).optional(),
    riskMax: z.number().min(0).max(100).optional(),
    influenceMin: z.number().min(0).max(100).optional(),
    minScore: z.number().min(0).max(100).optional(),
  }).optional(),
  actions: z.array(z.object({
    type: z.enum(['watch', 'follow', 'add_to_watchlist', 'create_alert_rule', 'open_entity', 'open_graph', 'simulate_copy', 'notify', 'paper_entry', 'paper_exit']),
    params: z.record(z.any()).optional(),
    priority: z.number().min(1).max(5).optional(),
    delaySeconds: z.number().optional(),
  })).min(1),
  timeHorizon: z.enum(['1d', '7d', '30d', 'unlimited']).optional(),
  cooldownMinutes: z.number().min(0).optional(),
});

const UpdatePlaybookBody = CreatePlaybookBody.partial();

export async function playbooksRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/playbooks
   * Create a new playbook
   */
  app.post('/', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const body = CreatePlaybookBody.parse(request.body);
    
    const playbook = await service.createPlaybook(userId, body);
    return { ok: true, data: playbook };
  });
  
  /**
   * GET /api/playbooks
   * Get user's playbooks
   */
  app.get('/', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const query = request.query as { enabled?: string; scope?: string };
    
    const playbooks = await service.getPlaybooks(userId, {
      enabled: query.enabled === 'true' ? true : query.enabled === 'false' ? false : undefined,
      scope: query.scope,
    });
    
    return { ok: true, data: playbooks, count: playbooks.length };
  });
  
  /**
   * GET /api/playbooks/templates
   * Get available templates
   */
  app.get('/templates', async () => {
    const templates = service.getPlaybookTemplates();
    return { ok: true, data: templates };
  });
  
  /**
   * POST /api/playbooks/from-template
   * Create from template
   */
  app.post('/from-template', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const body = request.body as { templateIndex: number; overrides?: any };
    
    const playbook = await service.createFromTemplate(userId, body.templateIndex, body.overrides);
    if (!playbook) {
      return { ok: false, error: 'Template not found' };
    }
    
    return { ok: true, data: playbook };
  });
  
  /**
   * GET /api/playbooks/stats
   * Get playbook statistics
   */
  app.get('/stats', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const stats = await service.getPlaybookStats(userId);
    return { ok: true, data: stats };
  });
  
  /**
   * GET /api/playbooks/:id
   * Get single playbook
   */
  app.get('/:id', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const { id } = request.params as { id: string };
    
    const playbook = await service.getPlaybookById(id, userId);
    if (!playbook) {
      return { ok: false, error: 'Playbook not found' };
    }
    
    return { ok: true, data: playbook };
  });
  
  /**
   * PUT /api/playbooks/:id
   * Update playbook
   */
  app.put('/:id', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const { id } = request.params as { id: string };
    const body = UpdatePlaybookBody.parse(request.body);
    
    const playbook = await service.updatePlaybook(id, userId, body);
    if (!playbook) {
      return { ok: false, error: 'Playbook not found' };
    }
    
    return { ok: true, data: playbook };
  });
  
  /**
   * DELETE /api/playbooks/:id
   * Delete playbook
   */
  app.delete('/:id', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const { id } = request.params as { id: string };
    
    const deleted = await service.deletePlaybook(id, userId);
    return { ok: deleted, message: deleted ? 'Deleted' : 'Not found' };
  });
  
  /**
   * POST /api/playbooks/:id/toggle
   * Toggle playbook enabled state
   */
  app.post('/:id/toggle', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const { id } = request.params as { id: string };
    
    const playbook = await service.togglePlaybook(id, userId);
    if (!playbook) {
      return { ok: false, error: 'Playbook not found' };
    }
    
    return { ok: true, data: playbook, message: playbook.enabled ? 'Enabled' : 'Disabled' };
  });
  
  app.log.info('Playbooks routes registered');
}
