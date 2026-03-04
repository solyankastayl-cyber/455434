/**
 * Market Regimes Routes (Phase 14C.4)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as service from './market_regime.service.js';
import { getRegimeDescription } from './market_regime.model.js';

export async function marketRegimesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/market-regimes/:asset
   */
  app.get('/:asset', async (request: FastifyRequest) => {
    const { asset } = request.params as { asset: string };
    const query = request.query as { chain?: string; timeframe?: string };
    
    const regime = await service.getRegime(
      asset,
      query.chain || 'ethereum',
      (query.timeframe as any) || '4h'
    );
    
    if (!regime) {
      return { ok: false, error: 'No regime data available' };
    }
    
    return {
      ok: true,
      data: {
        assetAddress: regime.assetAddress,
        timeframe: regime.timeframe,
        regime: regime.regime,
        regimeDescription: getRegimeDescription(regime.regime),
        confidence: regime.regimeConfidence,
        metrics: {
          volatility: regime.volatility,
          trendStrength: regime.trendStrength,
          trendDirection: regime.trendDirection,
          priceChangePercent: regime.priceChangePercent,
          maxDrawdownPercent: regime.maxDrawdownPercent,
        },
        regimeChanged: regime.regimeChanged,
        previousRegime: regime.previousRegime,
        computedAt: regime.computedAt,
        validUntil: regime.validUntil,
      },
    };
  });

  /**
   * GET /api/market-regimes/:asset/all
   */
  app.get('/:asset/all', async (request: FastifyRequest) => {
    const { asset } = request.params as { asset: string };
    const query = request.query as { chain?: string };
    
    const regimes = await service.getAllRegimes(asset, query.chain || 'ethereum');
    
    return {
      ok: true,
      data: Object.fromEntries(
        Object.entries(regimes).map(([tf, r]) => [
          tf,
          r ? {
            regime: r.regime,
            description: getRegimeDescription(r.regime),
            confidence: r.regimeConfidence,
            priceChangePercent: r.priceChangePercent,
          } : null,
        ])
      ),
    };
  });

  /**
   * GET /api/market-regimes/changes/recent
   */
  app.get('/changes/recent', async (request: FastifyRequest) => {
    const query = request.query as { hours?: string; chain?: string };
    
    const changes = await service.getRecentRegimeChanges(
      parseInt(query.hours || '24'),
      query.chain || 'ethereum'
    );
    
    return {
      ok: true,
      data: changes.map(r => ({
        assetAddress: r.assetAddress,
        timeframe: r.timeframe,
        from: r.previousRegime,
        to: r.regime,
        computedAt: r.computedAt,
      })),
      count: changes.length,
    };
  });

  app.log.info('Market Regimes routes registered');
}
