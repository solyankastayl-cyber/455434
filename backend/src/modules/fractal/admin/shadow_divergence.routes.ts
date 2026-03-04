/**
 * BLOCK 57 — Shadow Divergence Routes
 * 
 * GET /api/fractal/v2.1/admin/shadow-divergence - Full divergence report
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { shadowDivergenceService } from './shadow_divergence.service.js';

export async function shadowDivergenceRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/admin/shadow-divergence
   * 
   * Get full ACTIVE vs SHADOW divergence report
   * 
   * Query params:
   *   symbol: string (default: BTC, only BTC allowed)
   *   from: YYYY-MM-DD (optional, default: 90 days ago)
   *   to: YYYY-MM-DD (optional, default: today)
   */
  fastify.get('/api/fractal/v2.1/admin/shadow-divergence', async (
    request: FastifyRequest<{
      Querystring: {
        symbol?: string;
        from?: string;
        to?: string;
      }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    
    // BTC-only check
    if (symbol !== 'BTC') {
      return {
        error: true,
        message: 'Shadow divergence supports BTC only'
      };
    }
    
    try {
      const report = await shadowDivergenceService.getDivergenceReport(
        symbol,
        request.query.from,
        request.query.to
      );
      
      // Format metrics for display
      const formatMetrics = (m: any) => ({
        ...m,
        cagr: Number((m.cagr * 100).toFixed(2)),
        maxDD: Number((m.maxDD * 100).toFixed(2)),
        winRate: Number((m.winRate * 100).toFixed(1)),
        expectancy: Number((m.expectancy * 100).toFixed(3)),
        sharpe: Number(m.sharpe.toFixed(3)),
        profitFactor: Number(m.profitFactor.toFixed(2))
      });
      
      const formatDelta = (d: any) => ({
        cagr: `${d.cagr >= 0 ? '+' : ''}${(d.cagr * 100).toFixed(2)}%`,
        sharpe: `${d.sharpe >= 0 ? '+' : ''}${d.sharpe.toFixed(3)}`,
        maxDD: `${d.maxDD >= 0 ? '+' : ''}${(d.maxDD * 100).toFixed(2)}%`,
        winRate: `${d.winRate >= 0 ? '+' : ''}${(d.winRate * 100).toFixed(1)}%`,
        expectancy: `${d.expectancy >= 0 ? '+' : ''}${(d.expectancy * 100).toFixed(3)}%`,
        profitFactor: `${d.profitFactor >= 0 ? '+' : ''}${d.profitFactor.toFixed(2)}`
      });
      
      // Format summary
      const formattedSummary: any = {};
      for (const preset of Object.keys(report.summary)) {
        formattedSummary[preset] = {};
        for (const horizon of Object.keys(report.summary[preset as keyof typeof report.summary])) {
          const metrics = report.summary[preset as keyof typeof report.summary][horizon as keyof typeof report.summary.CONSERVATIVE];
          formattedSummary[preset][horizon] = {
            active: formatMetrics(metrics.active),
            shadow: formatMetrics(metrics.shadow),
            delta: formatDelta(metrics.delta)
          };
        }
      }
      
      return {
        ...report,
        summary: formattedSummary
      };
    } catch (err: any) {
      return {
        error: true,
        message: err.message || 'Failed to generate divergence report'
      };
    }
  });
}
