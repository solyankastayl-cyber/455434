/**
 * PHASE 5.1 — Outcome Routes
 * ===========================
 * Admin API for outcome tracking
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { runOutcomeJob, getOutcomeStats } from '../jobs/outcome.job.js';
import { DecisionOutcomeModel } from '../storage/outcome.model.js';
import { clearPriceCache, getCacheStats } from '../services/price.resolver.js';
import { OutcomeJobRequest } from '../contracts/outcome.types.js';

export async function outcomeRoutes(app: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // POST /api/v10/learning/outcomes/run-once
  // Run outcome calculation job once (admin trigger)
  // ═══════════════════════════════════════════════════════════════
  app.post('/api/v10/learning/outcomes/run-once', async (
    request: FastifyRequest<{ Body: OutcomeJobRequest }>,
    reply: FastifyReply
  ) => {
    try {
      const jobRequest: OutcomeJobRequest = request.body || {};
      const result = await runOutcomeJob(jobRequest);
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'JOB_FAILED',
        message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/v10/learning/outcomes/stats
  // Get outcome statistics
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/v10/learning/outcomes/stats', async (
    request: FastifyRequest<{ 
      Querystring: { 
        symbol?: string; 
        period?: '24h' | '7d' | '30d' | 'all';
      } 
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { symbol, period = '7d' } = request.query;
      const stats = await getOutcomeStats(symbol, period);
      
      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'STATS_FAILED',
        message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/v10/learning/outcomes/list
  // List recent outcomes
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/v10/learning/outcomes/list', async (
    request: FastifyRequest<{
      Querystring: {
        symbol?: string;
        status?: string;
        limit?: string;
        offset?: string;
      }
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { 
        symbol, 
        status,
        limit = '50',
        offset = '0'
      } = request.query;
      
      const query: any = {};
      if (symbol) query.symbol = symbol;
      if (status) query.status = status;
      
      const [outcomes, total] = await Promise.all([
        DecisionOutcomeModel
          .find(query)
          .sort({ decisionTimestamp: -1 })
          .skip(parseInt(offset))
          .limit(parseInt(limit))
          .lean(),
        DecisionOutcomeModel.countDocuments(query),
      ]);
      
      // Remove MongoDB _id from response
      const sanitizedOutcomes = outcomes.map(o => {
        const { _id, ...rest } = o as any;
        return { id: _id.toString(), ...rest };
      });
      
      return reply.send({
        ok: true,
        data: {
          outcomes: sanitizedOutcomes,
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'LIST_FAILED',
        message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/v10/learning/outcomes/:decisionId
  // Get outcome for specific decision
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/v10/learning/outcomes/:decisionId', async (
    request: FastifyRequest<{ Params: { decisionId: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { decisionId } = request.params;
      
      const outcome = await DecisionOutcomeModel
        .findOne({ decisionId })
        .lean();
      
      if (!outcome) {
        return reply.status(404).send({
          ok: false,
          error: 'NOT_FOUND',
          message: `No outcome found for decision ${decisionId}`,
        });
      }
      
      const { _id, ...rest } = outcome as any;
      
      return reply.send({
        ok: true,
        data: { id: _id.toString(), ...rest },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'FETCH_FAILED',
        message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/v10/learning/outcomes/accuracy/by-action
  // Get accuracy breakdown by action type
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/v10/learning/outcomes/accuracy/by-action', async (
    request: FastifyRequest<{
      Querystring: {
        symbol?: string;
        period?: '24h' | '7d' | '30d' | 'all';
      }
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { symbol, period = '7d' } = request.query;
      
      const periodMs: Record<string, number> = {
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
        'all': Infinity,
      };
      
      const minTimestamp = period === 'all' 
        ? 0 
        : Date.now() - periodMs[period];
      
      const match: any = {
        decisionTimestamp: { $gte: minTimestamp },
        status: 'CALCULATED',
      };
      
      if (symbol) {
        match.symbol = symbol;
      }
      
      const breakdown = await DecisionOutcomeModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$action',
            total: { $sum: 1 },
            correct: { $sum: { $cond: ['$directionCorrect', 1, 0] } },
            avgPnl: { $avg: '$bestPnlPct' },
            avgConfidence: { $avg: '$confidence' },
          },
        },
        {
          $project: {
            action: '$_id',
            total: 1,
            correct: 1,
            accuracy: { 
              $cond: [
                { $gt: ['$total', 0] },
                { $divide: ['$correct', '$total'] },
                null
              ]
            },
            avgPnl: 1,
            avgConfidence: 1,
          },
        },
      ]);
      
      return reply.send({
        ok: true,
        data: {
          symbol: symbol || 'ALL',
          period,
          breakdown,
          generatedAt: Date.now(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'ACCURACY_FAILED',
        message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // POST /api/v10/learning/outcomes/cache/clear
  // Clear price cache (admin)
  // ═══════════════════════════════════════════════════════════════
  app.post('/api/v10/learning/outcomes/cache/clear', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      clearPriceCache();
      
      return reply.send({
        ok: true,
        message: 'Price cache cleared',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'CACHE_CLEAR_FAILED',
        message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/v10/learning/outcomes/cache/stats
  // Get price cache stats
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/v10/learning/outcomes/cache/stats', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const stats = getCacheStats();
      
      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'CACHE_STATS_FAILED',
        message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /api/v10/learning/health
  // Health check for learning module
  // ═══════════════════════════════════════════════════════════════
  app.get('/api/v10/learning/health', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const [outcomeCount, pendingCount] = await Promise.all([
        DecisionOutcomeModel.countDocuments(),
        DecisionOutcomeModel.countDocuments({ status: 'PENDING' }),
      ]);
      
      const cacheStats = getCacheStats();
      
      return reply.send({
        ok: true,
        data: {
          module: 'learning',
          phase: '5.1',
          status: 'UP',
          outcomes: {
            total: outcomeCount,
            pending: pendingCount,
          },
          priceCache: cacheStats,
          timestamp: Date.now(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'HEALTH_CHECK_FAILED',
        message,
      });
    }
  });
  
  app.log.info('[Phase 5.1] Outcome routes registered');
}

console.log('[Phase 5.1] Outcome Routes loaded');
