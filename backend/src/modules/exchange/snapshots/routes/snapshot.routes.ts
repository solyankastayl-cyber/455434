/**
 * BLOCK 2.11 — Snapshot Routes
 * ============================
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { snapshotBuilderService } from '../services/snapshot_builder.service.js';

export async function registerSnapshotRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC: Get latest snapshots
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/market/snapshots/latest', async (req: FastifyRequest<{
    Querystring: {
      venue?: string;
      marketType?: string;
      limit?: string;
      minQuality?: string;
    };
  }>) => {
    const venue = req.query.venue;
    const marketType = req.query.marketType;
    const limit = parseInt(req.query.limit ?? '50');
    const minQuality = parseFloat(req.query.minQuality ?? '0.6');

    const snapshots = await snapshotBuilderService.getLatest({
      venue,
      marketType,
      limit,
      minQuality,
    });

    return {
      ok: true,
      count: snapshots.length,
      snapshots: snapshots.map(s => ({
        symbolKey: s.symbolKey,
        base: s.base,
        venue: s.venue,
        ts: s.ts,
        price: s.price,
        priceChg24h: s.priceChg24h,
        volumeUsd24h: s.volumeUsd24h,
        fundingRate: s.fundingRate,
        qualityScore: s.dataQuality.qualityScore,
        liquidityTier: s.tags?.liquidityTier,
        hasFunding: s.tags?.hasFunding,
        hasOI: s.tags?.hasOI,
        features: s.features,
      })),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC: Get snapshot history for symbol
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/market/snapshots/:symbolKey', async (req: FastifyRequest<{
    Params: { symbolKey: string };
    Querystring: { limit?: string };
  }>) => {
    const { symbolKey } = req.params;
    const limit = parseInt(req.query.limit ?? '288');

    const history = await snapshotBuilderService.getHistory(symbolKey, limit);

    return {
      ok: true,
      symbolKey,
      count: history.length,
      history: history.map(s => ({
        ts: s.ts,
        price: s.price,
        fundingRate: s.fundingRate,
        oiUsd: s.oiUsd,
        features: s.features,
      })),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: Build snapshots manually
  // ═══════════════════════════════════════════════════════════════

  app.post('/api/admin/market/snapshots/build', async (req: FastifyRequest<{
    Body?: {
      venue?: string;
      marketType?: string;
      tf?: string;
      maxSymbols?: number;
    };
  }>) => {
    const result = await snapshotBuilderService.buildOnce({
      tf: (req.body?.tf as any) ?? '5m',
      maxSymbols: req.body?.maxSymbols ?? 200,
    });

    return {
      ok: true,
      ...result,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: Health check
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/admin/market/snapshots/health', async () => {
    const health = await snapshotBuilderService.getHealth();
    return {
      ok: true,
      ...health,
      hint: health.totalSnapshots > 0 ? 'Snapshots available' : 'Run build to create snapshots',
    };
  });

  console.log('[Snapshots] Routes registered');
}
