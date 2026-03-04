/**
 * FOMO AI WebSocket Routes
 * 
 * Admin endpoints for managing FOMO WS monitors
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { 
  startFomoMonitor, 
  stopFomoMonitor, 
  getMonitorStatus,
  triggerBroadcast,
} from '../services/fomo.ws.service.js';

export async function fomoWsRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v10/fomo/ws/status
   * Get FOMO WS monitor status
   */
  app.get('/api/v10/fomo/ws/status', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const status = getMonitorStatus();
    
    return reply.send({
      ok: true,
      ...status,
    });
  });

  /**
   * POST /api/v10/fomo/ws/monitor/start
   * Start monitoring a symbol
   */
  app.post('/api/v10/fomo/ws/monitor/start', async (
    request: FastifyRequest<{ Body: { symbol: string } }>,
    reply: FastifyReply
  ) => {
    const { symbol } = request.body || {};
    
    if (!symbol) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_SYMBOL',
      });
    }
    
    startFomoMonitor(symbol.toUpperCase());
    
    return reply.send({
      ok: true,
      symbol: symbol.toUpperCase(),
      status: 'MONITORING',
    });
  });

  /**
   * POST /api/v10/fomo/ws/monitor/stop
   * Stop monitoring a symbol
   */
  app.post('/api/v10/fomo/ws/monitor/stop', async (
    request: FastifyRequest<{ Body: { symbol: string } }>,
    reply: FastifyReply
  ) => {
    const { symbol } = request.body || {};
    
    if (!symbol) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_SYMBOL',
      });
    }
    
    stopFomoMonitor(symbol.toUpperCase());
    
    return reply.send({
      ok: true,
      symbol: symbol.toUpperCase(),
      status: 'STOPPED',
    });
  });

  /**
   * POST /api/v10/fomo/ws/broadcast
   * Manually trigger broadcast for a symbol
   */
  app.post('/api/v10/fomo/ws/broadcast', async (
    request: FastifyRequest<{ Body: { symbol: string } }>,
    reply: FastifyReply
  ) => {
    const { symbol } = request.body || {};
    
    if (!symbol) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_SYMBOL',
      });
    }
    
    await triggerBroadcast(symbol.toUpperCase());
    
    return reply.send({
      ok: true,
      symbol: symbol.toUpperCase(),
      status: 'BROADCAST_SENT',
    });
  });

  app.log.info('[FOMO WS] WebSocket routes registered');
}

console.log('[FOMO WS] Routes loaded');
