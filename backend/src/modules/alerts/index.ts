/**
 * ALERTS MODULE — Index
 */

import { FastifyInstance } from 'fastify';

// Types
export * from './contracts/alert.types.js';

// Services
export { alertDispatcher } from './services/alert.dispatcher.js';
export { telegramSender } from './services/telegram.sender.js';

// Storage
export { ProductAlertModel, AlertSettingsModel, getAlertSettings, updateAlertSettings } from './storage/alert.model.js';

/**
 * Register Alert Routes
 */
export async function registerAlertRoutes(app: FastifyInstance): Promise<void> {
  console.log('[Alerts] Loading dispatcher...');
  const { alertDispatcher } = await import('./services/alert.dispatcher.js');
  console.log('[Alerts] Loading storage...');
  const { getAlertSettings, updateAlertSettings, AlertModel } = await import('./storage/alert.model.js');
  console.log('[Alerts] Loading types...');
  
  // GET /api/v10/alerts/settings
  app.get('/api/v10/alerts/settings', async (req, reply) => {
    try {
      const settings = await getAlertSettings();
      
      // Mask sensitive data
      const safeSettings = {
        ...settings,
        telegram: {
          ...settings.telegram,
          botToken: settings.telegram.botToken ? '***CONFIGURED***' : undefined,
        },
        discord: {
          ...settings.discord,
          webhookUrl: settings.discord.webhookUrl ? '***CONFIGURED***' : undefined,
        },
      };
      
      return reply.send({ ok: true, settings: safeSettings });
    } catch (err: any) {
      console.error('[Alerts] settings error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });
  
  // PATCH /api/v10/alerts/settings
  app.patch('/api/v10/alerts/settings', async (req, reply) => {
    const update = req.body as any;
    
    await updateAlertSettings(update);
    await alertDispatcher.reloadSettings();
    
    return reply.send({ ok: true, message: 'Settings updated' });
  });
  
  // POST /api/v10/alerts/test/:channel
  app.post<{ Params: { channel: string } }>('/api/v10/alerts/test/:channel', async (req, reply) => {
    const channel = req.params.channel.toUpperCase() as any;
    
    if (!['TELEGRAM', 'DISCORD'].includes(channel)) {
      return reply.status(400).send({ ok: false, error: 'Invalid channel' });
    }
    
    const result = await alertDispatcher.testAlert(channel);
    
    return reply.send({
      ok: result.ok,
      message: result.ok ? 'Test alert sent' : 'Test failed',
      error: result.error,
    });
  });
  
  // GET /api/v10/alerts/history
  app.get<{ Querystring: { limit?: string } }>('/api/v10/alerts/history', async (req, reply) => {
    const limit = parseInt(req.query.limit || '50', 10);
    const alerts = await alertDispatcher.getAlertHistory(limit);
    
    return reply.send({ ok: true, alerts });
  });
  
  // GET /api/v10/alerts/stats
  app.get('/api/v10/alerts/stats', async (req, reply) => {
    const stats = await alertDispatcher.getAlertStats();
    
    return reply.send({ ok: true, stats });
  });
  
  console.log('[Alerts] Routes registered');
}

