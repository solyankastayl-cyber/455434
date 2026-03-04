/**
 * BLOCK 56 — Strategy Backtest Routes
 * 
 * GET /api/fractal/v2.1/strategy/backtest-grid
 * 
 * Runs historical backtest for 3 presets and returns:
 * - Performance metrics (CAGR, Sharpe, MaxDD, etc.)
 * - Equity curves
 * - Trade statistics
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { strategyBacktestService, BacktestGridResult } from './strategy.backtest.service.js';

export async function strategyBacktestRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/strategy/backtest-grid
   * 
   * Query params:
   *   symbol: string (default: BTC)
   *   from: string (ISO date, default: 2019-01-01)
   *   to: string (ISO date, default: now)
   *   feesBps: number (default: 24)
   *   slippageBps: number (default: 24)
   */
  fastify.get('/api/fractal/v2.1/strategy/backtest-grid', async (
    request: FastifyRequest<{
      Querystring: {
        symbol?: string;
        from?: string;
        to?: string;
        feesBps?: string;
        slippageBps?: string;
      }
    }>
  ): Promise<BacktestGridResult> => {
    const symbol = request.query.symbol ?? 'BTC';
    const fromStr = request.query.from ?? '2019-01-01';
    const toStr = request.query.to ?? new Date().toISOString().slice(0, 10);
    const feesBps = parseInt(request.query.feesBps ?? '24', 10);
    const slippageBps = parseInt(request.query.slippageBps ?? '24', 10);
    
    const from = new Date(fromStr);
    const to = new Date(toStr);
    
    // Validate dates
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new Error('Invalid date format. Use YYYY-MM-DD');
    }
    
    if (from >= to) {
      throw new Error('from date must be before to date');
    }
    
    return strategyBacktestService.runBacktestGrid(
      symbol,
      from,
      to,
      feesBps,
      slippageBps
    );
  });
  
  /**
   * GET /api/fractal/v2.1/strategy/backtest-console
   * 
   * Returns formatted console output for quick analysis
   */
  fastify.get('/api/fractal/v2.1/strategy/backtest-console', async (
    request: FastifyRequest<{
      Querystring: {
        symbol?: string;
        from?: string;
        to?: string;
      }
    }>
  ): Promise<{ console: string }> => {
    const symbol = request.query.symbol ?? 'BTC';
    const fromStr = request.query.from ?? '2019-01-01';
    const toStr = request.query.to ?? new Date().toISOString().slice(0, 10);
    
    const from = new Date(fromStr);
    const to = new Date(toStr);
    
    const result = await strategyBacktestService.runBacktestGrid(symbol, from, to);
    
    // Format as console table
    const lines: string[] = [];
    
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push(`  STRATEGY BACKTEST GRID — ${symbol}`);
    lines.push(`  Period: ${result.period.from} → ${result.period.to}`);
    lines.push(`  Signal Source: ${result.signalSource}`);
    lines.push(`  Costs: ${result.assumptions.feesBps}bps fees + ${result.assumptions.slippageBps}bps slippage`);
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('');
    
    // Header
    lines.push('┌──────────────┬────────┬────────┬────────┬────────┬──────────┬─────────┬───────────┐');
    lines.push('│ Preset       │ CAGR   │ Sharpe │ MaxDD  │ Trades │ AvgPos   │ WinRate │ TimeMkt   │');
    lines.push('├──────────────┼────────┼────────┼────────┼────────┼──────────┼─────────┼───────────┤');
    
    for (const r of result.results) {
      const preset = r.preset.padEnd(12);
      const cagr = `${(r.cagr * 100).toFixed(1)}%`.padStart(6);
      const sharpe = r.sharpe.toFixed(2).padStart(6);
      const maxDD = `${(r.maxDD * 100).toFixed(1)}%`.padStart(6);
      const trades = r.trades.toString().padStart(6);
      const avgPos = `${(r.avgPosition * 100).toFixed(0)}%`.padStart(8);
      const winRate = `${(r.winRate * 100).toFixed(0)}%`.padStart(7);
      const timeMkt = `${(r.timeInMarket * 100).toFixed(0)}%`.padStart(9);
      
      lines.push(`│ ${preset} │ ${cagr} │ ${sharpe} │ ${maxDD} │ ${trades} │ ${avgPos} │ ${winRate} │ ${timeMkt} │`);
    }
    
    lines.push('└──────────────┴────────┴────────┴────────┴────────┴──────────┴─────────┴───────────┘');
    lines.push('');
    
    // Analysis
    const sorted = [...result.results].sort((a, b) => b.sharpe - a.sharpe);
    lines.push(`📊 Best Sharpe: ${sorted[0].preset} (${sorted[0].sharpe.toFixed(2)})`);
    
    const sortedCagr = [...result.results].sort((a, b) => b.cagr - a.cagr);
    lines.push(`📈 Best CAGR: ${sortedCagr[0].preset} (${(sortedCagr[0].cagr * 100).toFixed(1)}%)`);
    
    const sortedDD = [...result.results].sort((a, b) => a.maxDD - b.maxDD);
    lines.push(`🛡️ Lowest MaxDD: ${sortedDD[0].preset} (${(sortedDD[0].maxDD * 100).toFixed(1)}%)`);
    
    lines.push('');
    
    return { console: lines.join('\n') };
  });
}
