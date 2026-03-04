/**
 * LIQUIDITY ENGINE ROUTES — P2
 * 
 * API endpoints for liquidity module.
 * 
 * ROUTES:
 * - POST /api/liquidity/admin/ingest      - Ingest all liquidity series
 * - GET  /api/liquidity/health            - Module health
 * - GET  /api/liquidity/context           - Full context (all series)
 * - GET  /api/liquidity/state             - Current impulse state
 * - GET  /api/liquidity/components        - Individual components (WALCL, RRP, TGA)
 * - GET  /api/liquidity/cascade/spx       - SPX cascade multiplier
 * - GET  /api/liquidity/cascade/btc       - BTC cascade multiplier
 * - GET  /api/liquidity/macro-component   - Component for macro score
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  ingestAllLiquiditySeries,
  getLiquiditySeriesCount,
  hasFredKey,
} from './liquidity.ingest.js';

import {
  buildLiquidityContext,
  getLiquidityState,
  buildLiquidityContextAsOf,
  getLiquidityStateAsOf,
} from './liquidity.impulse.js';

import {
  getLiquidityMacroComponent,
  getSpxLiquidityMultiplier,
  getBtcLiquidityMultiplier,
  shouldAccelerateCrisis,
  getLiquidityForStateVector,
} from './liquidity.regime.js';

// P2.5: Episode validation
import {
  validateEpisode,
  validateAllEpisodes,
  PREDEFINED_EPISODES,
  EpisodeValidationInput,
} from './liquidity.validate.js';

// ═══════════════════════════════════════════════════════════════
// REGISTER ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerLiquidityRoutes(app: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // ADMIN: Ingest all liquidity series
  // ─────────────────────────────────────────────────────────────
  app.post('/api/liquidity/admin/ingest', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!hasFredKey()) {
        return reply.status(400).send({
          ok: false,
          error: 'FRED_API_KEY not configured',
        });
      }
      
      const result = await ingestAllLiquiditySeries();
      return reply.send(result);
      
    } catch (error: any) {
      console.error('[Liquidity] Ingest error:', error.message);
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // Health check
  // ─────────────────────────────────────────────────────────────
  app.get('/api/liquidity/health', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const walclCount = await getLiquiditySeriesCount('WALCL');
      const rrpCount = await getLiquiditySeriesCount('RRPONTSYD');
      const tgaCount = await getLiquiditySeriesCount('WTREGEN');
      
      const totalPoints = walclCount + rrpCount + tgaCount;
      const seriesAvailable = [walclCount, rrpCount, tgaCount].filter(c => c > 0).length;
      
      return reply.send({
        ok: seriesAvailable > 0,
        module: 'liquidity-engine',
        version: 'P2.1',
        fredKeyConfigured: hasFredKey(),
        series: {
          WALCL: walclCount,
          RRPONTSYD: rrpCount,
          WTREGEN: tgaCount,
        },
        totalPoints,
        seriesAvailable,
        status: seriesAvailable === 3 ? 'READY' : seriesAvailable > 0 ? 'PARTIAL' : 'NO_DATA',
      });
      
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // Full context (all series + state)
  // P3: Supports ?asOf= parameter
  // ─────────────────────────────────────────────────────────────
  app.get('/api/liquidity/context', async (
    req: FastifyRequest<{ Querystring: { asOf?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { asOf } = req.query;
      
      if (asOf) {
        const context = await buildLiquidityContextAsOf(asOf);
        return reply.send({ ...context, mode: 'as-of', asOf });
      }
      
      const context = await buildLiquidityContext();
      return reply.send({ ...context, mode: 'current' });
      
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // Current impulse state
  // P3: Supports ?asOf= parameter
  // ─────────────────────────────────────────────────────────────
  app.get('/api/liquidity/state', async (
    req: FastifyRequest<{ Querystring: { asOf?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { asOf } = req.query;
      
      if (asOf) {
        const state = await getLiquidityStateAsOf(asOf);
        return reply.send({ ...state, mode: 'as-of', asOf });
      }
      
      const state = await getLiquidityState();
      return reply.send({ ...state, mode: 'current' });
      
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // State vector component (for AE Brain)
  // ─────────────────────────────────────────────────────────────
  app.get('/api/liquidity/state-vector', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const sv = await getLiquidityForStateVector();
      return reply.send(sv);
      
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // Macro score component
  // ─────────────────────────────────────────────────────────────
  app.get('/api/liquidity/macro-component', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const component = await getLiquidityMacroComponent();
      return reply.send(component);
      
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // SPX cascade multiplier
  // ─────────────────────────────────────────────────────────────
  app.get('/api/liquidity/cascade/spx', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const mult = await getSpxLiquidityMultiplier();
      return reply.send(mult);
      
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // BTC cascade multiplier
  // ─────────────────────────────────────────────────────────────
  app.get('/api/liquidity/cascade/btc', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const mult = await getBtcLiquidityMultiplier();
      return reply.send(mult);
      
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // Crisis acceleration check
  // ─────────────────────────────────────────────────────────────
  app.get('/api/liquidity/crisis-check', async (
    req: FastifyRequest<{ Querystring: { creditTrend?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const creditTrend = (req.query.creditTrend || 'FLAT') as 'UP' | 'DOWN' | 'FLAT';
      const result = await shouldAccelerateCrisis(creditTrend);
      return reply.send(result);
      
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // P2.5: Episode Validation — Single episode
  // ─────────────────────────────────────────────────────────────
  app.get('/api/liquidity/validate/episode', async (
    req: FastifyRequest<{ 
      Querystring: { 
        from?: string;
        to?: string;
        expectedRegime?: string;
        stepDays?: string;
        thresholdShare?: string;
      } 
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { from, to, expectedRegime, stepDays, thresholdShare } = req.query;
      
      if (!from || !to || !expectedRegime) {
        return reply.status(400).send({
          ok: false,
          error: 'Required: from, to, expectedRegime',
          example: '/api/liquidity/validate/episode?from=2020-03-01&to=2021-03-01&expectedRegime=EXPANSION',
        });
      }
      
      const input: EpisodeValidationInput = {
        from,
        to,
        expectedRegime: expectedRegime as any,
        stepDays: stepDays ? parseInt(stepDays) : 7,
        thresholdShare: thresholdShare ? parseFloat(thresholdShare) : 0.60,
      };
      
      const result = await validateEpisode(input);
      
      // Return without full snapshots for cleaner response
      return reply.send({
        ...result,
        snapshots: `${result.snapshots.length} weekly snapshots (use /api/liquidity/validate/episode/detail for full data)`,
      });
      
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // P2.5: Episode Validation — Single episode with full snapshots
  // ─────────────────────────────────────────────────────────────
  app.get('/api/liquidity/validate/episode/detail', async (
    req: FastifyRequest<{ 
      Querystring: { 
        from?: string;
        to?: string;
        expectedRegime?: string;
        stepDays?: string;
        thresholdShare?: string;
      } 
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { from, to, expectedRegime, stepDays, thresholdShare } = req.query;
      
      if (!from || !to || !expectedRegime) {
        return reply.status(400).send({
          ok: false,
          error: 'Required: from, to, expectedRegime',
        });
      }
      
      const input: EpisodeValidationInput = {
        from,
        to,
        expectedRegime: expectedRegime as any,
        stepDays: stepDays ? parseInt(stepDays) : 7,
        thresholdShare: thresholdShare ? parseFloat(thresholdShare) : 0.60,
      };
      
      const result = await validateEpisode(input);
      return reply.send(result);
      
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // P2.5: Run all predefined episode validations
  // ─────────────────────────────────────────────────────────────
  app.get('/api/liquidity/validate/episodes', async (
    req: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const result = await validateAllEpisodes();
      
      // Summarize without full snapshots
      const summary: Record<string, any> = {};
      for (const [key, res] of Object.entries(result.results)) {
        const episode = PREDEFINED_EPISODES[key as keyof typeof PREDEFINED_EPISODES];
        summary[key] = {
          name: episode.name,
          description: episode.description,
          result: res.result,
          stats: res.stats,
          passReasons: res.passReasons,
          failReasons: res.failReasons,
        };
      }
      
      return reply.send({
        ok: result.ok,
        passCount: result.passCount,
        failCount: result.failCount,
        episodes: summary,
      });
      
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // P2.5: List predefined episodes
  // ─────────────────────────────────────────────────────────────
  app.get('/api/liquidity/validate/episodes/list', async (
    req: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      episodes: PREDEFINED_EPISODES,
    });
  });
  
  console.log('[Liquidity Engine] Routes registered:');
  console.log('  POST /api/liquidity/admin/ingest');
  console.log('  GET  /api/liquidity/health');
  console.log('  GET  /api/liquidity/context');
  console.log('  GET  /api/liquidity/state');
  console.log('  GET  /api/liquidity/state-vector');
  console.log('  GET  /api/liquidity/macro-component');
  console.log('  GET  /api/liquidity/cascade/spx');
  console.log('  GET  /api/liquidity/cascade/btc');
  console.log('  GET  /api/liquidity/crisis-check');
  console.log('  GET  /api/liquidity/validate/episode');
  console.log('  GET  /api/liquidity/validate/episode/detail');
  console.log('  GET  /api/liquidity/validate/episodes');
  console.log('  GET  /api/liquidity/validate/episodes/list');
}
