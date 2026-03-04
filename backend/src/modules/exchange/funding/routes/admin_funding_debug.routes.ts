/**
 * BLOCK 2.8 — Admin Funding Debug Routes
 * =======================================
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { fundingAggregatorService } from '../services/funding_aggregator.service.js';

export async function registerAdminFundingDebugRoutes(app: FastifyInstance) {
  // Health check for funding system
  app.get('/api/admin/exchange/funding/health', async () => {
    // Get some sample data to check coverage
    const testSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    const coverage: Record<string, boolean> = {};

    for (const symbol of testSymbols) {
      const state = await fundingAggregatorService.computeFundingState(symbol);
      coverage[symbol] = state !== null;
    }

    const hasCoverage = Object.values(coverage).some(v => v);

    return {
      ok: true,
      coverage,
      hasCoverage,
      hint: hasCoverage ? 'Funding data available' : 'No funding data - run collector job',
    };
  });

  // Get funding state for specific symbol
  app.get('/api/admin/exchange/funding/:symbol', async (req: FastifyRequest<{
    Params: { symbol: string };
  }>) => {
    const { symbol } = req.params;
    const state = await fundingAggregatorService.computeFundingState(symbol);

    if (!state) {
      return { ok: false, symbol, error: 'No funding data' };
    }

    const interpretation = fundingAggregatorService.interpretFundingState(state);

    return {
      ok: true,
      symbol,
      state,
      interpretation,
    };
  });

  // Get funding features for feature vector
  app.get('/api/admin/exchange/funding/:symbol/features', async (req: FastifyRequest<{
    Params: { symbol: string };
  }>) => {
    const { symbol } = req.params;
    const features = await fundingAggregatorService.getFundingFeatures(symbol);

    return {
      ok: true,
      symbol,
      features,
    };
  });

  // Batch funding states
  app.post('/api/admin/exchange/funding/batch', async (req: FastifyRequest<{
    Body: { symbols: string[] };
  }>) => {
    const symbols = req.body?.symbols ?? [];
    const states = await fundingAggregatorService.getFundingStatesForSymbols(symbols);

    const results: Record<string, any> = {};
    for (const [symbol, state] of states) {
      results[symbol] = {
        state,
        interpretation: fundingAggregatorService.interpretFundingState(state),
      };
    }

    return {
      ok: true,
      count: states.size,
      results,
    };
  });

  console.log('[Funding] Admin Debug Routes registered');
}
