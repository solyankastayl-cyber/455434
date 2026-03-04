/**
 * PHASE 2.2 — Dataset Routes
 * ===========================
 * 
 * API endpoints for ML dataset operations.
 * 
 * ENDPOINTS:
 *   POST /api/v10/dataset/build/:symbol     - Build dataset for symbol
 *   POST /api/v10/dataset/build-all         - Build dataset for all symbols
 *   GET  /api/v10/dataset/stats/:symbol     - Get dataset stats
 *   GET  /api/v10/dataset/ready             - Get dataset ready status
 *   GET  /api/v10/dataset/sample/:symbol    - Get sample rows
 *   GET  /api/v10/dataset/export/:symbol    - Export for ML training
 */

import { FastifyInstance } from 'fastify';
import {
  buildDatasetForSymbol,
  buildFullDataset,
  backfillHistoricalDataset,
  getDatasetStats,
  getDatasetReadyStatus,
  getSampleRows,
  getDatasetForTraining,
} from './dataset.service.js';

export async function datasetRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // BUILD DATASET
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /build/:symbol - Build dataset for a symbol
   */
  fastify.post<{
    Params: { symbol: string };
    Body: { horizon?: number };
  }>('/build/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    const { horizon = 6 } = request.body || {};
    
    try {
      const result = await buildDatasetForSymbol(symbol, horizon);
      return result;
    } catch (error) {
      console.error('[Dataset] Build failed:', error);
      reply.code(500);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Build failed',
      };
    }
  });
  
  /**
   * POST /backfill/:symbol - Backfill historical dataset from truth records
   */
  fastify.post<{
    Params: { symbol: string };
    Body: { horizon?: number };
  }>('/backfill/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    const { horizon = 6 } = request.body || {};
    
    try {
      const result = await backfillHistoricalDataset(symbol, horizon);
      return result;
    } catch (error) {
      console.error('[Dataset] Backfill failed:', error);
      reply.code(500);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Backfill failed',
      };
    }
  });
  
  /**
   * POST /build-all - Build dataset for all symbols
   */
  fastify.post<{
    Body: { horizon?: number };
  }>('/build-all', async (request, reply) => {
    const { horizon = 6 } = request.body || {};
    
    try {
      const result = await buildFullDataset(horizon);
      return result;
    } catch (error) {
      console.error('[Dataset] Build-all failed:', error);
      reply.code(500);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Build failed',
      };
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // QUERY DATASET
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /stats/:symbol - Get dataset stats
   */
  fastify.get<{
    Params: { symbol: string };
  }>('/stats/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    return getDatasetStats(symbol);
  });
  
  /**
   * GET /ready - Get dataset ready status for ML
   */
  fastify.get('/ready', async (request, reply) => {
    return getDatasetReadyStatus();
  });
  
  /**
   * GET /sample/:symbol - Get sample rows
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: { count?: string };
  }>('/sample/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    const count = request.query.count ? parseInt(request.query.count) : 10;
    
    const rows = await getSampleRows(symbol, count);
    return {
      ok: true,
      symbol: symbol.toUpperCase(),
      count: rows.length,
      rows,
    };
  });
  
  /**
   * GET /export/:symbol - Export dataset for training
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: { 
      minQuality?: string; 
      limit?: string;
      offset?: string;
    };
  }>('/export/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    const { 
      minQuality = '0.6', 
      limit = '1000',
      offset = '0',
    } = request.query;
    
    const rows = await getDatasetForTraining({
      symbol,
      minQuality: parseFloat(minQuality),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
    
    return {
      ok: true,
      symbol: symbol.toUpperCase(),
      count: rows.length,
      rows,
    };
  });
  
  console.log('[Phase 2.2] Dataset Routes registered');
}

export default datasetRoutes;
