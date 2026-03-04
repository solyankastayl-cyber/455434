/**
 * DXY ADMIN ROUTES — Data Ingestion & Management
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { 
  ingestFromStooq, 
  ingestFromLocalCsv, 
  getDxyMeta, 
  checkDxyIntegrity 
} from '../services/dxy-ingest.service.js';

// ═══════════════════════════════════════════════════════════════
// REGISTER ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerDxyAdminRoutes(fastify: FastifyInstance) {
  const prefix = '/api/fractal/v2.1/admin/dxy';
  
  /**
   * POST /api/fractal/v2.1/admin/dxy/ingest
   * 
   * Ingest DXY data from STOOQ
   */
  fastify.post(`${prefix}/ingest`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      console.log('[DXY] Starting STOOQ ingest...');
      const result = await ingestFromStooq();
      console.log(`[DXY] Ingest complete: ${result.written} written, ${result.updated} updated`);
      return result;
      
    } catch (error: any) {
      console.error('[DXY] Ingest failed:', error.message);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/fractal/v2.1/admin/dxy/ingest-csv
   * 
   * Ingest DXY data from local CSV file
   */
  fastify.post(`${prefix}/ingest-csv`, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { csvPath?: string };
    
    try {
      const csvPath = body.csvPath || '/app/data/dxy_stooq.csv';
      console.log(`[DXY] Starting CSV ingest from ${csvPath}...`);
      const result = await ingestFromLocalCsv(csvPath);
      console.log(`[DXY] CSV ingest complete: ${result.written} written`);
      return result;
      
    } catch (error: any) {
      console.error('[DXY] CSV ingest failed:', error.message);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/fractal/v2.1/admin/dxy/ingest/status
   * 
   * Get ingest status and data coverage
   */
  fastify.get(`${prefix}/ingest/status`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const meta = await getDxyMeta();
      const integrity = await checkDxyIntegrity();
      
      return {
        ok: integrity.ok,
        ...meta,
        integrity: {
          status: integrity.ok ? 'HEALTHY' : 'WARNING',
          warning: integrity.warning,
        },
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/fractal/v2.1/admin/dxy/integrity
   * 
   * Check data integrity
   */
  fastify.get(`${prefix}/integrity`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const integrity = await checkDxyIntegrity();
      return integrity;
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  console.log('[DXY] Admin routes registered');
}

export default registerDxyAdminRoutes;
