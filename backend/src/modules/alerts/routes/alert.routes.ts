/**
 * ALERT ROUTES
 * ============
 * 
 * Admin API for alert management
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { alertDispatcher } from '../services/alert.dispatcher.js';
import { updateAlertSettings, getAlertSettings } from '../storage/alert.model.js';
import { AlertSettings, AlertChannel } from '../contracts/alert.types.js';

export async function registerAlertRoutes(app: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/v10/alerts/settings
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/v10/alerts/settings', async (req: FastifyRequest, reply: FastifyReply) => {
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
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PATCH /api/v10/alerts/settings
  // ═══════════════════════════════════════════════════════════════
  app.patch('/api/v10/alerts/settings', async (req: FastifyRequest, reply: FastifyReply) => {
    const update = req.body as Partial<AlertSettings>;
    
    const settings = await updateAlertSettings(update);
    await alertDispatcher.reloadSettings();
    
    return reply.send({ ok: true, message: 'Settings updated' });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // POST /api/v10/alerts/test/:channel
  // ═══════════════════════════════════════════════════════════════
  app.post('/api/v10/alerts/test/:channel', async (req: FastifyRequest<{
    Params: { channel: string }
  }>, reply: FastifyReply) => {
    const channel = req.params.channel.toUpperCase() as AlertChannel;
    
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
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/v10/alerts/history
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/v10/alerts/history', async (req: FastifyRequest<{
    Querystring: { limit?: string }
  }>, reply: FastifyReply) => {
    const limit = parseInt(req.query.limit || '50', 10);
    const alerts = await alertDispatcher.getAlertHistory(limit);
    
    return reply.send({ ok: true, alerts });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/v10/alerts/stats
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/v10/alerts/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    const stats = await alertDispatcher.getAlertStats();
    
    return reply.send({ ok: true, stats });
  });
}
