/**
 * C8 Transition Matrix API Routes
 * 
 * Endpoints:
 * - POST /api/ae/admin/transition/compute  - Compute matrix
 * - GET  /api/ae/transition/current        - Get current matrix + derived
 * - GET  /api/ae/transition/matrix         - Get raw matrix
 * - GET  /api/ae/transition/durations      - Get duration stats
 */

import { FastifyInstance } from 'fastify';
import {
  computeTransitionMatrix,
  getLatestMatrix,
  computeDerivedMetrics,
  computeDurationStats,
  getTransitionPack,
} from '../services/transition.service.js';
import type { TransitionConfig } from '../contracts/transition.contract.js';

export async function registerTransitionRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // ADMIN: COMPUTE MATRIX
  // ═══════════════════════════════════════════════════════════════
  
  fastify.post<{
    Body: {
      from?: string;
      to?: string;
      stepDays?: number;
      alpha?: number;
    };
  }>(
    '/api/ae/admin/transition/compute',
    async (request, reply) => {
      const body = request.body || {};
      
      const config: TransitionConfig = {
        from: body.from || '2000-01-01',
        to: body.to || '2025-12-31',
        stepDays: body.stepDays || 7,
        alpha: body.alpha || 1,
      };
      
      if (config.stepDays < 1 || config.stepDays > 30) {
        return reply.status(400).send({
          ok: false,
          error: 'stepDays must be 1-30',
        });
      }
      
      try {
        const matrix = await computeTransitionMatrix(config);
        return {
          ok: true,
          matrix,
        };
      } catch (e) {
        return reply.status(500).send({
          ok: false,
          error: (e as Error).message,
        });
      }
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // GET CURRENT (MATRIX + DERIVED)
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get<{ Querystring: { label?: string } }>(
    '/api/ae/transition/current',
    async (request, reply) => {
      try {
        const pack = await getTransitionPack(request.query.label);
        
        if (!pack) {
          return reply.status(404).send({
            ok: false,
            error: 'No transition matrix computed yet',
          });
        }
        
        return {
          ok: true,
          ...pack,
        };
      } catch (e) {
        return reply.status(500).send({
          ok: false,
          error: (e as Error).message,
        });
      }
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // GET RAW MATRIX
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/ae/transition/matrix', async (request, reply) => {
    try {
      const matrix = await getLatestMatrix();
      
      if (!matrix) {
        return reply.status(404).send({
          ok: false,
          error: 'No transition matrix computed yet',
        });
      }
      
      return {
        ok: true,
        matrix,
      };
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: (e as Error).message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET DURATION STATS
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get<{
    Querystring: { from?: string; to?: string };
  }>(
    '/api/ae/transition/durations',
    async (request, reply) => {
      const { from = '2000-01-01', to = '2025-12-31' } = request.query;
      
      try {
        const durations = await computeDurationStats(from, to);
        return {
          ok: true,
          durations,
        };
      } catch (e) {
        return reply.status(500).send({
          ok: false,
          error: (e as Error).message,
        });
      }
    }
  );
  
  console.log('[AE Transition] Routes registered:');
  console.log('  POST /api/ae/admin/transition/compute');
  console.log('  GET  /api/ae/transition/current');
  console.log('  GET  /api/ae/transition/matrix');
  console.log('  GET  /api/ae/transition/durations');
}
