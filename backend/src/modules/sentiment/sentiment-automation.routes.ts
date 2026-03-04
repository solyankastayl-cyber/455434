/**
 * Phase S4.1 — Twitter Sentiment Automation Routes
 * =================================================
 * 
 * API endpoints for automated Twitter → Sentiment processing.
 * 
 * S5.5 UPDATE: Now integrates with Price Layer for SignalEvent collection.
 * 
 * DOES NOT:
 * - Apply author trust
 * - Do ML retraining
 * - Modify sentiment logic
 * 
 * DOES (S5.5):
 * - Create SignalEvent for each processed tweet
 * - Trigger price snapshots (t0, 5m, 15m, 1h, 4h, 24h)
 * - Enable outcome labeling pipeline
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sentimentClient } from './sentiment.client.js';
import { priceLayerService } from '../price-layer/price-layer.service.js';

// ============================================================
// S5.5 Integration Config
// ============================================================

const PRICE_LAYER_CONFIG = {
  enabled: process.env.TWITTER_PRICE_LAYER_ENABLED === 'true',
  // Asset extraction from tweet text
  assetKeywords: {
    BTC: ['btc', 'bitcoin', '$btc', '#btc', '#bitcoin'],
    ETH: ['eth', 'ethereum', '$eth', '#eth', '#ethereum'],
    SOL: ['sol', 'solana', '$sol', '#sol', '#solana'],
  },
};

/**
 * Extract asset from tweet text
 */
function extractAssetFromText(text: string): 'BTC' | 'ETH' | 'SOL' | null {
  const lowerText = text.toLowerCase();
  
  for (const [asset, keywords] of Object.entries(PRICE_LAYER_CONFIG.assetKeywords)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        return asset as 'BTC' | 'ETH' | 'SOL';
      }
    }
  }
  
  // Default to BTC if no specific asset mentioned (crypto context assumed)
  return 'BTC';
}

// ============================================================
// Queue Configuration
// ============================================================

const QUEUE_CONFIG = {
  maxQueueSize: 1000,
  batchSize: 10,
  processIntervalMs: 5000,
  maxRetries: 2,
  minCompletenessScore: 0.85,
};

// ============================================================
// In-Memory Queue State
// ============================================================

interface QueuedTweet {
  id: string;
  tweet_id: string;
  text: string;
  author_id: string;
  author_username: string;
  completenessScore: number;
  enqueuedAt: Date;
  retries: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
}

interface SentimentResult {
  tweet_id: string;
  author_id: string;
  author_username: string;
  text: string;
  label: string;
  score: number;
  confidence: string;
  confidenceScore: number;
  reasons: string[];
  processedAt: Date;
  processingTimeMs: number;
}

interface AutomationState {
  enabled: boolean;
  isRunning: boolean;
  queue: QueuedTweet[];
  results: SentimentResult[];
  stats: {
    totalEnqueued: number;
    totalProcessed: number;
    totalDropped: number;
    totalFailed: number;
    totalProcessingTimeMs: number;
    lastProcessedAt: Date | null;
    // S5.5 — Price Layer stats
    signalEventsCreated?: number;
  };
}

const automationState: AutomationState = {
  enabled: process.env.TWITTER_SENTIMENT_AUTOMATION === 'true',
  isRunning: false,
  queue: [],
  results: [],
  stats: {
    totalEnqueued: 0,
    totalProcessed: 0,
    totalDropped: 0,
    totalFailed: 0,
    totalProcessingTimeMs: 0,
    lastProcessedAt: null,
    signalEventsCreated: 0,
  },
};

let processingInterval: NodeJS.Timeout | null = null;

// ============================================================
// Queue Processing Logic
// ============================================================

