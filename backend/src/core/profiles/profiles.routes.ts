/**
 * Profiles Routes
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './actor_profiles.service.js';
import {
  GetProfileParams,
  GetTopProfilesQuery,
  GetByStrategyQuery,
  SearchProfilesQuery,
} from './profiles.schema.js';

export async function profilesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/profiles/actor/:address
   * Get actor profile by address
   */
  app.get('/actor/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = GetProfileParams.parse(request.params);
    
    let profile = await service.getActorProfile(params.address);
    
    // Build profile on-demand if not exists
    if (!profile) {
      try {
        profile = await service.buildActorProfile(params.address);
      } catch (err) {
        return reply.status(404).send({ ok: false, error: 'Profile not found' });
      }
    }
    
    return { ok: true, data: profile };
  });
  
  /**
   * POST /api/profiles/actor/:address/rebuild
   * Force rebuild actor profile
   */
  app.post('/actor/:address/rebuild', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = GetProfileParams.parse(request.params);
    
    const profile = await service.buildActorProfile(params.address);
    
    return { ok: true, data: profile };
  });
  
  /**
   * GET /api/profiles/top
   * Get top actors by score
   */
  app.get('/top', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = GetTopProfilesQuery.parse(request.query);
    
    const profiles = await service.getTopActors(query.limit, query.tier);
    
    return { ok: true, data: profiles, count: profiles.length };
  });
  
  /**
   * GET /api/profiles/by-strategy
   * Get actors by strategy type
   */
  app.get('/by-strategy', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = GetByStrategyQuery.parse(request.query);
    
    const profiles = await service.getActorsByStrategy(query.strategyType, query.limit);
    
    return { ok: true, data: profiles, count: profiles.length };
  });
  
  /**
   * GET /api/profiles/search
   * Search profiles
   */
  app.get('/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = SearchProfilesQuery.parse(request.query);
    
    const profiles = await service.searchProfiles(query.q, query.limit);
    
    return { ok: true, data: profiles, count: profiles.length };
  });
  
  /**
   * GET /api/profiles/stats
   * Get profile statistics
   */
  app.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const stats = await service.getStats();
    return { ok: true, data: stats };
  });
}
