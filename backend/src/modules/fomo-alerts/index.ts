/**
 * FOMO Alerts Module Index
 */

import { FastifyInstance } from 'fastify';
import { fomoAlertEngine } from './services/fomo-alert.engine.js';
import { getFomoAlertConfig, updateFomoAlertConfig, FomoAlertLogModel } from './storage/fomo-alert.model.js';
import { FomoAlertConfig } from './contracts/fomo-alert.types.js';

// Exports
export { fomoAlertEngine } from './services/fomo-alert.engine.js';
export * from './contracts/fomo-alert.types.js';
export { getFomoAlertConfig, updateFomoAlertConfig } from './storage/fomo-alert.model.js';

/**
 * Register FOMO Alert Routes
 */
export async function registerFomoAlertRoutes(app: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/v10/fomo-alerts/config
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/v10/fomo-alerts/config', async (req, reply) => {
    const config = await getFomoAlertConfig();
    
    // Mask tokens
    const safeConfig = {
      ...config,
      user: {
        ...config.user,
        botToken: config.user.botToken ? '***CONFIGURED***' : undefined,
      },
      admin: {
        ...config.admin,
        botToken: config.admin.botToken ? '***CONFIGURED***' : undefined,
      },
    };
    
    return reply.send({ ok: true, config: safeConfig });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PATCH /api/v10/fomo-alerts/config
  // ═══════════════════════════════════════════════════════════════
  app.patch('/api/v10/fomo-alerts/config', async (req, reply) => {
    const update = req.body as Partial<FomoAlertConfig>;
    
    await updateFomoAlertConfig(update);
    await fomoAlertEngine.reloadConfig();
    
    return reply.send({ ok: true, message: 'Config updated' });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // POST /api/v10/fomo-alerts/test/:scope
  // ═══════════════════════════════════════════════════════════════
  app.post<{ Params: { scope: string } }>('/api/v10/fomo-alerts/test/:scope', async (req, reply) => {
    const scope = req.params.scope.toUpperCase() as 'USER' | 'ADMIN';
    
    if (!['USER', 'ADMIN'].includes(scope)) {
      return reply.status(400).send({ ok: false, error: 'Invalid scope' });
    }
    
    const result = await fomoAlertEngine.testAlert(scope);
    
    return reply.send({
      ok: result.ok,
      message: result.ok ? 'Test alert sent' : 'Test failed',
      error: result.error,
    });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/v10/fomo-alerts/logs
  // ═══════════════════════════════════════════════════════════════
  app.get<{ Querystring: { limit?: string } }>('/api/v10/fomo-alerts/logs', async (req, reply) => {
    const limit = parseInt(req.query.limit || '100', 10);
    const logs = await fomoAlertEngine.getAlertLogs(limit);
    
    return reply.send({ ok: true, logs });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/v10/fomo-alerts/stats
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/v10/fomo-alerts/stats', async (req, reply) => {
    const stats = await fomoAlertEngine.getAlertStats();
    
    return reply.send({ ok: true, stats });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/v10/fomo-alerts/preview
  // Preview message without sending
  // ═══════════════════════════════════════════════════════════════
  app.post('/api/v10/fomo-alerts/preview', async (req, reply) => {
    const { event, payload } = req.body as { event: string; payload: any };
    
    try {
      const { buildFomoAlertMessage } = await import('./services/fomo-alert-message.builder.js');
      const { text, title } = buildFomoAlertMessage(event as any, payload);
      
      return reply.send({ 
        ok: true, 
        preview: {
          title,
          text,
          scope: payload.symbol ? 'USER' : 'ADMIN',
        }
      });
    } catch (err: any) {
      return reply.status(400).send({ ok: false, error: err.message });
    }
  });
  
  console.log('[FomoAlerts] Routes registered');
}
