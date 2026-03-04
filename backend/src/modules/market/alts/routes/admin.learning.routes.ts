/**
 * BLOCK 2.6 — Admin Learning Routes
 * ===================================
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { mongoose } from '../../../../db/mongoose.js';
import { altOutcomeTrackerService } from '../services/alt.outcome.tracker.service.js';
import { altLearningSamplesService } from '../services/alt.learning.samples.service.js';

export async function registerAdminAltLearningRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════════
  // HEALTH CHECK
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/admin/alts/learning/health', async () => {
    const db = mongoose.connection.db;
    if (!db) {
      return { ok: false, error: 'No database' };
    }

    const [predPending, predDone, outcomes, samples] = await Promise.all([
      db.collection('alt_candidate_predictions').countDocuments({ outcomeStatus: 'PENDING' }),
      db.collection('alt_candidate_predictions').countDocuments({ outcomeStatus: 'DONE' }),
      db.collection('alt_candidate_outcomes').countDocuments({}),
      db.collection('alt_learning_samples').countDocuments({}),
    ]);

    const hints: string[] = [];
    if (predDone === 0) hints.push('No DONE predictions yet → wait horizons or check price provider.');
    if (outcomes === 0) hints.push('No outcomes → outcome tracker not running or dueAt never reached.');
    if (samples === 0) hints.push('No learning samples → ensure outcomes exist and sampler job runs.');

    return {
      ok: true,
      counts: { predPending, predDone, outcomes, samples },
      hints,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // RECENT OUTCOMES
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/admin/alts/outcomes/recent', async (req: FastifyRequest<{
    Querystring: { limit?: string };
  }>) => {
    const limit = parseInt(req.query.limit ?? '50');
    const rows = await altOutcomeTrackerService.getRecent(limit);
    return { ok: true, count: rows.length, rows };
  });

  // ═══════════════════════════════════════════════════════════════
  // OUTCOME STATS
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/admin/alts/outcomes/stats', async () => {
    const stats = await altOutcomeTrackerService.getStats();
    return { ok: true, ...stats };
  });

  // ═══════════════════════════════════════════════════════════════
  // SAMPLE STATS
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/admin/alts/samples/stats', async () => {
    const stats = await altLearningSamplesService.getStats();
    return { ok: true, ...stats };
  });

  // ═══════════════════════════════════════════════════════════════
  // RUN OUTCOME TRACKER MANUALLY
  // ═══════════════════════════════════════════════════════════════

  app.post('/api/admin/alts/outcomes/run', async (req: FastifyRequest<{
    Body?: { limit?: number };
  }>) => {
    const limit = req.body?.limit ?? 200;
    const result = await altOutcomeTrackerService.runBatch(limit);
    return { ok: true, ...result };
  });

  // ═══════════════════════════════════════════════════════════════
  // RUN SAMPLE MATERIALIZER MANUALLY
  // ═══════════════════════════════════════════════════════════════

  app.post('/api/admin/alts/samples/materialize', async (req: FastifyRequest<{
    Body?: { limit?: number };
  }>) => {
    const limit = req.body?.limit ?? 500;
    const result = await altLearningSamplesService.materialize(limit);
    return { ok: true, ...result };
  });

  console.log('[Alts] Admin Learning Routes registered');
}
