/**
 * C2.2 — Validation API Routes
 * =============================
 * 
 * ENDPOINTS:
 * - GET /api/v10/validation/:symbol/latest
 * - GET /api/v10/validation/:symbol/history
 * - GET /api/v10/validation/:symbol/stats
 * - POST /api/v10/validation/compute
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { validationService } from './validation.service.js';
import { ExchangeVerdict } from './validation.engine.js';
import { OnchainWindow } from '../onchain/onchain.contracts.js';

/**
 * GET /:symbol/latest - Get latest validation
 */
async function latestHandler(
  request: FastifyRequest<{ Params: { symbol: string } }>,
  reply: FastifyReply
) {
  try {
    const { symbol } = request.params;
    const validation = await validationService.getLatest(symbol);
    
    return {
      ok: true,
      validation,
    };
  } catch (error) {
    console.error('[Validation] Latest error:', error);
    return {
      ok: false,
      validation: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * GET /:symbol/history - Get validation history
 */
async function historyHandler(
  request: FastifyRequest<{
    Params: { symbol: string };
    Querystring: { from: string; to: string; limit?: string };
  }>,
  reply: FastifyReply
) {
  try {
    const { symbol } = request.params;
    const { from, to, limit = '100' } = request.query;
    
    if (!from || !to) {
      reply.code(400);
      return { ok: false, error: 'Missing required parameters: from, to' };
    }
    
    const validations = await validationService.getHistory(
      symbol,
      parseInt(from),
      parseInt(to),
      parseInt(limit)
    );
    
    return {
      ok: true,
      validations,
      count: validations.length,
    };
  } catch (error) {
    console.error('[Validation] History error:', error);
    return {
      ok: false,
      validations: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * GET /:symbol/stats - Get validation statistics
 */
async function statsHandler(
  request: FastifyRequest<{
    Params: { symbol: string };
    Querystring: { from: string; to: string };
  }>,
  reply: FastifyReply
) {
  try {
    const { symbol } = request.params;
    const { from, to } = request.query;
    
    if (!from || !to) {
      reply.code(400);
      return { ok: false, error: 'Missing required parameters: from, to' };
    }
    
    const stats = await validationService.getStats(
      symbol,
      parseInt(from),
      parseInt(to)
    );
    
    return {
      ok: true,
      stats,
    };
  } catch (error) {
    console.error('[Validation] Stats error:', error);
    return {
      ok: false,
      stats: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * POST /compute - Compute validation
 */
async function computeHandler(
  request: FastifyRequest<{
    Body: {
      symbol: string;
      exchangeVerdict: ExchangeVerdict;
      exchangeConfidence: number;
      t0?: number;
      window?: OnchainWindow;
    };
  }>,
  reply: FastifyReply
) {
  try {
    const { symbol, exchangeVerdict, exchangeConfidence, t0, window = '1h' } = request.body || {};
    
    if (!symbol || !exchangeVerdict || exchangeConfidence === undefined) {
      reply.code(400);
      return {
        ok: false,
        error: 'Missing required parameters: symbol, exchangeVerdict, exchangeConfidence',
      };
    }
    
    // Validate exchangeVerdict
    if (!['BULLISH', 'BEARISH', 'NEUTRAL'].includes(exchangeVerdict)) {
      reply.code(400);
      return {
        ok: false,
        error: 'Invalid exchangeVerdict. Must be BULLISH, BEARISH, or NEUTRAL',
      };
    }
    
    const result = await validationService.compute(
      symbol,
      exchangeVerdict,
      exchangeConfidence,
      t0,
      window
    );
    
    return result;
  } catch (error) {
    console.error('[Validation] Compute error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Route registration
export async function validationRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/:symbol/latest', latestHandler);
  fastify.get('/:symbol/history', historyHandler);
  fastify.get('/:symbol/stats', statsHandler);
  fastify.post('/compute', computeHandler);
  
  console.log('[C2.2] Validation routes registered');
}

console.log('[C2.2] Validation routes module loaded');
