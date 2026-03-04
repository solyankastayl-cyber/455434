/**
 * PHASE 1.4 — Backfill & History Routes
 * =======================================
 * 
 * API endpoints for backfill and truth evaluation.
 * 
 * ENDPOINTS:
 *   POST /api/v10/market/backfill/start        - Start backfill job
 *   GET  /api/v10/market/backfill/status/:id   - Get backfill status
 *   GET  /api/v10/market/backfill/runs         - Get recent runs
 *   GET  /api/v10/market/history/:symbol       - Get price history
 *   POST /api/v10/market/truth/evaluate        - Evaluate verdicts
 *   GET  /api/v10/market/truth/:symbol         - Get truth records
 *   GET  /api/v10/market/truth/stats/:symbol   - Get truth statistics
 */

import { FastifyInstance } from 'fastify';
import { createBackfillRun, getBackfillRun, getBackfillRuns } from './backfill.job.js';
import { getPriceBars, countPriceBars, getTimeframeMs } from '../history/priceHistory.service.js';
import { getTruthRecords, getTruthStats, evaluateVerdicts } from '../history/truthEvaluator.service.js';
import { Timeframe } from '../history/history.types.js';
import { generateMockVerdictHistory } from '../chart/verdict-history.service.js';

export async function backfillRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // BACKFILL ENDPOINTS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /backfill/start - Start backfill job
   */
  fastify.post<{
    Body: {
      symbol: string;
      tf?: string;
      days?: number;
    };
  }>('/backfill/start', async (request, reply) => {
    const { symbol, tf = '1h', days = 7 } = request.body;
    
    if (!symbol) {
      reply.code(400);
      return { ok: false, error: 'Symbol is required' };
    }
    
    const run = await createBackfillRun({
      symbol: symbol.toUpperCase(),
      tf: tf as Timeframe,
      days: Math.min(days, 90), // Max 90 days
    });
    
    return {
      ok: true,
      runId: run.runId,
      symbol: run.symbol,
      tf: run.tf,
      days: run.days,
      status: run.status,
    };
  });
  
  /**
   * GET /backfill/status/:runId - Get backfill status
   */
  fastify.get<{
    Params: { runId: string };
  }>('/backfill/status/:runId', async (request, reply) => {
    const { runId } = request.params;
    
    const run = await getBackfillRun(runId);
    
    if (!run) {
      reply.code(404);
      return { ok: false, error: 'Run not found' };
    }
    
    return { ok: true, run };
  });
  
  /**
   * GET /backfill/runs - Get recent backfill runs
   */
  fastify.get<{
    Querystring: { symbol?: string; limit?: string };
  }>('/backfill/runs', async (request, reply) => {
    const { symbol, limit = '10' } = request.query;
    
    const runs = await getBackfillRuns({
      symbol,
      limit: parseInt(limit),
    });
    
    return { ok: true, runs };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // HISTORY ENDPOINTS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /history/:symbol - Get price history from database
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: {
      tf?: string;
      from?: string;
      to?: string;
    };
  }>('/history/:symbol', async (request, reply) => {
    const symbol = request.params.symbol.toUpperCase();
    const tf = (request.query.tf || '1h') as Timeframe;
    const to = parseInt(request.query.to || String(Date.now()));
    const from = parseInt(request.query.from || String(to - 7 * 24 * 3600000));
    
    const bars = await getPriceBars({ symbol, tf, from, to });
    const count = await countPriceBars({ symbol, tf });
    
    return {
      ok: true,
      symbol,
      tf,
      count: bars.length,
      totalInDb: count,
      bars,
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // TRUTH ENDPOINTS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /truth/evaluate - Evaluate verdicts against price history
   */
  fastify.post<{
    Body: {
      symbol: string;
      tf?: string;
      from?: number;
      to?: number;
    };
  }>('/truth/evaluate', async (request, reply) => {
    const { symbol, tf = '1h', from, to } = request.body;
    
    if (!symbol) {
      reply.code(400);
      return { ok: false, error: 'Symbol is required' };
    }
    
    const now = Date.now();
    const evalTo = to || now;
    const evalFrom = from || evalTo - 7 * 24 * 3600000;
    
    // Get price bars
    const prices = await getPriceBars({
      symbol: symbol.toUpperCase(),
      tf: tf as Timeframe,
      from: evalFrom,
      to: evalTo,
    });
    
    if (prices.length === 0) {
      return {
        ok: false,
        error: 'No price history found. Run backfill first.',
      };
    }
    
    // Generate mock verdicts for testing
    const verdicts = generateMockVerdictHistory({
      symbol: symbol.toUpperCase(),
      from: evalFrom,
      to: evalTo,
      intervalMs: getTimeframeMs(tf as Timeframe),
    });
    
    // Evaluate
    const result = await evaluateVerdicts({
      symbol: symbol.toUpperCase(),
      tf: tf as Timeframe,
      verdicts: verdicts.map(v => ({
        ts: v.ts,
        verdict: v.verdict,
        confidence: v.confidence,
      })),
      prices,
    });
    
    return {
      ok: true,
      symbol: symbol.toUpperCase(),
      tf,
      ...result,
    };
  });
  
  /**
   * GET /truth/:symbol - Get truth records
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: {
      tf?: string;
      outcome?: string;
      limit?: string;
    };
  }>('/truth/:symbol', async (request, reply) => {
    const symbol = request.params.symbol.toUpperCase();
    const tf = request.query.tf as Timeframe | undefined;
    const outcome = request.query.outcome as any;
    const limit = parseInt(request.query.limit || '100');
    
    const records = await getTruthRecords({
      symbol,
      tf,
      outcome,
      limit,
    });
    
    return {
      ok: true,
      symbol,
      count: records.length,
      records,
    };
  });
  
  /**
   * GET /truth/stats/:symbol - Get truth statistics
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: { tf?: string };
  }>('/truth/stats/:symbol', async (request, reply) => {
    const symbol = request.params.symbol.toUpperCase();
    const tf = request.query.tf as Timeframe | undefined;
    
    const stats = await getTruthStats({ symbol, tf });
    
    return { ok: true, stats };
  });
  
  console.log('[Phase 1.4] Backfill & History Routes registered');
}

export default backfillRoutes;
