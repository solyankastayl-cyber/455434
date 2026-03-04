/**
 * Bundles Routes
 * API endpoints for bundles (intelligence layer)
 * 
 * Base path: /api/bundles
 * 
 * Key endpoints:
 * - GET /active          - Get active bundles (high intensity)
 * - GET /corridor/:a/:b  - Get corridor bundle with interpretation
 * - GET /address/:addr   - Get bundles for address
 * - GET /stats           - Get bundle statistics
 */
import type { FastifyInstance } from 'fastify';
import { bundlesService, formatBundle } from './bundles.service.js';
import type { BundleWindow, BundleType } from './bundles.model.js';

/**
 * Bundles Routes
 */
export async function bundlesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /active - Get active bundles
   */
  app.get<{
    Querystring: {
      window?: string;
      bundleType?: string;
      minIntensity?: string;
      minConfidence?: string;
      limit?: string;
    };
  }>('/active', async (request) => {
    const {
      window = '7d',
      bundleType,
      minIntensity,
      minConfidence = '0.5',
      limit = '50',
    } = request.query;

    const bundles = await bundlesService.getActive({
      window: window as BundleWindow,
      bundleType: bundleType as BundleType,
      minIntensity: minIntensity ? parseFloat(minIntensity) : undefined,
      minConfidence: parseFloat(minConfidence),
      limit: parseInt(limit, 10),
    });

    return {
      ok: true,
      data: bundles.map(formatBundle),
    };
  });

  /**
   * GET /stats - Get bundle statistics
   */
  app.get('/stats', async () => {
    const stats = await bundlesService.getStats();
    return {
      ok: true,
      data: stats,
    };
  });

  /**
   * GET /address/:address - Get bundles for address
   */
  app.get<{
    Params: { address: string };
    Querystring: {
      window?: string;
      direction?: string;
      bundleType?: string;
      limit?: string;
    };
  }>('/address/:address', async (request, reply) => {
    const { address } = request.params;
    const { window = '7d', direction = 'both', bundleType, limit = '50' } = request.query;

    // Validate address
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.status(400).send({
        ok: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid address format',
      });
    }

    const result = await bundlesService.getForAddress(address, {
      window: window as BundleWindow,
      direction: direction as 'in' | 'out' | 'both',
      bundleType: bundleType as BundleType,
      limit: parseInt(limit, 10),
    });

    return {
      ok: true,
      data: {
        bundles: result.bundles.map(formatBundle),
        summary: result.summary,
      },
    };
  });

  /**
   * GET /corridor/:from/:to - Get corridor bundle with interpretation
   * This is what frontend shows when clicking a corridor
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

    const bundle = await bundlesService.getCorridor(
      from,
      to,
      window as BundleWindow
    );

    if (!bundle) {
      return reply.status(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: 'No bundle found for this corridor',
      });
    }

    return {
      ok: true,
      data: formatBundle(bundle),
    };
  });

  /**
   * GET /:id - Get bundle by ID
   */
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const bundle = await bundlesService.getById(id);

    if (!bundle) {
      return reply.status(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: 'Bundle not found',
      });
    }

    return {
      ok: true,
      data: formatBundle(bundle),
    };
  });

  app.log.info('Bundles routes registered');
}

// Export as 'routes' for consistency
export { bundlesRoutes as routes };
