/**
 * DXY FRACTAL ROUTES — Main Terminal API
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 * 
 * A3.8: Horizon-specific defaults + mode + configUsed
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { buildDxyFocusPack, buildDxySyntheticPack, buildDxyHybridPack } from '../services/dxy-focus-pack.service.js';
import { getDxyLatestPrice, getAllDxyCandles } from '../services/dxy-chart.service.js';
import { checkDxyIntegrity } from '../services/dxy-ingest.service.js';
import { DXY_HORIZONS, DXY_SCAN_CONFIG, type DxyHorizon } from '../contracts/dxy.types.js';
import { normalizeWindow } from '../services/dxy-normalize.service.js';
import { cosineSimilarity } from '../services/dxy-similarity.service.js';
import {
  resolveDxyConfig,
  getDxyMode,
  isDxyTradingEnabled,
  getDxyWarnings,
  type DxyFocus,
  type DxyCoreConfig,
} from '../config/dxy.defaults.js';

// ═══════════════════════════════════════════════════════════════
// REGISTER ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerDxyFractalRoutes(fastify: FastifyInstance) {
  const prefix = '/api/fractal';
  
  /**
   * GET /api/fractal/dxy
   * 
   * Main DXY Fractal Terminal endpoint
   * Returns complete analysis for given horizon
   * 
   * A3.8: Includes mode, tradingEnabled, configUsed, warnings
   */
  fastify.get(`${prefix}/dxy`, async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const query = req.query as { focus?: string; horizon?: string };
    const horizon = (query.focus || query.horizon || '30d') as DxyFocus;
    
    try {
      // Check data availability
      const integrity = await checkDxyIntegrity();
      if (!integrity.ok) {
        return reply.code(503).send({
          ok: false,
          error: 'INSUFFICIENT_DATA',
          message: integrity.warning,
          hint: 'Run POST /api/fractal/v2.1/admin/dxy/ingest to load data',
        });
      }
      
      // A3.8: Resolve config for this horizon
      const config = resolveDxyConfig(horizon);
      const mode = getDxyMode(horizon);
      const tradingEnabled = isDxyTradingEnabled(horizon);
      const warnings = getDxyWarnings(horizon);
      
      // Get current price
      const latest = await getDxyLatestPrice();
      
      // Build focus pack (contains matches, replay, bands)
      const focusPack = await buildDxyFocusPack(horizon);
      
      if (!focusPack) {
        return reply.code(500).send({
          ok: false,
          error: 'Failed to build focus pack',
        });
      }
      
      // Build synthetic forecast
      const synthetic = await buildDxySyntheticPack(horizon);
      
      // A3.8: Compute decision with tradingEnabled check
      let action = synthetic.forecast.base >= 0 ? 'LONG' : 'SHORT';
      let size = 1;
      const decisionReasons: string[] = [];
      
      if (!tradingEnabled) {
        // Regime horizon: trading disabled
        action = 'HOLD';
        size = 0;
        decisionReasons.push('Regime horizon: trading disabled');
        decisionReasons.push(`Use as bias filter: ${synthetic.forecast.base >= 0 ? 'USD_STRENGTHENING' : 'USD_WEAKENING'}`);
      } else {
        decisionReasons.push(`${horizon} tactical signal`);
      }
      
      return {
        ok: true,
        symbol: 'DXY',
        focus: horizon,
        processingTimeMs: Date.now() - start,
        data: {
          contract: {
            version: 'DXY_V1.1.0', // Bumped for A3.8
            asOf: new Date().toISOString().split('T')[0],
          },
          currentPrice: latest?.price || 100,
          change24h: latest?.change24h || 0,
          synthetic: {
            baseReturn: synthetic.forecast.base,
            bearReturn: synthetic.forecast.bear,
            bullReturn: synthetic.forecast.bull,
          },
          matches: focusPack.matches,
          replay: focusPack.replay,
          path: focusPack.path,
          bands: focusPack.bands,
          diagnostics: focusPack.diagnostics,
          decision: {
            action,
            size,
            confidence: Math.round(focusPack.diagnostics.similarity * 100),
            entropy: focusPack.diagnostics.entropy,
            reasons: decisionReasons,
            // A3.8: Regime bias (always present for context)
            regimeBias: synthetic.forecast.base >= 0 ? 'USD_STRENGTHENING' : 'USD_WEAKENING',
          },
        },
        // A3.8: New meta fields
        meta: {
          mode,
          tradingEnabled,
          configUsed: config,
          warnings,
        },
      };
      
    } catch (error: any) {
      console.error('[DXY] Fractal error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/fractal/dxy/replay
   * 
   * A2: Replay Engine Pro
   * Returns DxyReplayPack with window/continuation paths mapped to current price space
   * 
   * Query params:
   *   focus: '7d' | '14d' | '30d' | '60d' | '90d' | '180d' | '365d' (default: '30d')
   *   rank: 1..10 (default: 1, top match)
   *   windowLen: number (default: 120)
   */
  fastify.get(`${prefix}/dxy/replay`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { focus?: string; rank?: string; windowLen?: string };
    const focus = query.focus || '30d';
    const rank = parseInt(query.rank || '1');
    const windowLen = parseInt(query.windowLen || '120');
    
    try {
      const { buildDxyReplayPack } = await import('../services/dxy-replay.service.js');
      const replayPack = await buildDxyReplayPack(focus, rank, windowLen);
      
      return replayPack;
      
    } catch (error: any) {
      console.error('[DXY Replay] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/fractal/dxy/replay/matches
   * 
   * A2: List top matches without full replay data
   * Useful for UI to show match selector
   */
  fastify.get(`${prefix}/dxy/replay/matches`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { focus?: string; topK?: string; windowLen?: string };
    const focus = query.focus || '30d';
    const topK = parseInt(query.topK || '10');
    const windowLen = parseInt(query.windowLen || '120');
    
    try {
      const { getDxyTopMatches } = await import('../services/dxy-replay.service.js');
      const result = await getDxyTopMatches(focus, topK, windowLen);
      
      return result;
      
    } catch (error: any) {
      console.error('[DXY Replay Matches] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/fractal/dxy/hybrid
   * 
   * Get hybrid (model + replay weighted) forecast
   */
  fastify.get(`${prefix}/dxy/hybrid`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { horizon?: string; weight?: string };
    const horizon = query.horizon || '30d';
    const weight = parseFloat(query.weight || '0.5');
    
    try {
      const hybrid = await buildDxyHybridPack(horizon, weight);
      
      return {
        ok: true,
        symbol: 'DXY',
        ...hybrid,
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/fractal/dxy/horizons
   * 
   * Get available horizons
   */
  fastify.get(`${prefix}/dxy/horizons`, async (req: FastifyRequest, reply: FastifyReply) => {
    return {
      ok: true,
      horizons: DXY_HORIZONS,
      default: '30d',
    };
  });
  
  /**
   * GET /api/fractal/dxy/debug-similarity
   * 
   * DXY-VALIDATION-1: Debug endpoint for similarity distribution analysis
   * 
   * Returns:
   * - similarityDistribution (min, p25, median, mean, p75, p90, p95, p99, max, stdDev)
   * - entropy metrics (simple, stdDev, topMatch)
   * - decadeDistribution (matches by decade)
   * - warnings and verdict
   * 
   * Expected ranges for DXY:
   *   - avgSimilarity: 0.85–0.92
   *   - entropy: 0.05–0.15
   *   - topSimilarity: 0.90–0.96
   */
  fastify.get(`${prefix}/dxy/debug-similarity`, async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const query = req.query as { windowLen?: string; threshold?: string };
    const windowLen = parseInt(query.windowLen || String(DXY_SCAN_CONFIG.windowLength));
    const threshold = parseFloat(query.threshold || '0.0');
    
    try {
      const candles = await getAllDxyCandles();
      
      if (!candles || candles.length < windowLen * 2) {
        return reply.code(400).send({
          ok: false,
          error: 'INSUFFICIENT_DATA',
          message: `Need at least ${windowLen * 2} candles, have ${candles?.length || 0}`,
        });
      }
      
      const closes = candles.map(c => c.close);
      
      // Current window (last N candles)
      const currentWindow = closes.slice(-windowLen);
      const normalizedCurrent = normalizeWindow(currentWindow);
      
      if (normalizedCurrent.length === 0) {
        return { ok: false, error: 'Failed to normalize current window' };
      }
      
      // Window variance
      const windowMean = normalizedCurrent.reduce((a, b) => a + b, 0) / normalizedCurrent.length;
      const windowVariance = normalizedCurrent.reduce((sum, v) => sum + (v - windowMean) ** 2, 0) / normalizedCurrent.length;
      
      // Collect ALL similarity scores
      const similarities: number[] = [];
      const maxStart = closes.length - windowLen * 2;
      
      for (let i = 0; i < maxStart; i++) {
        const histWindow = closes.slice(i, i + windowLen);
        const normalizedHist = normalizeWindow(histWindow);
        
        if (normalizedHist.length === 0) continue;
        
        const sim = cosineSimilarity(normalizedCurrent, normalizedHist);
        if (sim >= threshold) {
          similarities.push(sim);
        }
      }
      
      if (similarities.length === 0) {
        return { ok: false, error: 'No similarities found' };
      }
      
      similarities.sort((a, b) => a - b);
      
      const n = similarities.length;
      const min = similarities[0];
      const max = similarities[n - 1];
      const mean = similarities.reduce((a, b) => a + b, 0) / n;
      
      const median = n % 2 === 0 
        ? (similarities[n / 2 - 1] + similarities[n / 2]) / 2
        : similarities[Math.floor(n / 2)];
      
      const p25 = similarities[Math.floor(n * 0.25)];
      const p75 = similarities[Math.floor(n * 0.75)];
      const p90 = similarities[Math.floor(n * 0.90)];
      const p95 = similarities[Math.floor(n * 0.95)];
      const p99 = similarities[Math.floor(n * 0.99)];
      
      const variance = similarities.reduce((sum, s) => sum + (s - mean) ** 2, 0) / n;
      const stdDev = Math.sqrt(variance);
      
      // Entropy calculations
      const entropySimple = 1 - mean;
      const entropyStdDev = stdDev;
      const entropyTopMatch = 1 - max;
      
      // Top 10 matches
      const top10 = similarities.slice(-10).reverse();
      
      // Decade distribution (high similarity matches)
      const decadeMatches: { [key: string]: number } = {};
      for (let i = 0; i < maxStart; i++) {
        const histWindow = closes.slice(i, i + windowLen);
        const normalizedHist = normalizeWindow(histWindow);
        if (normalizedHist.length === 0) continue;
        
        const sim = cosineSimilarity(normalizedCurrent, normalizedHist);
        if (sim >= 0.9) {
          const date = candles[i].date;
          const year = parseInt(date.substring(0, 4));
          const decade = Math.floor(year / 10) * 10;
          decadeMatches[decade + 's'] = (decadeMatches[decade + 's'] || 0) + 1;
        }
      }
      
      // Warnings
      const warnings: string[] = [];
      if (median > 0.93) warnings.push('WARNING: median > 0.93 - model may be too lenient');
      if (p90 > 0.97) warnings.push('WARNING: p90 > 0.97 - filter too soft');
      if (windowVariance < 0.001) warnings.push('WARNING: low window variance - cosine will be high');
      if (entropySimple < 0.05) warnings.push('WARNING: entropy < 0.05 - suspiciously low');
      
      // Expected ranges
      const expected = {
        avgSimilarity: { min: 0.85, max: 0.92 },
        entropy: { min: 0.05, max: 0.15 },
        topSimilarity: { min: 0.90, max: 0.96 },
      };
      
      const inRange = {
        avgSimilarity: mean >= expected.avgSimilarity.min && mean <= expected.avgSimilarity.max,
        entropy: entropySimple >= expected.entropy.min && entropySimple <= expected.entropy.max,
        topSimilarity: max >= expected.topSimilarity.min && max <= expected.topSimilarity.max,
      };
      
      return {
        ok: true,
        processingTimeMs: Date.now() - start,
        config: {
          windowLength: windowLen,
          threshold,
          totalCandles: candles.length,
          totalWindowsScanned: maxStart,
        },
        currentWindow: {
          startDate: candles[candles.length - windowLen].date,
          endDate: candles[candles.length - 1].date,
          variance: Math.round(windowVariance * 10000) / 10000,
        },
        similarityDistribution: {
          count: n,
          min: Math.round(min * 10000) / 10000,
          p25: Math.round(p25 * 10000) / 10000,
          median: Math.round(median * 10000) / 10000,
          mean: Math.round(mean * 10000) / 10000,
          p75: Math.round(p75 * 10000) / 10000,
          p90: Math.round(p90 * 10000) / 10000,
          p95: Math.round(p95 * 10000) / 10000,
          p99: Math.round(p99 * 10000) / 10000,
          max: Math.round(max * 10000) / 10000,
          stdDev: Math.round(stdDev * 10000) / 10000,
          variance: Math.round(variance * 10000) / 10000,
        },
        entropy: {
          simple: Math.round(entropySimple * 10000) / 10000,
          stdDev: Math.round(entropyStdDev * 10000) / 10000,
          topMatch: Math.round(entropyTopMatch * 10000) / 10000,
          recommended: Math.round(entropyStdDev * 10000) / 10000,
        },
        top10Matches: top10.map(s => Math.round(s * 10000) / 10000),
        decadeDistribution: decadeMatches,
        expected,
        inRange,
        warnings,
        verdict: warnings.length === 0 ? 'OK' : 'NEEDS_ATTENTION',
      };
      
    } catch (error: any) {
      console.error('[DXY] Debug similarity error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // A1: GET /api/fractal/dxy/audit — Core Audit Pack
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/fractal/dxy/audit', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const query = req.query as { focus?: string; window?: string; topK?: string };
    
    const focus = query.focus || '30d';
    const windowSize = query.window ? parseInt(query.window) : 120;
    const topK = query.topK ? parseInt(query.topK) : 5;
    
    try {
      const { runDxyAudit } = await import('../services/dxy-audit.service.js');
      const result = await runDxyAudit(focus, windowSize, topK);
      
      return {
        ok: true,
        ...result,
        processingTimeMs: Date.now() - start,
      };
      
    } catch (error: any) {
      console.error('[DXY Audit] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // A3: GET /api/fractal/dxy/synthetic — Synthetic Bands + Hybrid
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Returns:
   * - synthetic: PathPoint[] (p50 median trajectory)
   * - bands: { p10, p50, p90 } as PathPoint[]
   * - hybrid: PathPoint[] (blend of synthetic + replay)
   * - pct: raw percentile distributions (decimal returns)
   * - weights: { similarity, entropy, replayWeight, topK, rank }
   */
  fastify.get(`${prefix}/dxy/synthetic`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { focus?: string; topK?: string; rank?: string; windowLen?: string };
    const focus = query.focus || '30d';
    const topK = parseInt(query.topK || '5');
    const rank = parseInt(query.rank || '1');
    const windowLen = parseInt(query.windowLen || '120');
    
    try {
      const { buildDxySyntheticPack } = await import('../services/dxy-synthetic.service.js');
      const pack = await buildDxySyntheticPack(focus, topK, rank, windowLen);
      
      return pack;
      
    } catch (error: any) {
      console.error('[DXY Synthetic] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  console.log('[DXY] Fractal routes registered at /api/fractal/dxy/*');
}

export default registerDxyFractalRoutes;
