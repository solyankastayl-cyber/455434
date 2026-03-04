/**
 * Relations Routes
 * API endpoints for aggregated relations
 * 
 * Base path: /api/relations
 * 
 * Key endpoints for graph visualization:
 * - GET /graph          - Get top relations for Warhammer-style graph
 * - GET /address/:addr  - Get relations for an address
 * - GET /corridor/:a/:b - Get corridor between two addresses
 * - GET /stats          - Get relation statistics
 */
import type { FastifyInstance } from 'fastify';
import { relationsService, formatRelation } from './relations.service.js';
import type { RelationWindow } from './relations.model.js';

/**
 * Relations Routes
 */
export async function relationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /graph - Get graph data (top relations by density)
   * This is the main endpoint for Warhammer-style visualization
   */
  app.get<{ Querystring: { window?: string; minDensity?: string; limit?: string } }>(
    '/graph',
    async (request) => {
      const { window = '7d', minDensity = '0', limit = '100' } = request.query;

      const graph = await relationsService.getGraph({
        window: window as RelationWindow,
        minDensity: parseFloat(minDensity),
        limit: parseInt(limit, 10),
      });

      return {
        ok: true,
        data: graph,
      };
    }
  );

  /**
   * GET /stats - Get relation statistics
   */
  app.get('/stats', async () => {
    const stats = await relationsService.getStats();
    return {
      ok: true,
      data: stats,
    };
  });

  /**
   * GET /address/:address - Get relations for an address
   */
  app.get<{
    Params: { address: string };
    Querystring: { window?: string; direction?: string; minDensity?: string; limit?: string };
  }>('/address/:address', async (request, reply) => {
    const { address } = request.params;
    const { window = '7d', direction = 'both', minDensity = '0', limit = '50' } = request.query;

    // Validate address
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.status(400).send({
        ok: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid address format',
      });
    }

    const result = await relationsService.getForAddress(address, {
      window: window as RelationWindow,
      direction: direction as 'in' | 'out' | 'both',
      minDensity: parseFloat(minDensity),
      limit: parseInt(limit, 10),
    });

    return {
      ok: true,
      data: {
        relations: result.relations.map(formatRelation),
        summary: result.summary,
      },
    };
  });

  /**
   * GET /corridor/:from/:to - Get corridor between two addresses
   * Returns aggregated data for corridor visualization and table
   */
  app.get<{
    Params: { from: string; to: string };
    Querystring: { window?: string };
  }>('/corridor/:from/:to', async (request, reply) => {
    const { from, to } = request.params;
    const { window = '7d' } = request.query;

    // Validate addresses
    if (!/^0x[a-fA-F0-9]{40}$/.test(from) || !/^0x[a-fA-F0-9]{40}$/.test(to)) {
      return reply.status(400).send({
        ok: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid address format',
      });
    }

    const result = await relationsService.getCorridor(
      from,
      to,
      window as RelationWindow
    );

    return {
      ok: true,
      data: {
        relations: result.relations.map(formatRelation),
        summary: result.summary,
      },
    };
  });

  /**
   * GET /:id - Get relation by ID
   */
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const relation = await relationsService.getById(id);

    if (!relation) {
      return reply.status(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: 'Relation not found',
      });
    }

    return {
      ok: true,
      data: formatRelation(relation),
    };
  });

  app.log.info('Relations routes registered');
}

// Export as 'routes' for consistency
export { relationsRoutes as routes };
