/**
 * UNRATE ROUTES — D6 v3
 * 
 * API endpoints for Unemployment Rate Macro Layer.
 * 
 * ISOLATION:
 * - Does NOT modify DXY fractal core
 * - Only provides UNRATE context and adjustment
 * 
 * Endpoints:
 * - GET  /api/dxy-macro/unrate-context — Current unemployment context
 * - GET  /api/dxy-macro/unrate-history — Unemployment history
 * - POST /api/dxy-macro/admin/unrate/ingest — Ingest UNRATE data
 * - GET  /api/dxy-macro/admin/unrate/meta — UNRATE data meta
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getUnrateContext, getUnrateHistory } from '../services/unrate.context.service.js';
import { ingestUnrateFromFred, getUnrateMeta, checkUnrateIntegrity } from '../services/unrate.ingest.service.js';

// ═══════════════════════════════════════════════════════════════
// REGISTER ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerUnrateRoutes(fastify: FastifyInstance) {
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/dxy-macro/unrate-context
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/dxy-macro/unrate-context', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { asOf?: string };
      const asOf = query.asOf ? new Date(query.asOf) : undefined;
      
      const integrity = await checkUnrateIntegrity();
      if (!integrity.ok) {
        return reply.code(503).send({
          ok: false,
          error: 'INSUFFICIENT_UNRATE_DATA',
          message: integrity.warning,
          hint: 'Run POST /api/dxy-macro/admin/unrate/ingest to load data',
        });
      }
      
      const context = await getUnrateContext(asOf);
      
      return {
        ok: true,
        ...context,
      };
      
    } catch (error: any) {
      console.error('[UNRATE] Context error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/dxy-macro/unrate-history
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/dxy-macro/unrate-history', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { months?: string };
      const months = query.months ? parseInt(query.months) : 120;
      
      const history = await getUnrateHistory(months);
      
      return {
        ok: true,
        months,
        dataPoints: history.length,
        history,
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // POST /api/dxy-macro/admin/unrate/ingest
  // ═══════════════════════════════════════════════════════════════
  
  fastify.post('/api/dxy-macro/admin/unrate/ingest', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { start?: string };
      const startDate = query.start || '1948-01-01';
      
      const result = await ingestUnrateFromFred(startDate);
      
      return result;
      
    } catch (error: any) {
      console.error('[UNRATE] Ingest error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/dxy-macro/admin/unrate/meta
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/dxy-macro/admin/unrate/meta', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const meta = await getUnrateMeta();
      const integrity = await checkUnrateIntegrity();
      
      return {
        ok: true,
        ...meta,
        integrity,
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  console.log('[UNRATE] Routes registered at /api/dxy-macro/unrate-*');
}

export default registerUnrateRoutes;
