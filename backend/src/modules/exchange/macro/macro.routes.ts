/**
 * Macro Module — API Routes
 * ==========================
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { macroStateService } from './macro.state.service.js';
import { fundingOverlayService } from './funding.overlay.service.js';
import { clusterContextService } from './cluster.context.service.js';

export async function registerMacroRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════════
  // MACRO STATE
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/exchange/macro/state', async () => {
    const state = await macroStateService.getLatest();
    return {
      ok: true,
      state,
    };
  });

  app.get('/api/exchange/macro/history', async (req: FastifyRequest<{
    Querystring: { limit?: string };
  }>) => {
    const limit = parseInt(req.query.limit ?? '50');
    const history = await macroStateService.getHistory(limit);
    return {
      ok: true,
      count: history.length,
      history,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // FUNDING OVERLAY
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/exchange/macro/funding', async () => {
    const state = fundingOverlayService.getMarketState();
    const squeeze = state
      ? fundingOverlayService.detectSqueezePotential(state)
      : null;

    return {
      ok: true,
      state,
      squeeze,
    };
  });

  app.get('/api/exchange/macro/funding/:symbol', async (req: FastifyRequest<{
    Params: { symbol: string };
  }>) => {
    const symbol = req.params.symbol.toUpperCase();
    const state = await fundingOverlayService.getSymbolFunding(symbol);
    
    return {
      ok: true,
      symbol,
      state,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // CLUSTER CONTEXT
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/exchange/macro/context', async () => {
    const summary = await clusterContextService.getSummary();
    return {
      ok: true,
      ...summary,
    };
  });

  app.get('/api/exchange/macro/context/:clusterId', async (req: FastifyRequest<{
    Params: { clusterId: string };
    Querystring: { clusterType?: string };
  }>) => {
    const { clusterId } = req.params;
    const clusterType = req.query.clusterType as any;
    
    const context = await clusterContextService.buildContext(clusterId, clusterType);
    
    return {
      ok: true,
      context,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: UPDATE STATE
  // ═══════════════════════════════════════════════════════════════

  app.post('/api/admin/exchange/macro/update', async (req: FastifyRequest<{
    Body?: {
      btcDominance?: number;
      ethDominance?: number;
      fearGreedIndex?: number;
      btcPrice?: number;
      btcChange24h?: number;
    };
  }>) => {
    const data = req.body ?? {};
    
    // Use defaults for missing data (in production would fetch from APIs)
    const state = await macroStateService.update({
      btcDominance: data.btcDominance ?? 50,
      ethDominance: data.ethDominance ?? 17,
      fearGreedIndex: data.fearGreedIndex ?? 50,
      btcPrice: data.btcPrice ?? 0,
      btcChange24h: data.btcChange24h ?? 0,
    });

    // Also update funding overlay
    await fundingOverlayService.updateMarketFunding();

    return {
      ok: true,
      state,
    };
  });

  console.log('[Macro] Routes registered');
}
