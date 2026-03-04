/**
 * SNAPSHOT MODULE — Index
 */

import { FastifyInstance } from 'fastify';

// Types
export * from './contracts/snapshot.types.js';

// Services
export { snapshotService } from './services/snapshot.service.js';

// Storage
export { SnapshotModel } from './storage/snapshot.model.js';

/**
 * Register Snapshot Routes
 */
export async function registerSnapshotRoutes(app: FastifyInstance): Promise<void> {
  const { snapshotService } = await import('./services/snapshot.service.js');
  
  // PUBLIC: GET /api/public/snapshot/:id
  // No auth, read-only, for share links
  app.get<{ Params: { id: string } }>('/api/public/snapshot/:id', async (req, reply) => {
    const result = await snapshotService.getSnapshot(req.params.id);
    
    if (!result.ok) {
      return reply.status(404).send(result);
    }
    
    return reply.send(result);
  });
  
  // POST /api/v10/snapshot/create
  app.post<{ Body: { symbol: string } }>('/api/v10/snapshot/create', async (req, reply) => {
    const { symbol } = req.body || {};
    
    if (!symbol) {
      return reply.status(400).send({ ok: false, error: 'Symbol required' });
    }
    
    const result = await snapshotService.createSnapshot({ symbol });
    
    return reply.send(result);
  });
  
  // GET /api/v10/snapshot/recent/:symbol
  app.get<{ Params: { symbol: string }, Querystring: { limit?: string } }>('/api/v10/snapshot/recent/:symbol', async (req, reply) => {
    const limit = parseInt(req.query.limit || '10', 10);
    const snapshots = await snapshotService.getRecentSnapshots(req.params.symbol, limit);
    
    return reply.send({ ok: true, snapshots });
  });
  
  // GET /api/v10/snapshot/stats
  app.get('/api/v10/snapshot/stats', async (req, reply) => {
    const stats = await snapshotService.getStats();
    
    return reply.send({ ok: true, stats });
  });
  
  console.log('[Snapshot] Routes registered');
}

