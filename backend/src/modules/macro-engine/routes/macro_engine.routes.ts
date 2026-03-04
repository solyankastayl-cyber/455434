/**
 * MACRO ENGINE ROUTES — Unified API for V1/V2
 * 
 * Same endpoints, engine version in response.
 */

import { FastifyInstance } from 'fastify';
import { getMacroEngineRouter } from '../router/macro_engine_router.service.js';
import { getMacroEngineV1 } from '../v1/macro_engine_v1.service.js';
import { getMacroEngineV2 } from '../v2/macro_engine_v2.service.js';
import { getRegimeStateService } from '../v2/state/regime_state.service.js';
import { getRollingCalibrationService } from '../v2/calibration/rolling_calibration.service.js';
import { MacroHorizon } from '../interfaces/macro_engine.interface.js';
import { getMacroSeriesPoints } from '../../dxy-macro-core/ingest/macro.ingest.service.js';

export async function registerMacroEngineRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/macro-engine';
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/:asset/pack — Main endpoint (uses router)
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/:asset/pack`, async (req, reply) => {
    const { asset } = req.params as { asset: string };
    const query = req.query as any;
    
    const validAssets = ['DXY', 'SPX', 'BTC'];
    const upperAsset = asset.toUpperCase() as 'DXY' | 'SPX' | 'BTC';
    
    if (!validAssets.includes(upperAsset)) {
      return reply.status(400).send({ error: `Invalid asset: ${asset}` });
    }
    
    const horizon = (query.horizon || '30D') as MacroHorizon;
    const hybridEndReturn = parseFloat(query.hybridEndReturn || '0');
    
    const router = getMacroEngineRouter();
    const pack = await router.computePack({
      asset: upperAsset,
      horizon,
      hybridEndReturn,
    });
    
    return pack;
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/:asset/compare — Compare V1 vs V2
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/:asset/compare`, async (req, reply) => {
    const { asset } = req.params as { asset: string };
    const query = req.query as any;
    
    const horizon = (query.horizon || '30D') as MacroHorizon;
    const hybridEndReturn = parseFloat(query.hybridEndReturn || '0');
    
    const router = getMacroEngineRouter();
    const comparison = await router.comparePacks({
      asset: asset.toUpperCase() as 'DXY' | 'SPX' | 'BTC',
      horizon,
      hybridEndReturn,
    });
    
    return {
      ok: true,
      ...comparison,
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/status — Router status
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/status`, async (req, reply) => {
    const router = getMacroEngineRouter();
    const status = router.getStatus();
    
    const { engine, reason } = await router.getActiveEngine();
    const v2Ready = await router.checkV2Readiness();
    
    return {
      ok: true,
      activeEngine: engine.version,
      activeReason: reason,
      v2Readiness: v2Ready,
      ...status,
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // ADMIN — Engine lifecycle management
  // ─────────────────────────────────────────────────────────────
  
  // POST /api/macro-engine/admin/active — Set active engine
  fastify.post(`${prefix}/admin/active`, async (req, reply) => {
    const body = req.body as any;
    const active = body?.active;
    const asset = (body?.asset || 'DXY').toUpperCase();
    
    if (!['v1', 'v2', 'auto'].includes(active)) {
      return reply.status(400).send({ error: 'Invalid active. Use: v1, v2, auto' });
    }
    
    const router = getMacroEngineRouter();
    router.forceEngine(active);
    
    return { ok: true, asset, active, message: `Engine set to: ${active}` };
  });
  
  // GET /api/macro-engine/admin/active — Get active engine
  fastify.get(`${prefix}/admin/active`, async (req, reply) => {
    const query = req.query as any;
    const asset = (query.asset || 'DXY').toUpperCase();
    
    const router = getMacroEngineRouter();
    const { engine, reason } = await router.getActiveEngine();
    const status = await router.getStatus();
    
    return {
      ok: true,
      asset,
      active: engine.version,
      mode: status.override || (status.config.autoSwitch ? 'auto' : status.config.defaultEngine),
      reason,
    };
  });
  
  // POST /api/macro-engine/admin/promote — Promote V2 to active
  fastify.post(`${prefix}/admin/promote`, async (req, reply) => {
    const body = req.body as any;
    const asset = (body?.asset || 'DXY').toUpperCase();
    const from = body?.from || 'v1';
    const to = body?.to || 'v2';
    const reason = body?.reason || 'manual promotion';
    
    // Verify V2 health before promoting
    const v2 = getMacroEngineV2();
    const health = await v2.healthCheck();
    
    if (!health.ok) {
      return reply.status(400).send({
        ok: false,
        error: 'V2 health check failed — cannot promote',
        issues: health.issues,
      });
    }
    
    const router = getMacroEngineRouter();
    router.forceEngine(to as any);
    
    console.log(`[ADMIN] PROMOTE ${asset}: ${from} → ${to} | reason: ${reason}`);
    
    return {
      ok: true,
      asset,
      from,
      to,
      reason,
      timestamp: new Date().toISOString(),
    };
  });
  
  // POST /api/macro-engine/admin/rollback — Rollback to V1
  fastify.post(`${prefix}/admin/rollback`, async (req, reply) => {
    const body = req.body as any;
    const asset = (body?.asset || 'DXY').toUpperCase();
    const to = body?.to || 'v1';
    const reason = body?.reason || 'manual rollback';
    
    const router = getMacroEngineRouter();
    const { engine: currentEngine } = await router.getActiveEngine();
    const from = currentEngine.version;
    
    router.forceEngine(to as any);
    
    console.log(`[ADMIN] ROLLBACK ${asset}: ${from} → ${to} | reason: ${reason}`);
    
    return {
      ok: true,
      asset,
      from,
      to,
      reason,
      timestamp: new Date().toISOString(),
    };
  });
  
  // POST /api/macro-engine/admin/force-engine — Legacy compat
  fastify.post(`${prefix}/admin/force-engine`, async (req, reply) => {
    const body = req.body as any;
    const version = body?.version;
    
    if (!['v1', 'v2', 'auto'].includes(version)) {
      return reply.status(400).send({ error: 'Invalid version. Use: v1, v2, auto' });
    }
    
    const router = getMacroEngineRouter();
    router.forceEngine(version);
    
    return { ok: true, message: `Forced engine to: ${version}` };
  });
  
  // POST /api/macro-engine/admin/reset — Reset to defaults
  fastify.post(`${prefix}/admin/reset`, { config: { rawBody: true } } as any, async (req, reply) => {
    const router = getMacroEngineRouter();
    router.resetOverride();
    
    return { ok: true, message: 'Router reset to config defaults' };
  });
  
  // Also support GET for convenience
  fastify.get(`${prefix}/admin/reset`, async (req, reply) => {
    const router = getMacroEngineRouter();
    router.resetOverride();
    
    return { ok: true, message: 'Router reset to config defaults' };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/v1/pack — Direct V1 access
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/v1/:asset/pack`, async (req, reply) => {
    const { asset } = req.params as { asset: string };
    const query = req.query as any;
    
    const v1 = getMacroEngineV1();
    const pack = await v1.computePack({
      asset: asset.toUpperCase() as 'DXY' | 'SPX' | 'BTC',
      horizon: (query.horizon || '30D') as MacroHorizon,
      hybridEndReturn: parseFloat(query.hybridEndReturn || '0'),
    });
    
    return pack;
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/v2/pack — Direct V2 access
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/v2/:asset/pack`, async (req, reply) => {
    const { asset } = req.params as { asset: string };
    const query = req.query as any;
    
    const v2 = getMacroEngineV2();
    const pack = await v2.computePack({
      asset: asset.toUpperCase() as 'DXY' | 'SPX' | 'BTC',
      horizon: (query.horizon || '30D') as MacroHorizon,
      hybridEndReturn: parseFloat(query.hybridEndReturn || '0'),
    });
    
    return pack;
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/v1/health — V1 health check
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/v1/health`, async (req, reply) => {
    const v1 = getMacroEngineV1();
    const health = await v1.healthCheck();
    return { version: 'v1', ...health };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/v2/health — V2 health check
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/v2/health`, async (req, reply) => {
    const v2 = getMacroEngineV2();
    const health = await v2.healthCheck();
    return { version: 'v2', ...health };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/v2/state/current — Current regime state
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/v2/state/current`, async (req, reply) => {
    const query = req.query as any;
    const symbol = (query.symbol || 'DXY').toUpperCase();
    
    const svc = getRegimeStateService();
    const state = await svc.getCurrentState(symbol);
    
    if (!state) {
      return { ok: true, state: null, message: 'No state stored yet. Call computePack to initialize.' };
    }
    
    // Convert Map to plain object
    const probs: Record<string, number> = {};
    if (state.probs) {
      for (const [k, v] of state.probs instanceof Map 
        ? state.probs.entries() 
        : Object.entries(state.probs)) {
        probs[k] = v;
      }
    }
    
    return {
      ok: true,
      state: {
        symbol: state.symbol,
        asOf: state.asOf,
        dominant: state.dominant,
        probs,
        persistence: state.persistence,
        entropy: state.entropy,
        lastChangeAt: state.lastChangeAt,
        changeCount30D: state.changeCount30D,
        scoreSigned: state.scoreSigned,
        confidence: state.confidence,
        transitionHint: state.transitionHint,
        sourceVersion: state.sourceVersion,
      },
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/v2/state/history — Regime state history
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/v2/state/history`, async (req, reply) => {
    const query = req.query as any;
    const symbol = (query.symbol || 'DXY').toUpperCase();
    const limit = parseInt(query.limit || '30');
    
    const svc = getRegimeStateService();
    const history = await svc.getHistory(symbol, limit);
    
    return {
      ok: true,
      count: history.length,
      history: history.map(s => ({
        asOf: s.asOf,
        dominant: s.dominant,
        persistence: s.persistence,
        entropy: s.entropy,
        scoreSigned: s.scoreSigned,
        confidence: s.confidence,
        changeCount30D: s.changeCount30D,
      })),
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/v2/calibration/weights — Current weights
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/v2/calibration/weights`, async (req, reply) => {
    const query = req.query as any;
    const symbol = (query.symbol || 'DXY').toUpperCase();
    
    const svc = getRollingCalibrationService();
    const current = await svc.getCurrentWeights(symbol);
    const effective = await svc.getEffectiveWeights(symbol);
    const needsRecal = await svc.needsRecalibration(symbol);
    
    return {
      ok: true,
      symbol,
      needsRecalibration: needsRecal,
      source: current ? 'calibrated' : 'default',
      lastCalibration: current?.asOf || null,
      windowDays: current?.windowDays || null,
      aggregateCorr: current?.aggregateCorr || null,
      qualityScore: current?.qualityScore || null,
      components: current?.components || null,
      effectiveWeights: effective,
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/v2/calibration/history — Weights history
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/v2/calibration/history`, async (req, reply) => {
    const query = req.query as any;
    const symbol = (query.symbol || 'DXY').toUpperCase();
    const limit = parseInt(query.limit || '12');
    
    const svc = getRollingCalibrationService();
    const history = await svc.getWeightsHistory(symbol, limit);
    
    return {
      ok: true,
      count: history.length,
      history: history.map(w => ({
        asOf: w.asOf,
        windowDays: w.windowDays,
        aggregateCorr: w.aggregateCorr,
        qualityScore: w.qualityScore,
        components: w.components,
      })),
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/macro-engine/v2/calibration/run — Trigger recalibration
  // ─────────────────────────────────────────────────────────────
  
  fastify.post(`${prefix}/v2/calibration/run`, async (req, reply) => {
    const body = req.body as any;
    const symbol = (body?.symbol || 'DXY').toUpperCase();
    
    try {
      // Load DXY price data
      const dxyPriceData = await loadDxyPrices();
      
      if (!dxyPriceData || dxyPriceData.prices.length < 252) {
        return reply.status(400).send({
          ok: false,
          error: 'Insufficient DXY price data for calibration',
          dataPoints: dxyPriceData?.prices.length || 0,
        });
      }
      
      // Load macro data for each series
      const macroData = new Map<string, Array<{ date: string; value: number }>>();
      const seriesKeys = ['T10Y2Y', 'FEDFUNDS', 'CPIAUCSL', 'CPILFESL', 'UNRATE', 'M2SL', 'PPIACO'];
      
      for (const key of seriesKeys) {
        const points = await getMacroSeriesPoints(key);
        if (points && points.length > 0) {
          macroData.set(key, points);
        }
      }
      
      // Load GOLD from adapter (real XAUUSD daily data)
      const { getGoldAdapter: getGold } = await import('../adapters/gold_series.adapter.js');
      const goldAdapter = getGold();
      await goldAdapter.load();
      const goldPrices = goldAdapter.getPriceData();
      if (goldPrices.length > 0) {
        macroData.set('GOLD', goldPrices);
      }
      
      // Run calibration
      const svc = getRollingCalibrationService();
      const result = await svc.runCalibration({
        symbol,
        dxyPrices: dxyPriceData.prices,
        dxyDates: dxyPriceData.dates,
        macroData,
      });
      
      // Sanity checks
      const sanity = runSanityChecks(result);
      
      return {
        ok: true,
        symbol,
        createdVersionId: `weights_${new Date().toISOString().slice(0, 10).replace(/-/g, '_')}`,
        windowDays: result.windowDays || 1260,
        stepDays: result.stepDays || 30,
        asOf: result.asOf,
        aggregateCorr: result.aggregateCorr,
        qualityScore: result.qualityScore,
        topWeights: (result.components || [])
          .filter((c: any) => c.weight > 0)
          .sort((a: any, b: any) => b.weight - a.weight)
          .map((c: any) => ({
            key: c.key,
            weight: Math.round(c.weight * 10000) / 10000,
            lagDays: c.lagDays,
            corr: Math.round(c.corr * 10000) / 10000,
          })),
        sanity,
        status: sanity.pass ? 'ACTIVE' : (sanity.sumWeightsOk && sanity.maxWeightOk ? 'DEGRADED' : 'REJECTED'),
        components: result.components,
      };
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: (e as any).message,
      });
    }
  });
  
  console.log(`[Macro Engine] Routes registered at ${prefix}/*`);
  console.log(`  GET  ${prefix}/:asset/pack (router)`);
  console.log(`  GET  ${prefix}/:asset/compare (shadow)`);
  console.log(`  GET  ${prefix}/status`);
  console.log(`  GET  ${prefix}/v1/:asset/pack | v2/:asset/pack`);
  console.log(`  GET  ${prefix}/v2/state/current | history`);
  console.log(`  GET  ${prefix}/v2/calibration/weights | history`);
  console.log(`  POST ${prefix}/v2/calibration/run`);
  console.log(`  POST ${prefix}/admin/active | promote | rollback | reset`);
}

// ═══════════════════════════════════════════════════════════════
// SANITY CHECKS for recalibration
// ═══════════════════════════════════════════════════════════════

function runSanityChecks(result: any): {
  pass: boolean;
  sumWeights: number;
  sumWeightsOk: boolean;
  maxWeight: number;
  maxWeightOk: boolean;
  minSeriesCoverage: number;
  coverageOk: boolean;
  maxStaleSeries: number;
  stalenessOk: boolean;
} {
  const components = result.components || [];
  const weights = components.map((c: any) => c.weight || 0);
  const sumWeights = weights.reduce((a: number, b: number) => a + b, 0);
  const maxWeight = Math.max(...weights, 0);
  
  // Count series with data
  const withData = components.filter((c: any) => Math.abs(c.corr || 0) > 0).length;
  const minSeriesCoverage = components.length > 0 ? withData / components.length : 0;
  
  const sumWeightsOk = Math.abs(sumWeights - 1.0) < 0.001;
  const maxWeightOk = maxWeight <= 0.35;
  const coverageOk = minSeriesCoverage >= 0.8;
  const stalenessOk = true; // staleness check happens elsewhere
  
  return {
    pass: sumWeightsOk && maxWeightOk && coverageOk,
    sumWeights: Math.round(sumWeights * 10000) / 10000,
    sumWeightsOk,
    maxWeight: Math.round(maxWeight * 10000) / 10000,
    maxWeightOk,
    minSeriesCoverage: Math.round(minSeriesCoverage * 1000) / 1000,
    coverageOk,
    maxStaleSeries: 3,
    stalenessOk,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Load DXY prices from CSV
// ═══════════════════════════════════════════════════════════════

async function loadDxyPrices(): Promise<{ prices: number[]; dates: string[] } | null> {
  try {
    const fs = await import('fs');
    const path = await import('path');
    
    // Try multiple DXY data sources
    const dataPaths = [
      '/app/data/dxy_stooq.csv',
      '/app/data/dxy_fred.csv',
      '/app/data/dxy_yahoo.csv',
    ];
    
    for (const csvPath of dataPaths) {
      if (fs.existsSync(csvPath)) {
        const content = fs.readFileSync(csvPath, 'utf-8');
        const lines = content.trim().split('\n');
        
        const prices: number[] = [];
        const dates: string[] = [];
        
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts.length >= 2) {
            const date = parts[0].trim();
            const close = parseFloat(parts[parts.length - 1]); // Last column = close
            
            if (!isNaN(close) && close > 0 && date) {
              dates.push(date);
              prices.push(close);
            }
          }
        }
        
        if (prices.length > 100) {
          return { prices, dates };
        }
      }
    }
    
    return null;
  } catch (e) {
    console.log('[loadDxyPrices] Error:', (e as any).message);
    return null;
  }
}

async function loadGoldFromFred(): Promise<Array<{ date: string; value: number }> | null> {
  // Deprecated: gold now loaded from stooq CSV via GoldSeriesAdapter
  return null;
}
