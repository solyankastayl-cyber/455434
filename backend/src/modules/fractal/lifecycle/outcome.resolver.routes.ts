/**
 * BLOCK 56.3 — Outcome Resolver Routes
 * 
 * POST /api/fractal/v2.1/admin/snapshot/resolve - Resolve snapshots for horizon
 * GET /api/fractal/v2.1/admin/snapshot/calibration - Get calibration bins
 * GET /api/fractal/v2.1/admin/snapshot/forward-stats - Get forward performance stats
 * GET /api/fractal/v2.1/admin/snapshot/active-vs-shadow - Compare Active vs Shadow
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { outcomeResolverService, type HorizonDays } from './outcome.resolver.service.js';

export async function outcomeResolverRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/fractal/v2.1/admin/snapshot/resolve
   * 
   * Resolve snapshots for a given horizon (7, 14, or 30 days)
   * 
   * Body:
   *   symbol: string (default: BTC)
   *   horizon: number (7, 14, or 30)
   */
  fastify.post('/api/fractal/v2.1/admin/snapshot/resolve', async (
    request: FastifyRequest<{
      Body: { symbol?: string; horizon: number }
    }>
  ) => {
    const symbol = request.body?.symbol ?? 'BTC';
    const horizon = request.body?.horizon as HorizonDays;
    
    if (![7, 14, 30].includes(horizon)) {
      return {
        error: true,
        message: 'horizon must be 7, 14, or 30'
      };
    }
    
    try {
      const result = await outcomeResolverService.resolveSnapshots(symbol, horizon);
      return result;
    } catch (err: any) {
      return {
        error: true,
        message: err.message || 'Failed to resolve snapshots'
      };
    }
  });
  
  /**
   * GET /api/fractal/v2.1/admin/snapshot/calibration
   * 
   * Get calibration bins from resolved snapshots
   * 
   * Query params:
   *   symbol: string (default: BTC)
   *   horizon: number (7, 14, or 30)
   */
  fastify.get('/api/fractal/v2.1/admin/snapshot/calibration', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string; horizon: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const horizon = parseInt(request.query.horizon || '7', 10) as HorizonDays;
    
    if (![7, 14, 30].includes(horizon)) {
      return {
        error: true,
        message: 'horizon must be 7, 14, or 30'
      };
    }
    
    const bins = await outcomeResolverService.getCalibrationBins(symbol, horizon);
    
    // Calculate ECE (Expected Calibration Error)
    let ece = 0;
    let totalSamples = 0;
    
    for (const bin of bins) {
      if (bin.total > 0) {
        const binMidpoint = (bin.bin + 0.5) / 10; // 0.05, 0.15, ..., 0.95
        ece += bin.total * Math.abs(binMidpoint - bin.winRate);
        totalSamples += bin.total;
      }
    }
    
    ece = totalSamples > 0 ? ece / totalSamples : 0;
    
    return {
      symbol,
      horizon,
      bins,
      ece: Number(ece.toFixed(4)),
      totalSamples
    };
  });
  
  /**
   * GET /api/fractal/v2.1/admin/snapshot/forward-stats
   * 
   * Get forward performance statistics
   * 
   * Query params:
   *   symbol: string (default: BTC)
   *   horizon: number (7, 14, or 30)
   */
  fastify.get('/api/fractal/v2.1/admin/snapshot/forward-stats', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string; horizon: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const horizon = parseInt(request.query.horizon || '7', 10) as HorizonDays;
    
    if (![7, 14, 30].includes(horizon)) {
      return {
        error: true,
        message: 'horizon must be 7, 14, or 30'
      };
    }
    
    const stats = await outcomeResolverService.getForwardStats(symbol, horizon);
    
    return {
      symbol,
      horizon,
      ...stats,
      avgRealizedReturn: Number((stats.avgRealizedReturn * 100).toFixed(2)) + '%',
      avgExpectedReturn: Number((stats.avgExpectedReturn * 100).toFixed(2)) + '%',
      hitRateFormatted: Number((stats.hitRate * 100).toFixed(1)) + '%'
    };
  });
  
  /**
   * GET /api/fractal/v2.1/admin/snapshot/active-vs-shadow
   * 
   * Compare Active vs Shadow performance
   * 
   * Query params:
   *   symbol: string (default: BTC)
   *   horizon: number (7, 14, or 30)
   */
  fastify.get('/api/fractal/v2.1/admin/snapshot/active-vs-shadow', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string; horizon: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const horizon = parseInt(request.query.horizon || '7', 10) as HorizonDays;
    
    if (![7, 14, 30].includes(horizon)) {
      return {
        error: true,
        message: 'horizon must be 7, 14, or 30'
      };
    }
    
    const comparison = await outcomeResolverService.getActiveVsShadow(symbol, horizon);
    
    return {
      symbol,
      horizon,
      active: {
        ...comparison.active,
        hitRate: comparison.active.total > 0 
          ? Number((comparison.active.hits / comparison.active.total * 100).toFixed(1)) + '%' 
          : 'N/A',
        avgReturn: Number((comparison.active.avgReturn * 100).toFixed(2)) + '%'
      },
      shadow: {
        ...comparison.shadow,
        hitRate: comparison.shadow.total > 0 
          ? Number((comparison.shadow.hits / comparison.shadow.total * 100).toFixed(1)) + '%' 
          : 'N/A',
        avgReturn: Number((comparison.shadow.avgReturn * 100).toFixed(2)) + '%'
      },
      delta: {
        hitRate: Number((comparison.deltaHitRate * 100).toFixed(1)) + '%',
        return: Number((comparison.deltaReturn * 100).toFixed(2)) + '%',
        shadowWinning: comparison.deltaHitRate > 0 || comparison.deltaReturn > 0
      }
    };
  });
}
