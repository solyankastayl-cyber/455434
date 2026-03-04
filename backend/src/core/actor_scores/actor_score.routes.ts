/**
 * Actor Score API Routes
 * 
 * EPIC A2: Actor Scores
 * 
 * Endpoints:
 * - POST /recalculate - Trigger score calculation
 * - GET / - List scores with filters
 * - GET /leaderboard - Top actors by edge score
 * - GET /summary - Score statistics
 * - GET /history - Calculation run history
 * - GET /:actorId - Get actor's scores
 */

import type { FastifyPluginAsync } from 'fastify';
import type { ScoreWindow, FlowRole } from './actor_score.types.js';
import { SCORE_WINDOWS } from './actor_score.types.js';
import {
  runScoreCalculation,
  recalculateAllScores,
  queryActorScores,
  getActorScoreDetail,
  getScoreLeaderboard,
  getScoreSummary,
  getScoreRunHistory,
} from './actor_score.service.js';

export const actorScoreRoutes: FastifyPluginAsync = async (app) => {

  // ============================================
  // CALCULATION ENDPOINTS
  // ============================================

  // Recalculate scores
  app.post('/recalculate', async (req, reply) => {
    const body = (req.body || {}) as { window?: ScoreWindow; actorIds?: string[] };
    
    try {
      if (body.window) {
        // Calculate for specific window
        const stats = await runScoreCalculation({
          window: body.window,
          actorIds: body.actorIds,
        });
        return reply.send({ ok: true, data: stats });
      } else {
        // Calculate all windows
        const results = await recalculateAllScores();
        return reply.send({ ok: true, data: results });
      }
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'CALCULATION_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // Get calculation run history
  app.get('/history', async (req, reply) => {
    const query = req.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '10', 10), 50);
    
    const runs = await getScoreRunHistory(limit);
    return reply.send({ ok: true, data: runs, count: runs.length });
  });

  // ============================================
  // QUERY ENDPOINTS
  // ============================================

  // List scores with filters
  app.get('/', async (req, reply) => {
    const query = req.query as Record<string, string>;
    
    const window = (query.window as ScoreWindow) || '7d';
    if (!SCORE_WINDOWS.includes(window)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_WINDOW',
        message: `Window must be one of: ${SCORE_WINDOWS.join(', ')}`,
      });
    }
    
    const options = {
      window,
      flowRole: query.flowRole as FlowRole | undefined,
      minEdgeScore: query.minScore ? parseInt(query.minScore, 10) : undefined,
      maxEdgeScore: query.maxScore ? parseInt(query.maxScore, 10) : undefined,
      sort: (query.sort as 'edge_score' | 'participation' | 'volume') || 'edge_score',
      sortOrder: (query.sortOrder as 'asc' | 'desc') || 'desc',
      page: Math.max(1, parseInt(query.page || '1', 10)), // Ensure page >= 1
      limit: Math.min(parseInt(query.limit || '20', 10), 100),
    };
    
    const result = await queryActorScores(options);
    
    return reply.send({
      ok: true,
      data: result.scores,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: Math.ceil(result.total / result.limit),
      },
    });
  });

  // Get leaderboard
  app.get('/leaderboard', async (req, reply) => {
    const query = req.query as { window?: string; limit?: string };
    
    const window = (query.window as ScoreWindow) || '7d';
    if (!SCORE_WINDOWS.includes(window)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_WINDOW',
        message: `Window must be one of: ${SCORE_WINDOWS.join(', ')}`,
      });
    }
    
    const limit = Math.min(parseInt(query.limit || '20', 10), 100);
    const leaderboard = await getScoreLeaderboard(window, limit);
    
    return reply.send({
      ok: true,
      data: leaderboard,
      window,
    });
  });

  // Get summary statistics
  app.get('/summary', async (req, reply) => {
    const query = req.query as { window?: string };
    
    const window = (query.window as ScoreWindow) || '7d';
    if (!SCORE_WINDOWS.includes(window)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_WINDOW',
        message: `Window must be one of: ${SCORE_WINDOWS.join(', ')}`,
      });
    }
    
    const summary = await getScoreSummary(window);
    
    return reply.send({
      ok: true,
      data: summary,
      window,
    });
  });

  // ============================================
  // DETAIL ENDPOINTS
  // ============================================

  // Get actor's scores
  app.get('/:actorId', async (req, reply) => {
    const params = req.params as { actorId: string };
    const query = req.query as { window?: string };
    
    const window = query.window as ScoreWindow | undefined;
    if (window && !SCORE_WINDOWS.includes(window)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_WINDOW',
        message: `Window must be one of: ${SCORE_WINDOWS.join(', ')}`,
      });
    }
    
    const result = await getActorScoreDetail(params.actorId, window);
    
    if (!result.actor) {
      return reply.status(404).send({
        ok: false,
        error: 'ACTOR_NOT_FOUND',
        message: `Actor ${params.actorId} not found`,
      });
    }
    
    return reply.send({
      ok: true,
      data: {
        actor: {
          id: result.actor.id,
          type: result.actor.type,
          name: result.actor.name,
          sourceLevel: result.actor.sourceLevel,
          coverage: result.actor.coverage || { score: 0, band: 'Low' },
        },
        scores: result.scores.map(s => {
          const { _id, ...scoreWithoutId } = s as Record<string, unknown>;
          return scoreWithoutId;
        }),
      },
    });
  });

  // Get actor's score history (for sparkline)
  app.get('/:actorId/history', async (req, reply) => {
    const params = req.params as { actorId: string };
    const query = req.query as { window?: string; days?: string };
    
    const window = (query.window as ScoreWindow) || '7d';
    if (!SCORE_WINDOWS.includes(window)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_WINDOW',
        message: `Window must be one of: ${SCORE_WINDOWS.join(', ')}`,
      });
    }
    
    const days = Math.min(parseInt(query.days || '30', 10), 90);
    
    const { getScoreHistory } = await import('./actor_score.model.js');
    const history = await getScoreHistory(params.actorId, window, days);
    
    return reply.send({
      ok: true,
      data: history,
      actorId: params.actorId,
      window,
      days,
    });
  });
};
