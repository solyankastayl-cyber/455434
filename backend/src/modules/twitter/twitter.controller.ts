// Twitter Controller - API v4 Routes (Fastify)
// Integrated with B2 Execution Core

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TwitterService } from './twitter.service.js';
import { getDb } from '../../db/mongodb.js';
import { twitterExecutionAdapter } from './execution/execution.adapter.js';
import { runtimeRegistry } from './runtime/runtime.registry.js';

const service = new TwitterService();

// Initialize execution adapter with DB on first request
let executionInitialized = false;
async function initExecution(): Promise<void> {
  if (executionInitialized) return;
  try {
    const db = getDb();
    twitterExecutionAdapter.initialize(db);
    executionInitialized = true;
    console.log('[Twitter] Execution adapter initialized');
  } catch (err) {
    console.error('[Twitter] Failed to initialize execution adapter:', err);
  }
}

export async function registerTwitterRoutes(app: FastifyInstance): Promise<void> {
  // Initialize execution on startup
  app.addHook('onReady', async () => {
    await initExecution();
  });
  
  // Prefix: /api/v4/twitter

  // Health & Status
  app.get('/health', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = await service.health();
      return reply.send({
        ok: true,
        data: health,
      });
    } catch (error: any) {
      return reply.status(503).send({
        ok: false,
        error: error.message || 'Parser unavailable',
      });
    }
  });

  app.get('/status', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const state = await service.getState();
      const stats = service.getCacheStats();
      const execStatus = service.getExecutionStatus();
      
      return reply.send({
        ok: true,
        data: {
          parser: state.data,
          cache: stats,
          execution: execStatus,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  // Search
  app.get('/search', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { query } = req.query as { query?: string };
      
      if (!query) {
        return reply.status(400).send({
          ok: false,
          error: 'query parameter is required',
        });
      }

      const result = await service.search(query);
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      if (error.message === 'PARSER_PAUSED') {
        return reply.status(503).send({
          ok: false,
          error: 'Parser is currently paused',
          status: 'PAUSED',
        });
      }
      
      return reply.status(500).send({
        ok: false,
        error: error.message || 'Search failed',
      });
    }
  });

  // Account
  app.get('/account/:username', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { username } = req.params as { username: string };
      const result = await service.account(username);
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message || 'Failed to fetch account',
      });
    }
  });

  // Account Tweets
  app.get('/account/:username/tweets', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { username } = req.params as { username: string };
      const result = await service.tweets(username);
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message || 'Failed to fetch tweets',
      });
    }
  });

  // Account Followers
  app.get('/account/:username/followers', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { username } = req.params as { username: string };
      const mode = req.headers['x-parser-mode'] as string | undefined;
      
      const result = await service.followers(username, mode);
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      if (error.message === 'FOLLOWERS_NOT_AVAILABLE_IN_LIMITED_MODE') {
        return reply.status(403).send({
          ok: false,
          error: 'Followers endpoint not available in LIMITED mode',
          mode: 'LIMITED',
        });
      }
      
      return reply.status(500).send({
        ok: false,
        error: error.message || 'Failed to fetch followers',
      });
    }
  });

  // Admin endpoints (passthrough)
  app.post('/admin/mode', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { mode } = req.body as { mode: string };
      const result = await service.setMode(mode);
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  app.post('/admin/pause', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await service.pause();
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  app.post('/admin/resume', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await service.resume();
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  app.post('/admin/boost', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { minutes } = req.body as { minutes?: number };
      const result = await service.boost(minutes || 10);
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  app.get('/admin/state', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await service.getState();
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  // B2 Execution endpoints
  app.get('/execution/status', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = service.getExecutionStatus();
      return reply.send({
        ok: true,
        data: status,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  app.post('/execution/worker/start', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      service.startExecutionWorker();
      return reply.send({
        ok: true,
        message: 'Worker started',
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  app.post('/execution/worker/stop', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      service.stopExecutionWorker();
      return reply.send({
        ok: true,
        message: 'Worker stopped',
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  app.post('/execution/reset-counters', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      service.resetExecutionCounters();
      return reply.send({
        ok: true,
        message: 'Counters reset',
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  // Clear runtime registry (force recreation of runtimes)
  app.post('/execution/reset-runtimes', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const oldCount = runtimeRegistry.size;
      runtimeRegistry.clear();
      
      // Force resync from DB
      await twitterExecutionAdapter.syncFromDatabase();
      
      return reply.send({
        ok: true,
        message: `Runtime registry cleared (${oldCount} runtimes removed). Slots resynced from DB.`,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  // B3 Runtime Layer endpoints
  
  /**
   * Execute search using Runtime Layer (Mock/Remote/Proxy)
   * This bypasses old parser service and uses the new abstraction
   */
  app.post('/runtime/search', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { keyword, limit } = req.body as { keyword: string; limit?: number };
      
      if (!keyword) {
        return reply.status(400).send({
          ok: false,
          error: 'keyword is required',
        });
      }

      const result = await twitterExecutionAdapter.executeWithRuntime('SEARCH', {
        keyword,
        q: keyword,
        limit: limit || 20,
      });

      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * Execute account tweets using Runtime Layer
   */
  app.post('/runtime/account/tweets', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { username, limit } = req.body as { username: string; limit?: number };
      
      if (!username) {
        return reply.status(400).send({
          ok: false,
          error: 'username is required',
        });
      }

      const result = await twitterExecutionAdapter.executeWithRuntime('ACCOUNT_TWEETS', {
        username,
        limit: limit || 20,
      });

      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * Get detailed execution status including runtime info
   */
  app.get('/execution/detailed-status', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = await twitterExecutionAdapter.getDetailedStatus();
      return reply.send({
        ok: true,
        data: status,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * Check runtime health for a specific slot
   */
  app.post('/runtime/health-check/:slotId', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { slotId } = req.params as { slotId: string };
      const status = await twitterExecutionAdapter.checkRuntimeHealth(slotId);
      
      return reply.send({
        ok: true,
        data: {
          slotId,
          status,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  // ==================== P2 - Filtered Tweet Query ====================

  /**
   * Query cached tweets with filters (P2)
   * POST /api/v4/twitter/tweets/query
   * 
   * Filters:
   * - minLikes, minReposts, minReplies, minViews (engagement)
   * - timeRange: { from, to } (unix ms)
   * - keyword, author, hashtags (content)
   * - source, query, username (source filters)
   * - limit, offset (pagination)
   */
  app.post('/tweets/query', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getDb();
      const { getStorageService } = await import('./execution/storage/storage.service.js');
      const storage = getStorageService(db);
      
      const filters = req.body as any;
      const result = await storage.queryTweets(filters);
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * Get recent tweets from cache
   * GET /api/v4/twitter/tweets/recent
   */
  app.get('/tweets/recent', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getDb();
      const { getStorageService } = await import('./execution/storage/storage.service.js');
      const storage = getStorageService(db);
      
      const { limit } = req.query as { limit?: string };
      const tweets = await storage.getRecentTweets(Number(limit) || 50);
      
      return reply.send({
        ok: true,
        data: tweets,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * Get tweets by keyword (from cache)
   * GET /api/v4/twitter/tweets/by-keyword/:keyword
   */
  app.get('/tweets/by-keyword/:keyword', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getDb();
      const { getStorageService } = await import('./execution/storage/storage.service.js');
      const storage = getStorageService(db);
      
      const { keyword } = req.params as { keyword: string };
      const { limit } = req.query as { limit?: string };
      const tweets = await storage.getTweetsByQuery(keyword, Number(limit) || 50);
      
      return reply.send({
        ok: true,
        data: tweets,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * Get tweets by username (from cache)
   * GET /api/v4/twitter/tweets/by-user/:username
   */
  app.get('/tweets/by-user/:username', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getDb();
      const { getStorageService } = await import('./execution/storage/storage.service.js');
      const storage = getStorageService(db);
      
      const { username } = req.params as { username: string };
      const { limit } = req.query as { limit?: string };
      const tweets = await storage.getTweetsByUsername(username, Number(limit) || 50);
      
      return reply.send({
        ok: true,
        data: tweets,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  // ==================== Task Queue Endpoints ====================

  /**
   * Get task queue stats
   * GET /api/v4/twitter/tasks/stats
   */
  app.get('/tasks/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getDb();
      const { getStorageService } = await import('./execution/storage/storage.service.js');
      const storage = getStorageService(db);
      
      const stats = await storage.getTaskStats();
      
      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  /**
   * Get tasks by status
   * GET /api/v4/twitter/tasks/:status
   */
  app.get('/tasks/:status', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getDb();
      const { getStorageService } = await import('./execution/storage/storage.service.js');
      const storage = getStorageService(db);
      
      const { status } = req.params as { status: string };
      const { limit } = req.query as { limit?: string };
      
      const validStatuses = ['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED'];
      if (!validStatuses.includes(status.toUpperCase())) {
        return reply.status(400).send({
          ok: false,
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        });
      }
      
      const tasks = await storage.getTasksByStatus(
        status.toUpperCase() as any,
        Number(limit) || 50
      );
      
      return reply.send({
        ok: true,
        data: tasks,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });

  // ==================== Browser Extension Ingest Endpoint ====================
  
  /**
   * POST /api/v4/twitter/ingest
   * 
   * CRITICAL: This is the "indirect method" endpoint.
   * Browser Extension fetches data directly from Twitter and sends it here.
   * Backend NEVER touches Twitter directly - only stores data received from browser.
   * 
   * Body: { type, params, data, source, timestamp }
   * - type: SEARCH | PROFILE | TWEETS | FOLLOWING | FOLLOWERS
   * - params: Original search params (keyword, username, limit, etc.)
   * - data: Tweets or profile data fetched by extension
   * - source: 'browser-extension'
   * - timestamp: When data was fetched
   */
  app.post('/ingest', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = req.headers.authorization;
      
      // Validate API key presence
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({
          ok: false,
          error: 'API_KEY_REQUIRED',
          message: 'Authorization header with Bearer token is required',
        });
      }

      const body = req.body as {
        type?: string;
        params?: any;
        data?: any[];
        source?: string;
        timestamp?: number;
      };

      // Validate payload
      if (!body.type) {
        return reply.status(400).send({
          ok: false,
          error: 'MISSING_TYPE',
          message: 'type field is required (SEARCH, PROFILE, TWEETS, etc.)',
        });
      }

      if (!body.data || !Array.isArray(body.data)) {
        return reply.status(400).send({
          ok: false,
          error: 'MISSING_DATA',
          message: 'data array is required',
        });
      }

      if (body.data.length === 0) {
        return reply.send({
          ok: true,
          message: 'No data to ingest',
          ingested: 0,
        });
      }

      const db = getDb();
      const collection = db.collection('browser_ingested_tweets');

      // Prepare documents for insertion
      const now = new Date();
      const docs = body.data.map((item: any) => ({
        type: body.type,
        source: body.source || 'browser-extension',
        fetchedAt: body.timestamp ? new Date(body.timestamp) : now,
        ingestedAt: now,
        params: body.params || {},
        // Tweet data
        tweetId: item.id,
        text: item.text,
        createdAt: item.createdAt,
        likes: item.likes || 0,
        reposts: item.reposts || 0,
        replies: item.replies || 0,
        views: item.views || 0,
        author: item.author || {},
        // Processing flags
        processed: false,
        processedAt: null,
      }));

      // Insert with duplicate handling
      let insertedCount = 0;
      try {
        const result = await collection.insertMany(docs, { ordered: false });
        insertedCount = result.insertedCount;
      } catch (err: any) {
        // Handle duplicate key errors (some tweets may already exist)
        if (err.code === 11000 || err.message?.includes('duplicate key')) {
          // Count successful inserts from partial insert
          insertedCount = err.insertedCount || 0;
          app.log.info({ 
            duplicates: docs.length - insertedCount,
            inserted: insertedCount 
          }, 'Ingest with some duplicates');
        } else {
          throw err;
        }
      }

      app.log.info({
        type: body.type,
        source: body.source,
        received: body.data.length,
        inserted: insertedCount,
      }, 'Browser extension data ingested');

      return reply.send({
        ok: true,
        message: 'Data ingested successfully',
        received: body.data.length,
        ingested: insertedCount,
      });
    } catch (error: any) {
      app.log.error(error, 'Ingest endpoint error');
      return reply.status(500).send({
        ok: false,
        error: error.message || 'Failed to ingest data',
      });
    }
  });
}
