/**
 * PHASE 1.2 + 1.3 + 1.4 — Market Routes
 * ======================================
 * 
 * API endpoints for market search, asset diagnosis, chart data, and backfill.
 * 
 * ENDPOINTS:
 *   GET  /api/v10/market/search?q=ETH         — Search symbols
 *   GET  /api/v10/market/top                  — Top symbols by score
 *   GET  /api/v10/market/asset/:symbol        — Full market diagnosis
 *   GET  /api/v10/market/chart/:symbol        — Chart data with verdicts/divergences
 *   GET  /api/v10/market/chart/price/:symbol  — Price bars only
 *   GET  /api/v10/market/chart/verdicts/:symbol — Verdict history
 *   GET  /api/v10/market/chart/divergences/:symbol — Divergences
 *   POST /api/v10/market/backfill/start       — Start backfill job
 *   GET  /api/v10/market/backfill/status/:id  — Get backfill status
 *   GET  /api/v10/market/backfill/runs        — Get recent runs
 *   GET  /api/v10/market/history/:symbol      — Get price history
 *   GET  /api/v10/market/truth/:symbol        — Get truth records
 *   GET  /api/v10/market/truth/stats/:symbol  — Get truth statistics
 */

import { FastifyInstance } from 'fastify';
import { marketSearch, getTopSymbols } from './market.search.service.js';
import { getMarketAsset } from './market.asset.service.js';
import { getUniverseStats } from './symbol.resolver.js';
import { chartRoutes } from './chart/index.js';
import { backfillRoutes } from './backfill/backfill.routes.js';
// BLOCK B: Rankings routes for Top Conviction
import { rankingsRoutes } from './routes/rankings.routes.js';

export async function marketRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // SEARCH
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /search - Search for assets
   * Query: q (search query)
   */
  fastify.get<{
    Querystring: { q?: string };
  }>('/search', async (request, reply) => {
    const query = request.query.q || '';
    const result = await marketSearch(query);
    return result;
  });
  
  /**
   * GET /top - Get top symbols by universe score
   * Query: limit (default 10)
   */
  fastify.get<{
    Querystring: { limit?: string };
  }>('/top', async (request, reply) => {
    const limit = parseInt(request.query.limit || '10');
    const items = await getTopSymbols(limit);
    return { ok: true, items };
  });
  
  /**
   * GET /stats - Universe statistics
   */
  fastify.get('/stats', async (request, reply) => {
    const stats = getUniverseStats();
    return { ok: true, ...stats };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // ASSET
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /asset/:symbol - Full market diagnosis
   * 
   * Returns:
   * - Exchange verdict (BULLISH/BEARISH/NEUTRAL)
   * - Confidence score
   * - Whale risk assessment
   * - Market stress level
   * - Explainability (drivers, risks, summary)
   */
  fastify.get<{
    Params: { symbol: string };
  }>('/asset/:symbol', async (request, reply) => {
    const symbol = request.params.symbol;
    const result = await getMarketAsset(symbol);
    return result;
  });
  
  // ═══════════════════════════════════════════════════════════════
  // CHART (Phase 1.3)
  // ═══════════════════════════════════════════════════════════════
  
  await fastify.register(chartRoutes);
  
  // ═══════════════════════════════════════════════════════════════
  // BACKFILL & TRUTH (Phase 1.4)
  // ═══════════════════════════════════════════════════════════════
  
  await fastify.register(backfillRoutes);
  
  // ═══════════════════════════════════════════════════════════════
  // RANKINGS (BLOCK B: Top Conviction)
  // ═══════════════════════════════════════════════════════════════
  
  await fastify.register(rankingsRoutes);
  
  console.log('[Phase 1.2 + 1.3 + 1.4 + BLOCK B] Market Routes registered');
}

export default marketRoutes;
