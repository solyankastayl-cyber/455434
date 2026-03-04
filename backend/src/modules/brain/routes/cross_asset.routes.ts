/**
 * P9.0 — Cross-Asset Controller (API Routes)
 * 
 * Endpoints:
 *   GET /api/brain/v2/cross-asset         — Current pack
 *   GET /api/brain/v2/cross-asset/schema  — Schema info
 *   POST /api/brain/v2/cross-asset/validate — Validate asOf
 *   GET /api/brain/v2/cross-asset/timeline — Backfill timeline
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getCrossAssetRegimeService } from '../services/cross_asset_regime.service.js';
import { validateCrossAssetPack, REGIME_THRESHOLDS, ASSET_PAIRS, WINDOW_SIZES } from '../contracts/cross_asset.contract.js';

export async function crossAssetRoutes(fastify: FastifyInstance): Promise<void> {

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/cross-asset — Current pack
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/cross-asset', async (
    request: FastifyRequest<{ Querystring: { asOf?: string } }>,
    reply: FastifyReply
  ) => {
    const asOf = request.query.asOf || new Date().toISOString().split('T')[0];

    try {
      const service = getCrossAssetRegimeService();
      const pack = await service.buildPack(asOf);

      const validation = validateCrossAssetPack(pack);

      return reply.send({
        ok: true,
        ...pack,
        _validation: validation.valid ? undefined : validation.errors,
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'CROSS_ASSET_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/cross-asset/schema — Schema info
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/cross-asset/schema', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      ok: true,
      version: 'P9.0',
      assets: ['BTC', 'SPX', 'DXY', 'GOLD'],
      pairs: [...ASSET_PAIRS],
      windows: [...WINDOW_SIZES],
      regimeLabels: ['RISK_ON_SYNC', 'RISK_OFF_SYNC', 'FLIGHT_TO_QUALITY', 'DECOUPLED', 'MIXED'],
      thresholds: REGIME_THRESHOLDS,
      diagnostics: {
        decoupleScore: '0..1, high = correlations breaking down between 20d and 120d',
        signFlipCount: '0..6, count of sign flips across windows',
        corrStability: '0..1, 1 = correlations stable across windows',
        contagionScore: '0..1, high = all risk assets move together',
      },
    });
  });

  // ─────────────────────────────────────────────────────────
  // POST /api/brain/v2/cross-asset/validate — Validate asOf
  // ─────────────────────────────────────────────────────────

  fastify.post('/api/brain/v2/cross-asset/validate', async (
    request: FastifyRequest<{ Body: { asOf?: string } }>,
    reply: FastifyReply
  ) => {
    const body = request.body || {};
    const asOf = body.asOf || new Date().toISOString().split('T')[0];

    try {
      const service = getCrossAssetRegimeService();
      const pack = await service.buildPack(asOf);
      const validation = validateCrossAssetPack(pack);

      return reply.send({
        ok: validation.valid,
        asOf,
        regime: pack.regime.label,
        confidence: pack.regime.confidence,
        validation,
        diagnostics: pack.diagnostics,
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'VALIDATE_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/cross-asset/timeline — Backfill timeline
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/cross-asset/timeline', async (
    request: FastifyRequest<{
      Querystring: { start?: string; end?: string; step?: string }
    }>,
    reply: FastifyReply
  ) => {
    const end = request.query.end || new Date().toISOString().split('T')[0];
    const start = request.query.start || subtractDays(end, 365);
    const stepDays = parseInt(request.query.step || '7', 10);

    try {
      const service = getCrossAssetRegimeService();
      const timeline: {
        asOf: string;
        regime: string;
        confidence: number;
        corr_btc_spx_60d: number;
        contagionScore: number;
        decoupleScore: number;
      }[] = [];

      let current = new Date(start);
      const endDate = new Date(end);

      while (current <= endDate) {
        const dateStr = current.toISOString().split('T')[0];

        try {
          const pack = await service.buildPack(dateStr);
          const w60 = pack.windows.find(w => w.windowDays === 60);

          timeline.push({
            asOf: dateStr,
            regime: pack.regime.label,
            confidence: pack.regime.confidence,
            corr_btc_spx_60d: w60?.corr_btc_spx ?? 0,
            contagionScore: pack.diagnostics.contagionScore,
            decoupleScore: pack.diagnostics.decoupleScore,
          });
        } catch {
          // Skip dates with insufficient data
        }

        current.setDate(current.getDate() + stepDays);
      }

      return reply.send({
        ok: true,
        start,
        end,
        stepDays,
        count: timeline.length,
        timeline,
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'TIMELINE_ERROR',
        message: (e as Error).message,
      });
    }
  });

  console.log('[CrossAsset] Routes registered at /api/brain/v2/cross-asset');
}

function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}
