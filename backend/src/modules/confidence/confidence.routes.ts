/**
 * PHASE 2.3 — Confidence Decay Routes
 * =====================================
 * 
 * API endpoints for confidence decay operations.
 * 
 * ENDPOINTS:
 *   POST /api/v10/confidence/compute/:symbol  - Compute and store decay
 *   GET  /api/v10/confidence/factor/:symbol   - Get decay factor
 *   GET  /api/v10/confidence/stats/:symbol    - Get decay stats
 *   GET  /api/v10/confidence/latest/:symbol   - Get latest record
 *   GET  /api/v10/confidence/history/:symbol  - Get decay history
 */

import { FastifyInstance } from 'fastify';
import {
  computeConfidenceDecay,
  getDecayFactor,
  getDecayStats,
  getLatestDecayRecord,
  getDecayHistory,
} from './confidence.service.js';

export async function confidenceRoutes(fastify: FastifyInstance): Promise<void> {

  // ═══════════════════════════════════════════════════════════════
  // COMPUTE DECAY
  // ═══════════════════════════════════════════════════════════════

  /**
   * POST /compute/:symbol - Compute and store decay
   */
  fastify.post<{
    Params: { symbol: string };
    Body: {
      rawConfidence: number;
      verdict?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'ALL';
    };
  }>('/compute/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    const { rawConfidence, verdict = 'ALL' } = request.body || {};

    if (typeof rawConfidence !== 'number') {
      reply.code(400);
      return { ok: false, error: 'rawConfidence is required' };
    }

    try {
      return computeConfidenceDecay(symbol, rawConfidence, verdict);
    } catch (error) {
      console.error('[Confidence] Compute failed:', error);
      reply.code(500);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Compute failed',
      };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // QUERY DECAY
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /factor/:symbol - Get current decay factor
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: { verdict?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'ALL' };
  }>('/factor/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    const { verdict = 'ALL' } = request.query;

    const decayFactor = await getDecayFactor(symbol, verdict);

    return {
      ok: true,
      symbol: symbol.toUpperCase(),
      verdict,
      decayFactor,
    };
  });

  /**
   * GET /stats/:symbol - Get comprehensive decay stats
   */
  fastify.get<{
    Params: { symbol: string };
  }>('/stats/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    return getDecayStats(symbol);
  });

  /**
   * GET /latest/:symbol - Get latest decay record
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: { verdict?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'ALL' };
  }>('/latest/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    const { verdict = 'ALL' } = request.query;

    const record = await getLatestDecayRecord(symbol, verdict);

    return {
      ok: true,
      symbol: symbol.toUpperCase(),
      record,
    };
  });

  /**
   * GET /history/:symbol - Get decay history
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: { limit?: string };
  }>('/history/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    const limit = request.query.limit ? parseInt(request.query.limit) : 50;

    const records = await getDecayHistory(symbol, limit);

    return {
      ok: true,
      symbol: symbol.toUpperCase(),
      count: records.length,
      records,
    };
  });

  console.log('[Phase 2.3] Confidence Decay Routes registered');
}

export default confidenceRoutes;
