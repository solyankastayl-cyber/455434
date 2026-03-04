/**
 * Y1 — Exchange Admin Routes
 * ===========================
 * 
 * API endpoints for Exchange Admin Control Plane.
 * 
 * ENDPOINTS:
 * 
 * Providers:
 *   GET    /api/v10/exchange/admin/providers
 *   GET    /api/v10/exchange/admin/providers/:id
 *   PATCH  /api/v10/exchange/admin/providers/:id
 *   POST   /api/v10/exchange/admin/providers/:id/test
 *   POST   /api/v10/exchange/admin/providers/:id/reset
 * 
 * Jobs:
 *   GET    /api/v10/exchange/admin/jobs
 *   GET    /api/v10/exchange/admin/jobs/:id
 *   POST   /api/v10/exchange/admin/jobs/:id/start
 *   POST   /api/v10/exchange/admin/jobs/:id/stop
 *   PATCH  /api/v10/exchange/admin/jobs/:id/config
 *   POST   /api/v10/exchange/admin/jobs/:id/run-once
 * 
 * Health:
 *   GET    /api/v10/exchange/admin/health
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  adminListProviders,
  adminGetProvider,
  adminPatchProvider,
  adminTestProvider,
  adminResetProvider,
  adminListJobs,
  adminGetJob,
  adminStartJob,
  adminStopJob,
  adminPatchJobConfig,
  adminRunJobOnce,
  getHealthOverview,
} from './admin.service.js';

import { ProviderPatchDTO, JobPatchConfigDTO } from './admin.types.js';

export async function exchangeAdminControlRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // PROVIDER ROUTES
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /providers - List all providers
   */
  fastify.get('/providers', async (request, reply) => {
    const providers = adminListProviders();
    return { ok: true, providers };
  });
  
  /**
   * GET /providers/:id - Get provider details
   */
  fastify.get<{ Params: { id: string } }>(
    '/providers/:id',
    async (request, reply) => {
      const provider = adminGetProvider(request.params.id);
      
      if (!provider) {
        reply.code(404);
        return { ok: false, error: 'Provider not found' };
      }
      
      return { ok: true, provider };
    }
  );
  
  /**
   * PATCH /providers/:id - Update provider config
   */
  fastify.patch<{ 
    Params: { id: string };
    Body: ProviderPatchDTO;
  }>(
    '/providers/:id',
    async (request, reply) => {
      const result = adminPatchProvider(request.params.id, request.body);
      
      if (!result.ok) {
        reply.code(400);
      }
      
      return result;
    }
  );
  
  /**
   * POST /providers/:id/test - Test provider connectivity
   */
  fastify.post<{ 
    Params: { id: string };
    Body: { symbol?: string };
  }>(
    '/providers/:id/test',
    async (request, reply) => {
      const result = await adminTestProvider(request.params.id, request.body);
      return result;
    }
  );
  
  /**
   * POST /providers/:id/reset - Reset provider circuit breaker
   */
  fastify.post<{ Params: { id: string } }>(
    '/providers/:id/reset',
    async (request, reply) => {
      const result = adminResetProvider(request.params.id);
      
      if (!result.ok) {
        reply.code(404);
      }
      
      return result;
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // JOB ROUTES
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /jobs - List all jobs
   */
  fastify.get('/jobs', async (request, reply) => {
    const jobs = adminListJobs();
    return { ok: true, jobs };
  });
  
  /**
   * GET /jobs/:id - Get job details
   */
  fastify.get<{ Params: { id: string } }>(
    '/jobs/:id',
    async (request, reply) => {
      const job = adminGetJob(request.params.id);
      
      if (!job) {
        reply.code(404);
        return { ok: false, error: 'Job not found' };
      }
      
      return { ok: true, job };
    }
  );
  
  /**
   * POST /jobs/:id/start - Start job
   */
  fastify.post<{ Params: { id: string } }>(
    '/jobs/:id/start',
    async (request, reply) => {
      const result = adminStartJob(request.params.id);
      
      if (!result.ok) {
        reply.code(400);
      }
      
      return result;
    }
  );
  
  /**
   * POST /jobs/:id/stop - Stop job
   */
  fastify.post<{ Params: { id: string } }>(
    '/jobs/:id/stop',
    async (request, reply) => {
      const result = adminStopJob(request.params.id);
      
      if (!result.ok) {
        reply.code(400);
      }
      
      return result;
    }
  );
  
  /**
   * PATCH /jobs/:id/config - Update job config
   */
  fastify.patch<{ 
    Params: { id: string };
    Body: JobPatchConfigDTO;
  }>(
    '/jobs/:id/config',
    async (request, reply) => {
      const result = adminPatchJobConfig(request.params.id, request.body);
      
      if (!result.ok) {
        reply.code(400);
      }
      
      return result;
    }
  );
  
  /**
   * POST /jobs/:id/run-once - Run job once (diagnostic)
   */
  fastify.post<{ 
    Params: { id: string };
    Body: { symbol?: string };
  }>(
    '/jobs/:id/run-once',
    async (request, reply) => {
      const result = await adminRunJobOnce(request.params.id, request.body);
      return result;
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // HEALTH ROUTES
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /health - Exchange health overview
   */
  fastify.get('/health', async (request, reply) => {
    const overview = getHealthOverview();
    return { ok: true, ...overview };
  });
  
  console.log('[Y1] Exchange Admin Control Routes registered');
}

export default exchangeAdminControlRoutes;
