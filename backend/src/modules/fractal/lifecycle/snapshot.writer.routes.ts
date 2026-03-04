/**
 * BLOCK 56.2 — Snapshot Writer Routes
 * 
 * POST /api/fractal/v2.1/admin/snapshot/write-btc - Write daily snapshot
 * GET /api/fractal/v2.1/admin/snapshot/latest - Get latest snapshot
 * GET /api/fractal/v2.1/admin/snapshot/range - Get snapshots in date range
 * GET /api/fractal/v2.1/admin/snapshot/count - Count snapshots
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { snapshotWriterService } from './snapshot.writer.service.js';

export async function snapshotWriterRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/fractal/v2.1/admin/snapshot/write-btc
   * 
   * Write daily snapshot for BTC (all 3 presets)
   * Idempotent: skips if snapshot already exists for the date
   * 
   * Query params:
   *   asofDate?: string (ISO date, default: latest candle date)
   */
  fastify.post('/api/fractal/v2.1/admin/snapshot/write-btc', async (
    request: FastifyRequest<{
      Querystring: { asofDate?: string }
    }>
  ) => {
    const asofDate = request.query.asofDate;
    
    try {
      const result = await snapshotWriterService.writeBtcSnapshots(asofDate);
      return result;
    } catch (err: any) {
      return {
        error: true,
        message: err.message || 'Failed to write snapshot'
      };
    }
  });
  
  /**
   * GET /api/fractal/v2.1/admin/snapshot/latest
   * 
   * Get latest snapshot for symbol
   * 
   * Query params:
   *   symbol: string (default: BTC)
   */
  fastify.get('/api/fractal/v2.1/admin/snapshot/latest', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    
    const snapshot = await snapshotWriterService.getLatestSnapshot(symbol);
    
    if (!snapshot) {
      return {
        found: false,
        message: `No snapshots found for ${symbol}`
      };
    }
    
    return {
      found: true,
      snapshot: {
        asofDate: snapshot.asOf.toISOString().slice(0, 10),
        symbol: snapshot.symbol,
        preset: snapshot.strategy.preset,
        version: snapshot.version,
        action: snapshot.action,
        confidence: snapshot.confidence,
        reliability: snapshot.reliability,
        entropy: snapshot.entropy,
        expectedReturn: snapshot.expectedReturn,
        tailRiskP95dd: snapshot.risk.mcP95_DD,
        dominantHorizon: snapshot.dominantHorizon,
        createdAt: snapshot.createdAt
      }
    };
  });
  
  /**
   * GET /api/fractal/v2.1/admin/snapshot/range
   * 
   * Get snapshots in date range
   * 
   * Query params:
   *   symbol: string (default: BTC)
   *   from: string (ISO date, required)
   *   to: string (ISO date, required)
   */
  fastify.get('/api/fractal/v2.1/admin/snapshot/range', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string; from: string; to: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const from = request.query.from;
    const to = request.query.to;
    
    if (!from || !to) {
      return {
        error: true,
        message: 'from and to dates are required'
      };
    }
    
    const snapshots = await snapshotWriterService.getSnapshotsRange(symbol, from, to);
    
    return {
      symbol,
      from,
      to,
      count: snapshots.length,
      snapshots: snapshots.map(s => ({
        asofDate: s.asOf.toISOString().slice(0, 10),
        preset: s.strategy.preset,
        action: s.action,
        confidence: s.confidence,
        reliability: s.reliability,
        entropy: s.entropy,
        expectedReturn: s.expectedReturn,
        positionSize: s.strategy.positionSize,
        mode: s.strategy.mode
      }))
    };
  });
  
  /**
   * GET /api/fractal/v2.1/admin/snapshot/count
   * 
   * Count snapshots for symbol
   * 
   * Query params:
   *   symbol: string (default: BTC)
   */
  fastify.get('/api/fractal/v2.1/admin/snapshot/count', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    
    const counts = await snapshotWriterService.countSnapshots(symbol);
    
    return {
      symbol,
      active: counts.active,
      shadow: counts.shadow,
      total: counts.active + counts.shadow
    };
  });
}
