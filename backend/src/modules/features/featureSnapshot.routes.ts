/**
 * PHASE 2.1 — Feature Snapshot Routes
 * =====================================
 * 
 * API endpoints for feature snapshots.
 * 
 * ENDPOINTS:
 *   POST /api/v10/features/snapshot/:symbol     - Create snapshot
 *   GET  /api/v10/features/snapshot/latest/:symbol - Get latest
 *   GET  /api/v10/features/snapshot/history/:symbol - Get history
 *   GET  /api/v10/features/snapshot/stats/:symbol - Get stats
 *   GET  /api/v10/features/snapshot/:snapshotId   - Get by ID
 */

import { FastifyInstance } from 'fastify';
import {
  createSnapshot,
  getLatestSnapshot,
  getSnapshotById,
  getSnapshotHistory,
  getSnapshotStats,
  countSnapshots,
} from './featureSnapshot.service.js';

export async function featureRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // CREATE SNAPSHOT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /snapshot/:symbol - Create new snapshot
   */
  fastify.post<{
    Params: { symbol: string };
  }>('/snapshot/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    
    if (!symbol) {
      reply.code(400);
      return { ok: false, error: 'Symbol is required' };
    }
    
    try {
      const snapshot = await createSnapshot(symbol);
      return { ok: true, snapshot };
    } catch (error) {
      console.error('[Features] Failed to create snapshot:', error);
      reply.code(500);
      return { 
        ok: false, 
        error: error instanceof Error ? error.message : 'Failed to create snapshot' 
      };
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET LATEST
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /snapshot/latest/:symbol - Get latest snapshot
   */
  fastify.get<{
    Params: { symbol: string };
  }>('/snapshot/latest/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    
    const snapshot = await getLatestSnapshot(symbol);
    
    if (!snapshot) {
      return { 
        ok: true, 
        snapshot: null,
        message: 'No snapshots found for symbol'
      };
    }
    
    return { ok: true, snapshot };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET HISTORY
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /snapshot/history/:symbol - Get snapshot history
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: {
      limit?: string;
      from?: string;
      to?: string;
      minCompleteness?: string;
    };
  }>('/snapshot/history/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    const { limit, from, to, minCompleteness } = request.query;
    
    const snapshots = await getSnapshotHistory(symbol, {
      limit: limit ? parseInt(limit) : 100,
      from: from ? parseInt(from) : undefined,
      to: to ? parseInt(to) : undefined,
      minCompleteness: minCompleteness ? parseFloat(minCompleteness) : undefined,
    });
    
    return {
      ok: true,
      symbol: symbol.toUpperCase(),
      count: snapshots.length,
      snapshots,
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET STATS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /snapshot/stats/:symbol - Get snapshot statistics
   */
  fastify.get<{
    Params: { symbol: string };
  }>('/snapshot/stats/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    
    const stats = await getSnapshotStats(symbol);
    
    return {
      ok: true,
      symbol: symbol.toUpperCase(),
      ...stats,
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET BY ID
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /snapshot/:snapshotId - Get snapshot by ID
   */
  fastify.get<{
    Params: { snapshotId: string };
  }>('/snapshot/:snapshotId', async (request, reply) => {
    const { snapshotId } = request.params;
    
    // Skip if it's a reserved route keyword
    if (['latest', 'history', 'stats'].includes(snapshotId)) {
      reply.code(400);
      return { ok: false, error: 'Invalid snapshot ID' };
    }
    
    const snapshot = await getSnapshotById(snapshotId);
    
    if (!snapshot) {
      reply.code(404);
      return { ok: false, error: 'Snapshot not found' };
    }
    
    return { ok: true, snapshot };
  });
  
  console.log('[Phase 2.1] Feature Snapshot Routes registered');
}

export default featureRoutes;
