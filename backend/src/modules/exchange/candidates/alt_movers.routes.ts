/**
 * BLOCK 2.13 — Alt Movers Routes
 * ==============================
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { altMoversService } from './alt_movers.service.js';
import { returnsBuilderService } from '../returns/returns_builder.service.js';

// Presets for different trading styles
const PRESETS = {
  conservative: {
    winnersThreshold: 0.08,
    lagThreshold: 0.01,
    minMomentum: 0.30,
  },
  momentum: {
    winnersThreshold: 0.06,
    lagThreshold: 0.02,
    minMomentum: 0.20,
  },
  early: {
    winnersThreshold: 0.05,
    lagThreshold: 0.00,
    minMomentum: 0.15,
  },
};

export async function registerAltMoversRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC: Get alt movers
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/market/alt-movers', async (req: FastifyRequest<{
    Querystring: {
      venue?: string;
      marketType?: string;
      tf?: string;
      horizon?: string;
      preset?: string;
      winnersThreshold?: string;
      lagThreshold?: string;
      minMomentum?: string;
      topKClusters?: string;
      outLimit?: string;
    };
  }>) => {
    const q = req.query;
    const preset = PRESETS[q.preset as keyof typeof PRESETS] ?? PRESETS.momentum;

    try {
      const result = await altMoversService.build({
        venue: q.venue ?? 'hyperliquid',
        marketType: (q.marketType ?? 'perp') as 'spot' | 'perp',
        tf: (q.tf ?? '5m') as '5m' | '15m' | '1h',
        horizon: (q.horizon ?? '4h') as '1h' | '4h' | '24h',
        winnersThreshold: parseFloat(q.winnersThreshold ?? String(preset.winnersThreshold)),
        lagThreshold: parseFloat(q.lagThreshold ?? String(preset.lagThreshold)),
        minClusterSize: 5,
        minMomentum: parseFloat(q.minMomentum ?? String(preset.minMomentum)),
        topKClusters: parseInt(q.topKClusters ?? '6'),
        outLimit: parseInt(q.outLimit ?? '30'),
      });

      return { ok: true, ...result };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: Build returns
  // ═══════════════════════════════════════════════════════════════

  app.post('/api/admin/market/returns/build', async (req: FastifyRequest<{
    Body?: {
      venue?: string;
      marketType?: string;
      tf?: string;
    };
  }>) => {
    try {
      const result = await returnsBuilderService.buildForLatest({
        venue: req.body?.venue ?? 'hyperliquid',
        marketType: (req.body?.marketType ?? 'perp') as 'spot' | 'perp',
        tf: (req.body?.tf ?? '5m') as '5m' | '15m' | '1h',
        horizons: ['1h', '4h', '24h'],
        limit: 500,
      });
      return { ok: true, ...result };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: Debug alt movers
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/admin/market/alt-movers/debug', async (req: FastifyRequest<{
    Querystring: {
      venue?: string;
      marketType?: string;
      tf?: string;
      horizon?: string;
    };
  }>) => {
    const q = req.query;
    try {
      const result = await altMoversService.build({
        venue: q.venue ?? 'hyperliquid',
        marketType: (q.marketType ?? 'perp') as 'spot' | 'perp',
        tf: (q.tf ?? '5m') as '5m' | '15m' | '1h',
        horizon: (q.horizon ?? '4h') as '1h' | '4h' | '24h',
        winnersThreshold: 0.06,
        lagThreshold: 0.02,
        minClusterSize: 3,
        minMomentum: 0.10,
        topKClusters: 10,
        outLimit: 50,
      });

      return {
        ok: true,
        ...result,
        debug: {
          note: 'Debug mode with relaxed thresholds',
          presets: PRESETS,
        },
      };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  console.log('[AltMovers] Routes registered (Block 2.13)');
}
