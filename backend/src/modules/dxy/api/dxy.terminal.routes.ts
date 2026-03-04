/**
 * DXY TERMINAL ROUTES — A4
 * 
 * Unified terminal API for DXY Fractal Engine.
 * Single endpoint returns: core + synthetic + replay + hybrid + meta
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { buildDxyTerminalPack } from '../services/dxy_terminal.service.js';
import { buildMacroOverlay } from '../services/macro_overlay.service.js';
import { computeMacroScore } from '../../dxy-macro-core/services/macro_score.service.js';
import { buildMacroContext } from '../../dxy-macro-core/services/macro_context.service.js';
import { isValidDxyHorizon } from '../contracts/dxy.types.js';
import { snapshotHook, extractDxySnapshotPayload } from '../../prediction/snapshot_hook.service.js';

// ═══════════════════════════════════════════════════════════════
// REGISTER TERMINAL ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerDxyTerminalRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/dxy/terminal
   * 
   * A4: Unified DXY Terminal API
   * 
   * Returns complete analysis pack in single request:
   * - core: current price, matches, diagnostics, decision
   * - synthetic: path + bands + forecast
   * - replay: window + continuation for selected rank
   * - hybrid: blended path + replayWeight + breakdown
   * - meta: mode, tradingEnabled, configUsed, warnings
   * 
   * Query params:
   *   focus: "7d" | "14d" | "30d" | "90d" | "180d" | "365d" (default: "30d")
   *   rank: 1..10 (default: 1) - which match to use for replay/hybrid
   *   windowLen: number (optional) - override config default
   *   topK: number (optional) - override config default (default: 10)
   * 
   * Response:
   *   DxyTerminalPack
   */
  fastify.get('/api/fractal/dxy/terminal', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as {
      focus?: string;
      rank?: string;
      windowLen?: string;
      topK?: string;
    };
    
    const focus = query.focus || '30d';
    const rank = query.rank ? parseInt(query.rank) : 1;
    const windowLen = query.windowLen ? parseInt(query.windowLen) : undefined;
    const topK = query.topK ? parseInt(query.topK) : undefined;
    
    // Validate focus
    if (!isValidDxyHorizon(focus)) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_FOCUS',
        message: `Invalid focus: ${focus}. Valid: 7d, 14d, 30d, 90d, 180d, 365d`,
      });
    }
    
    // Validate rank
    if (rank < 1 || rank > 10) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_RANK',
        message: 'Rank must be between 1 and 10',
      });
    }
    
    try {
      const terminalPack = await buildDxyTerminalPack({
        focus,
        rank,
        windowLen,
        topK,
      });
      
      // Auto-save snapshot hook DISABLED for DXY
      // DXY snapshots were being saved with incorrect anchorIndex (history too short)
      // Until extractDxyData is fixed to use external candles, use terminal fallback
      // const snapshotPayload = extractDxySnapshotPayload(terminalPack, focus);
      // console.log('[DXY Terminal] Snapshot payload extracted:', !!snapshotPayload, 'series length:', snapshotPayload?.series?.length || 0);
      // if (snapshotPayload) {
      //   snapshotHook(snapshotPayload).catch(e => {
      //     console.warn('[DXY Terminal] Snapshot hook failed:', e.message);
      //   });
      // }
      console.log('[DXY Terminal] Snapshot auto-save disabled - using terminal fallback in Overview');
      
      return terminalPack;
      
    } catch (error: any) {
      console.error('[DXY Terminal] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: 'TERMINAL_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/fractal/dxy/macro/debug
   * 
   * B2: Debug endpoint for macro overlay
   * Returns only macro calculations without candles/matches
   */
  fastify.get('/api/fractal/dxy/macro/debug', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { focus?: string; signalDirection?: string };
    const focus = query.focus || '30d';
    const signalDirection = (query.signalDirection || 'LONG') as 'LONG' | 'SHORT' | 'HOLD';
    
    try {
      // Get macro score
      const macroScore = await computeMacroScore();
      
      if (macroScore.components.length === 0) {
        return {
          ok: false,
          error: 'NO_MACRO_DATA',
          message: 'No macro data available. Run POST /api/dxy-macro-core/admin/ingest first.',
        };
      }
      
      // Build contexts map
      const contextMap: Record<string, any> = {};
      const seriesIds = ['FEDFUNDS', 'CPILFESL', 'T10Y2Y', 'UNRATE', 'M2SL'];
      
      for (const seriesId of seriesIds) {
        const ctx = await buildMacroContext(seriesId);
        if (ctx) {
          contextMap[seriesId] = ctx;
        }
      }
      
      // Build overlay
      const overlay = buildMacroOverlay(macroScore, contextMap, signalDirection);
      
      return {
        ok: true,
        focus,
        signalDirection,
        macroScore: {
          score01: macroScore.score01,
          scoreSigned: macroScore.scoreSigned,
          confidence: macroScore.confidence,
        },
        contexts: Object.fromEntries(
          Object.entries(contextMap).map(([k, v]: [string, any]) => [k, {
            current: v.current,
            deltas: v.deltas,
            trend: v.trend,
            regime: v.regime,
            pressure: v.pressure,
          }])
        ),
        overlay,
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'MACRO_DEBUG_ERROR',
        message: error.message,
      });
    }
  });
  
  console.log('[DXY] Terminal route registered at /api/fractal/dxy/terminal');
  console.log('[DXY] Macro debug route registered at /api/fractal/dxy/macro/debug');
}
