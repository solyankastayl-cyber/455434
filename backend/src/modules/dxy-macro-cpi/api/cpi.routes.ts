/**
 * CPI ROUTES — D6 v2
 * 
 * API endpoints for CPI Macro Layer.
 * 
 * ISOLATION:
 * - Does NOT modify DXY fractal core
 * - Only provides CPI context and adjustment
 * 
 * Endpoints:
 * - GET  /api/dxy-macro/cpi-context — Current CPI context
 * - GET  /api/dxy-macro/cpi-history — CPI history
 * - POST /api/dxy-macro/admin/cpi/ingest — Ingest CPI data
 * - GET  /api/dxy-macro/admin/cpi/meta — CPI data meta
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getCpiContext, getCpiHistory } from '../services/cpi_context.service.js';
import { computeCpiAdjustment } from '../services/cpi_adjustment.service.js';
import { ingestAllCpiSeries, getCpiMeta, checkCpiIntegrity } from '../services/cpi_ingest.service.js';

// ═══════════════════════════════════════════════════════════════
// REGISTER ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerCpiRoutes(fastify: FastifyInstance) {
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/dxy-macro/cpi-context
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/dxy-macro/cpi-context', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { asOf?: string };
      const asOf = query.asOf ? new Date(query.asOf) : undefined;
      
      const integrity = await checkCpiIntegrity();
      if (!integrity.ok) {
        return reply.code(503).send({
          ok: false,
          error: 'INSUFFICIENT_CPI_DATA',
          message: integrity.warning,
          hint: 'Run POST /api/dxy-macro/admin/cpi/ingest to load CPI data',
        });
      }
      
      const context = await getCpiContext(asOf);
      
      return {
        ok: true,
        ...context,
      };
      
    } catch (error: any) {
      console.error('[CPI] Context error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/dxy-macro/cpi-history
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/dxy-macro/cpi-history', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { months?: string; series?: string };
      const months = query.months ? parseInt(query.months) : 120;
      const series = (query.series === 'headline' ? 'headline' : 'core') as 'headline' | 'core';
      
      const history = await getCpiHistory(months, series);
      
      return {
        ok: true,
        series,
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
  // POST /api/dxy-macro/admin/cpi/ingest
  // ═══════════════════════════════════════════════════════════════
  
  fastify.post('/api/dxy-macro/admin/cpi/ingest', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = req.query as { start?: string };
      const startDate = query.start || '1947-01-01';
      
      const result = await ingestAllCpiSeries(startDate);
      
      return result;
      
    } catch (error: any) {
      console.error('[CPI] Ingest error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/dxy-macro/admin/cpi/meta
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/dxy-macro/admin/cpi/meta', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const meta = await getCpiMeta();
      const integrity = await checkCpiIntegrity();
      
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
  
  console.log('[CPI] Routes registered at /api/dxy-macro/cpi-*');
}

export default registerCpiRoutes;
