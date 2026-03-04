/**
 * C3.3 — Meta-Brain v2 API Routes
 * ================================
 * 
 * ENDPOINTS:
 * - POST /process - Process decision for symbol
 * - GET /context/:symbol - Get input context
 * - POST /simulate - Simulate with custom inputs
 * - GET /rules - Get decision matrix rules
 * - GET /history/:symbol - Get decision history
 * - GET /stats - Get statistics
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { buildContext, buildContextFromInputs } from '../services/context.builder.js';
import { processDecision } from '../services/decision.engine.js';
import { getMatrixRules } from '../matrix/decision-matrix.v1.js';
import { 
  saveDecision, 
  getLatestDecision, 
  getDecisionHistory, 
  getDecisionStats,
} from '../storage/metaBrainV2.model.js';
import {
  SentimentInput,
  ExchangeInput,
  ValidationInput,
  VerdictDirection,
  ValidationStatus,
  MarketReadiness,
  WhaleRisk,
} from '../contracts/metaBrainV2.types.js';

// ═══════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════

/**
 * POST /process - Process decision for symbol
 */
async function processHandler(
  request: FastifyRequest<{
    Body: { symbol: string; t0?: number };
  }>,
  reply: FastifyReply
) {
  try {
    const { symbol, t0 } = request.body || {};
    
    if (!symbol) {
      reply.code(400);
      return { ok: false, error: 'Missing required parameter: symbol' };
    }
    
    // Build context from live data
    const ctx = await buildContext(symbol, t0);
    
    // Process decision
    const decision = processDecision(ctx);
    
    // Persist for audit
    await saveDecision(decision);
    
    return {
      ok: true,
      decision,
      context: ctx,
    };
  } catch (error) {
    console.error('[MetaBrain] Process error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * GET /context/:symbol - Get input context without decision
 */
async function contextHandler(
  request: FastifyRequest<{
    Params: { symbol: string };
    Querystring: { t0?: string };
  }>,
  reply: FastifyReply
) {
  try {
    const { symbol } = request.params;
    const t0 = request.query.t0 ? parseInt(request.query.t0) : undefined;
    
    const ctx = await buildContext(symbol, t0);
    
    return {
      ok: true,
      context: ctx,
    };
  } catch (error) {
    console.error('[MetaBrain] Context error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * POST /simulate - Simulate with custom inputs (no audit)
 */
async function simulateHandler(
  request: FastifyRequest<{
    Body: {
      symbol?: string;
      sentiment?: {
        direction: VerdictDirection;
        confidence: number;
      };
      exchange?: {
        direction: VerdictDirection;
        confidence: number;
        readiness?: MarketReadiness;
        whaleRisk?: WhaleRisk;
      };
      validation?: {
        status: ValidationStatus;
        strength?: number;
      };
    };
  }>,
  reply: FastifyReply
) {
  try {
    const body = request.body || {};
    
    // Build inputs with defaults
    const sentiment: SentimentInput = {
      direction: body.sentiment?.direction || 'NEUTRAL',
      confidence: body.sentiment?.confidence || 0.5,
      drivers: ['simulation'],
      source: 'simulate',
    };
    
    const exchange: ExchangeInput = {
      direction: body.exchange?.direction || 'NEUTRAL',
      confidence: body.exchange?.confidence || 0.5,
      readiness: body.exchange?.readiness || 'READY',
      whaleRisk: body.exchange?.whaleRisk || 'LOW',
      drivers: ['simulation'],
    };
    
    const validation: ValidationInput = {
      status: body.validation?.status || 'NO_DATA',
      strength: body.validation?.strength,
    };
    
    // Build context from inputs
    const ctx = buildContextFromInputs(
      body.symbol || 'SIMULATED',
      Date.now(),
      sentiment,
      exchange,
      validation
    );
    
    // Process decision (no audit)
    const decision = processDecision(ctx);
    
    return {
      ok: true,
      decision,
      context: ctx,
      note: 'Simulation result - NOT persisted',
    };
  } catch (error) {
    console.error('[MetaBrain] Simulate error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * GET /rules - Get decision matrix rules
 */
async function rulesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  return {
    ok: true,
    rules: getMatrixRules(),
  };
}

/**
 * GET /history/:symbol - Get decision history
 */
async function historyHandler(
  request: FastifyRequest<{
    Params: { symbol: string };
    Querystring: { limit?: string };
  }>,
  reply: FastifyReply
) {
  try {
    const { symbol } = request.params;
    const limit = request.query.limit ? parseInt(request.query.limit) : 50;
    
    const history = await getDecisionHistory(symbol, limit);
    
    return {
      ok: true,
      history,
      count: history.length,
    };
  } catch (error) {
    console.error('[MetaBrain] History error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * GET /latest/:symbol - Get latest decision
 */
async function latestHandler(
  request: FastifyRequest<{
    Params: { symbol: string };
  }>,
  reply: FastifyReply
) {
  try {
    const { symbol } = request.params;
    
    const decision = await getLatestDecision(symbol);
    
    return {
      ok: true,
      decision,
    };
  } catch (error) {
    console.error('[MetaBrain] Latest error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * GET /stats - Get statistics
 */
async function statsHandler(
  request: FastifyRequest<{
    Querystring: { since?: string };
  }>,
  reply: FastifyReply
) {
  try {
    const since = request.query.since ? parseInt(request.query.since) : undefined;
    
    const stats = await getDecisionStats(since);
    
    return {
      ok: true,
      stats,
    };
  } catch (error) {
    console.error('[MetaBrain] Stats error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function metaBrainV2Routes(fastify: FastifyInstance): Promise<void> {
  // Core
  fastify.post('/process', processHandler);
  fastify.get('/context/:symbol', contextHandler);
  fastify.post('/simulate', simulateHandler);
  
  // Transparency
  fastify.get('/rules', rulesHandler);
  
  // History & Stats
  fastify.get('/latest/:symbol', latestHandler);
  fastify.get('/history/:symbol', historyHandler);
  fastify.get('/stats', statsHandler);
  
  console.log('[C3] Meta-Brain v2 routes registered');
}

console.log('[C3] Meta-Brain v2 routes module loaded');
