/**
 * Twitter Data Session Mode — ML1.R.DS
 * =====================================
 * 
 * Session-based Twitter data collection для Retrain Dataset.
 * 
 * ПРИНЦИП:
 * - Twitter НЕ работает постоянно
 * - Включается по команде (session)
 * - Автоматически выключается после лимита
 * - Собирает данные для retrain dataset
 * 
 * РЕЖИМЫ:
 * - Quick: 50 tweets
 * - Medium: 200 tweets  
 * - Full: 500 tweets
 * - Custom: N tweets / T minutes
 * 
 * НЕ ДЕЛАЕТ:
 * - Price layer
 * - Author intelligence
 * - Production decisions
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sentimentClient } from './sentiment.client.js';
import { realMLShadowClient } from './real-ml-shadow.client.js';
import { retrainDatasetService } from './retrain-dataset.service.js';

// ============================================================
// Session Configuration
// ============================================================

const SESSION_PRESETS = {
  quick: { maxTweets: 50, maxMinutes: 5, description: 'Quick test (50 tweets, 5 min)' },
  medium: { maxTweets: 200, maxMinutes: 15, description: 'Medium session (200 tweets, 15 min)' },
  full: { maxTweets: 500, maxMinutes: 30, description: 'Full collection (500 tweets, 30 min)' },
  stress: { maxTweets: 1000, maxMinutes: 60, description: 'Stress test (1000 tweets, 60 min)' },
};

// ============================================================
// Session State
// ============================================================

interface DataSession {
  id: string;
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'STOPPED' | 'ERROR';
  preset: string;
  config: {
    maxTweets: number;
    maxMinutes: number;
  };
  startedAt: Date | null;
  endedAt: Date | null;
  stats: {
    tweetsProcessed: number;
    samplesAdded: number;
    samplesSkipped: number;
    errors: number;
    mockLabels: { POSITIVE: number; NEUTRAL: number; NEGATIVE: number };
    cnnLabels: { POSITIVE: number; NEUTRAL: number; NEGATIVE: number };
    mismatches: number;
  };
  stopReason?: string;
}

let currentSession: DataSession = {
  id: '',
  status: 'IDLE',
  preset: 'none',
  config: { maxTweets: 0, maxMinutes: 0 },
  startedAt: null,
  endedAt: null,
  stats: {
    tweetsProcessed: 0,
    samplesAdded: 0,
    samplesSkipped: 0,
    errors: 0,
    mockLabels: { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0 },
    cnnLabels: { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0 },
    mismatches: 0,
  },
};

let sessionCheckInterval: NodeJS.Timeout | null = null;

// ============================================================
// Session Management
// ============================================================

function generateSessionId(): string {
  return `DS_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function resetSession(): void {
  currentSession = {
    id: '',
    status: 'IDLE',
    preset: 'none',
    config: { maxTweets: 0, maxMinutes: 0 },
    startedAt: null,
    endedAt: null,
    stats: {
      tweetsProcessed: 0,
      samplesAdded: 0,
      samplesSkipped: 0,
      errors: 0,
      mockLabels: { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0 },
      cnnLabels: { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0 },
      mismatches: 0,
    },
  };
}

function shouldStopSession(): { stop: boolean; reason: string } {
  if (currentSession.status !== 'RUNNING') {
    return { stop: false, reason: '' };
  }

  // Check tweet limit
  if (currentSession.stats.tweetsProcessed >= currentSession.config.maxTweets) {
    return { stop: true, reason: `Tweet limit reached (${currentSession.config.maxTweets})` };
  }

  // Check time limit
  if (currentSession.startedAt) {
    const elapsedMinutes = (Date.now() - currentSession.startedAt.getTime()) / 60000;
    if (elapsedMinutes >= currentSession.config.maxMinutes) {
      return { stop: true, reason: `Time limit reached (${currentSession.config.maxMinutes} min)` };
    }
  }

  return { stop: false, reason: '' };
}

async function stopSession(reason: string): Promise<void> {
  if (currentSession.status !== 'RUNNING') return;

  currentSession.status = 'COMPLETED';
  currentSession.endedAt = new Date();
  currentSession.stopReason = reason;

  if (sessionCheckInterval) {
    clearInterval(sessionCheckInterval);
    sessionCheckInterval = null;
  }

  console.log(`[DataSession] Session ${currentSession.id} stopped: ${reason}`);
}

// ============================================================
// Core Processing
// ============================================================

async function processTextForDataset(text: string): Promise<{
  added: boolean;
  reason?: string;
  mock?: { label: string; confidence: number };
  cnn?: { label: string; confidence: number };
}> {
  if (currentSession.status !== 'RUNNING') {
    return { added: false, reason: 'session_not_running' };
  }

  try {
    // Get MOCK result
    const mockResult = await sentimentClient.predict(text);
    const mockLabel = mockResult.label;
    const mockConfidence = mockResult.meta.confidenceScore || 0.5;
    
    // Update mock stats
    currentSession.stats.mockLabels[mockLabel as keyof typeof currentSession.stats.mockLabels]++;

    // Get CNN result (shadow)
    let cnnLabel: string | null = null;
    let cnnConfidence = 0;
    let cnnScore = 0;

    if (realMLShadowClient.isEnabled()) {
      const cnnResult = await realMLShadowClient.predict(text);
      if (cnnResult && !cnnResult.error) {
        cnnLabel = cnnResult.label;
        cnnConfidence = cnnResult.confidence;
        cnnScore = cnnResult.score;
        
        // Update CNN stats
        currentSession.stats.cnnLabels[cnnLabel as keyof typeof currentSession.stats.cnnLabels]++;
        
        // Track mismatches
        if (mockLabel !== cnnLabel) {
          currentSession.stats.mismatches++;
        }
      }
    }

    if (!cnnLabel) {
      currentSession.stats.samplesSkipped++;
      return { 
        added: false, 
        reason: 'cnn_unavailable',
        mock: { label: mockLabel, confidence: mockConfidence },
      };
    }

    // Add to retrain dataset
    const addResult = await retrainDatasetService.addFromShadow(
      text,
      { label: mockLabel, score: mockResult.score, confidence: mockConfidence },
      { label: cnnLabel, score: cnnScore, confidence: cnnConfidence },
      mockLabel, // final label = MOCK (source of truth)
      mockConfidence,
      mockResult.meta.flags || []
    );

    currentSession.stats.tweetsProcessed++;

    if (addResult.added) {
      currentSession.stats.samplesAdded++;
      return {
        added: true,
        mock: { label: mockLabel, confidence: mockConfidence },
        cnn: { label: cnnLabel, confidence: cnnConfidence },
      };
    } else {
      currentSession.stats.samplesSkipped++;
      return {
        added: false,
        reason: addResult.reason,
        mock: { label: mockLabel, confidence: mockConfidence },
        cnn: { label: cnnLabel, confidence: cnnConfidence },
      };
    }
  } catch (error: any) {
    currentSession.stats.errors++;
    return { added: false, reason: error.message };
  }
}

// ============================================================
// Routes
// ============================================================

export default async function twitterDataSessionRoutes(app: FastifyInstance) {
  
  /**
   * GET /api/v4/admin/ml/data-session/status
   * Get current session status
   */
  app.get('/api/v4/admin/ml/data-session/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const elapsedMinutes = currentSession.startedAt 
      ? Math.round((Date.now() - currentSession.startedAt.getTime()) / 60000 * 10) / 10
      : 0;

    return reply.send({
      ok: true,
      data: {
        ...currentSession,
        elapsedMinutes,
        progress: {
          tweets: `${currentSession.stats.tweetsProcessed}/${currentSession.config.maxTweets}`,
          time: `${elapsedMinutes}/${currentSession.config.maxMinutes} min`,
          percentComplete: currentSession.config.maxTweets > 0 
            ? Math.round(currentSession.stats.tweetsProcessed / currentSession.config.maxTweets * 100)
            : 0,
        },
        presets: SESSION_PRESETS,
      },
    });
  });

  /**
   * POST /api/v4/admin/ml/data-session/start
   * Start a new data collection session
   */
  app.post('/api/v4/admin/ml/data-session/start', async (req: FastifyRequest, reply: FastifyReply) => {
    const { preset = 'medium', maxTweets, maxMinutes } = req.body as {
      preset?: keyof typeof SESSION_PRESETS | 'custom';
      maxTweets?: number;
      maxMinutes?: number;
    };

    // Check if already running
    if (currentSession.status === 'RUNNING') {
      return reply.status(400).send({
        ok: false,
        error: 'SESSION_ALREADY_RUNNING',
        message: 'Stop current session first',
        currentSession: currentSession.id,
      });
    }

    // Check if shadow mode is enabled
    if (!realMLShadowClient.isEnabled()) {
      return reply.status(400).send({
        ok: false,
        error: 'SHADOW_MODE_DISABLED',
        message: 'Enable Shadow Mode first to collect CNN data',
      });
    }

    // Configure session
    let config: { maxTweets: number; maxMinutes: number };
    
    if (preset === 'custom') {
      if (!maxTweets || !maxMinutes) {
        return reply.status(400).send({
          ok: false,
          error: 'INVALID_CUSTOM_CONFIG',
          message: 'Custom preset requires maxTweets and maxMinutes',
        });
      }
      config = { maxTweets, maxMinutes };
    } else {
      const presetConfig = SESSION_PRESETS[preset];
      if (!presetConfig) {
        return reply.status(400).send({
          ok: false,
          error: 'INVALID_PRESET',
          message: `Valid presets: ${Object.keys(SESSION_PRESETS).join(', ')}`,
        });
      }
      config = { maxTweets: presetConfig.maxTweets, maxMinutes: presetConfig.maxMinutes };
    }

    // Reset and start session
    resetSession();
    currentSession.id = generateSessionId();
    currentSession.status = 'RUNNING';
    currentSession.preset = preset;
    currentSession.config = config;
    currentSession.startedAt = new Date();

    // Start session check interval
    sessionCheckInterval = setInterval(() => {
      const check = shouldStopSession();
      if (check.stop) {
        stopSession(check.reason);
      }
    }, 10000); // Check every 10 seconds

    console.log(`[DataSession] Started session ${currentSession.id} with preset=${preset}, maxTweets=${config.maxTweets}, maxMinutes=${config.maxMinutes}`);

    return reply.send({
      ok: true,
      message: 'Data collection session started',
      data: {
        sessionId: currentSession.id,
        preset,
        config,
        instructions: [
          'Session is now RUNNING',
          'Use /api/v4/admin/ml/data-session/feed to add texts',
          'Session will auto-stop when limits are reached',
          'Use /api/v4/admin/ml/data-session/stop to stop manually',
        ],
      },
    });
  });

  /**
   * POST /api/v4/admin/ml/data-session/stop
   * Stop current session
   */
  app.post('/api/v4/admin/ml/data-session/stop', async (req: FastifyRequest, reply: FastifyReply) => {
    if (currentSession.status !== 'RUNNING') {
      return reply.status(400).send({
        ok: false,
        error: 'NO_ACTIVE_SESSION',
        message: 'No running session to stop',
      });
    }

    await stopSession('Manual stop');

    return reply.send({
      ok: true,
      message: 'Session stopped',
      data: {
        sessionId: currentSession.id,
        stats: currentSession.stats,
        duration: currentSession.startedAt 
          ? `${Math.round((Date.now() - currentSession.startedAt.getTime()) / 60000)} minutes`
          : '0 minutes',
      },
    });
  });

  /**
   * POST /api/v4/admin/ml/data-session/feed
   * Feed a single text to the session
   */
  app.post('/api/v4/admin/ml/data-session/feed', async (req: FastifyRequest, reply: FastifyReply) => {
    const { text } = req.body as { text: string };

    if (!text || typeof text !== 'string') {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_TEXT',
        message: 'Text is required',
      });
    }

    if (currentSession.status !== 'RUNNING') {
      return reply.status(400).send({
        ok: false,
        error: 'SESSION_NOT_RUNNING',
        message: 'Start a session first',
      });
    }

    // Check limits before processing
    const check = shouldStopSession();
    if (check.stop) {
      await stopSession(check.reason);
      return reply.send({
        ok: true,
        data: {
          added: false,
          reason: 'session_auto_stopped',
          sessionEnded: true,
          stats: currentSession.stats,
        },
      });
    }

    const result = await processTextForDataset(text);

    return reply.send({
      ok: true,
      data: {
        ...result,
        progress: {
          tweetsProcessed: currentSession.stats.tweetsProcessed,
          maxTweets: currentSession.config.maxTweets,
          samplesAdded: currentSession.stats.samplesAdded,
        },
      },
    });
  });

  /**
   * POST /api/v4/admin/ml/data-session/feed-batch
   * Feed multiple texts to the session
   */
  app.post('/api/v4/admin/ml/data-session/feed-batch', async (req: FastifyRequest, reply: FastifyReply) => {
    const { texts } = req.body as { texts: string[] };

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_TEXTS',
        message: 'Array of texts is required',
      });
    }

    if (texts.length > 100) {
      return reply.status(400).send({
        ok: false,
        error: 'TOO_MANY_TEXTS',
        message: 'Maximum 100 texts per batch',
      });
    }

    if (currentSession.status !== 'RUNNING') {
      return reply.status(400).send({
        ok: false,
        error: 'SESSION_NOT_RUNNING',
        message: 'Start a session first',
      });
    }

    let added = 0;
    let skipped = 0;
    let sessionEnded = false;

    for (const text of texts) {
      // Check limits before each text
      const check = shouldStopSession();
      if (check.stop) {
        await stopSession(check.reason);
        sessionEnded = true;
        break;
      }

      if (!text || typeof text !== 'string' || text.length < 5) {
        skipped++;
        continue;
      }

      const result = await processTextForDataset(text);
      if (result.added) {
        added++;
      } else {
        skipped++;
      }
    }

    return reply.send({
      ok: true,
      data: {
        total: texts.length,
        added,
        skipped,
        sessionEnded,
        stats: currentSession.stats,
        progress: {
          tweetsProcessed: currentSession.stats.tweetsProcessed,
          maxTweets: currentSession.config.maxTweets,
          percentComplete: Math.round(currentSession.stats.tweetsProcessed / currentSession.config.maxTweets * 100),
        },
      },
    });
  });

  /**
   * GET /api/v4/admin/ml/data-session/summary
   * Get session summary with mismatch analysis
   */
  app.get('/api/v4/admin/ml/data-session/summary', async (req: FastifyRequest, reply: FastifyReply) => {
    const datasetStats = await retrainDatasetService.getStats();

    return reply.send({
      ok: true,
      data: {
        session: {
          id: currentSession.id || 'none',
          status: currentSession.status,
          preset: currentSession.preset,
          startedAt: currentSession.startedAt,
          endedAt: currentSession.endedAt,
          stopReason: currentSession.stopReason,
        },
        collection: {
          tweetsProcessed: currentSession.stats.tweetsProcessed,
          samplesAdded: currentSession.stats.samplesAdded,
          samplesSkipped: currentSession.stats.samplesSkipped,
          errors: currentSession.stats.errors,
          addRate: currentSession.stats.tweetsProcessed > 0 
            ? Math.round(currentSession.stats.samplesAdded / currentSession.stats.tweetsProcessed * 100)
            : 0,
        },
        labels: {
          mock: currentSession.stats.mockLabels,
          cnn: currentSession.stats.cnnLabels,
          mismatches: currentSession.stats.mismatches,
          mismatchRate: currentSession.stats.tweetsProcessed > 0
            ? Math.round(currentSession.stats.mismatches / currentSession.stats.tweetsProcessed * 100)
            : 0,
        },
        dataset: {
          total: datasetStats.total,
          validForRetrain: datasetStats.validForRetrain,
          balance: datasetStats.balance,
          isBalanced: datasetStats.balance.isBalanced,
        },
        recommendation: datasetStats.validForRetrain >= 500
          ? 'Dataset ready for mismatch analysis'
          : `Need ${500 - datasetStats.validForRetrain} more valid samples`,
      },
    });
  });
}
