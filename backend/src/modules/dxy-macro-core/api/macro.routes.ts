/**
 * MACRO API ROUTES — B1
 * 
 * API endpoints for macro data platform.
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  ingestAllMacroSeries,
  ingestMacroSeries,
  getAllSeriesMeta,
  getMacroSeriesPoints,
} from '../ingest/macro.ingest.service.js';
import { buildMacroContext, buildAllMacroContexts } from '../services/macro_context.service.js';
import { computeMacroScore, computeMacroScoreAsOf } from '../services/macro_score.service.js';
import { buildHousingContext } from '../services/housing_context.service.js';
import { buildActivityContext } from '../services/activity_context.service.js';
import { buildCreditContext } from '../services/credit_context.service.js';
import { validateStability, validateEpisodes } from '../services/macro_stability_validation.service.js';
import { getDefaultMacroSeries, MACRO_SERIES_REGISTRY } from '../data/macro_sources.registry.js';
import { checkFredHealth, hasFredApiKey } from '../ingest/fred.client.js';
import { analyzeComponentCorrelations, DEFAULT_OPTIMIZED_WEIGHTS, pearsonCorrelation } from '../services/macro_decomposition.service.js';
import { getMacroSeriesPoints } from '../ingest/macro.ingest.service.js';

// P3: Import lag profiles
import { getAllLagProfiles } from '../../macro-asof/asof.service.js';

// ═══════════════════════════════════════════════════════════════
// REGISTER ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerMacroRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/dxy-macro-core';
  
  // ─────────────────────────────────────────────────────────────
  // Health check
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/health`, async (req, reply) => {
    const fredHealth = await checkFredHealth();
    const seriesMeta = await getAllSeriesMeta();
    
    return {
      ok: true,
      module: 'dxy-macro-core',
      version: 'B4.3',  // Updated for credit
      fred: {
        ...fredHealth,
        hasApiKey: hasFredApiKey(),
        keyHelp: 'Get free key at https://fred.stlouisfed.org/docs/api/api_key.html',
      },
      seriesLoaded: seriesMeta.length,
      defaultSeries: getDefaultMacroSeries().length,
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /series — List all available series
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/series`, async (req, reply) => {
    const metas = await getAllSeriesMeta();
    const registry = MACRO_SERIES_REGISTRY;
    
    // Combine registry info with loaded data info
    const series = registry.map(spec => {
      const meta = metas.find(m => m.seriesId === spec.seriesId);
      return {
        seriesId: spec.seriesId,
        displayName: spec.displayName,
        frequency: spec.frequency,
        role: spec.role,
        units: spec.units,
        enabledByDefault: spec.enabledByDefault,
        loaded: !!meta,
        pointCount: meta?.pointCount ?? 0,
        firstDate: meta?.firstDate ?? null,
        lastDate: meta?.lastDate ?? null,
        coverageYears: meta?.coverageYears ?? 0,
      };
    });
    
    return {
      ok: true,
      total: registry.length,
      enabled: registry.filter(s => s.enabledByDefault).length,
      loaded: metas.length,
      series,
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /context — Get context for a single series
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/context`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { seriesId?: string };
    const seriesId = query.seriesId;
    
    if (!seriesId) {
      // Return all contexts
      const contexts = await buildAllMacroContexts();
      return {
        ok: true,
        count: contexts.length,
        contexts,
      };
    }
    
    // Single series context
    const context = await buildMacroContext(seriesId);
    
    if (!context) {
      return reply.code(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: `Series ${seriesId} not found or insufficient data`,
      });
    }
    
    return {
      ok: true,
      context,
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /score — Get composite macro score
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/score`, async (
    req: FastifyRequest<{ Querystring: { asOf?: string } }>,
    reply: FastifyReply
  ) => {
    const { asOf } = req.query;
    
    if (asOf) {
      // P3: As-of mode
      const score = await computeMacroScoreAsOf(asOf);
      return { ok: true, score, mode: 'as-of' };
    }
    
    const score = await computeMacroScore();
    return { ok: true, score, mode: 'current' };
  });
  
  // ─────────────────────────────────────────────────────────────
  // P4.1: GET /score/evidence — Get macro score with full explainability
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/score/evidence`, async (
    req: FastifyRequest<{ Querystring: { asOf?: string } }>,
    reply: FastifyReply
  ) => {
    const { asOf } = req.query;
    const { buildMacroEvidence } = await import('../../evidence-engine/macro_evidence.builder.js');
    
    const score = asOf 
      ? await computeMacroScoreAsOf(asOf)
      : await computeMacroScore();
    
    const evidence = buildMacroEvidence(score);
    
    return { 
      ok: true, 
      score, 
      evidence,
      mode: asOf ? 'as-of' : 'current',
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // P3: GET /lag-profiles — List publication lag profiles
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/lag-profiles`, async (req, reply) => {
    const profiles = getAllLagProfiles();
    return {
      ok: true,
      count: profiles.length,
      profiles,
      note: 'Publication lag in days for each series. Used for honest backtesting.',
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /housing — Get housing context (B4.1)
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/housing`, async (req, reply) => {
    const housing = await buildHousingContext();
    
    return {
      ok: true,
      housing,
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /activity — Get economic activity context (B4.2)
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/activity`, async (req, reply) => {
    const activity = await buildActivityContext();
    
    return {
      ok: true,
      activity,
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /credit — Get credit & financial stress context (B4.3)
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/credit`, async (req, reply) => {
    const credit = await buildCreditContext();
    
    return {
      ok: true,
      credit,
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /history — Get historical data for a series
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/history`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { seriesId?: string; from?: string; to?: string };
    const { seriesId, from, to } = query;
    
    if (!seriesId) {
      return reply.code(400).send({
        ok: false,
        error: 'MISSING_PARAM',
        message: 'seriesId is required',
      });
    }
    
    const points = await getMacroSeriesPoints(seriesId, from, to);
    
    return {
      ok: true,
      seriesId,
      count: points.length,
      from: points[0]?.date ?? null,
      to: points[points.length - 1]?.date ?? null,
      points,
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /admin/ingest — Ingest macro data from FRED
  // ─────────────────────────────────────────────────────────────
  
  fastify.post(`${prefix}/admin/ingest`, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { series?: string[] } | undefined;
    const seriesIds = body?.series;
    
    console.log(`[Macro API] Ingest request: ${seriesIds?.length ? seriesIds.join(', ') : 'all default'}`);
    
    const result = await ingestAllMacroSeries(seriesIds);
    
    return result;
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /admin/ingest/:seriesId — Ingest single series
  // ─────────────────────────────────────────────────────────────
  
  fastify.post(`${prefix}/admin/ingest/:seriesId`, async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { seriesId: string };
    const { seriesId } = params;
    
    console.log(`[Macro API] Single ingest: ${seriesId}`);
    
    const result = await ingestMacroSeries(seriesId);
    
    return result;
  });
  
  // ─────────────────────────────────────────────────────────────
  // B5.1: GET /validate/stability — Stability validation
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/validate/stability`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as {
      from?: string;
      to?: string;
      step?: string;
      smooth?: string;
      span?: string;
    };
    
    const params = {
      from: query.from || '2000-01-01',
      to: query.to || '2025-12-31',
      stepDays: query.step ? parseInt(query.step) : 7,
      smooth: (query.smooth === 'ema' ? 'ema' : 'none') as 'ema' | 'none',
      span: query.span ? parseInt(query.span) : 14,
    };
    
    console.log(`[Macro B5.1] Stability validation: ${params.from} to ${params.to}, step=${params.stepDays}`);
    
    const report = await validateStability(params);
    
    return report;
  });
  
  // ─────────────────────────────────────────────────────────────
  // B5.2: GET /validate/episodes — Episode validation
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/validate/episodes`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as {
      smooth?: string;
      span?: string;
    };
    
    const smooth = query.smooth === 'ema' ? 'ema' : 'none';
    const span = query.span ? parseInt(query.span) : 14;
    
    console.log(`[Macro B5.2] Episode validation: smooth=${smooth}, span=${span}`);
    
    const report = await validateEpisodes(smooth as 'ema' | 'none', span);
    
    return report;
  });
  
  console.log(`[Macro] Routes registered at ${prefix}/* (B5 Validation)`);
  
  // ─────────────────────────────────────────────────────────────
  // DECOMPOSITION: GET /decomposition — Component correlation analysis
  // Roadmap tasks: Декомпозиция, корреляции, веса, шум, лаг
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/decomposition`, async (req, reply) => {
    // Return current optimized weights and component info
    const contexts = await buildAllMacroContexts();
    
    const components = contexts.map(ctx => ({
      seriesId: ctx.seriesId,
      displayName: ctx.displayName,
      role: ctx.role,
      regime: ctx.regime,
      pressure: ctx.pressure,
      optimizedWeight: DEFAULT_OPTIMIZED_WEIGHTS[ctx.seriesId] ?? 0.05,
    }));
    
    // Sort by weight descending
    components.sort((a, b) => b.optimizedWeight - a.optimizedWeight);
    
    return {
      ok: true,
      note: 'Component decomposition with correlation-optimized weights',
      totalComponents: components.length,
      components,
      weightingMethod: 'weight_i ∝ |corr(component_i, DXY_forward)|',
      noiseThreshold: 0.03,
      lagAnalysis: {
        testedLags: [10, 30, 60, 120],
        note: 'Optimal lag selected per component based on max |corr|',
      },
      defaultWeights: DEFAULT_OPTIMIZED_WEIGHTS,
    };
  });
  
  // NOTE: /guard/current is registered in guard_hysteresis.routes.ts
  
  // ─────────────────────────────────────────────────────────────
  // CORRELATION ANALYSIS: GET /correlation-analysis
  // Run actual correlation analysis with DXY forward returns
  // ─────────────────────────────────────────────────────────────
  
  fastify.get(`${prefix}/correlation-analysis`, async (req, reply) => {
    const horizonDays = parseInt((req.query as any)?.horizon || '30');
    
    // Get DXY prices
    const { getAllDxyCandles } = await import('../../dxy/services/dxy-chart.service.js');
    const dxyCandles = await getAllDxyCandles();
    
    if (dxyCandles.length < 200) {
      return { ok: false, error: 'Not enough DXY data for correlation analysis' };
    }
    
    // Compute DXY forward returns
    const dxyPrices = dxyCandles.map(c => c.close);
    const dxyDates = dxyCandles.map(c => c.date);
    
    // Forward returns at different lags
    const computeForwardReturns = (prices: number[], lag: number) => {
      const rets: number[] = [];
      for (let i = 0; i < prices.length - lag; i++) {
        rets.push((prices[i + lag] - prices[i]) / prices[i]);
      }
      return rets;
    };
    
    const dxyFwd10 = computeForwardReturns(dxyPrices, 10);
    const dxyFwd30 = computeForwardReturns(dxyPrices, 30);
    const dxyFwd60 = computeForwardReturns(dxyPrices, 60);
    const dxyFwd120 = computeForwardReturns(dxyPrices, 120);
    
    // Get macro series data
    const seriesIds = ['FEDFUNDS', 'CPIAUCSL', 'CPILFESL', 'UNRATE', 'M2SL', 'T10Y2Y', 'PPIACO'];
    const correlations: any[] = [];
    
    for (const seriesId of seriesIds) {
      const points = await getMacroSeriesPoints(seriesId);
      if (points.length < 100) continue;
      
      // Align macro data with DXY dates
      const macroMap = new Map(points.map(p => [p.date, p.value]));
      const alignedMacro: number[] = [];
      
      for (const date of dxyDates.slice(0, dxyFwd30.length)) {
        // Find closest macro date (monthly to daily alignment)
        const macroDate = date.slice(0, 7) + '-01'; // Convert to monthly
        let val = macroMap.get(macroDate);
        if (!val) {
          // Try exact date or closest
          val = macroMap.get(date) || 0;
        }
        alignedMacro.push(val || 0);
      }
      
      if (alignedMacro.filter(v => v !== 0).length < 50) continue;
      
      // Calculate correlations at different lags
      const corr10 = pearsonCorrelation(alignedMacro.slice(0, dxyFwd10.length), dxyFwd10);
      const corr30 = pearsonCorrelation(alignedMacro.slice(0, dxyFwd30.length), dxyFwd30);
      const corr60 = pearsonCorrelation(alignedMacro.slice(0, dxyFwd60.length), dxyFwd60);
      const corr120 = pearsonCorrelation(alignedMacro.slice(0, dxyFwd120.length), dxyFwd120);
      
      // Find optimal lag
      const absCorrs = { lag10: Math.abs(corr10), lag30: Math.abs(corr30), lag60: Math.abs(corr60), lag120: Math.abs(corr120) };
      const maxLag = Object.entries(absCorrs).sort((a, b) => b[1] - a[1])[0];
      const optimalLag = parseInt(maxLag[0].replace('lag', ''));
      const optimalCorr = maxLag[0] === 'lag10' ? corr10 : maxLag[0] === 'lag30' ? corr30 : maxLag[0] === 'lag60' ? corr60 : corr120;
      
      const isNoise = Math.abs(optimalCorr) < 0.03;
      
      correlations.push({
        seriesId,
        displayName: MACRO_SERIES_REGISTRY.find(s => s.seriesId === seriesId)?.displayName || seriesId,
        correlations: {
          lag10: Math.round(corr10 * 10000) / 10000,
          lag30: Math.round(corr30 * 10000) / 10000,
          lag60: Math.round(corr60 * 10000) / 10000,
          lag120: Math.round(corr120 * 10000) / 10000,
        },
        optimalLag,
        optimalCorrelation: Math.round(optimalCorr * 10000) / 10000,
        absCorrelation: Math.round(Math.abs(optimalCorr) * 10000) / 10000,
        isNoise,
        recommendation: isNoise ? 'EXCLUDE (noise)' : Math.abs(optimalCorr) > 0.1 ? 'STRONG SIGNAL' : 'WEAK SIGNAL',
      });
    }
    
    // Sort by |corr| descending
    correlations.sort((a, b) => b.absCorrelation - a.absCorrelation);
    
    // Calculate optimized weights
    const nonNoise = correlations.filter(c => !c.isNoise);
    const totalAbsCorr = nonNoise.reduce((sum, c) => sum + c.absCorrelation, 0);
    
    const optimizedWeights: Record<string, number> = {};
    for (const c of correlations) {
      if (c.isNoise) {
        optimizedWeights[c.seriesId] = 0;
      } else {
        optimizedWeights[c.seriesId] = totalAbsCorr > 0 
          ? Math.round((c.absCorrelation / totalAbsCorr) * 10000) / 10000 
          : 0;
      }
    }
    
    return {
      ok: true,
      meta: {
        dxyDataPoints: dxyCandles.length,
        analysisHorizon: horizonDays,
        lagsAnalyzed: [10, 30, 60, 120],
        noiseThreshold: 0.03,
      },
      correlations,
      optimizedWeights,
      summary: {
        strongSignals: correlations.filter(c => c.recommendation === 'STRONG SIGNAL').map(c => c.seriesId),
        weakSignals: correlations.filter(c => c.recommendation === 'WEAK SIGNAL').map(c => c.seriesId),
        excludedNoise: correlations.filter(c => c.isNoise).map(c => c.seriesId),
      },
    };
  });
}
