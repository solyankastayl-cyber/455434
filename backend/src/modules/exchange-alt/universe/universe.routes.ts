/**
 * STAGE 2 — Universe Routes
 * ==========================
 * API endpoints for Alt Universe.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { universeBuilder } from './universe.builder.js';
import { forceRefresh } from './universe.scheduler.js';
import type { Venue } from '../types.js';

export async function registerUniverseRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════════
  // GET UNIVERSE
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/exchange/universe', async (req: FastifyRequest<{
    Querystring: {
      venue?: string;
      tier?: string;
      tags?: string;
    };
  }>) => {
    const venue = req.query.venue as Venue | undefined;
    const tier = req.query.tier as 'TIER1' | 'TIER2' | 'TIER3' | undefined;
    const tags = req.query.tags?.split(',').filter(Boolean);

    let assets;
    if (tier) {
      assets = await universeBuilder.getByTier(tier, venue);
    } else if (tags && tags.length > 0) {
      assets = await universeBuilder.getByTags(tags, venue);
    } else {
      assets = await universeBuilder.getEnabledAssets(venue);
    }

    return {
      ok: true,
      count: assets.length,
      assets,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET SYMBOLS (just array of strings)
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/exchange/universe/symbols', async (req: FastifyRequest<{
    Querystring: { venue?: string };
  }>) => {
    const venue = (req.query.venue ?? 'BINANCE') as Venue;
    const symbols = await universeBuilder.getSymbols(venue);
    
    return {
      ok: true,
      venue,
      count: symbols.length,
      symbols,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET STATS
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/exchange/universe/stats', async () => {
    const stats = await universeBuilder.getStats();
    const latestBinance = await universeBuilder.getLatestSnapshot('BINANCE');
    
    return {
      ok: true,
      stats,
      lastRefresh: latestBinance?.ts ?? null,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: FORCE REFRESH
  // ═══════════════════════════════════════════════════════════════

  app.post('/api/admin/exchange/universe/refresh', async (req: FastifyRequest<{
    Body?: { venue?: string };
  }>) => {
    const venue = (req.body?.venue ?? 'BINANCE') as Venue;
    
    const snapshot = await forceRefresh(venue);
    
    return {
      ok: true,
      venue,
      eligibleAssets: snapshot.eligibleAssets,
      totalAssets: snapshot.totalAssets,
      ts: snapshot.ts,
    };
  });

  console.log('[Universe] Routes registered');
}