async function processBatch() {
  if (!automationState.isRunning) return;

  const pending = automationState.queue
    .filter(q => q.status === 'PENDING')
    .slice(0, QUEUE_CONFIG.batchSize);

  console.log(`[S4.1] Processing batch: ${pending.length} items`);

  for (const item of pending) {
    try {
      item.status = 'PROCESSING';
      const startTime = Date.now();

      // Call sentiment engine
      console.log(`[S4.1] Analyzing tweet ${item.tweet_id}: "${item.text.substring(0, 50)}..."`);
      const response = await sentimentClient.predict(item.text);
      console.log(`[S4.1] Result: ${response.label}, score=${response.score}`);
      
      const processingTimeMs = Date.now() - startTime;
      automationState.stats.totalProcessingTimeMs += processingTimeMs;

      // Build result
      const result: SentimentResult = {
        tweet_id: item.tweet_id,
        author_id: item.author_id,
        author_username: item.author_username,
        text: item.text,
        label: response.label,
        score: response.score,
        confidence: response.meta?.confidence || 'UNKNOWN',
        confidenceScore: response.meta?.confidenceScore || 0,
        reasons: response.meta?.reasons || [],
        processedAt: new Date(),
        processingTimeMs,
      };

      // ============================================================
      // S5.5 — Price Layer Integration
      // Create SignalEvent for outcome tracking
      // ============================================================
      if (PRICE_LAYER_CONFIG.enabled) {
        try {
          const asset = extractAssetFromText(item.text);
          if (asset) {
            const signalEvent = await priceLayerService.createSignalEvent({
              source: 'twitter',
              asset,
              sentiment: {
                label: response.label as 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE',
                score: response.score,
                confidence: response.meta?.confidenceScore || 0.5,
                engine_version: response.meta?.engineVersion || 'v1.6',
                cnn_flags: response.meta?.cnnFlags || [],
              },
              meta: {
                text: item.text,
                text_length: item.text.length,
                tweet_id: item.tweet_id,
                author_id: item.author_id,
                author_username: item.author_username,
              },
            });
            console.log(`[S5.5] SignalEvent created: ${signalEvent.signal_id} for ${asset}`);
            automationState.stats.signalEventsCreated = (automationState.stats.signalEventsCreated || 0) + 1;
          }
        } catch (priceError: any) {
          console.warn(`[S5.5] Failed to create SignalEvent: ${priceError.message}`);
          // Non-blocking — sentiment processing continues
        }
      }

      // Store result (in-memory, last 500)
      automationState.results.push(result);
      if (automationState.results.length > 500) {
        automationState.results = automationState.results.slice(-500);
      }

      // Update stats
      item.status = 'COMPLETED';
      automationState.stats.totalProcessed++;
      automationState.stats.lastProcessedAt = new Date();

      // Remove from queue
      automationState.queue = automationState.queue.filter(q => q.id !== item.id);
      console.log(`[S4.1] Tweet ${item.tweet_id} processed successfully`);

    } catch (error: any) {
      console.error(`[S4.1] Error processing ${item.tweet_id}:`, error.message);
      item.retries++;
      if (item.retries >= QUEUE_CONFIG.maxRetries) {
        item.status = 'FAILED';
        automationState.stats.totalFailed++;
        automationState.queue = automationState.queue.filter(q => q.id !== item.id);
      } else {
        item.status = 'PENDING';
      }
    }
  }
}

// ============================================================
// Routes Registration
// ============================================================

