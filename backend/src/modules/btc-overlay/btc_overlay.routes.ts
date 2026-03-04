/**
 * BTC OVERLAY ROUTES — SPX → BTC Influence Engine API
 * 
 * Endpoints:
 * - GET /api/overlay/coeffs?base=BTC&driver=SPX&horizon=30d
 * - GET /api/overlay/adjusted-path?base=BTC&driver=SPX&horizon=30d
 * - GET /api/overlay/explain?base=BTC&driver=SPX&horizon=30d
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getBtcOverlayService } from './btc_overlay.service.js';
import type { HorizonKey } from './btc_overlay.contract.js';

const VALID_HORIZONS = [7, 14, 30, 90, 180, 365];

function parseHorizon(h: string): HorizonKey | null {
  const num = parseInt(h.replace('d', ''));
  if (VALID_HORIZONS.includes(num)) return num as HorizonKey;
  return null;
}

export async function btcOverlayRoutes(fastify: FastifyInstance): Promise<void> {
  const service = getBtcOverlayService();
  
  // GET /api/overlay/coeffs
  fastify.get<{
    Querystring: { base?: string; driver?: string; horizon?: string };
  }>('/api/overlay/coeffs', async (req, reply) => {
    const horizon = parseHorizon(req.query.horizon || '30d');
    if (!horizon) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid horizon. Use: 7d, 14d, 30d, 90d, 180d, 365d',
      });
    }
    
    try {
      const response = await service.getCoeffsResponse(horizon);
      return reply.send({ ok: true, ...response });
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });
  
  // GET /api/overlay/explain
  fastify.get<{
    Querystring: { base?: string; driver?: string; horizon?: string };
  }>('/api/overlay/explain', async (req, reply) => {
    const horizon = parseHorizon(req.query.horizon || '30d');
    if (!horizon) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid horizon. Use: 7d, 14d, 30d, 90d, 180d, 365d',
      });
    }
    
    try {
      const coeffs = await service.calculateCoeffs(horizon);
      
      // Mock returns for now (would come from actual BTC/SPX forecasts)
      const btcHybridReturn = 0.03; // 3%
      const spxFinalReturn = 0.0241; // 2.41%
      
      const response = service.getExplainResponse(horizon, btcHybridReturn, spxFinalReturn, coeffs);
      return reply.send({ ok: true, ...response });
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });
  
  // GET /api/overlay/adjusted-path
  fastify.get<{
    Querystring: { base?: string; driver?: string; horizon?: string };
  }>('/api/overlay/adjusted-path', async (req, reply) => {
    const horizon = parseHorizon(req.query.horizon || '30d');
    if (!horizon) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid horizon. Use: 7d, 14d, 30d, 90d, 180d, 365d',
      });
    }
    
    try {
      const coeffs = await service.calculateCoeffs(horizon);
      
      // Generate mock series (would integrate with actual BTC/SPX data)
      const basePrice = 67000;
      const days = horizon;
      
      // Generate simple cumulative returns
      const btcHybridReturns: number[] = [];
      const spxFinalReturns: number[] = [];
      
      for (let i = 0; i < days; i++) {
        btcHybridReturns.push(0.001 * (1 + Math.sin(i / 10))); // ~0.1% daily
        spxFinalReturns.push(0.0008 * (1 + Math.cos(i / 15))); // ~0.08% daily
      }
      
      const series = service.buildAdjustedSeries(
        basePrice,
        btcHybridReturns,
        spxFinalReturns,
        coeffs,
        new Date()
      );
      
      // Calculate cumulative returns for explain
      const btcCumReturn = btcHybridReturns.reduce((a, b) => a + b, 0);
      const spxCumReturn = spxFinalReturns.reduce((a, b) => a + b, 0);
      const explain = service.computeAdjustedReturn(btcCumReturn, spxCumReturn, coeffs);
      
      return reply.send({
        ok: true,
        meta: {
          base: 'BTC',
          driver: 'SPX',
          horizon: `${horizon}d`,
          asOf: new Date().toISOString(),
          step: '1d',
          basePrice,
        },
        series,
        explain,
      });
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });
  
  console.log('[BtcOverlay] Routes registered at /api/overlay/*');
}
