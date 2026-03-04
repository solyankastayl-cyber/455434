/**
 * ML1 Shadow Mode Routes
 * =======================
 * 
 * API для мониторинга и управления Shadow Mode.
 * REAL ML ничего не решает — только логирует.
 * 
 * ML1.4 Hybrid Booster — CNN как усилитель confidence.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { realMLShadowClient } from './real-ml-shadow.client.js';
import { sentimentClient } from './sentiment.client.js';

export default async function ml1ShadowRoutes(app: FastifyInstance) {
  
  // ============================================================
  // ML1.4 HYBRID BOOSTER ROUTES
  // ============================================================
  
  /**
   * GET /api/v4/admin/sentiment/booster/status
   * Get ML1.4 Hybrid Booster status
   */
  app.get('/api/v4/admin/sentiment/booster/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const boosterStatus = sentimentClient.getBoosterStatus();
    
    return reply.send({
      ok: true,
      data: {
        ...boosterStatus,
        description: 'ML1.4 Hybrid Confidence Booster',
        conditions: [
          'MOCK label = NEUTRAL',
          'CNN label = POSITIVE',
          `CNN confidence >= ${Math.round(boosterStatus.config.cnnConfidenceThreshold * 100)}%`,
          'No conflict/question flags',
        ],
        effects: [
          'Label stays NEUTRAL (MOCK is source of truth)',
          `Confidence boosted by up to ${Math.round(boosterStatus.config.maxBoost * 100)}%`,
          `Confidence capped at ${Math.round(boosterStatus.config.confidenceCap * 100)}%`,
          'Flags: cnn_positive_boost added',
        ],
      },
    });
  });
  
  /**
   * POST /api/v4/admin/sentiment/booster/toggle
   * Enable/disable ML1.4 Hybrid Booster
   */
  app.post('/api/v4/admin/sentiment/booster/toggle', async (req: FastifyRequest, reply: FastifyReply) => {
    const { enabled } = req.body as { enabled: boolean };
    
    const result = sentimentClient.setBoosterEnabled(enabled);
    
    return reply.send({
      ok: true,
      message: `Hybrid Booster ${enabled ? 'ENABLED' : 'DISABLED'}`,
      data: result,
    });
  });
  
  /**
   * POST /api/v4/admin/sentiment/booster/threshold
   * Update CNN confidence threshold for booster
   */
  app.post('/api/v4/admin/sentiment/booster/threshold', async (req: FastifyRequest, reply: FastifyReply) => {
    const { threshold } = req.body as { threshold: number };
    
    try {
      const result = sentimentClient.setBoosterThreshold(threshold);
      
      return reply.send({
        ok: true,
        message: `Booster threshold updated to ${Math.round(threshold * 100)}%`,
        data: result,
      });
    } catch (error: any) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_THRESHOLD',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v4/admin/sentiment/booster/test
   * Test ML1.4 Hybrid Booster with a specific text
   */
  app.post('/api/v4/admin/sentiment/booster/test', async (req: FastifyRequest, reply: FastifyReply) => {
    const { text } = req.body as { text: string };
    
    if (!text || typeof text !== 'string') {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_TEXT',
        message: 'Text is required',
      });
    }
    
    // Run prediction which includes ML1.4 booster logic
    const result = await sentimentClient.predict(text);
    
    return reply.send({
      ok: true,
      data: {
        text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        label: result.label,
        score: result.score,
        confidence: result.meta.confidenceScore,
        confidenceLevel: result.meta.confidence,
        hybridBooster: result.meta.hybridBooster,
        flags: result.meta.flags,
        reasons: result.meta.reasons,
      },
    });
  });

  // ============================================================
  // SHADOW MODE ROUTES
  // ============================================================
  
  /**
   * GET /api/v4/admin/sentiment/shadow/status
   * Shadow mode status and stats
   */
  app.get('/api/v4/admin/sentiment/shadow/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const shadowData = realMLShadowClient.getStats();
    
    return reply.send({
      ok: true,
      data: {
        mode: shadowData.enabled ? 'SHADOW' : 'OFF',
        enabled: shadowData.enabled,
        stats: {
          totalComparisons: shadowData.stats.totalComparisons,
          labelMatches: shadowData.stats.labelMatches,
          labelMismatches: shadowData.stats.labelMismatches,
          realErrors: shadowData.stats.realErrors,
          lastUpdate: shadowData.stats.lastUpdate,
        },
        metrics: {
          labelMatchRate: Math.round(shadowData.metrics.labelMatchRate * 1000) / 10, // %
          avgScoreDiff: Math.round(shadowData.metrics.avgScoreDiff * 1000) / 1000,
          avgConfidenceDiff: Math.round(shadowData.metrics.avgConfidenceDiff * 1000) / 1000,
          avgLatencyMs: Math.round(shadowData.metrics.avgLatencyMs),
          errorRate: Math.round(shadowData.metrics.errorRate * 1000) / 10, // %
        },
        alerts: getAlerts(shadowData),
        recentMismatches: shadowData.stats.recentMismatches.slice(-5),
      },
    });
  });
  
  /**
   * POST /api/v4/admin/sentiment/shadow/toggle
   * Enable/disable shadow mode
   */
  app.post('/api/v4/admin/sentiment/shadow/toggle', async (req: FastifyRequest, reply: FastifyReply) => {
    const { enabled } = req.body as { enabled: boolean };
    
    realMLShadowClient.setEnabled(enabled);
    
    console.log(`[ML1] Shadow mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
    
    return reply.send({
      ok: true,
      message: `Shadow mode ${enabled ? 'enabled' : 'disabled'}`,
      data: { enabled },
    });
  });
  
  /**
   * GET /api/v4/admin/sentiment/shadow/log
   * Get recent shadow comparison events
   */
  app.get('/api/v4/admin/sentiment/shadow/log', async (req: FastifyRequest, reply: FastifyReply) => {
    const { limit = 50 } = req.query as { limit?: number };
    
    const log = realMLShadowClient.getLog(Math.min(limit, 100));
    
    return reply.send({
      ok: true,
      data: {
        count: log.length,
        events: log,
      },
    });
  });
  
  /**
   * POST /api/v4/admin/sentiment/shadow/reset
   * Reset shadow stats
   */
  app.post('/api/v4/admin/sentiment/shadow/reset', async (req: FastifyRequest, reply: FastifyReply) => {
    realMLShadowClient.resetStats();
    
    return reply.send({
      ok: true,
      message: 'Shadow stats reset',
    });
  });
  
  /**
   * POST /api/v4/admin/sentiment/shadow/test
   * Test shadow comparison with a single text
   */
  app.post('/api/v4/admin/sentiment/shadow/test', async (req: FastifyRequest, reply: FastifyReply) => {
    const { text } = req.body as { text: string };
    
    if (!text || typeof text !== 'string') {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_TEXT',
        message: 'Text is required',
      });
    }
    
    // Get mock result
    const mockStart = Date.now();
    const mockResult = await sentimentClient.predict(text);
    const mockLatency = Date.now() - mockStart;
    
    // Get shadow comparison
    const comparison = await realMLShadowClient.shadowCompare(
      text,
      {
        label: mockResult.label,
        score: mockResult.score,
        confidence: mockResult.meta?.confidenceScore || 0.5,
      },
      mockLatency
    );
    
    return reply.send({
      ok: true,
      data: {
        text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        comparison,
        mockFull: mockResult,
      },
    });
  });
  
  console.log('[ML1 Shadow] Routes registered');
}

// ============================================================
// Helpers
// ============================================================

function getAlerts(shadowData: ReturnType<typeof realMLShadowClient.getStats>): string[] {
  const alerts: string[] = [];
  
  // High mismatch rate
  if (shadowData.stats.totalComparisons > 10 && shadowData.metrics.labelMatchRate < 0.7) {
    alerts.push(`⚠️ High mismatch rate: ${Math.round((1 - shadowData.metrics.labelMatchRate) * 100)}%`);
  }
  
  // High error rate
  if (shadowData.metrics.errorRate > 0.1) {
    alerts.push(`⚠️ High error rate: ${Math.round(shadowData.metrics.errorRate * 100)}%`);
  }
  
  // High latency
  if (shadowData.metrics.avgLatencyMs > 1000) {
    alerts.push(`⚠️ High latency: ${Math.round(shadowData.metrics.avgLatencyMs)}ms`);
  }
  
  return alerts;
}