export function registerSentimentAutomationRoutes(app: FastifyInstance) {

  // ============================================
  // GET /admin/sentiment/automation/status
  // ============================================
  app.get('/api/v4/admin/sentiment/automation/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const queueDepth = automationState.queue.filter(q => q.status === 'PENDING').length;
    const avgProcessingTimeMs = automationState.stats.totalProcessed > 0
      ? Math.round(automationState.stats.totalProcessingTimeMs / automationState.stats.totalProcessed)
      : 0;

    return reply.send({
      ok: true,
      data: {
        enabled: automationState.enabled,
        isRunning: automationState.isRunning,
        config: QUEUE_CONFIG,
        stats: {
          queueDepth,
          ...automationState.stats,
          avgProcessingTimeMs,
        },
        featureFlags: {
          TWITTER_PARSER_ENABLED: process.env.TWITTER_PARSER_ENABLED === 'true',
          TWITTER_SENTIMENT_ENABLED: process.env.TWITTER_SENTIMENT_ENABLED === 'true',
          TWITTER_SENTIMENT_AUTOMATION: process.env.TWITTER_SENTIMENT_AUTOMATION === 'true',
          TWITTER_PRICE_ENABLED: process.env.TWITTER_PRICE_ENABLED === 'true',
          // S5.5 — Price Layer Integration
          TWITTER_PRICE_LAYER_ENABLED: process.env.TWITTER_PRICE_LAYER_ENABLED === 'true',
        },
        // S5.5 — Price Layer status
        priceLayer: {
          enabled: PRICE_LAYER_CONFIG.enabled,
          signalEventsCreated: automationState.stats.signalEventsCreated || 0,
        },
      },
    });
  });

  // ============================================
  // POST /admin/sentiment/automation/start
  // ============================================
  app.post('/api/v4/admin/sentiment/automation/start', async (req: FastifyRequest, reply: FastifyReply) => {
    if (automationState.isRunning) {
      return reply.send({ ok: false, message: 'Automation already running' });
    }

    // Check feature flag
    if (process.env.TWITTER_SENTIMENT_AUTOMATION !== 'true') {
      return reply.status(400).send({
        ok: false,
        error: 'AUTOMATION_DISABLED',
        message: 'TWITTER_SENTIMENT_AUTOMATION is not enabled',
      });
    }

    automationState.isRunning = true;
    automationState.enabled = true;

    // Start processing interval
    processingInterval = setInterval(processBatch, QUEUE_CONFIG.processIntervalMs);
    
    // Process immediately on start
    processBatch();

    return reply.send({
      ok: true,
      message: 'Automation started',
      data: { isRunning: true },
    });
  });

  // ============================================
  // POST /admin/sentiment/automation/stop
  // ============================================
  app.post('/api/v4/admin/sentiment/automation/stop', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!automationState.isRunning) {
      return reply.send({ ok: false, message: 'Automation not running' });
    }

    automationState.isRunning = false;

    if (processingInterval) {
      clearInterval(processingInterval);
      processingInterval = null;
    }

    return reply.send({
      ok: true,
      message: 'Automation stopped',
      data: { isRunning: false },
    });
  });

  // ============================================
  // POST /admin/sentiment/automation/process-now
  // Manually trigger batch processing (ignores isRunning check)
  // ============================================
  app.post('/api/v4/admin/sentiment/automation/process-now', async (req: FastifyRequest, reply: FastifyReply) => {
    const beforeDepth = automationState.queue.filter(q => q.status === 'PENDING').length;
    
    if (beforeDepth === 0) {
      return reply.send({
        ok: true,
        message: 'No items to process',
        data: { before: 0, after: 0, processed: 0 },
      });
    }
    
    // Process directly without checking isRunning
    const pending = automationState.queue
      .filter(q => q.status === 'PENDING')
      .slice(0, QUEUE_CONFIG.batchSize);

    console.log(`[S4.1] Manual processing: ${pending.length} items`);

    for (const item of pending) {
      try {
        item.status = 'PROCESSING';
        const startTime = Date.now();

        console.log(`[S4.1] Analyzing tweet ${item.tweet_id}: "${item.text.substring(0, 50)}..."`);
        const response = await sentimentClient.predict(item.text);
        console.log(`[S4.1] Result: ${response.label}, score=${response.score}`);
        
        const processingTimeMs = Date.now() - startTime;
        automationState.stats.totalProcessingTimeMs += processingTimeMs;

        const result: SentimentResult = {
          tweet_id: item.tweet_id,
          author_id: item.author_id,
          author_username: item.author_username,
          text: item.text,
          label: response.label,
          score: response.score,
          confidence: response.meta?.confidence || 'UNKNOWN',
          confidenceScore: response.meta?.confidenceScore || 0,
          reasons: response.meta?.reasons || [],
          processedAt: new Date(),
          processingTimeMs,
        };

        // ============================================================
        // S5.5 — Price Layer Integration (process-now)
        // ============================================================
        if (PRICE_LAYER_CONFIG.enabled) {
          try {
            const asset = extractAssetFromText(item.text);
            if (asset) {
              const signalEvent = await priceLayerService.createSignalEvent({
                source: 'twitter',
                asset,
                sentiment: {
                  label: response.label as 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE',
                  score: response.score,
                  confidence: response.meta?.confidenceScore || 0.5,
                  engine_version: response.meta?.engineVersion || 'v1.6',
                  cnn_flags: response.meta?.cnnFlags || [],
                },
                meta: {
                  text: item.text,
                  text_length: item.text.length,
                  tweet_id: item.tweet_id,
                  author_id: item.author_id,
                  author_username: item.author_username,
                },
              });
              console.log(`[S5.5] SignalEvent created: ${signalEvent.signal_id} for ${asset}`);
              automationState.stats.signalEventsCreated = (automationState.stats.signalEventsCreated || 0) + 1;
            }
          } catch (priceError: any) {
            console.warn(`[S5.5] Failed to create SignalEvent: ${priceError.message}`);
          }
        }

        automationState.results.push(result);
        if (automationState.results.length > 500) {
          automationState.results = automationState.results.slice(-500);
        }

        item.status = 'COMPLETED';
        automationState.stats.totalProcessed++;
        automationState.stats.lastProcessedAt = new Date();
        automationState.queue = automationState.queue.filter(q => q.id !== item.id);
        
        console.log(`[S4.1] Tweet ${item.tweet_id} processed: ${response.label}`);

      } catch (error: any) {
        console.error(`[S4.1] Error processing ${item.tweet_id}:`, error.message);
        item.retries++;
        if (item.retries >= QUEUE_CONFIG.maxRetries) {
          item.status = 'FAILED';
          automationState.stats.totalFailed++;
          automationState.queue = automationState.queue.filter(q => q.id !== item.id);
        } else {
          item.status = 'PENDING';
        }
      }
    }
    
    const afterDepth = automationState.queue.filter(q => q.status === 'PENDING').length;
    
    return reply.send({
      ok: true,
      message: `Processed ${beforeDepth - afterDepth} items`,
      data: {
        before: beforeDepth,
        after: afterDepth,
        processed: beforeDepth - afterDepth,
        totalProcessed: automationState.stats.totalProcessed,
        signalEventsCreated: automationState.stats.signalEventsCreated || 0,
      },
    });
  });

  // ============================================
  // POST /admin/sentiment/automation/clear
  // ============================================
  app.post('/api/v4/admin/sentiment/automation/clear', async (req: FastifyRequest, reply: FastifyReply) => {
    const cleared = automationState.queue.length;
    automationState.queue = [];

    return reply.send({
      ok: true,
      message: `Queue cleared: ${cleared} items removed`,
      data: { cleared },
    });
  });

  // ============================================
  // POST /admin/sentiment/automation/reset
  // ============================================
  app.post('/api/v4/admin/sentiment/automation/reset', async (req: FastifyRequest, reply: FastifyReply) => {
    // Stop if running
    if (processingInterval) {
      clearInterval(processingInterval);
      processingInterval = null;
    }

    // Reset state
    automationState.isRunning = false;
    automationState.queue = [];
    automationState.results = [];
    automationState.stats = {
      totalEnqueued: 0,
      totalProcessed: 0,
      totalDropped: 0,
      totalFailed: 0,
      totalProcessingTimeMs: 0,
      lastProcessedAt: null,
    };

    return reply.send({
      ok: true,
      message: 'Automation state reset',
    });
  });

  // ============================================
  // POST /admin/sentiment/automation/enqueue
  // Enqueue a tweet for processing
  // ============================================
  app.post('/api/v4/admin/sentiment/automation/enqueue', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tweet } = req.body as { tweet: any };

    if (!tweet) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_TWEET',
        message: 'Tweet payload required',
      });
    }

    // S4.1 Guard: Validate text field
    const text = tweet.text || tweet.post?.text;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_TEXT',
        message: 'Tweet text is required and must be non-empty string',
      });
    }

    // Validate completeness
    const completenessScore = tweet.completenessScore ?? calculateCompleteness(tweet);
    
    if (completenessScore < QUEUE_CONFIG.minCompletenessScore) {
      automationState.stats.totalDropped++;
      return reply.send({
        ok: false,
        error: 'INCOMPLETE_PAYLOAD',
        message: `Completeness ${completenessScore} < ${QUEUE_CONFIG.minCompletenessScore}`,
        dropped: true,
      });
    }

    // Check queue size
    if (automationState.queue.length >= QUEUE_CONFIG.maxQueueSize) {
      return reply.status(429).send({
        ok: false,
        error: 'QUEUE_FULL',
        message: 'Queue is at maximum capacity',
      });
    }

    // Check duplicate
    const tweetId = tweet.tweet_id || tweet.tweetId || tweet.id;
    if (automationState.queue.some(q => q.tweet_id === tweetId)) {
      return reply.send({
        ok: false,
        error: 'DUPLICATE',
        message: 'Tweet already in queue',
      });
    }

    // Enqueue
    const queued: QueuedTweet = {
      id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      tweet_id: tweetId,
      text: tweet.text || tweet.post?.text,
      author_id: tweet.author?.author_id || tweet.author?.id || tweet.author_id || '',
      author_username: tweet.author?.username || tweet.username || '',
      completenessScore,
      enqueuedAt: new Date(),
      retries: 0,
      status: 'PENDING',
    };

    automationState.queue.push(queued);
    automationState.stats.totalEnqueued++;

    return reply.send({
      ok: true,
      message: 'Tweet enqueued',
      data: {
        queueId: queued.id,
        position: automationState.queue.length,
      },
    });
  });

  // ============================================
  // POST /admin/sentiment/automation/enqueue-batch
  // Enqueue multiple tweets
  // ============================================
  app.post('/api/v4/admin/sentiment/automation/enqueue-batch', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tweets } = req.body as { tweets: any[] };

    if (!tweets || !Array.isArray(tweets)) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_TWEETS',
        message: 'Array of tweets required',
      });
    }

    let enqueued = 0;
    let dropped = 0;
    let duplicates = 0;
    let invalidText = 0;

    for (const tweet of tweets) {
      // S4.1 Guard: Validate text field
      const text = tweet.text || tweet.post?.text;
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        invalidText++;
        continue;
      }

      const completenessScore = tweet.completenessScore ?? calculateCompleteness(tweet);
      const tweetId = tweet.tweet_id || tweet.tweetId || tweet.id;

      if (completenessScore < QUEUE_CONFIG.minCompletenessScore) {
        dropped++;
        automationState.stats.totalDropped++;
        continue;
      }

      if (automationState.queue.some(q => q.tweet_id === tweetId)) {
        duplicates++;
        continue;
      }

      if (automationState.queue.length >= QUEUE_CONFIG.maxQueueSize) {
        break;
      }

      const queued: QueuedTweet = {
        id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        tweet_id: tweetId,
        text: text,
        author_id: tweet.author?.author_id || tweet.author?.id || '',
        author_username: tweet.author?.username || '',
        completenessScore,
        enqueuedAt: new Date(),
        retries: 0,
        status: 'PENDING',
      };

      automationState.queue.push(queued);
      automationState.stats.totalEnqueued++;
      enqueued++;
    }

    return reply.send({
      ok: true,
      data: {
        enqueued,
        dropped,
        duplicates,
        invalidText,
        queueDepth: automationState.queue.filter(q => q.status === 'PENDING').length,
      },
    });
  });

  // ============================================
  // GET /admin/sentiment/automation/results
  // Get recent results
  // ============================================
  app.get('/api/v4/admin/sentiment/automation/results', async (req: FastifyRequest, reply: FastifyReply) => {
    const { limit = 20 } = req.query as { limit?: number };

    const results = automationState.results.slice(-Math.min(limit, 100));

    // Calculate stats from results
    const labelCounts = results.reduce((acc, r) => {
      acc[r.label] = (acc[r.label] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const avgConfidence = results.length > 0
      ? results.reduce((sum, r) => sum + r.confidenceScore, 0) / results.length
      : 0;

    return reply.send({
      ok: true,
      data: {
        count: results.length,
        results,
        summary: {
          labelCounts,
          avgConfidence: Math.round(avgConfidence * 100) / 100,
        },
      },
    });
  });

  // ============================================
  // GET /admin/sentiment/automation/queue
  // Get current queue
  // ============================================
  app.get('/api/v4/admin/sentiment/automation/queue', async (req: FastifyRequest, reply: FastifyReply) => {
    const { limit = 50 } = req.query as { limit?: number };

    return reply.send({
      ok: true,
      data: {
        depth: automationState.queue.length,
        pending: automationState.queue.filter(q => q.status === 'PENDING').length,
        processing: automationState.queue.filter(q => q.status === 'PROCESSING').length,
        items: automationState.queue.slice(0, limit),
      },
    });
  });
}

// ============================================================
// Helper Functions
// ============================================================

function calculateCompleteness(tweet: any): number {
  const requiredFields = [
    tweet.tweet_id || tweet.tweetId || tweet.id,
    tweet.text || tweet.post?.text,
    tweet.author?.avatar_url || tweet.author?.avatarUrl || tweet.author?.avatar,
    tweet.author?.followers_count ?? tweet.author?.followers,
    tweet.author?.following_count ?? tweet.author?.following,
  ];

  const present = requiredFields.filter(v => v !== undefined && v !== null && v !== '').length;
  return present / requiredFields.length;
}

export default registerSentimentAutomationRoutes;
