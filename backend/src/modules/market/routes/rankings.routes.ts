/**
 * RANKINGS ROUTES
 * ===============
 * 
 * BLOCK B3: Multi-Asset Ranking API
 * 
 * GET /api/market/rankings/top
 * 
 * Returns top conviction signals across the universe.
 * Uses heavy verdict cache for fast responses.
 * 
 * Query params:
 *   - universe: 'core' | 'extended' (default: 'core')
 *   - horizon: '1D' | '7D' | '30D' (default: '1D')
 *   - limit: number (default: 20)
 *   - type: 'BUY' | 'SELL' | 'ALL' (default: 'ALL')
 * 
 * Response includes:
 *   - items: Full list sorted by conviction
 *   - buys: Top 5 BUY signals
 *   - sells: Top 5 SELL signals
 */

import { FastifyInstance } from 'fastify';
import { RankingsService, type Horizon } from '../services/rankings.service.js';
import { UniverseService, type UniverseType } from '../services/universe.service.js';
import { heavyVerdictStore } from '../../verdict/runtime/heavy-verdict.store.js';

export async function rankingsRoutes(fastify: FastifyInstance) {
  // Initialize rankings service with the verdict cache
  const rankingsService = new RankingsService(heavyVerdictStore);

  /**
   * GET /api/market/rankings/top
   * 
   * Returns top conviction signals for multi-asset ranking
   */
  fastify.get<{
    Querystring: {
      universe?: string;
      horizon?: string;
      limit?: string;
      type?: string;
    };
  }>('/api/market/rankings/top', async (request, reply) => {
    const t0 = Date.now();

    const {
      universe = 'core',
      horizon = '1D',
      limit = '20',
      type = 'ALL',
    } = request.query;

    // Validate params
    const validHorizons = ['1D', '7D', '30D'];
    const validUniverses = ['core', 'extended'];
    const validTypes = ['BUY', 'SELL', 'ALL'];

    if (!validHorizons.includes(horizon)) {
      return reply.status(400).send({
        ok: false,
        error: `Invalid horizon. Must be one of: ${validHorizons.join(', ')}`,
      });
    }

    if (!validUniverses.includes(universe)) {
      return reply.status(400).send({
        ok: false,
        error: `Invalid universe. Must be one of: ${validUniverses.join(', ')}`,
      });
    }

    if (!validTypes.includes(type.toUpperCase())) {
      return reply.status(400).send({
        ok: false,
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
      });
    }

    try {
      const result = await rankingsService.getTopRankings({
        universe: universe as UniverseType,
        horizon: horizon as Horizon,
        limit: Math.min(50, Math.max(1, parseInt(limit, 10) || 20)),
        type: type.toUpperCase() as 'BUY' | 'SELL' | 'ALL',
      });

      return {
        ...result,
        __timings: {
          totalMs: Date.now() - t0,
          computeMs: result.computeMs,
        },
      };

    } catch (error: any) {
      console.error('[Rankings] Error:', error.message);
      return reply.status(500).send({
        ok: false,
        error: error.message,
        __timings: { totalMs: Date.now() - t0 },
      });
    }
  });

  /**
   * GET /api/market/rankings/universes
   * 
   * Returns available universes
   */
  fastify.get('/api/market/rankings/universes', async () => {
    return {
      ok: true,
      universes: UniverseService.getAvailableUniverses().map(u => ({
        id: u,
        symbols: UniverseService.getUniverse(u),
        count: UniverseService.getUniverse(u).length,
      })),
    };
  });

  console.log('[Rankings] Routes registered');
}

export default rankingsRoutes;
