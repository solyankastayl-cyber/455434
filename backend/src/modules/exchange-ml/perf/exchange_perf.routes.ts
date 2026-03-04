/**
 * Exchange Performance API Routes
 * ================================
 * 
 * Endpoints for the Performance Dashboard.
 * 
 * Main endpoint:
 * GET /api/admin/exchange-ml/perf/window
 *   - Returns capital-centric metrics for a given time window
 *   - Used by admin UI to monitor trading system health
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ExchangeTradePerfService, getExchangeTradePerfService } from './exchange_trade_perf.service.js';
import { TradeRecord, Horizon, PerfWindow } from './exchange_trade_types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface PerfWindowQuery {
  days?: string;
  horizon?: string;
}

interface PerfRoutesDeps {
  // Function to get trade records from simulation storage
  getSimTrades: (args: { days: number }) => Promise<TradeRecord[]>;
}

// ═══════════════════════════════════════════════════════════════
// ROUTES REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerExchangePerfRoutes(
  app: FastifyInstance,
  deps: PerfRoutesDeps
): Promise<void> {
  const svc = getExchangeTradePerfService();

  /**
   * GET /api/admin/exchange-ml/perf/window
   * 
   * Query parameters:
   * - days: Number of days to analyze (default: 90)
   * - horizon: 1D | 7D | 30D (default: 30D)
   * 
   * Returns:
   * - Performance window metrics
   */
  app.get('/api/admin/exchange-ml/perf/window', async (
    req: FastifyRequest<{ Querystring: PerfWindowQuery }>,
    reply: FastifyReply
  ) => {
    try {
      const q = req.query;
      const days = Number(q.days || 90);
      const horizon = (q.horizon?.toUpperCase() || '30D') as Horizon;
      
      // Validate horizon
      if (!['1D', '7D', '30D'].includes(horizon)) {
        return reply.status(400).send({
          ok: false,
          error: 'Invalid horizon. Must be 1D, 7D, or 30D',
        });
      }
      
      // Get trade records
      const trades = await deps.getSimTrades({ days });
      
      // Compute performance window
      const window = svc.compute(trades, horizon, days);

      return {
        ok: true,
        window,
        meta: {
          requestedDays: days,
          requestedHorizon: horizon,
          tradesFound: trades.length,
        },
      };
    } catch (error: any) {
      console.error('[ExchangePerfRoutes] Error computing window:', error);
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/admin/exchange-ml/perf/rolling
   * 
   * Returns performance metrics for multiple time windows.
   */
  app.get('/api/admin/exchange-ml/perf/rolling', async (
    req: FastifyRequest<{ Querystring: PerfWindowQuery }>,
    reply: FastifyReply
  ) => {
    try {
      const q = req.query;
      const days = Number(q.days || 365);
      const horizon = (q.horizon?.toUpperCase() || '30D') as Horizon;
      
      // Get trade records
      const trades = await deps.getSimTrades({ days });
      
      // Compute rolling windows
      const windows = svc.computeRolling(trades, horizon, [7, 14, 30, 60, 90, 180, 365]);

      return {
        ok: true,
        windows,
        horizon,
        meta: {
          tradesFound: trades.length,
        },
      };
    } catch (error: any) {
      console.error('[ExchangePerfRoutes] Error computing rolling:', error);
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/admin/exchange-ml/perf/compare
   * 
   * Compare active vs shadow model performance.
   * (For future use when shadow trades are tracked separately)
   */
  app.get('/api/admin/exchange-ml/perf/compare', async (
    req: FastifyRequest<{ Querystring: PerfWindowQuery }>,
    reply: FastifyReply
  ) => {
    try {
      const q = req.query;
      const days = Number(q.days || 90);
      const horizon = (q.horizon?.toUpperCase() || '30D') as Horizon;
      
      // Get trade records (for now, same records for both)
      const trades = await deps.getSimTrades({ days });
      
      // Compute comparison (placeholder - in production would have separate shadow trades)
      const comparison = svc.compare(trades, trades, horizon, days);

      return {
        ok: true,
        comparison,
        meta: {
          note: 'Shadow comparison requires separate shadow trade tracking',
        },
      };
    } catch (error: any) {
      console.error('[ExchangePerfRoutes] Error computing compare:', error);
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/admin/exchange-ml/perf/summary
   * 
   * Returns a summary of all horizons for quick dashboard display.
   */
  app.get('/api/admin/exchange-ml/perf/summary', async (
    req: FastifyRequest<{ Querystring: { days?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const days = Number(req.query.days || 90);
      
      // Get trade records
      const trades = await deps.getSimTrades({ days });
      
      // Compute for all horizons
      const horizons: Horizon[] = ['1D', '7D', '30D'];
      const summary: Record<Horizon, PerfWindow> = {} as any;
      
      for (const h of horizons) {
        summary[h] = svc.compute(trades, h, days);
      }

      // Calculate aggregate stats
      const totalTrades = trades.length;
      const totalWins = trades.filter(t => t.win).length;
      const overallWinRate = totalTrades > 0 ? totalWins / totalTrades : 0;
      const totalPnL = trades.reduce((a, b) => a + b.pnlPct, 0);

      return {
        ok: true,
        days,
        summary,
        aggregate: {
          totalTrades,
          totalWins,
          totalLosses: totalTrades - totalWins,
          overallWinRate,
          totalPnL,
          avgPnL: totalTrades > 0 ? totalPnL / totalTrades : 0,
        },
      };
    } catch (error: any) {
      console.error('[ExchangePerfRoutes] Error computing summary:', error);
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  console.log('[ExchangePerfRoutes] Routes registered');
}
