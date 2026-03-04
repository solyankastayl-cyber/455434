/**
 * C2.1.1 — Onchain API Routes
 * ============================
 * 
 * REST API endpoints for on-chain data.
 * 
 * ENDPOINTS:
 * - GET /health
 * - GET /snapshot/:symbol
 * - GET /latest/:symbol
 * - GET /history/:symbol
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { onchainSnapshotService } from './onchain.service.js';
import { onchainMetricsEngine } from './onchain.metrics.js';
import { onchainPersistenceBuilder } from './onchain.persistence.js';
import { OnchainProviderHealthModel } from './onchain.models.js';
import {
  OnchainWindow,
  OnchainHealthResponse,
  OnchainProviderStatus,
} from './onchain.contracts.js';

// Health handler
async function healthHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<OnchainHealthResponse> {
  try {
    const providers = await OnchainProviderHealthModel.find({}).lean();
    
    let overallStatus: OnchainProviderStatus = 'DOWN';
    const upProviders = providers.filter(p => p.status === 'UP');
    
    if (upProviders.length === providers.length && providers.length > 0) {
      overallStatus = 'UP';
    } else if (upProviders.length > 0) {
      overallStatus = 'DEGRADED';
    }
    
    return {
      ok: true,
      status: overallStatus,
      providers: providers.map(p => ({
        providerId: p.providerId,
        providerName: p.providerName,
        status: p.status as OnchainProviderStatus,
        chains: p.chains,
        lastSuccessAt: p.lastSuccessAt,
        lastError: p.lastError,
        lastErrorAt: p.lastErrorAt,
        successRate24h: p.successRate24h,
        avgLatencyMs: p.avgLatencyMs,
        checkedAt: p.checkedAt,
      })),
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error('[Onchain] Health check error:', error);
    return {
      ok: false,
      status: 'DOWN',
      providers: [],
      timestamp: Date.now(),
    };
  }
}

// Snapshot handler
async function snapshotHandler(
  request: FastifyRequest<{
    Params: { symbol: string };
    Querystring: { t0?: string; window?: OnchainWindow };
  }>,
  reply: FastifyReply
) {
  try {
    const { symbol } = request.params;
    const t0 = request.query.t0 ? parseInt(request.query.t0) : undefined;
    const window = request.query.window || '1h';
    
    const result = await onchainSnapshotService.getSnapshot(symbol, t0, window);
    return result;
  } catch (error) {
    console.error('[Onchain] Snapshot error:', error);
    return {
      ok: false,
      snapshot: null,
      source: 'mock',
      confidence: 0,
      dataAvailable: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Latest handler
async function latestHandler(
  request: FastifyRequest<{
    Params: { symbol: string };
    Querystring: { window?: OnchainWindow };
  }>,
  reply: FastifyReply
) {
  try {
    const { symbol } = request.params;
    const window = request.query.window || '1h';
    
    const result = await onchainSnapshotService.getLatest(symbol, window);
    return result;
  } catch (error) {
    console.error('[Onchain] Latest error:', error);
    return {
      ok: false,
      snapshot: null,
      source: 'mock',
      confidence: 0,
      dataAvailable: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// History handler
async function historyHandler(
  request: FastifyRequest<{
    Params: { symbol: string };
    Querystring: { from: string; to: string; window?: OnchainWindow };
  }>,
  reply: FastifyReply
) {
  try {
    const { symbol } = request.params;
    const { from, to, window = '1h' } = request.query;
    
    if (!from || !to) {
      reply.code(400);
      return {
        ok: false,
        error: 'Missing required parameters: from, to',
      };
    }
    
    const result = await onchainSnapshotService.getHistory(
      symbol,
      parseInt(from),
      parseInt(to),
      window
    );
    return result;
  } catch (error) {
    console.error('[Onchain] History error:', error);
    return {
      ok: false,
      observations: [],
      count: 0,
      range: { from: 0, to: 0 },
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// C2.1.2 — METRICS HANDLERS
// ═══════════════════════════════════════════════════════════════

/**
 * GET /metrics/:symbol - Get normalized metrics
 */
