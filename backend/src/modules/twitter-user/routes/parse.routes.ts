/**
 * Parse Routes - Phase 1.4
 * 
 * API endpoints для запуска парсинга:
 * - POST /api/v4/twitter/parse/search
 * - POST /api/v4/twitter/parse/account
 * - GET /api/v4/twitter/tasks
 * - GET /api/v4/twitter/data/search
 */

import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/require-user.hook.js';
import { ParseRuntimeService } from '../services/parse-runtime.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { UserTwitterParseTaskModel } from '../models/twitter-parse-task.model.js';
import { UserTwitterParsedTweetModel } from '../models/twitter-parsed-tweet.model.js';
import { userScope } from '../acl/ownership.js';
import type { ParseSearchRequest, ParseAccountRequest } from '../dto/parse-request.dto.js';

export async function registerParseRoutes(app: FastifyInstance) {
  // Initialize services
  const cookieEncKey = process.env.COOKIE_ENC_KEY || '';
  const crypto = new CryptoService(cookieEncKey);
  const parseRuntime = new ParseRuntimeService(crypto);

  /**
   * POST /api/v4/twitter/parse/search
   * 
   * Start a search parse task
   */
  app.post('/api/v4/twitter/parse/search', async (req, reply) => {
    try {
      const u = requireUser(req);
      const body = (req.body ?? {}) as ParseSearchRequest;

      if (!body.query || typeof body.query !== 'string') {
        return reply.code(400).send({
          ok: false,
          error: 'Missing or invalid query',
        });
      }

      const limit = Math.min(Math.max(body.limit || 50, 10), 500); // 10-500 range

      const result = await parseRuntime.parseSearch({
        ownerUserId: u.id,
        query: body.query.trim(),
        limit,
        filters: body.filters,
      });

      // Map status to HTTP code
      if (result.status === 'FAILED' && !result.taskId) {
        // No session available
        return reply.code(409).send({
          ok: false,
          error: result.reason,
          state: mapReasonToState(result.reason),
        });
      }

      return reply.send({
        ok: result.status !== 'FAILED',
        data: result,
      });

    } catch (err: any) {
      app.log.error(err, 'Parse search error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/twitter/parse/account
   * 
   * Start an account parse task
   */
  app.post('/api/v4/twitter/parse/account', async (req, reply) => {
    try {
      const u = requireUser(req);
      const body = (req.body ?? {}) as ParseAccountRequest;

      if (!body.username || typeof body.username !== 'string') {
        return reply.code(400).send({
          ok: false,
          error: 'Missing or invalid username',
        });
      }

      const username = body.username.replace('@', '').trim();
      const limit = Math.min(Math.max(body.limit || 50, 10), 500);

      const result = await parseRuntime.parseAccount({
        ownerUserId: u.id,
        username,
        limit,
      });

      if (result.status === 'FAILED' && !result.taskId) {
        return reply.code(409).send({
          ok: false,
          error: result.reason,
          state: mapReasonToState(result.reason),
        });
      }

      return reply.send({
        ok: result.status !== 'FAILED',
        data: result,
      });

    } catch (err: any) {
      app.log.error(err, 'Parse account error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v4/twitter/parse/tasks
   * 
   * Get user's parse tasks history
   */
  app.get('/api/v4/twitter/parse/tasks', async (req, reply) => {
    try {
      const u = requireUser(req);
      const query = req.query as {
        status?: string;
        type?: string;
        limit?: string;
        skip?: string;
      };

      const filter: any = { ...userScope(u.id) };

      if (query.status) {
        filter.status = query.status.toUpperCase();
      }
      if (query.type) {
        filter.type = query.type.toUpperCase();
      }

      const limit = Math.min(parseInt(query.limit || '20'), 100);
      const skip = parseInt(query.skip || '0');

      const [tasks, total] = await Promise.all([
        UserTwitterParseTaskModel.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        UserTwitterParseTaskModel.countDocuments(filter),
      ]);

      return reply.send({
        ok: true,
        data: {
          tasks: tasks.map(t => ({
            id: String(t._id),
            type: t.type,
            query: t.query,
            targetUsername: t.targetUsername,
            status: t.status,
            fetched: t.fetched,
            limit: t.limit,
            durationMs: t.durationMs,
            error: t.error,
            createdAt: t.createdAt,
            completedAt: t.completedAt,
          })),
          total,
          limit,
          skip,
        },
      });

    } catch (err: any) {
      app.log.error(err, 'Get tasks error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v4/twitter/parse/tasks/:id
   * 
   * Get single task details
   */
  app.get('/api/v4/twitter/parse/tasks/:id', async (req, reply) => {
    try {
      const u = requireUser(req);
      const { id } = req.params as { id: string };

      const task = await UserTwitterParseTaskModel.findOne({
        _id: id,
        ...userScope(u.id),
      }).lean();

      if (!task) {
        return reply.code(404).send({ ok: false, error: 'Task not found' });
      }

      return reply.send({
        ok: true,
        data: task,
      });

    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v4/twitter/data/search
   * 
   * Get parsed tweets data
   */
  app.get('/api/v4/twitter/data/search', async (req, reply) => {
    try {
      const u = requireUser(req);
      const query = req.query as {
        query?: string;
        source?: string;
        minLikes?: string;
        minReposts?: string;
        timeRange?: string;
        limit?: string;
        skip?: string;
        sortBy?: string;
      };

      const filter: any = { ...userScope(u.id) };

      // Query filter
      if (query.query) {
        filter.query = query.query;
      }

      // Source filter
      if (query.source) {
        filter.source = query.source.toUpperCase();
      }

      // Metrics filters
      if (query.minLikes) {
        filter.likes = { $gte: parseInt(query.minLikes) };
      }
      if (query.minReposts) {
        filter.reposts = { $gte: parseInt(query.minReposts) };
      }

      // Time range filter
      if (query.timeRange) {
        const now = new Date();
        let since: Date;
        
        switch (query.timeRange) {
          case '1h':
            since = new Date(now.getTime() - 60 * 60 * 1000);
            break;
          case '6h':
            since = new Date(now.getTime() - 6 * 60 * 60 * 1000);
            break;
          case '24h':
            since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
          case '7d':
            since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          default:
            since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        }
        
        filter.parsedAt = { $gte: since };
      }

      const limit = Math.min(parseInt(query.limit || '50'), 200);
      const skip = parseInt(query.skip || '0');

      // Sort
      let sort: any = { parsedAt: -1 };
      if (query.sortBy === 'likes') {
        sort = { likes: -1, parsedAt: -1 };
      } else if (query.sortBy === 'reposts') {
        sort = { reposts: -1, parsedAt: -1 };
      } else if (query.sortBy === 'views') {
        sort = { views: -1, parsedAt: -1 };
      }

      const [tweets, total] = await Promise.all([
        UserTwitterParsedTweetModel.find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        UserTwitterParsedTweetModel.countDocuments(filter),
      ]);

      return reply.send({
        ok: true,
        data: {
          items: tweets.map(t => ({
            id: String(t._id),
            tweetId: t.tweetId,
            text: t.text,
            username: t.username,
            displayName: t.displayName,
            likes: t.likes,
            reposts: t.reposts,
            replies: t.replies,
            views: t.views,
            media: t.media,
            query: t.query,
            source: t.source,
            tweetedAt: t.tweetedAt,
            parsedAt: t.parsedAt,
          })),
          total,
          limit,
          skip,
        },
      });

    } catch (err: any) {
      app.log.error(err, 'Get data error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v4/twitter/data/stats
   * 
   * Get parsing statistics
   */
  app.get('/api/v4/twitter/data/stats', async (req, reply) => {
    try {
      const u = requireUser(req);
      const scope = userScope(u.id);

      const [totalTweets, totalTasks, recentTasks] = await Promise.all([
        UserTwitterParsedTweetModel.countDocuments(scope),
        UserTwitterParseTaskModel.countDocuments(scope),
        UserTwitterParseTaskModel.find({
          ...scope,
          completedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        })
        .lean(),
      ]);

      // Calculate stats from recent tasks
      const taskStats = recentTasks.reduce((acc, task) => {
        acc.totalFetched += task.fetched || 0;
        acc.totalDuration += task.durationMs || 0;
        if (task.status === 'DONE') acc.successCount++;
        if (task.status === 'PARTIAL') acc.partialCount++;
        if (task.status === 'FAILED') acc.failedCount++;
        return acc;
      }, {
        totalFetched: 0,
        totalDuration: 0,
        successCount: 0,
        partialCount: 0,
        failedCount: 0,
      });

      return reply.send({
        ok: true,
        data: {
          totalTweets,
          totalTasks,
          last24h: {
            tasks: recentTasks.length,
            fetched: taskStats.totalFetched,
            avgDurationMs: recentTasks.length > 0 
              ? Math.round(taskStats.totalDuration / recentTasks.length) 
              : 0,
            successRate: recentTasks.length > 0
              ? Math.round((taskStats.successCount / recentTasks.length) * 100)
              : 0,
          },
        },
      });

    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}

/**
 * Map selection reason to UI state
 */
function mapReasonToState(reason?: string): string {
  switch (reason) {
    case 'NO_ACCOUNTS':
      return 'NOT_CONNECTED';
    case 'NO_SESSIONS':
      return 'NEED_COOKIES';
    case 'ALL_SESSIONS_INVALID':
      return 'SESSION_INVALID';
    case 'SESSION_EXPIRED':
      return 'SESSION_EXPIRED';
    case 'NO_PROXY_AVAILABLE':
      return 'NO_PROXY';
    default:
      return 'SESSION_STALE';
  }
}
