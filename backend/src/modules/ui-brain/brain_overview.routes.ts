/**
 * BRAIN OVERVIEW ROUTES — User Brain Page v3 + v4 Decision Engine
 * 
 * Single aggregating endpoint for UI
 */

import { FastifyInstance } from 'fastify';
import { getBrainOverviewService } from './brain_overview.service.js';
import { getBrainDecisionPack } from './brain_decision.service.js';
import { getVersionInfo } from '../../core/version.js';

export async function brainOverviewRoutes(fastify: FastifyInstance): Promise<void> {
  const service = getBrainOverviewService();
  
  // Health check
  fastify.get('/api/ui/brain/health', async () => {
    return {
      ok: true,
      module: 'ui-brain',
      version: getVersionInfo(),
    };
  });
  
  // Main aggregating endpoint (v3 legacy)
  fastify.get<{ Querystring: { asOf?: string } }>(
    '/api/ui/brain/overview',
    async (req, reply) => {
      try {
        const { asOf } = req.query;
        const pack = await service.getOverview(asOf);
        
        return {
          ok: true,
          ...pack,
        };
      } catch (err) {
        reply.code(500);
        return {
          ok: false,
          error: (err as Error).message,
        };
      }
    }
  );
  
  // NEW: Brain v4 Decision Engine endpoint
  fastify.get('/api/ui/brain/decision', async (req, reply) => {
    try {
      const pack = await getBrainDecisionPack();
      
      return {
        ok: true,
        ...pack,
      };
    } catch (err) {
      reply.code(500);
      return {
        ok: false,
        error: (err as Error).message,
      };
    }
  });
  
  fastify.log.info('[UI Brain] Routes registered at /api/ui/brain/*');
  fastify.log.info('[UI Brain] v4 Decision Engine available at /api/ui/brain/decision');
}

export default brainOverviewRoutes;
