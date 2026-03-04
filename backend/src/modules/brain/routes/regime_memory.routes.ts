/**
 * P10.1 — Regime Memory Routes
 * 
 * GET  /api/brain/v2/regime-memory/current     — Get current regime memory
 * GET  /api/brain/v2/regime-memory/timeline    — Historical timeline
 * POST /api/brain/v2/regime-memory/recompute   — Admin: full rebuild
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getRegimeMemoryService } from '../services/regime_memory.service.js';
import { validateRegimeMemoryPack } from '../contracts/regime_memory.contract.js';

export async function regimeMemoryRoutes(fastify: FastifyInstance): Promise<void> {

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/regime-memory/current
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/regime-memory/current', async (
    request: FastifyRequest<{
      Querystring: { asOf?: string }
    }>,
    reply: FastifyReply
  ) => {
    const asOf = request.query.asOf;
    
    try {
      const service = getRegimeMemoryService();
      const pack = await service.getCurrent(asOf);
      
      const validation = validateRegimeMemoryPack(pack);
      
      return reply.send({ 
        ok: true, 
        ...pack,
        validation: {
          valid: validation.valid,
          errors: validation.errors.length > 0 ? validation.errors : undefined,
        },
      });
    } catch (e) {
      console.error('[RegimeMemory] Error getting current:', e);
      return reply.status(500).send({
        ok: false,
        error: 'REGIME_MEMORY_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/regime-memory/timeline
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/regime-memory/timeline', async (
    request: FastifyRequest<{
      Querystring: { 
        start?: string; 
        end?: string; 
        stepDays?: string;
      }
    }>,
    reply: FastifyReply
  ) => {
    const now = new Date();
    const defaultEnd = now.toISOString().split('T')[0];
    const defaultStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const start = request.query.start || defaultStart;
    const end = request.query.end || defaultEnd;
    const stepDays = parseInt(request.query.stepDays || '7');

    try {
      const service = getRegimeMemoryService();
      const timeline = await service.getTimeline(start, end, stepDays);
      
      return reply.send({ ok: true, ...timeline });
    } catch (e) {
      console.error('[RegimeMemory] Error getting timeline:', e);
      return reply.status(500).send({
        ok: false,
        error: 'TIMELINE_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // POST /api/brain/v2/regime-memory/recompute (admin)
  // ─────────────────────────────────────────────────────────

  fastify.post('/api/brain/v2/regime-memory/recompute', async (
    request: FastifyRequest<{
      Body: {
        start?: string;
        end?: string;
        stepDays?: number;
      }
    }>,
    reply: FastifyReply
  ) => {
    const body = request.body || {};
    
    const now = new Date();
    const defaultEnd = now.toISOString().split('T')[0];
    const defaultStart = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const start = body.start || defaultStart;
    const end = body.end || defaultEnd;
    const stepDays = body.stepDays || 1;

    try {
      console.log(`[RegimeMemory] Admin RECOMPUTE: ${start} → ${end}, step=${stepDays}d`);
      const service = getRegimeMemoryService();
      const result = await service.recompute(start, end, stepDays);
      
      // Get final state after recompute
      const current = await service.getCurrent(end);
      
      return reply.send({ 
        ok: true, 
        recompute: result,
        finalState: {
          macro: { current: current.macro.current, daysInState: current.macro.daysInState, stability: current.macro.stability },
          guard: { current: current.guard.current, daysInState: current.guard.daysInState, stability: current.guard.stability },
          crossAsset: { current: current.crossAsset.current, daysInState: current.crossAsset.daysInState, stability: current.crossAsset.stability },
        },
      });
    } catch (e) {
      console.error('[RegimeMemory] Recompute error:', e);
      return reply.status(500).send({
        ok: false,
        error: 'RECOMPUTE_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/regime-memory/schema
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/regime-memory/schema', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      ok: true,
      version: 'P10.1',
      scopes: {
        macro: {
          values: ['EASING', 'TIGHTENING', 'STRESS', 'NEUTRAL', 'NEUTRAL_MIXED', 'RISK_ON', 'RISK_OFF'],
          description: 'Macro economic regime from DXY/Fed policy',
        },
        guard: {
          values: ['NONE', 'WARN', 'CRISIS', 'BLOCK'],
          description: 'Risk guard level from credit/VIX stress',
        },
        crossAsset: {
          values: ['RISK_ON_SYNC', 'RISK_OFF_SYNC', 'FLIGHT_TO_QUALITY', 'DECOUPLED', 'MIXED'],
          description: 'Cross-asset correlation regime',
        },
      },
      stability: {
        formula: '0.5 * (daysInState/90) + 0.5 * (1 - flips30d/10)',
        range: '[0, 1]',
        interpretation: {
          '0.0-0.3': 'Unstable (high flips, short duration)',
          '0.3-0.6': 'Transitional',
          '0.6-0.8': 'Stable',
          '0.8-1.0': 'Very stable (long duration, no flips)',
        },
      },
      endpoints: {
        current: 'GET /api/brain/v2/regime-memory/current?asOf=YYYY-MM-DD',
        timeline: 'GET /api/brain/v2/regime-memory/timeline?start=&end=&stepDays=',
        recompute: 'POST /api/brain/v2/regime-memory/recompute { start, end, stepDays }',
      },
    });
  });

  console.log('[RegimeMemory] P10.1 Routes registered at /api/brain/v2/regime-memory/*');
}
