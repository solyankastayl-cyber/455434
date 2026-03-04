/**
 * BLOCK 56.4 — Forward Equity Routes
 * 
 * GET /api/fractal/v2.1/admin/forward-equity - Build equity curve
 * GET /api/fractal/v2.1/admin/forward-equity/grid - Grid of all metrics
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { 
  forwardEquityService, 
  type Role, 
  type Preset, 
  type HorizonDays 
} from './forward.equity.service.js';

export async function forwardEquityRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/admin/forward-equity
   * 
   * Build equity curve from resolved snapshots
   * 
   * Query params:
   *   symbol: string (default: BTC)
   *   role: ACTIVE | SHADOW (default: ACTIVE)
   *   preset: conservative | balanced | aggressive (default: balanced)
   *   horizon: 7 | 14 | 30 (default: 7)
   *   from: YYYY-MM-DD (optional)
   *   to: YYYY-MM-DD (optional)
   */
  fastify.get('/api/fractal/v2.1/admin/forward-equity', async (
    request: FastifyRequest<{
      Querystring: {
        symbol?: string;
        role?: string;
        preset?: string;
        horizon?: string;
        from?: string;
        to?: string;
      }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const roleInput = (request.query.role ?? 'ACTIVE').toUpperCase();
    const presetInput = (request.query.preset ?? 'BALANCED').toUpperCase();
    const horizonInput = parseInt(request.query.horizon ?? '7', 10);
    
    // Validate role
    if (!['ACTIVE', 'SHADOW'].includes(roleInput)) {
      return { error: true, message: 'role must be ACTIVE or SHADOW' };
    }
    const role = roleInput as Role;
    
    // Validate preset
    if (!['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'].includes(presetInput)) {
      return { error: true, message: 'preset must be conservative, balanced, or aggressive' };
    }
    const preset = presetInput as Preset;
    
    // Validate horizon
    if (![7, 14, 30].includes(horizonInput)) {
      return { error: true, message: 'horizon must be 7, 14, or 30' };
    }
    const horizon = horizonInput as HorizonDays;
    
    try {
      const result = await forwardEquityService.build({
        symbol,
        role,
        preset,
        horizon,
        from: request.query.from,
        to: request.query.to
      });
      
      // Format metrics for display
      return {
        ...result,
        metrics: {
          cagr: Number((result.metrics.cagr * 100).toFixed(2)),
          cagrFormatted: `${(result.metrics.cagr * 100).toFixed(2)}%`,
          sharpe: Number(result.metrics.sharpe.toFixed(3)),
          maxDD: Number((result.metrics.maxDD * 100).toFixed(2)),
          maxDDFormatted: `${(result.metrics.maxDD * 100).toFixed(2)}%`,
          winRate: Number((result.metrics.winRate * 100).toFixed(1)),
          winRateFormatted: `${(result.metrics.winRate * 100).toFixed(1)}%`,
          expectancy: Number((result.metrics.expectancy * 100).toFixed(3)),
          expectancyFormatted: `${(result.metrics.expectancy * 100).toFixed(3)}%`,
          profitFactor: Number(result.metrics.profitFactor.toFixed(2)),
          volatility: Number((result.metrics.volatility * 100).toFixed(2)),
          volatilityFormatted: `${(result.metrics.volatility * 100).toFixed(2)}%`,
          trades: result.metrics.trades
        }
      };
    } catch (err: any) {
      return {
        error: true,
        message: err.message || 'Failed to build forward equity'
      };
    }
  });
  
  /**
   * GET /api/fractal/v2.1/admin/forward-equity/grid
   * 
   * Get grid of all preset/horizon/role combinations
   * 
   * Query params:
   *   symbol: string (default: BTC)
   */
  fastify.get('/api/fractal/v2.1/admin/forward-equity/grid', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    
    try {
      const result = await forwardEquityService.grid(symbol);
      
      // Format metrics for display
      const formatMetrics = (m: any) => ({
        ...m,
        cagrPct: `${(m.cagr * 100).toFixed(2)}%`,
        maxDDPct: `${(m.maxDD * 100).toFixed(2)}%`
      });
      
      // Format all metrics in grid
      for (const role of ['ACTIVE', 'SHADOW'] as const) {
        for (const horizon of Object.keys(result.roles[role])) {
          for (const preset of Object.keys(result.roles[role][horizon])) {
            result.roles[role][horizon][preset] = formatMetrics(
              result.roles[role][horizon][preset]
            );
          }
        }
      }
      
      return result;
    } catch (err: any) {
      return {
        error: true,
        message: err.message || 'Failed to build grid'
      };
    }
  });
}
