/**
 * DXY FORWARD ADMIN ROUTES
 * 
 * D4.7 — Admin endpoints for DXY Forward Performance
 * 
 * Admin:
 * - POST /api/forward/dxy/admin/snapshot?asOf=YYYY-MM-DD
 * - POST /api/forward/dxy/admin/outcomes/resolve?limit=500
 * - POST /api/forward/dxy/admin/metrics/recompute
 * 
 * Public (for future UI):
 * - GET /api/forward/dxy/summary?window=ALL
 * - GET /api/forward/dxy/equity?horizon=30&window=ALL
 * 
 * ISOLATION: DXY only. No BTC/SPX imports.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createDxySnapshot, getDxySignals, getDxySignalCount } from '../services/dxy_forward_snapshot.service.js';
import { resolveDxyOutcomes, getDxyOutcomeStats } from '../services/dxy_forward_outcome.service.js';
import { recomputeAllMetrics, getFullSummary } from '../services/dxy_forward_metrics.service.js';
import { buildEquityCurve } from '../services/dxy_forward_equity.service.js';
import { DXY_HORIZON_DAYS } from '../dxy-forward.constants.js';

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerDxyForwardRoutes(fastify: FastifyInstance) {
  const prefix = '/api/forward/dxy';
  
  // ═══════════════════════════════════════════════════════════════
  // ADMIN ENDPOINTS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/forward/dxy/admin/snapshot
   * 
   * Create forward signals for a specific date
   * 
   * Query params:
   * - asOf: YYYY-MM-DD (default: today)
   * 
   * Body (optional):
   * - horizons: [7, 14, 30, ...] (default: all DXY horizons)
   */
  fastify.post(`${prefix}/admin/snapshot`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { asOf?: string };
      const body = req.body as { horizons?: number[] } | undefined;
      
      const asOf = query.asOf || new Date().toISOString().slice(0, 10);
      const horizons = body?.horizons?.map(Number).filter(n => !isNaN(n));
      
      const result = await createDxySnapshot({ asOf, horizons });
      
      return {
        ok: true,
        ...result,
      };
      
    } catch (e: any) {
      return reply.code(400).send({
        ok: false,
        error: e?.message || String(e),
      });
    }
  });
  
  /**
   * POST /api/forward/dxy/admin/outcomes/resolve
   * 
   * Resolve outcomes for all unresolved signals
   * 
   * Query params:
   * - limit: max signals to process (default: 500)
   */
  fastify.post(`${prefix}/admin/outcomes/resolve`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { limit?: string };
      const limit = query.limit ? parseInt(query.limit) : 500;
      
      const result = await resolveDxyOutcomes(limit);
      
      return {
        ok: true,
        ...result,
      };
      
    } catch (e: any) {
      return reply.code(500).send({
        ok: false,
        error: e?.message || String(e),
      });
    }
  });
  
  /**
   * POST /api/forward/dxy/admin/metrics/recompute
   * 
   * Recompute and cache all metrics
   */
  fastify.post(`${prefix}/admin/metrics/recompute`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await recomputeAllMetrics();
      
      return {
        ok: true,
        ...result,
      };
      
    } catch (e: any) {
      return reply.code(500).send({
        ok: false,
        error: e?.message || String(e),
      });
    }
  });
  
  /**
   * GET /api/forward/dxy/admin/stats
   * 
   * Get signal and outcome statistics
   */
  fastify.get(`${prefix}/admin/stats`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const signalCount = await getDxySignalCount();
      const outcomeStats = await getDxyOutcomeStats();
      
      return {
        ok: true,
        signals: signalCount,
        outcomes: outcomeStats,
      };
      
    } catch (e: any) {
      return reply.code(500).send({
        ok: false,
        error: e?.message || String(e),
      });
    }
  });
  
  /**
   * GET /api/forward/dxy/admin/signals
   * 
   * Get signals for a specific date
   */
  fastify.get(`${prefix}/admin/signals`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { asOf?: string };
      const asOf = query.asOf || new Date().toISOString().slice(0, 10);
      
      const signals = await getDxySignals(asOf);
      
      return {
        ok: true,
        asOf,
        count: signals.length,
        signals,
      };
      
    } catch (e: any) {
      return reply.code(400).send({
        ok: false,
        error: e?.message || String(e),
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC ENDPOINTS (for future UI)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/forward/dxy/summary
   * 
   * Get full forward performance summary
   * 
   * Query params:
   * - window: ALL | 1Y | 5Y | 10Y (default: ALL)
   */
  fastify.get(`${prefix}/summary`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { window?: string };
      const window = (['ALL', '1Y', '5Y', '10Y'].includes(query.window || '')
        ? query.window
        : 'ALL') as 'ALL' | '1Y' | '5Y' | '10Y';
      
      const summary = await getFullSummary(window);
      
      return {
        ok: true,
        ...summary,
      };
      
    } catch (e: any) {
      return reply.code(500).send({
        ok: false,
        error: e?.message || String(e),
      });
    }
  });
  
  /**
   * GET /api/forward/dxy/equity
   * 
   * Get equity curve for visualization
   * 
   * Query params:
   * - horizon: 7 | 14 | 30 | 90 | 180 | 365 (optional, default: all)
   * - window: ALL | 1Y | 5Y | 10Y (default: ALL)
   */
  fastify.get(`${prefix}/equity`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { horizon?: string; window?: string };
      
      const horizonDays = query.horizon ? parseInt(query.horizon) : null;
      const window = (['ALL', '1Y', '5Y', '10Y'].includes(query.window || '')
        ? query.window
        : 'ALL') as 'ALL' | '1Y' | '5Y' | '10Y';
      
      const curve = await buildEquityCurve({ horizonDays, window });
      
      return {
        ok: true,
        ...curve,
      };
      
    } catch (e: any) {
      return reply.code(500).send({
        ok: false,
        error: e?.message || String(e),
      });
    }
  });
  
  /**
   * GET /api/forward/dxy/horizons
   * 
   * Get available horizons
   */
  fastify.get(`${prefix}/horizons`, async (req: FastifyRequest, reply: FastifyReply) => {
    return {
      ok: true,
      horizons: DXY_HORIZON_DAYS,
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // D1: MACRO VALIDATION ENDPOINT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/forward/dxy/admin/validate/macro
   * 
   * D1: Walk-forward validation comparing:
   * - MODE_A (PURE): baseline fractal
   * - MODE_B (MACRO): fractal + macro overlay with SIZE scaling
   * 
   * Body:
   * {
   *   "from": "2000-01-01",
   *   "to": "2025-12-31",
   *   "stepDays": 7,
   *   "focus": "30d",
   *   "preset": "BALANCED",
   *   "modeB": {
   *     "applyMultiplierTo": "SIZE",
   *     "guardPolicy": "SKIP_TRADE"
   *   }
   * }
   */
  fastify.post(`${prefix}/admin/validate/macro`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = req.body as {
        from?: string;
        to?: string;
        stepDays?: number;
        focus?: string;
        preset?: string;
        modeB?: {
          applyMultiplierTo?: string;
          guardPolicy?: string;
        };
      } | undefined;
      
      const { runMacroValidation } = await import('../services/dxy_macro_validation.service.js');
      
      const result = await runMacroValidation({
        from: body?.from || '2000-01-01',
        to: body?.to || '2025-12-31',
        stepDays: body?.stepDays || 7,
        focus: body?.focus || '30d',
        preset: body?.preset || 'BALANCED',
        modeB: {
          applyMultiplierTo: (body?.modeB?.applyMultiplierTo || 'SIZE') as 'SIZE' | 'CONFIDENCE',
          guardPolicy: (body?.modeB?.guardPolicy || 'SKIP_TRADE') as 'SKIP_TRADE' | 'REDUCE_SIZE',
        },
      });
      
      return result;
      
    } catch (e: any) {
      console.error('[D1 Validation] Error:', e);
      return reply.code(500).send({
        ok: false,
        error: e?.message || String(e),
      });
    }
  });
  
  console.log('[DXY Forward] Routes registered at /api/forward/dxy/*');
  console.log('[DXY Forward] D1 Macro validation at /api/forward/dxy/admin/validate/macro');
}

export default registerDxyForwardRoutes;