async function metricsHandler(
  request: FastifyRequest<{
    Params: { symbol: string };
    Querystring: { t0?: string; window?: OnchainWindow };
  }>,
  reply: FastifyReply
) {
  try {
    const { symbol } = request.params;
    const t0 = request.query.t0 ? parseInt(request.query.t0) : undefined;
    const window = request.query.window || '1h';
    
    // Get snapshot first
    const snapshotRes = await onchainSnapshotService.getSnapshot(symbol, t0, window);
    
    if (!snapshotRes.ok || !snapshotRes.snapshot) {
      return {
        ok: false,
        metrics: null,
        error: 'Failed to get snapshot',
      };
    }
    
    // Calculate metrics
    const metrics = onchainMetricsEngine.calculate(snapshotRes.snapshot);
    
    return {
      ok: true,
      metrics,
      source: snapshotRes.source,
    };
  } catch (error) {
    console.error('[Onchain] Metrics error:', error);
    return {
      ok: false,
      metrics: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * GET /diagnostics/:symbol - Get detailed diagnostics
 */
async function diagnosticsHandler(
  request: FastifyRequest<{
    Params: { symbol: string };
    Querystring: { t0?: string; window?: OnchainWindow };
  }>,
  reply: FastifyReply
) {
  try {
    const { symbol } = request.params;
    const t0 = request.query.t0 ? parseInt(request.query.t0) : undefined;
    const window = request.query.window || '1h';
    
    // Get snapshot
    const snapshotRes = await onchainSnapshotService.getSnapshot(symbol, t0, window);
    
    if (!snapshotRes.ok || !snapshotRes.snapshot) {
      return {
        ok: false,
        diagnostics: null,
        error: 'Failed to get snapshot',
      };
    }
    
    // Calculate metrics
    const metrics = onchainMetricsEngine.calculate(snapshotRes.snapshot);
    
    // Get diagnostics
    const diagnostics = onchainMetricsEngine.getDiagnostics(snapshotRes.snapshot, metrics);
    
    return {
      ok: true,
      diagnostics,
    };
  } catch (error) {
    console.error('[Onchain] Diagnostics error:', error);
    return {
      ok: false,
      diagnostics: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Route registration
export async function onchainRoutes(fastify: FastifyInstance): Promise<void> {
  // C2.1.1 — Data Foundation
  fastify.get('/health', healthHandler);
  fastify.get('/snapshot/:symbol', snapshotHandler);
  fastify.get('/latest/:symbol', latestHandler);
  fastify.get('/history/:symbol', historyHandler);
  
  // C2.1.2 — Metrics Engine
  fastify.get('/metrics/:symbol', metricsHandler);
  fastify.get('/diagnostics/:symbol', diagnosticsHandler);
  
  // C2.1.3 — Persistence Builder
  fastify.post('/tick', tickHandler);
  fastify.post('/backfill', backfillHandler);
  fastify.get('/observation/:symbol', observationHandler);
  
  console.log('[C2.1] Onchain routes registered (Data + Metrics + Persistence)');
}

// ═══════════════════════════════════════════════════════════════
// C2.1.3 — PERSISTENCE HANDLERS
// ═══════════════════════════════════════════════════════════════

/**
 * POST /tick - Create observation at t0
 */
async function tickHandler(
  request: FastifyRequest<{
    Body: { symbol: string; t0?: number; window?: OnchainWindow; force?: boolean };
  }>,
  reply: FastifyReply
) {
  try {
    const { symbol, t0, window = '1h', force = false } = request.body || {};
    
    if (!symbol) {
      reply.code(400);
      return { ok: false, error: 'Missing required parameter: symbol' };
    }
    
    const result = await onchainPersistenceBuilder.tick(symbol, t0, window, force);
    return result;
  } catch (error) {
    console.error('[Onchain] Tick error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * POST /backfill - Backfill observations for time range
 */
async function backfillHandler(
  request: FastifyRequest<{
    Body: { 
      symbol: string; 
      from: number; 
      to: number; 
      stepMs?: number;
      window?: OnchainWindow;
    };
  }>,
  reply: FastifyReply
) {
  try {
    const { symbol, from, to, stepMs = 60_000, window = '1h' } = request.body || {};
    
    if (!symbol || !from || !to) {
      reply.code(400);
      return { ok: false, error: 'Missing required parameters: symbol, from, to' };
    }
    
    // Limit backfill range to prevent abuse
    const maxRangeMs = 24 * 60 * 60 * 1000;  // 24 hours
    if (to - from > maxRangeMs) {
      reply.code(400);
      return { ok: false, error: 'Backfill range too large (max 24 hours)' };
    }
    
    const result = await onchainPersistenceBuilder.backfill(symbol, from, to, stepMs, window);
    return result;
  } catch (error) {
    console.error('[Onchain] Backfill error:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * GET /observation/:symbol - Get latest observation
 */
async function observationHandler(
  request: FastifyRequest<{
    Params: { symbol: string };
    Querystring: { t0?: string; window?: OnchainWindow };
  }>,
  reply: FastifyReply
) {
  try {
    const { symbol } = request.params;
    const t0 = request.query.t0 ? parseInt(request.query.t0) : undefined;
    const window = request.query.window || '1h';
    
    let observation;
    if (t0) {
      observation = await onchainPersistenceBuilder.getAt(symbol, t0, window);
    } else {
      observation = await onchainPersistenceBuilder.getLatest(symbol, window);
    }
    
    if (!observation) {
      return {
        ok: true,
        observation: null,
        message: 'No observation found',
      };
    }
    
    return {
      ok: true,
      observation,
    };
  } catch (error) {
    console.error('[Onchain] Observation error:', error);
    return {
      ok: false,
      observation: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

console.log('[C2.1] Onchain routes module loaded');
