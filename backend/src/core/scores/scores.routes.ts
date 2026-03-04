/**
 * Scores Routes
 * API endpoints for scores
 * 
 * Base path: /api/scores
 */
import type { FastifyInstance } from 'fastify';
import { scoresService, formatScore } from './scores.service.js';
import type { ScoreWindow, ScoreSubjectType, ScoreSort, ScoreTier } from './scores.schema.js';

/**
 * Scores Routes
 */
export async function scoresRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /address/:address - Get score for address
   */
  app.get<{
    Params: { address: string };
    Querystring: { window?: string };
  }>('/address/:address', async (request, reply) => {
    const { address } = request.params;
    const window = (request.query.window || '30d') as ScoreWindow;

    // Validate address
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.status(400).send({
        ok: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid address format',
      });
    }

    const score = await scoresService.getByAddress(address, window);

    if (!score) {
      return reply.status(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: 'No score found for this address',
      });
    }

    return {
      ok: true,
      data: formatScore(score),
    };
  });

  /**
   * GET /address/:address/all - Get all window scores for address
   */
  app.get<{
    Params: { address: string };
  }>('/address/:address/all', async (request, reply) => {
    const { address } = request.params;

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.status(400).send({
        ok: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid address format',
      });
    }

    const scores = await scoresService.getAllWindowsForAddress(address);

    return {
      ok: true,
      data: scores.map(formatScore),
    };
  });

  /**
   * GET /actor/:id - Get score for actor
   */
  app.get<{
    Params: { id: string };
    Querystring: { window?: string };
  }>('/actor/:id', async (request, reply) => {
    const { id } = request.params;
    const window = (request.query.window || '30d') as ScoreWindow;

    const score = await scoresService.getByActor(id, window);

    if (!score) {
      return reply.status(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: 'No score found for this actor',
      });
    }

    return {
      ok: true,
      data: formatScore(score),
    };
  });

  /**
   * GET /entity/:id - Get score for entity
   */
  app.get<{
    Params: { id: string };
    Querystring: { window?: string };
  }>('/entity/:id', async (request, reply) => {
    const { id } = request.params;
    const window = (request.query.window || '30d') as ScoreWindow;

    const score = await scoresService.getByEntity(id, window);

    if (!score) {
      return reply.status(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: 'No score found for this entity',
      });
    }

    return {
      ok: true,
      data: formatScore(score),
    };
  });

  /**
   * GET /top - Get top scores (leaderboard)
   */
  app.get<{
    Querystring: {
      type?: string;
      sort?: string;
      tier?: string;
      window?: string;
      limit?: string;
      offset?: string;
    };
  }>('/top', async (request) => {
    const {
      type = 'address',
      sort = 'composite',
      tier,
      window = '30d',
      limit = '50',
      offset = '0',
    } = request.query;

    const result = await scoresService.getTop({
      type: type as ScoreSubjectType,
      sort: sort as ScoreSort,
      tier: tier as ScoreTier | undefined,
      window: window as ScoreWindow,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    return {
      ok: true,
      data: {
        scores: result.scores.map(formatScore),
        total: result.total,
      },
    };
  });

  /**
   * GET /watchlist - Get scores for watchlist addresses
   */
  app.get<{
    Querystring: { addresses: string; window?: string };
  }>('/watchlist', async (request, reply) => {
    const { addresses, window = '30d' } = request.query;

    if (!addresses) {
      return reply.status(400).send({
        ok: false,
        error: 'VALIDATION_ERROR',
        message: 'addresses parameter is required',
      });
    }

    const addressList = addresses.split(',').map(a => a.trim());
    
    // Validate addresses
    const invalidAddresses = addressList.filter(a => !/^0x[a-fA-F0-9]{40}$/.test(a));
    if (invalidAddresses.length > 0) {
      return reply.status(400).send({
        ok: false,
        error: 'VALIDATION_ERROR',
        message: `Invalid addresses: ${invalidAddresses.join(', ')}`,
      });
    }

    const scores = await scoresService.getWatchlist(addressList, window as ScoreWindow);

    return {
      ok: true,
      data: scores.map(formatScore),
    };
  });

  /**
   * GET /stats - Get score statistics
   */
  app.get('/stats', async () => {
    const stats = await scoresService.getStats();
    return {
      ok: true,
      data: stats,
    };
  });

  app.log.info('Scores routes registered');
}

// Export as 'routes' for consistency
export { scoresRoutes as routes };
