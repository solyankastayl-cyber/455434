/**
 * SPX CORE — API Routes
 * 
 * BLOCK B5.2 — SPX Fractal Core API
 * 
 * Endpoints:
 * - GET /api/spx/v2.1/focus-pack?focus=30d
 * - GET /api/spx/v2.1/terminal (full terminal data)
 * 
 * ISOLATION: Does NOT import from /modules/btc/ or /modules/fractal/
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { buildSpxFocusPack, type SpxFocusPack } from './spx-focus-pack.builder.js';
import { isValidSpxHorizon, type SpxHorizonKey, getAllSpxHorizons } from './spx-horizon.config.js';
import { spxCandlesService } from './spx-candles.service.js';
import { detectPhaseFromCloses } from './spx-phase.service.js';
import { snapshotHook, extractSpxSnapshotPayload } from '../prediction/snapshot_hook.service.js';

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerSpxCoreRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/spx/v2.1';
  
  // ═══════════════════════════════════════════════════════════════
  // FOCUS PACK ENDPOINT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/spx/v2.1/focus-pack?focus=30d
   * 
   * Returns complete SPX focus-pack for specified horizon.
   * Includes: matches, overlay, forecast, divergence, primary selection.
   */
  fastify.get(`${prefix}/focus-pack`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { focus?: string; horizon?: string };
    const focus = query.horizon || query.focus || '30d';  // Support both 'horizon' and 'focus' params
    
    // Validate horizon
    if (!isValidSpxHorizon(focus)) {
      return reply.code(400).send({
        ok: false,
        error: `Invalid horizon: ${focus}. Valid: 7d, 14d, 30d, 90d, 180d, 365d`,
      });
    }
    
    try {
      const t0 = Date.now();
      const focusPack = await buildSpxFocusPack(focus as SpxHorizonKey);
      
      // Auto-save snapshot hook (non-blocking)
      const snapshotPayload = extractSpxSnapshotPayload(focusPack, focus);
      console.log('[SPX Core] Snapshot payload extracted:', !!snapshotPayload, 'series length:', snapshotPayload?.series?.length || 0);
      if (snapshotPayload) {
        snapshotHook(snapshotPayload).catch(e => {
          console.warn('[SPX Core] Snapshot hook failed:', e.message);
        });
      }
      
      return {
        ok: true,
        symbol: 'SPX',
        focus,
        processingTimeMs: Date.now() - t0,
        data: focusPack,
      };
    } catch (error: any) {
      fastify.log.error(`[SPX Core] Focus pack error: ${error.message}`);
      
      if (error.message?.includes('INSUFFICIENT_DATA')) {
        return reply.code(503).send({
          ok: false,
          error: error.message,
          hint: 'Run SPX data ingestion first: POST /api/fractal/v2.1/admin/spx/ingest-csv',
        });
      }
      
      return reply.code(500).send({
        ok: false,
        error: error.message || 'Internal server error',
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // TERMINAL ENDPOINT (Full Data)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/spx/v2.1/core/terminal
   * 
   * Returns full SPX terminal data with all horizons.
   */
  fastify.get(`${prefix}/core/terminal`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const t0 = Date.now();
      
      // Get basic data
      const latest = await spxCandlesService.getLatest();
      const count = await spxCandlesService.getCount();
      
      if (!latest || count < 100) {
        return reply.code(503).send({
          ok: false,
          error: 'Insufficient SPX data',
          count,
          hint: 'Run SPX data ingestion first',
        });
      }
      
      // Get recent candles for phase detection
      const recentCandles = await spxCandlesService.getLastNDays(200);
      const closes = recentCandles.map(c => c.c);
      const phase = detectPhaseFromCloses(closes);
      
      // Calculate SMAs
      const sma50 = closes.length >= 50 
        ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 
        : latest.c;
      const sma200 = closes.length >= 200 
        ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 
        : latest.c;
      
      // Price changes
      const change1d = closes.length > 1 
        ? ((latest.c - closes[closes.length - 2]) / closes[closes.length - 2]) * 100 
        : 0;
      const change7d = closes.length > 7 
        ? ((latest.c - closes[closes.length - 8]) / closes[closes.length - 8]) * 100 
        : 0;
      const change30d = closes.length > 30 
        ? ((latest.c - closes[closes.length - 31]) / closes[closes.length - 31]) * 100 
        : 0;
      
      return {
        ok: true,
        symbol: 'SPX',
        status: 'OPERATIONAL',
        processingTimeMs: Date.now() - t0,
        data: {
          meta: {
            symbol: 'SPX',
            asOf: new Date().toISOString(),
            latestDate: latest.date,
            totalCandles: count,
            version: 'SPX_V2.1.0',
          },
          price: {
            current: latest.c,
            open: latest.o,
            high: latest.h,
            low: latest.l,
            sma50: Math.round(sma50 * 100) / 100,
            sma200: Math.round(sma200 * 100) / 100,
            change1d: Math.round(change1d * 100) / 100,
            change7d: Math.round(change7d * 100) / 100,
            change30d: Math.round(change30d * 100) / 100,
          },
          phase,
          horizons: getAllSpxHorizons().map(h => ({
            key: h.key,
            tier: h.tier,
            weight: h.weight,
            description: h.description,
            endpoint: `${prefix}/focus-pack?focus=${h.key}`,
          })),
        },
      };
    } catch (error: any) {
      fastify.log.error(`[SPX Core] Terminal error: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: error.message || 'Internal server error',
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // HORIZONS INFO ENDPOINT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/spx/v2.1/horizons
   * 
   * Returns available SPX horizons configuration.
   */
  fastify.get(`${prefix}/horizons`, async () => {
    return {
      ok: true,
      symbol: 'SPX',
      horizons: getAllSpxHorizons(),
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // QUICK SCAN ENDPOINT (Lightweight)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/spx/v2.1/quick-scan?focus=30d
   * 
   * Returns lightweight scan results without full forecast computation.
   */
  fastify.get(`${prefix}/quick-scan`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { focus?: string };
    const focus = query.focus || '30d';
    
    if (!isValidSpxHorizon(focus)) {
      return reply.code(400).send({
        ok: false,
        error: `Invalid horizon: ${focus}`,
      });
    }
    
    try {
      const t0 = Date.now();
      const focusPack = await buildSpxFocusPack(focus as SpxHorizonKey);
      
      // Return lightweight version
      return {
        ok: true,
        symbol: 'SPX',
        focus,
        processingTimeMs: Date.now() - t0,
        summary: {
          matchCount: focusPack.overlay.matches.length,
          topSimilarity: focusPack.overlay.matches[0]?.similarity || 0,
          medianReturn: focusPack.overlay.stats.medianReturn,
          hitRate: focusPack.overlay.stats.hitRate,
          phase: focusPack.phase.phase,
          divergenceGrade: focusPack.divergence.grade,
          qualityScore: focusPack.diagnostics.qualityScore,
        },
        primaryMatch: focusPack.primarySelection.primaryMatch ? {
          id: focusPack.primarySelection.primaryMatch.id,
          similarity: focusPack.primarySelection.primaryMatch.similarity,
          return: focusPack.primarySelection.primaryMatch.return,
          selectionReason: focusPack.primarySelection.primaryMatch.selectionReason,
        } : null,
      };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PHASE ENGINE ENDPOINT (B5.4)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/spx/v2.1/phases
   * 
   * Returns SPX phase analysis with segments, stats, and current phase.
   * BLOCK B5.4 — SPX-native Phase Engine
   */
  fastify.get(`${prefix}/phases`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const t0 = Date.now();
      
      // Dynamic import to avoid circular deps
      const { SpxPhaseService } = await import('../spx-phase/spx-phase.service.js');
      const phaseService = new SpxPhaseService();
      
      // Get all candles
      const allCandles = await spxCandlesService.getAllCandles();
      
      if (allCandles.length < 250) {
        return reply.code(503).send({
          ok: false,
          error: 'Insufficient data for phase analysis (need 250+ candles)',
          count: allCandles.length,
        });
      }
      
      // Convert to phase engine format
      const phaseCandles = allCandles.map(c => ({
        t: c.date,
        ts: new Date(c.date).getTime(),
        o: c.o,
        h: c.h,
        l: c.l,
        c: c.c,
      }));
      
      // Build phase analysis
      const phaseOutput = phaseService.build(phaseCandles);
      
      return {
        ok: true,
        symbol: 'SPX',
        processingTimeMs: Date.now() - t0,
        data: {
          phaseIdAtNow: phaseOutput.phaseIdAtNow,
          currentFlags: phaseOutput.currentFlags,
          segments: phaseOutput.segments.slice(-100), // Last 100 segments for perf
          statsByPhase: phaseOutput.statsByPhase,
          overallGrade: phaseOutput.overallGrade,
          totalDays: phaseOutput.totalDays,
          coverageYears: phaseOutput.coverageYears,
          lastUpdated: phaseOutput.lastUpdated,
        },
      };
    } catch (error: any) {
      fastify.log.error(`[SPX Core] Phase engine error: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/spx/v2.1/phases/segments?start=2020-01-01&end=2026-02-21
   * 
   * Returns phase segments in date range (for chart shading).
   */
  fastify.get(`${prefix}/phases/segments`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { start?: string; end?: string };
    const start = query.start || '1950-01-01';
    const end = query.end || new Date().toISOString().slice(0, 10);
    
    try {
      const { SpxPhaseService } = await import('../spx-phase/spx-phase.service.js');
      const phaseService = new SpxPhaseService();
      
      const allCandles = await spxCandlesService.getAllCandles();
      const phaseCandles = allCandles.map(c => ({
        t: c.date,
        ts: new Date(c.date).getTime(),
        o: c.o,
        h: c.h,
        l: c.l,
        c: c.c,
      }));
      
      const segments = phaseService.getPhasesInRange(phaseCandles, start, end);
      
      return {
        ok: true,
        symbol: 'SPX',
        dateRange: { start, end },
        segmentsCount: segments.length,
        segments,
      };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  fastify.log.info(`[SPX Core] Routes registered at ${prefix}/* (BLOCK B5.2 + B5.4 READY)`);
}

export default registerSpxCoreRoutes;
