/**
 * Admin Backtest Routes - ETAP 4
 * 
 * Provides backtest data for Admin UI:
 * - GET /api/admin/backtest/market - Run market backtest
 * - GET /api/admin/backtest/history - Get accuracy history
 * - GET /api/admin/backtest/models - List available model versions
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from './admin.middleware.js';
import {
  backtestMarket,
  getAccuracyHistory,
  MLAccuracyHistoryModel,
} from '../ml/ml_backtest.service.js';

// ============================================
// TYPES
// ============================================

interface BacktestQuery {
  network?: string;
  from?: string;
  to?: string;
  windowDays?: string;
  modelVersion?: string;
}

interface HistoryQuery {
  network?: string;
  limit?: string;
  modelVersion?: string;
}

// ============================================
// ROUTES
// ============================================

export async function adminBacktestRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /admin/backtest/market
   * Run market model backtest
   */
  app.get(
    '/backtest/market',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: BacktestQuery }>, reply: FastifyReply) => {
      try {
        const { network = 'ethereum', windowDays = '30' } = request.query;
        const days = Math.min(parseInt(windowDays) || 30, 90);
        
        const result = await backtestMarket(network, days);
        
        // Transform to admin-friendly format
        const response = {
          summary: {
            accuracy: result.accuracy.overall,
            precisionBuy: result.accuracy.BUY || 0,
            precisionSell: result.accuracy.SELL || 0,
            precisionNeutral: result.accuracy.NEUTRAL || 0,
            samples: result.samples,
            modelVersion: result.modelVersion,
            window: result.window,
          },
          confusionMatrix: result.confusionMatrix,
          note: result.note,
        };
        
        return reply.send({ ok: true, data: response });
      } catch (err: any) {
        console.error('[AdminBacktest] Market error:', err.message);
        return reply.code(500).send({
          ok: false,
          error: 'BACKTEST_ERROR',
          message: err.message,
        });
      }
    }
  );

  /**
   * GET /admin/backtest/history
   * Get historical accuracy data for charts
   */
  app.get(
    '/backtest/history',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: HistoryQuery }>, reply: FastifyReply) => {
      try {
        const { network = 'ethereum', limit = '30', modelVersion } = request.query;
        const maxLimit = Math.min(parseInt(limit) || 30, 100);
        
        // Build query
        const query: any = { 
          network, 
          signalType: 'market' 
        };
        
        if (modelVersion && modelVersion !== 'ALL') {
          query.modelVersion = modelVersion;
        }
        
        const history = await MLAccuracyHistoryModel.find(query)
          .sort({ ts: -1 })
          .limit(maxLimit)
          .lean();
        
        // Transform for chart
        const data = history.map((h: any) => ({
          date: new Date(h.ts * 1000).toISOString().split('T')[0],
          ts: h.ts,
          modelVersion: h.modelVersion,
          accuracy: h.accuracy?.overall || 0,
          precisionBuy: h.accuracy?.byClass?.BUY || 0,
          precisionSell: h.accuracy?.byClass?.SELL || 0,
          samples: h.samples,
        })).reverse(); // Oldest first for chart
        
        return reply.send({ ok: true, data });
      } catch (err: any) {
        console.error('[AdminBacktest] History error:', err.message);
        return reply.code(500).send({
          ok: false,
          error: 'HISTORY_ERROR',
          message: err.message,
        });
      }
    }
  );

  /**
   * GET /admin/backtest/models
   * List available model versions
   */
  app.get(
    '/backtest/models',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: { network?: string } }>, reply: FastifyReply) => {
      try {
        const { network = 'ethereum' } = request.query;
        
        const versions = await MLAccuracyHistoryModel.distinct('modelVersion', {
          network,
          signalType: 'market',
        });
        
        return reply.send({ 
          ok: true, 
          data: {
            versions: versions.filter(v => v && v !== 'N/A'),
            network,
          }
        });
      } catch (err: any) {
        console.error('[AdminBacktest] Models error:', err.message);
        return reply.code(500).send({
          ok: false,
          error: 'MODELS_ERROR',
          message: err.message,
        });
      }
    }
  );

  /**
   * GET /admin/backtest/daily
   * Get daily breakdown for accuracy over time chart
   */
  app.get(
    '/backtest/daily',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: BacktestQuery }>, reply: FastifyReply) => {
      try {
        const { network = 'ethereum', windowDays = '30' } = request.query;
        const days = Math.min(parseInt(windowDays) || 30, 90);
        const minTs = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
        
        // Aggregate by day
        const pipeline = [
          {
            $match: {
              network,
              signalType: 'market',
              ts: { $gte: minTs },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: { $toDate: { $multiply: ['$ts', 1000] } },
                },
              },
              avgAccuracy: { $avg: '$accuracy.overall' },
              samples: { $sum: '$samples' },
              count: { $sum: 1 },
            },
          },
          {
            $sort: { _id: 1 },
          },
        ];
        
        const results = await MLAccuracyHistoryModel.aggregate(pipeline);
        
        const data = results.map((r: any) => ({
          date: r._id,
          accuracy: r.avgAccuracy || 0,
          samples: r.samples,
        }));
        
        return reply.send({ ok: true, data });
      } catch (err: any) {
        console.error('[AdminBacktest] Daily error:', err.message);
        return reply.code(500).send({
          ok: false,
          error: 'DAILY_ERROR',
          message: err.message,
        });
      }
    }
  );

  console.log('[Admin] Backtest routes registered');
}

export default adminBacktestRoutes;
