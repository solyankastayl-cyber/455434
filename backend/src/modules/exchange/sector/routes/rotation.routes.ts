/**
 * BLOCK 2.9 — Sector Rotation Routes
 * ===================================
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Sector } from '../types/sector.types.js';
import { sectorStateService } from '../services/sector_state.service.js';
import { rotationWaveService } from '../services/rotation_wave.service.js';
import { assetTagsStore } from '../db/asset_tags.model.js';

type Window = '4h' | '24h';

export async function registerSectorRotationRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC: Get all sectors in rotation order
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/market/rotation/sectors', async (req: FastifyRequest<{
    Querystring: { window?: string };
  }>) => {
    const window = (req.query.window ?? '4h') as Window;
    const sectors = await sectorStateService.getAllSectorStates(window);

    return {
      ok: true,
      ts: new Date().toISOString(),
      window,
      count: sectors.length,
      sectors,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC: Get picks for a specific sector
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/market/rotation/picks', async (req: FastifyRequest<{
    Querystring: { sector?: string; window?: string; limit?: string };
  }>) => {
    const sector = (req.query.sector ?? 'L2') as Sector;
    const window = (req.query.window ?? '4h') as Window;
    const limit = parseInt(req.query.limit ?? '10');

    const result = await rotationWaveService.getSectorPicks(sector, window, limit);

    return {
      ok: true,
      ...result,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: Explain why sector is top
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/admin/rotation/explain', async (req: FastifyRequest<{
    Querystring: { sector?: string; window?: string };
  }>) => {
    const sector = (req.query.sector ?? 'L2') as Sector;
    const window = (req.query.window ?? '4h') as Window;

    const state = await sectorStateService.computeSectorState(sector, window);
    if (!state) {
      return { ok: false, error: 'No data for sector' };
    }

    const explanation: string[] = [];

    if (state.momentum > 0.1) explanation.push(`Strong momentum: ${(state.momentum * 100).toFixed(1)}%`);
    if (state.breadth > 0.5) explanation.push(`Wide breadth: ${(state.breadth * 100).toFixed(0)}% symbols positive`);
    if (state.dispersion < 0.2) explanation.push(`Low dispersion: ${(state.dispersion * 100).toFixed(1)}% (cohesive move)`);
    if (state.squeezeRisk < 0.3) explanation.push(`Low squeeze risk: ${(state.squeezeRisk * 100).toFixed(0)}%`);

    return {
      ok: true,
      sector,
      window,
      state,
      explanation,
      formula: {
        momentum_weight: 0.45,
        breadth_weight: 0.25,
        dispersion_weight: 0.20,
        squeeze_weight: 0.10,
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: Seed asset tags
  // ═══════════════════════════════════════════════════════════════

  app.post('/api/admin/rotation/seed-tags', async () => {
    const result = await assetTagsStore.seedInitialData();
    return { ok: true, ...result };
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: Get sector stats
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/admin/rotation/stats', async () => {
    const stats = await assetTagsStore.getSectorStats();
    const all = await assetTagsStore.getAll();

    return {
      ok: true,
      totalAssets: all.length,
      bySector: stats,
    };
  });

  console.log('[Sector] Rotation Routes registered');
}
