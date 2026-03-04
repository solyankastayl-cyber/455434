/**
 * BLOCK 75.1 & 75.2 — Memory Routes
 * 
 * POST /api/fractal/v2.1/admin/memory/write-snapshots - Write daily snapshots
 * POST /api/fractal/v2.1/admin/memory/resolve-outcomes - Resolve matured outcomes
 * GET  /api/fractal/v2.1/admin/memory/snapshots/latest - Get latest snapshot
 * GET  /api/fractal/v2.1/admin/memory/snapshots/range - Get snapshots in date range
 * GET  /api/fractal/v2.1/admin/memory/snapshots/count - Count snapshots
 * GET  /api/fractal/v2.1/admin/memory/forward-stats - Get forward truth stats
 * GET  /api/fractal/v2.1/admin/memory/calibration - Get calibration stats
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { memorySnapshotWriterService } from './snapshot/snapshot-writer.service.js';
import { outcomeResolverService } from './outcome/outcome-resolver.service.js';
import type { FocusHorizon, SnapshotRole, SnapshotPreset } from './snapshot/prediction-snapshot.model.js';

export async function memoryRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // BLOCK 75.1: SNAPSHOT ENDPOINTS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/fractal/v2.1/admin/memory/write-snapshots
   * 
   * Write daily snapshots for all 6 horizons × 3 presets × 2 roles
   * Idempotent: skips existing
   */
  fastify.post('/api/fractal/v2.1/admin/memory/write-snapshots', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string; asofDate?: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const asofDate = request.query.asofDate;
    
    if (symbol !== 'BTC') {
      return { error: true, message: 'BTC_ONLY' };
    }
    
    try {
      const result = await memorySnapshotWriterService.writeAllSnapshots(asofDate);
      return result;
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  });
  
  /**
   * GET /api/fractal/v2.1/admin/memory/snapshots/latest
   */
  fastify.get('/api/fractal/v2.1/admin/memory/snapshots/latest', async (
    request: FastifyRequest<{
      Querystring: { 
        symbol?: string;
        focus?: string;
        preset?: string;
        role?: string;
      }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const focus = request.query.focus as FocusHorizon | undefined;
    const preset = request.query.preset as SnapshotPreset | undefined;
    const role = request.query.role as SnapshotRole | undefined;
    
    const snapshot = await memorySnapshotWriterService.getLatestSnapshot(symbol, focus, preset, role);
    
    if (!snapshot) {
      return { found: false, message: `No snapshots found` };
    }
    
    return {
      found: true,
      snapshot: {
        symbol: snapshot.symbol,
        asofDate: snapshot.asofDate,
        focus: snapshot.focus,
        role: snapshot.role,
        preset: snapshot.preset,
        tier: snapshot.tier,
        maturityDate: snapshot.maturityDate,
        kernelDigest: snapshot.kernelDigest,
        tierWeights: snapshot.tierWeights,
        distribution: snapshot.distribution,
        createdAt: snapshot.createdAt
      }
    };
  });
  
  /**
   * GET /api/fractal/v2.1/admin/memory/snapshots/range
   */
  fastify.get('/api/fractal/v2.1/admin/memory/snapshots/range', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string; from: string; to: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const from = request.query.from;
    const to = request.query.to;
    
    if (!from || !to) {
      return { error: true, message: 'from and to are required' };
    }
    
    const snapshots = await memorySnapshotWriterService.getSnapshotsRange(symbol, from, to);
    
    return {
      symbol,
      from,
      to,
      count: snapshots.length,
      snapshots: snapshots.map(s => ({
        asofDate: s.asofDate,
        focus: s.focus,
        role: s.role,
        preset: s.preset,
        direction: s.kernelDigest.direction,
        finalSize: s.kernelDigest.finalSize,
        consensusIndex: s.kernelDigest.consensusIndex,
        structuralLock: s.kernelDigest.structuralLock
      }))
    };
  });
  
  /**
   * GET /api/fractal/v2.1/admin/memory/snapshots/count
   */
  fastify.get('/api/fractal/v2.1/admin/memory/snapshots/count', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const counts = await memorySnapshotWriterService.countSnapshots(symbol);
    return { symbol, ...counts };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // BLOCK 75.2: OUTCOME ENDPOINTS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/fractal/v2.1/admin/memory/resolve-outcomes
   * 
   * Resolve matured snapshots with forward truth
   * Idempotent: skips already resolved
   */
  fastify.post('/api/fractal/v2.1/admin/memory/resolve-outcomes', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string; max?: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const max = parseInt(request.query.max || '500', 10);
    
    if (symbol !== 'BTC') {
      return { error: true, message: 'BTC_ONLY' };
    }
    
    try {
      const result = await outcomeResolverService.resolveMaturedOutcomes(symbol, max);
      return result;
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  });
  
  /**
   * GET /api/fractal/v2.1/admin/memory/forward-stats
   * 
   * Get forward truth statistics
   */
  fastify.get('/api/fractal/v2.1/admin/memory/forward-stats', async (
    request: FastifyRequest<{
      Querystring: { 
        symbol?: string;
        from?: string;
        to?: string;
        focus?: string;
      }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const from = request.query.from;
    const to = request.query.to;
    const focus = request.query.focus as FocusHorizon | undefined;
    
    try {
      const stats = await outcomeResolverService.getForwardStats(symbol, from, to, focus);
      
      return {
        symbol,
        from: from || 'all',
        to: to || 'all',
        focus: focus || 'all',
        totalResolved: stats.totalResolved,
        hitRate: Number((stats.hitRate * 100).toFixed(1)) + '%',
        avgRealizedReturnPct: Number(stats.avgRealizedReturnPct.toFixed(2)) + '%',
        byPreset: Object.fromEntries(
          Object.entries(stats.byPreset).map(([k, v]) => [
            k,
            { hitRate: Number((v.hitRate * 100).toFixed(1)) + '%', avgReturn: Number(v.avgReturn.toFixed(2)) + '%', count: v.count }
          ])
        ),
        byRole: Object.fromEntries(
          Object.entries(stats.byRole).map(([k, v]) => [
            k,
            { hitRate: Number((v.hitRate * 100).toFixed(1)) + '%', avgReturn: Number(v.avgReturn.toFixed(2)) + '%', count: v.count }
          ])
        ),
        byVolRegime: stats.byVolRegime,
        byPhaseType: stats.byPhaseType
      };
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  });
  
  /**
   * GET /api/fractal/v2.1/admin/memory/calibration
   */
  fastify.get('/api/fractal/v2.1/admin/memory/calibration', async (
    request: FastifyRequest<{
      Querystring: { 
        symbol?: string;
        focus?: string;
        preset?: string;
      }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const focus = (request.query.focus || '30d') as FocusHorizon;
    const preset = (request.query.preset || 'balanced') as SnapshotPreset;
    
    try {
      const stats = await outcomeResolverService.getCalibrationStats(symbol, focus, preset);
      
      return {
        symbol,
        focus,
        preset,
        hitRate: Number((stats.hitRate * 100).toFixed(1)) + '%',
        bandHitRate: Number((stats.bandHitRate * 100).toFixed(1)) + '%',
        avgError: Number(stats.avgError.toFixed(2)) + '%',
        count: stats.count
      };
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  });
  
  fastify.log.info('[Fractal] BLOCK 75.1 & 75.2: Memory routes registered');
}
