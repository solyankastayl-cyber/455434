/**
 * BLOCK 70.2 — FocusPack Routes
 * 
 * New endpoint for real horizon binding:
 * GET /api/fractal/v2.1/focus-pack?symbol=BTC&focus=30d
 * 
 * Returns complete FocusPack with:
 * - overlay (matches, distribution series)
 * - forecast (path, bands, markers)
 * - diagnostics
 * 
 * Length of arrays = aftermathDays for each horizon
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { buildFocusPack } from './focus-pack.builder.js';
import { 
  HORIZON_CONFIG, 
  FRACTAL_HORIZONS, 
  type HorizonKey,
  isValidHorizon 
} from '../config/horizon.config.js';
import type { FocusPack } from './focus.types.js';
import { buildReplayPack } from '../replay/replay-pack.builder.js';
import { snapshotHook, extractBtcSnapshotPayload } from '../../prediction/snapshot_hook.service.js';

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function focusPackRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/focus-pack
   * BLOCK 73.5.2: Added phaseId parameter for phase filtering
   * 
   * Returns complete FocusPack for a specific horizon
   */
  fastify.get('/api/fractal/v2.1/focus-pack', async (
    req: FastifyRequest<{ 
      Querystring: { 
        symbol?: string; 
        focus?: string;
        phaseId?: string;  // BLOCK 73.5.2
      } 
    }>,
    reply
  ) => {
    const symbol = String(req.query.symbol ?? 'BTC').toUpperCase();
    const focusRaw = req.query.focus || '30d';
    const phaseId = req.query.phaseId || null;  // BLOCK 73.5.2
    
    // Validate symbol
    if (symbol !== 'BTC') {
      return reply.code(400).send({ 
        error: 'BTC_ONLY',
        message: 'Only BTC is supported' 
      });
    }
    
    // Validate focus
    if (!isValidHorizon(focusRaw)) {
      return reply.code(400).send({ 
        error: 'INVALID_HORIZON',
        message: `Invalid focus: ${focusRaw}. Valid: ${FRACTAL_HORIZONS.join(', ')}`
      });
    }
    
    const focus = focusRaw as HorizonKey;
    
    try {
      const t0 = Date.now();
      const focusPack = await buildFocusPack(symbol, focus, phaseId);
      const durationMs = Date.now() - t0;
      
      // Validate that distribution series has correct length
      const cfg = HORIZON_CONFIG[focus];
      const actualLength = focusPack.overlay.distributionSeries.p50.length;
      
      if (actualLength !== cfg.aftermathDays) {
        fastify.log.warn({
          focus,
          expected: cfg.aftermathDays,
          actual: actualLength
        }, '[FocusPack] Distribution length mismatch');
      }
      
      // Auto-save snapshot hook (non-blocking)
      const snapshotPayload = extractBtcSnapshotPayload(focusPack, focus);
      console.log('[BTC FocusPack] Snapshot payload extracted:', !!snapshotPayload, 'series length:', snapshotPayload?.series?.length || 0);
      if (snapshotPayload) {
        snapshotHook(snapshotPayload).catch(e => {
          console.warn('[BTC FocusPack] Snapshot hook failed:', e.message);
        });
      }
      
      return reply.send({
        ok: true,
        durationMs,
        focusPack
      });
      
    } catch (err: any) {
      fastify.log.error({ err: err.message, focus }, '[FocusPack] Build error');
      return reply.code(500).send({ 
        error: 'BUILD_ERROR',
        message: err.message 
      });
    }
  });
  
  /**
   * GET /api/fractal/v2.1/focus-pack/all
   * 
   * Returns FocusPacks for ALL horizons (for preloading)
   * Use with caution - expensive operation
   */
  fastify.get('/api/fractal/v2.1/focus-pack/all', async (
    req: FastifyRequest<{ Querystring: { symbol?: string } }>,
    reply
  ) => {
    const symbol = String(req.query.symbol ?? 'BTC').toUpperCase();
    
    if (symbol !== 'BTC') {
      return reply.code(400).send({ error: 'BTC_ONLY' });
    }
    
    try {
      const t0 = Date.now();
      const packs: Record<HorizonKey, FocusPack> = {} as any;
      
      // Build all focus packs in parallel
      const results = await Promise.all(
        FRACTAL_HORIZONS.map(async (focus) => {
          try {
            const pack = await buildFocusPack(symbol, focus);
            return { focus, pack, error: null };
          } catch (err: any) {
            return { focus, pack: null, error: err.message };
          }
        })
      );
      
      const errors: string[] = [];
      for (const r of results) {
        if (r.pack) {
          packs[r.focus] = r.pack;
        } else {
          errors.push(`${r.focus}: ${r.error}`);
        }
      }
      
      const durationMs = Date.now() - t0;
      
      return reply.send({
        ok: errors.length === 0,
        durationMs,
        horizons: Object.keys(packs),
        packs,
        errors: errors.length > 0 ? errors : undefined
      });
      
    } catch (err: any) {
      fastify.log.error({ err: err.message }, '[FocusPack/all] Error');
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: err.message });
    }
  });
  
  /**
   * GET /api/fractal/v2.1/focus-pack/validate
   * 
   * Validates that all horizons return correct distribution lengths
   * Used for testing real horizon binding
   */
  fastify.get('/api/fractal/v2.1/focus-pack/validate', async (
    req: FastifyRequest<{ Querystring: { symbol?: string } }>,
    reply
  ) => {
    const symbol = String(req.query.symbol ?? 'BTC').toUpperCase();
    
    if (symbol !== 'BTC') {
      return reply.code(400).send({ error: 'BTC_ONLY' });
    }
    
    const validations: Array<{
      horizon: HorizonKey;
      expectedLength: number;
      actualLength: number;
      matchesCount: number;
      valid: boolean;
    }> = [];
    
    for (const focus of FRACTAL_HORIZONS) {
      try {
        const pack = await buildFocusPack(symbol, focus);
        const cfg = HORIZON_CONFIG[focus];
        const actualLength = pack.overlay.distributionSeries.p50.length;
        
        validations.push({
          horizon: focus,
          expectedLength: cfg.aftermathDays,
          actualLength,
          matchesCount: pack.overlay.matches.length,
          valid: actualLength === cfg.aftermathDays
        });
        
      } catch (err: any) {
        validations.push({
          horizon: focus,
          expectedLength: HORIZON_CONFIG[focus].aftermathDays,
          actualLength: -1,
          matchesCount: 0,
          valid: false
        });
      }
    }
    
    const allValid = validations.every(v => v.valid);
    
    return reply.send({
      ok: allValid,
      message: allValid 
        ? 'All horizons have correct distribution lengths' 
        : 'Some horizons have incorrect distribution lengths',
      validations
    });
  });
  
  fastify.log.info('[Fractal] BLOCK 70.2: FocusPack routes registered');
  
  // ═══════════════════════════════════════════════════════════════
  // BLOCK 73.4 — Interactive Match Replay
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/fractal/v2.1/replay-pack
   * 
   * Returns replay data for a specific historical match.
   * Used when user clicks on a match chip in the UI.
   */
  fastify.get('/api/fractal/v2.1/replay-pack', async (
    req: FastifyRequest<{ 
      Querystring: { 
        symbol?: string; 
        focus?: string;
        matchId?: string;
      } 
    }>,
    reply
  ) => {
    const symbol = String(req.query.symbol ?? 'BTC').toUpperCase();
    const focusRaw = req.query.focus || '30d';
    const matchId = req.query.matchId;
    
    // Validate
    if (symbol !== 'BTC') {
      return reply.code(400).send({ error: 'BTC_ONLY' });
    }
    
    if (!isValidHorizon(focusRaw)) {
      return reply.code(400).send({ 
        error: 'INVALID_HORIZON',
        message: `Invalid focus: ${focusRaw}`
      });
    }
    
    if (!matchId) {
      return reply.code(400).send({ 
        error: 'MATCH_ID_REQUIRED',
        message: 'matchId query parameter is required'
      });
    }
    
    const focus = focusRaw as HorizonKey;
    
    try {
      const t0 = Date.now();
      
      // Get full focus pack first
      const focusPack = await buildFocusPack(symbol, focus);
      
      // Find the requested match
      const match = focusPack.overlay.matches.find(m => m.id === matchId);
      
      if (!match) {
        return reply.code(404).send({
          error: 'MATCH_NOT_FOUND',
          message: `Match ${matchId} not found in ${focus} overlay`,
          availableMatches: focusPack.overlay.matches.map(m => m.id)
        });
      }
      
      // Get unified path from forecast
      const unifiedPath = (focusPack.forecast as any).unifiedPath;
      if (!unifiedPath?.syntheticPath) {
        return reply.code(500).send({
          error: 'NO_UNIFIED_PATH',
          message: 'UnifiedPath not available in focusPack'
        });
      }
      
      // Build replay pack for this match
      const replayPack = buildReplayPack(
        match,
        unifiedPath.syntheticPath,
        unifiedPath.anchorPrice,
        HORIZON_CONFIG[focus].aftermathDays,
        focusPack.meta.tier
      );
      
      const durationMs = Date.now() - t0;
      
      return reply.send({
        ok: true,
        durationMs,
        replayPack,
        // Include synthetic for comparison
        synthetic: {
          path: unifiedPath.syntheticPath,
          markers: unifiedPath.markers
        }
      });
      
    } catch (err: any) {
      fastify.log.error({ err: err.message, matchId, focus }, '[ReplayPack] Error');
      return reply.code(500).send({ 
        error: 'BUILD_ERROR',
        message: err.message 
      });
    }
  });
  
  fastify.log.info('[Fractal] BLOCK 73.4: ReplayPack route registered');
}
