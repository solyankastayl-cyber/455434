/**
 * AE Brain API Routes
 * 
 * Endpoints:
 * - GET  /api/ae/health
 * - GET  /api/ae/state
 * - GET  /api/ae/regime
 * - GET  /api/ae/causal
 * - GET  /api/ae/scenarios
 * - GET  /api/ae/novelty
 * - GET  /api/ae/terminal
 * - POST /api/ae/admin/snapshot
 */

import { FastifyInstance } from 'fastify';
import { buildAeState } from '../services/ae_state.service.js';
import { classifyRegime } from '../services/ae_regime.service.js';
import { buildCausalGraph } from '../services/ae_causal.service.js';
import { buildScenarios } from '../services/ae_scenarios.service.js';
import { computeNovelty, snapshotState, getNoveltyStats, getStateFromDB } from '../services/ae_novelty.service.js';
import { buildAeTerminal, getAeBrainHealth } from '../services/ae_terminal.service.js';
import { runAeBackfill, getBackfillStats } from '../services/ae_backfill.service.js';

export async function registerAeRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // HEALTH
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/ae/health', async (request, reply) => {
    const health = await getAeBrainHealth();
    const noveltyStats = await getNoveltyStats();
    
    return {
      ...health,
      noveltyStats,
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // C1: STATE VECTOR
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get<{ Querystring: { asOf?: string } }>(
    '/api/ae/state',
    async (request, reply) => {
      const { asOf } = request.query;
      const targetDate = asOf || new Date().toISOString().split('T')[0];
      
      try {
        // First try to get from historical database
        const historicalState = await getStateFromDB(targetDate);
        if (historicalState) {
          return { ok: true, ...historicalState, source: 'historical' };
        }
        
        // Fallback to live calculation for current date
        const state = await buildAeState(targetDate);
        return { ok: true, ...state, source: 'live' };
      } catch (e) {
        return reply.status(500).send({
          ok: false,
          error: (e as Error).message,
        });
      }
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // C2: REGIME CLASSIFIER
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get<{ Querystring: { asOf?: string } }>(
    '/api/ae/regime',
    async (request, reply) => {
      const { asOf } = request.query;
      const targetDate = asOf || new Date().toISOString().split('T')[0];
      
      try {
        // First try historical data
        const historicalState = await getStateFromDB(targetDate);
        if (historicalState) {
          const regime = classifyRegime(historicalState);
          return { ok: true, asOf: targetDate, source: 'historical', ...regime };
        }
        
        // Fallback to live
        const state = await buildAeState(targetDate);
        const regime = classifyRegime(state);
        return { ok: true, asOf: targetDate, source: 'live', ...regime };
      } catch (e) {
        return reply.status(500).send({
          ok: false,
          error: (e as Error).message,
        });
      }
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // C3: CAUSAL GRAPH
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get<{ Querystring: { asOf?: string } }>(
    '/api/ae/causal',
    async (request, reply) => {
      const { asOf } = request.query;
      
      try {
        const state = await buildAeState(asOf);
        const causal = buildCausalGraph(state);
        return { ok: true, asOf: state.asOf, ...causal };
      } catch (e) {
        return reply.status(500).send({
          ok: false,
          error: (e as Error).message,
        });
      }
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // C4: SCENARIOS
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get<{ Querystring: { asOf?: string } }>(
    '/api/ae/scenarios',
    async (request, reply) => {
      const { asOf } = request.query;
      
      try {
        const state = await buildAeState(asOf);
        const regime = classifyRegime(state);
        const scenarios = buildScenarios(state, regime);
        return { ok: true, asOf: state.asOf, ...scenarios };
      } catch (e) {
        return reply.status(500).send({
          ok: false,
          error: (e as Error).message,
        });
      }
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // C5: NOVELTY
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get<{ Querystring: { asOf?: string } }>(
    '/api/ae/novelty',
    async (request, reply) => {
      const { asOf } = request.query;
      const today = asOf || new Date().toISOString().split('T')[0];
      
      try {
        const novelty = await computeNovelty(today);
        return { ok: true, asOf: today, ...novelty };
      } catch (e) {
        return reply.status(500).send({
          ok: false,
          error: (e as Error).message,
        });
      }
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // TERMINAL (MAIN)
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get<{ Querystring: { asOf?: string } }>(
    '/api/ae/terminal',
    async (request, reply) => {
      const { asOf } = request.query;
      
      try {
        const terminal = await buildAeTerminal(asOf);
        return terminal;
      } catch (e) {
        return reply.status(500).send({
          ok: false,
          error: (e as Error).message,
        });
      }
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // P4.2: TERMINAL WITH EVIDENCE
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get<{ Querystring: { asOf?: string } }>(
    '/api/ae/terminal/evidence',
    async (request, reply) => {
      const { asOf } = request.query;
      
      try {
        const terminal = await buildAeTerminal(asOf);
        const { buildAeEvidence } = await import('../../evidence-engine/ae_evidence.builder.js');
        
        const evidence = buildAeEvidence(terminal);
        
        return {
          ...terminal,
          evidence,
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
  // ADMIN: SNAPSHOT
  // ═══════════════════════════════════════════════════════════════
  
  fastify.post<{ Querystring: { asOf?: string } }>(
    '/api/ae/admin/snapshot',
    async (request, reply) => {
      const { asOf } = request.query;
      const today = asOf || new Date().toISOString().split('T')[0];
      
      try {
        // Build current state
        const state = await buildAeState(today);
        
        // Snapshot to database
        const result = await snapshotState(state);
        
        return {
          ok: result.ok,
          asOf: today,
          created: result.created,
          state: state.vector,
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
  // ADMIN: BULK SNAPSHOT (for historical backfill)
  // ═══════════════════════════════════════════════════════════════
  
  fastify.post<{ Body: { dates: string[] } }>(
    '/api/ae/admin/snapshot-bulk',
    async (request, reply) => {
      const { dates } = request.body || {};
      
      if (!dates || !Array.isArray(dates) || dates.length === 0) {
        return reply.status(400).send({
          ok: false,
          error: 'dates array required',
        });
      }
      
      const results: Array<{ asOf: string; ok: boolean; created: boolean }> = [];
      
      for (const asOf of dates) {
        try {
          const state = await buildAeState(asOf);
          const result = await snapshotState(state);
          results.push({ asOf, ok: result.ok, created: result.created });
        } catch (e) {
          results.push({ asOf, ok: false, created: false });
        }
      }
      
      return {
        ok: true,
        processed: results.length,
        created: results.filter(r => r.created).length,
        results,
      };
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // ADMIN: HISTORICAL BACKFILL (C6)
  // ═══════════════════════════════════════════════════════════════
  
  fastify.post<{ Querystring: { from?: string; to?: string; stepDays?: string } }>(
    '/api/ae/admin/backfill',
    async (request, reply) => {
      const from = request.query.from || '2000-01-01';
      const to = request.query.to || '2025-12-31';
      const stepDays = parseInt(request.query.stepDays || '7');
      
      if (stepDays < 1 || stepDays > 30) {
        return reply.status(400).send({
          ok: false,
          error: 'stepDays must be 1-30',
        });
      }
      
      try {
        const result = await runAeBackfill(from, to, stepDays);
        return result;
      } catch (e) {
        return reply.status(500).send({
          ok: false,
          error: (e as Error).message,
        });
      }
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // ADMIN: BACKFILL STATS
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/ae/admin/backfill-stats', async (request, reply) => {
    try {
      const stats = await getBackfillStats();
      return { ok: true, ...stats };
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: (e as Error).message,
      });
    }
  });
  
  console.log('[AE Brain] Routes registered:');
  console.log('  GET  /api/ae/health');
  console.log('  GET  /api/ae/state');
  console.log('  GET  /api/ae/regime');
  console.log('  GET  /api/ae/causal');
  console.log('  GET  /api/ae/scenarios');
  console.log('  GET  /api/ae/novelty');
  console.log('  GET  /api/ae/terminal');
  console.log('  POST /api/ae/admin/snapshot');
  console.log('  POST /api/ae/admin/backfill');
  console.log('  GET  /api/ae/admin/backfill-stats');
}
