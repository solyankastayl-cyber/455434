/**
 * Snapshots Routes
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './snapshots.service.js';
import {
  GetSnapshotParams,
  GetSnapshotQuery,
  GetBulkSnapshotsBody,
} from './snapshots.schema.js';

export async function snapshotsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/snapshots/actor/:address/card
   * Get actor card snapshot (compact)
   */
  app.get('/actor/:address/card', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = GetSnapshotParams.parse(request.params);
    const query = GetSnapshotQuery.parse(request.query);
    
    const snapshot = await service.getActorCardSnapshot(params.address, query.rebuild);
    
    if (!snapshot) {
      return reply.status(404).send({ ok: false, error: 'Actor not found' });
    }
    
    return { ok: true, data: snapshot };
  });
  
  /**
   * GET /api/snapshots/actor/:address/full
   * Get actor full snapshot (for profile page)
   */
  app.get('/actor/:address/full', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = GetSnapshotParams.parse(request.params);
    const query = GetSnapshotQuery.parse(request.query);
    
    const snapshot = await service.getActorFullSnapshot(params.address, query.rebuild);
    
    if (!snapshot) {
      return reply.status(404).send({ ok: false, error: 'Actor not found' });
    }
    
    return { ok: true, data: snapshot };
  });
  
  /**
   * GET /api/snapshots/actor/:address/node
   * Get graph node snapshot (for hover)
   */
  app.get('/actor/:address/node', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = GetSnapshotParams.parse(request.params);
    
    const snapshot = await service.getGraphNodeSnapshot(params.address);
    
    if (!snapshot) {
      return reply.status(404).send({ ok: false, error: 'Actor not found' });
    }
    
    return { ok: true, data: snapshot };
  });
  
  /**
   * POST /api/snapshots/bulk/cards
   * Get multiple actor card snapshots
   */
  app.post('/bulk/cards', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = GetBulkSnapshotsBody.parse(request.body);
    
    const snapshots = await Promise.all(
      body.addresses.map(addr => service.getActorCardSnapshot(addr))
    );
    
    // Filter out nulls and map to address => snapshot
    const result: Record<string, service.ActorCardSnapshot> = {};
    for (let i = 0; i < body.addresses.length; i++) {
      if (snapshots[i]) {
        result[body.addresses[i].toLowerCase()] = snapshots[i]!;
      }
    }
    
    return { ok: true, data: result, count: Object.keys(result).length };
  });
  
  /**
   * DELETE /api/snapshots/actor/:address
   * Invalidate all snapshots for an actor
   */
  app.delete('/actor/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = GetSnapshotParams.parse(request.params);
    
    const count = await service.invalidateActorSnapshots(params.address);
    
    return { ok: true, invalidated: count };
  });
  
  /**
   * GET /api/snapshots/stats
   * Get snapshot statistics
   */
  app.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const stats = await service.getStats();
    return { ok: true, data: stats };
  });
}
