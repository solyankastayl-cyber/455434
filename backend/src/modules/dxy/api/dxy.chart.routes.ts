/**
 * DXY CHART ROUTES — OHLC Data Endpoints
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDxyChart } from '../services/dxy-chart.service.js';
import { getDxyMeta } from '../services/dxy-ingest.service.js';

// ═══════════════════════════════════════════════════════════════
// REGISTER ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerDxyChartRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/dxy/v2.1/chart?limit=450
   * 
   * Returns OHLC candles for DXY
   */
  fastify.get('/api/dxy/v2.1/chart', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { limit?: string };
    
    try {
      const limit = parseInt(query.limit || '450');
      const candles = await getDxyChart(limit);
      const meta = await getDxyMeta();
      
      return {
        ok: true,
        symbol: 'DXY',
        candles,
        meta,
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/dxy/chart (alias)
   * 
   * Direct DXY chart endpoint
   */
  fastify.get('/api/dxy/chart', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { limit?: string };
    
    try {
      const limit = parseInt(query.limit || '450');
      const candles = await getDxyChart(limit);
      const meta = await getDxyMeta();
      
      return {
        ok: true,
        symbol: 'DXY',
        candles,
        meta,
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  console.log('[DXY] Chart routes registered');
}

export default registerDxyChartRoutes;
