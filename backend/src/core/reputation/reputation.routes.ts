/**
 * Reputation Routes (Phase 15)
 */
import { FastifyInstance, FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import * as signalRepService from './signal_reputation.service.js';
import * as strategyRepService from './strategy_reputation.service.js';
import * as actorRepService from './actor_reputation.service.js';
import * as trustSnapshotService from './trust_snapshots.service.js';

export async function reputationRoutes(app: FastifyInstance) {
  // ===== Signal Reputation =====
  
  app.get('/api/reputation/signal/:id', async (request: FastifyRequest<{
    Params: { id: string };
  }>) => {
    const { id } = request.params;
    const reputation = await signalRepService.getSignalReputation(new Types.ObjectId(id));
    
    if (!reputation) {
      return { ok: false, error: 'NOT_FOUND' };
    }
    
    return { ok: true, data: reputation };
  });
  
  app.get('/api/reputation/signal/top', async () => {
    const top = await signalRepService.getTopSignals(50);
    return { ok: true, data: top };
  });
  
  app.get('/api/reputation/signal/stats', async () => {
    const stats = await signalRepService.getSignalReputationStats();
    return { ok: true, data: stats };
  });
  
  // ===== Strategy Reputation =====
  
  app.get('/api/reputation/strategy/:type', async (request: FastifyRequest<{
    Params: { type: string };
  }>) => {
    const { type } = request.params;
    const reputation = await strategyRepService.getStrategyReputation(type as any);
    
    if (!reputation) {
      return { ok: false, error: 'NOT_FOUND' };
    }
    
    return { ok: true, data: reputation };
  });
  
  app.get('/api/reputation/strategies/top', async () => {
    const top = await strategyRepService.getTopStrategies(20);
    return { ok: true, data: top };
  });
  
  app.get('/api/reputation/strategies/stats', async () => {
    const stats = await strategyRepService.getStrategyReputationStats();
    return { ok: true, data: stats };
  });
  
  // ===== Actor Reputation =====
  
  app.get('/api/reputation/actor/:address', async (request: FastifyRequest<{
    Params: { address: string };
  }>) => {
    const { address } = request.params;
    const reputation = await actorRepService.getActorReputation(address);
    
    if (!reputation) {
      return { ok: false, error: 'NOT_FOUND' };
    }
    
    return { ok: true, data: reputation };
  });
  
  app.get('/api/reputation/actors/top', async () => {
    const top = await actorRepService.getTopActors(50);
    return { ok: true, data: top };
  });
  
  app.get('/api/reputation/actors/stats', async () => {
    const stats = await actorRepService.getActorReputationStats();
    return { ok: true, data: stats };
  });
  
  // ===== Trust Snapshots =====
  
  app.get('/api/reputation/trust/signal/:id', async (request: FastifyRequest<{
    Params: { id: string };
  }>) => {
    const { id } = request.params;
    const snapshot = await trustSnapshotService.getTrustSnapshot('signal', id);
    
    if (!snapshot) {
      return { ok: false, error: 'NOT_FOUND' };
    }
    
    return { ok: true, data: snapshot };
  });
  
  app.get('/api/reputation/trust/strategy/:type', async (request: FastifyRequest<{
    Params: { type: string };
  }>) => {
    const { type } = request.params;
    const snapshot = await trustSnapshotService.getTrustSnapshot('strategy', type);
    
    if (!snapshot) {
      return { ok: false, error: 'NOT_FOUND' };
    }
    
    return { ok: true, data: snapshot };
  });
  
  app.get('/api/reputation/trust/actor/:address', async (request: FastifyRequest<{
    Params: { address: string };
  }>) => {
    const { address } = request.params;
    const snapshot = await trustSnapshotService.getTrustSnapshot('actor', address.toLowerCase());
    
    if (!snapshot) {
      return { ok: false, error: 'NOT_FOUND' };
    }
    
    return { ok: true, data: snapshot };
  });
  
  app.log.info('Reputation routes registered');
}
