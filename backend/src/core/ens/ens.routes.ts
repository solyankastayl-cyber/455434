/**
 * ENS Routes (P2.2)
 * 
 * API endpoints for ENS resolution.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as ensService from './ens.service.js';

export async function ensRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/ens/status
   * Check ENS service status
   */
  app.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const enabled = ensService.isENSEnabled();
    const cacheStats = ensService.getCacheStats();
    
    return reply.send({
      ok: true,
      data: {
        enabled,
        cache: cacheStats,
      },
    });
  });

  /**
   * GET /api/ens/resolve/:name
   * Resolve ENS name to address
   */
  app.get('/resolve/:name', async (
    request: FastifyRequest<{ Params: { name: string } }>,
    reply: FastifyReply
  ) => {
    const { name } = request.params;
    
    if (!name) {
      return reply.status(400).send({
        ok: false,
        error: 'ENS name is required',
      });
    }
    
    const result = await ensService.resolveENS(name);
    
    return reply.send({
      ok: true,
      data: result,
    });
  });

  /**
   * GET /api/ens/reverse/:address
   * Reverse lookup address to ENS name
   */
  app.get('/reverse/:address', async (
    request: FastifyRequest<{ Params: { address: string } }>,
    reply: FastifyReply
  ) => {
    const { address } = request.params;
    
    if (!address) {
      return reply.status(400).send({
        ok: false,
        error: 'Address is required',
      });
    }
    
    const result = await ensService.reverseENS(address);
    
    return reply.send({
      ok: true,
      data: result,
    });
  });
}
