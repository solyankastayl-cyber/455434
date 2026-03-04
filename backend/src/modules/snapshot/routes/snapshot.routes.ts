/**
 * SNAPSHOT ROUTES
 * ===============
 * 
 * API for creating and viewing snapshots
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { snapshotService } from '../services/snapshot.service.js';

export async function registerSnapshotRoutes(app: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC: GET /api/public/snapshot/:id
  // No auth, read-only, for share links
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/public/snapshot/:id', async (req: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const result = await snapshotService.getSnapshot(req.params.id);
    
    if (!result.ok) {
      return reply.status(404).send(result);
    }
    
    return reply.send(result);
  });
  
  // ═══════════════════════════════════════════════════════════════
  // POST /api/v10/snapshot/create
  // Create a new snapshot from current state
  // ═══════════════════════════════════════════════════════════════
  app.post('/api/v10/snapshot/create', async (req: FastifyRequest<{
    Body: { symbol: string }
  }>, reply: FastifyReply) => {
    const { symbol } = req.body;
    
    if (!symbol) {
      return reply.status(400).send({ ok: false, error: 'Symbol required' });
    }
    
    const result = await snapshotService.createSnapshot({ symbol });
    
    return reply.send(result);
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/v10/snapshot/recent/:symbol
  // Get recent snapshots for a symbol
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/v10/snapshot/recent/:symbol', async (req: FastifyRequest<{
    Params: { symbol: string },
    Querystring: { limit?: string }
  }>, reply: FastifyReply) => {
    const limit = parseInt(req.query.limit || '10', 10);
    const snapshots = await snapshotService.getRecentSnapshots(req.params.symbol, limit);
    
    return reply.send({ ok: true, snapshots });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/v10/snapshot/stats
  // Get snapshot statistics
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/v10/snapshot/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    const stats = await snapshotService.getStats();
    
    return reply.send({ ok: true, stats });
  });
}
