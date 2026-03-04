/**
 * BLOCK 2.5 — Alt Candidates Routes
 * ===================================
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { altCandidatesService } from '../services/alt.candidates.service.js';
import { altPredictionsService } from '../services/alt.predictions.service.js';
import type { Horizon } from '../db/types.js';

export async function registerAltCandidatesRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════════
  // GET CANDIDATES (main endpoint)
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/market/alts/candidates', async (req: FastifyRequest<{
    Querystring: {
      venue?: string;
      horizon?: string;
      limit?: string;
      mode?: string;
      minConf?: string;
    };
  }>) => {
    const horizon = (req.query.horizon ?? '4h') as Horizon;
    const venue = req.query.venue ?? 'resolved';
    const limit = parseInt(req.query.limit ?? '30');
    const minConf = parseFloat(req.query.minConf ?? '0.55');
    const mode = req.query.mode ?? 'ALL';

    // Get latest snapshot or generate new one
    let snapshot = await altCandidatesService.getLatestSnapshot(horizon);
    
    // If no recent snapshot, generate
    const maxAge = 15 * 60 * 1000; // 15 minutes
    if (!snapshot || (Date.now() - snapshot.ts.getTime()) > maxAge) {
      snapshot = await altCandidatesService.generateCandidates({
        horizon,
        venue,
        limit,
        minConf,
      });
      
      // Materialize predictions from snapshot
      if (snapshot._id) {
        await altPredictionsService.materializeSnapshot(snapshot._id);
      }
    }

    // Filter by mode if not ALL
    let buckets = snapshot.buckets;
    if (mode !== 'ALL') {
      buckets = {
        UP: mode === 'UP' ? snapshot.buckets.UP : [],
        DOWN: mode === 'DOWN' ? snapshot.buckets.DOWN : [],
        WATCH: mode === 'WATCH' ? snapshot.buckets.WATCH : [],
      };
    }

    return {
      ok: true,
      meta: {
        asOf: snapshot.ts.toISOString(),
        horizon,
        venue,
        universeSize: snapshot.universeSize,
      },
      buckets,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // FORCE GENERATE (admin)
  // ═══════════════════════════════════════════════════════════════

  app.post('/api/admin/market/alts/candidates/generate', async (req: FastifyRequest<{
    Body?: {
      horizon?: string;
      venue?: string;
      limit?: number;
    };
  }>) => {
    const horizon = (req.body?.horizon ?? '4h') as Horizon;
    const venue = req.body?.venue ?? 'resolved';
    const limit = req.body?.limit ?? 50;

    const snapshot = await altCandidatesService.generateCandidates({
      horizon,
      venue,
      limit,
    });

    // Materialize predictions
    if (snapshot._id) {
      const result = await altPredictionsService.materializeSnapshot(snapshot._id);
      return {
        ok: true,
        snapshotId: snapshot._id.toString(),
        universeSize: snapshot.universeSize,
        candidates: {
          UP: snapshot.buckets.UP.length,
          DOWN: snapshot.buckets.DOWN.length,
          WATCH: snapshot.buckets.WATCH.length,
        },
        predictions: result,
      };
    }

    return {
      ok: true,
      snapshotId: null,
      universeSize: snapshot.universeSize,
    };
  });

  console.log('[Alts] Candidates Routes registered');
}
