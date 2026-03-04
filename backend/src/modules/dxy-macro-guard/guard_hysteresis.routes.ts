/**
 * GUARD HYSTERESIS ROUTES — P1.3
 * 
 * API endpoints for guard with hysteresis.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  getCurrentGuardState,
  validateHysteresis,
  resetGuardState,
} from './guard_hysteresis.service.js';
import { THRESHOLDS, LEVEL_ORDER } from './guard_hysteresis.rules.js';

export async function registerGuardHysteresisRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/dxy-macro-core/guard';
  
  /**
   * GET /api/dxy-macro-core/guard/current
   * 
   * Get current guard state with hysteresis applied.
   */
  fastify.get(`${prefix}/current`, async () => {
    try {
      const state = await getCurrentGuardState();
      return { ok: true, ...state };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });
  
  /**
   * GET /api/dxy-macro-core/guard/validate/hysteresis
   * 
   * Validate hysteresis logic on historical data.
   */
  fastify.get(`${prefix}/validate/hysteresis`, async (req: FastifyRequest) => {
    const query = req.query as { from?: string; to?: string };
    const from = query.from || '2000-01-01';
    const to = query.to || '2025-12-31';
    
    try {
      const result = await validateHysteresis(from, to);
      return result;
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });
  
  /**
   * GET /api/dxy-macro-core/guard/config
   * 
   * Get guard thresholds configuration.
   */
  fastify.get(`${prefix}/config`, async () => {
    return {
      ok: true,
      version: 'GUARD_HYSTERESIS_V1.0',
      thresholds: THRESHOLDS,
      levelOrder: LEVEL_ORDER,
    };
  });
  
  /**
   * POST /api/dxy-macro-core/guard/admin/reset
   * 
   * Reset guard state (for testing).
   */
  fastify.post(`${prefix}/admin/reset`, async () => {
    try {
      await resetGuardState();
      return { ok: true, message: 'Guard state reset' };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });
  
  /**
   * GET /api/dxy-macro-core/guard/health
   * 
   * Health check.
   */
  fastify.get(`${prefix}/health`, async () => {
    return {
      ok: true,
      module: 'guard-hysteresis',
      version: 'P1.3',
      status: 'ACTIVE',
      features: ['enter_exit_thresholds', 'min_hold', 'cooldown'],
    };
  });
  
  fastify.log.info(`[Guard Hysteresis] Routes registered at ${prefix}/*`);
}

export default registerGuardHysteresisRoutes;
