/**
 * SPX PHASE ROUTES — HTTP Endpoints
 * 
 * BLOCK B5.4 — SPX Phase Engine API
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { spxPhaseService } from './spx-phase.service.js';
import { SpxCandleModel } from '../spx/spx.mongo.js';

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerSpxPhaseRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/spx/v2.1';

  /**
   * GET /api/spx/v2.1/phases
   * 
   * Get complete phase analysis
   */
  app.get(`${prefix}/phases`, async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      // Load candles
      const candles = await SpxCandleModel.find()
        .sort({ t: 1 })
        .lean()
        .exec();

      if (candles.length < 250) {
        return reply.send({
          ok: false,
          error: 'Insufficient SPX data for phase analysis',
          minRequired: 250,
          actual: candles.length,
        });
      }

      // Build phase output
      const output = spxPhaseService.build(candles as any);

      return reply.send({
        ok: true,
        data: output,
      });
    } catch (err: any) {
      console.error('[SPX Phase] Error:', err);
      return reply.status(500).send({
        ok: false,
        error: err.message || 'Phase analysis failed',
      });
    }
  });

  /**
   * GET /api/spx/v2.1/phases/current
   * 
   * Get current phase only (lightweight)
   */
  app.get(`${prefix}/phases/current`, async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      // Load candles
      const candles = await SpxCandleModel.find()
        .sort({ t: 1 })
        .lean()
        .exec();

      if (candles.length < 250) {
        return reply.send({
          ok: false,
          error: 'Insufficient SPX data',
        });
      }

      // Build phase output
      const output = spxPhaseService.build(candles as any);

      return reply.send({
        ok: true,
        data: {
          phase: output.phaseIdAtNow,
          currentFlags: output.currentFlags,
          overallGrade: output.overallGrade,
          lastUpdated: output.lastUpdated,
        },
      });
    } catch (err: any) {
      console.error('[SPX Phase] Current error:', err);
      return reply.status(500).send({
        ok: false,
        error: err.message || 'Phase lookup failed',
      });
    }
  });

  /**
   * GET /api/spx/v2.1/phases/range
   * 
   * Get phases in date range (for chart shading)
   */
  app.get(`${prefix}/phases/range`, async (
    request: FastifyRequest<{ 
      Querystring: { startDate: string; endDate: string } 
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { startDate, endDate } = request.query;

      if (!startDate || !endDate) {
        return reply.status(400).send({
          ok: false,
          error: 'startDate and endDate required',
        });
      }

      // Load candles
      const candles = await SpxCandleModel.find()
        .sort({ t: 1 })
        .lean()
        .exec();

      if (candles.length < 250) {
        return reply.send({
          ok: false,
          error: 'Insufficient SPX data',
        });
      }

      // Get phases in range
      const phases = spxPhaseService.getPhasesInRange(
        candles as any, 
        startDate, 
        endDate
      );

      return reply.send({
        ok: true,
        data: phases,
        meta: {
          startDate,
          endDate,
          phaseCount: phases.length,
        },
      });
    } catch (err: any) {
      console.error('[SPX Phase] Range error:', err);
      return reply.status(500).send({
        ok: false,
        error: err.message || 'Phase range lookup failed',
      });
    }
  });

  console.log('[SPX Phase] Routes registered');
}
