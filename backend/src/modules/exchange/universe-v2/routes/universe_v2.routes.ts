/**
 * BLOCK 2.10 — Universe Routes
 * ============================
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { VenueType, MarketType } from '../db/universe.model.js';
import { universeScannerService } from '../services/universe_scanner.service.js';

export async function registerUniverseV2Routes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC: Get universe symbols
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/market/universe', async (req: FastifyRequest<{
    Querystring: {
      venue?: string;
      marketType?: string;
      liquidityTier?: string;
      limit?: string;
    };
  }>) => {
    const venue = req.query.venue as VenueType | undefined;
    const marketType = req.query.marketType as MarketType | undefined;
    const liquidityTier = req.query.liquidityTier as 'LOW' | 'MID' | 'HIGH' | undefined;
    const limit = parseInt(req.query.limit ?? '200');

    const symbols = await universeScannerService.listEnabled({
      venue,
      marketType,
      liquidityTier,
      limit,
    });

    return {
      ok: true,
      count: symbols.length,
      symbols: symbols.map(s => ({
        symbol: s.symbol,
        base: s.base,
        quote: s.quote,
        venue: s.venue,
        marketType: s.marketType,
        lastPrice: s.lastPrice,
        volumeUsd24h: s.avgUsdVolume24h,
        liquidityTier: s.liquidityTier,
        hasFunding: s.hasFunding,
        hasOI: s.hasOI,
      })),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: Scan all venues
  // ═══════════════════════════════════════════════════════════════

  app.post('/api/admin/market/universe/scan', async () => {
    const results = await universeScannerService.scanAll();
    return {
      ok: true,
      results,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: Scan single venue
  // ═══════════════════════════════════════════════════════════════

  app.post('/api/admin/market/universe/scan/:venue', async (req: FastifyRequest<{
    Params: { venue: string };
  }>) => {
    const venue = req.params.venue as VenueType;
    const result = await universeScannerService.scanVenue(venue);
    return { ok: true, result };
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: Health / Stats
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/admin/market/universe/health', async () => {
    const stats = await universeScannerService.getStats();
    return {
      ok: true,
      ...stats,
      hint: stats.enabled > 0 ? 'Universe populated' : 'Run scan to populate',
    };
  });

  console.log('[Universe] V2 Routes registered');
}
