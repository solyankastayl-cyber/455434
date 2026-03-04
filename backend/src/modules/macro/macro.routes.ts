/**
 * Macro Context API Routes
 * 
 * Provides macro market context (Fear & Greed, Dominance)
 * for the Market State Anchor layer.
 * 
 * API Version: v10
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getMacroSnapshot, getCurrentSnapshot } from './services/macro.snapshot.service.js';
import { getMacroSignal, calculateMacroImpact } from './services/macro.signal.service.js';
import { clearFearGreedCache, fetchFearGreedHistory } from './providers/feargreed.provider.js';
import { clearDominanceCache } from './providers/dominance.provider.js';
import { clearSnapshotCache } from './services/macro.snapshot.service.js';
import { 
  startMacroAlertMonitor, 
  stopMacroAlertMonitor, 
  getMacroMonitorState,
  triggerMacroAlertCheck 
} from './services/macro.alert.monitor.js';

export async function macroRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v10/macro/health
   * Health check for macro module
   */
  fastify.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const snapshot = getCurrentSnapshot();
    
    return reply.send({
      ok: true,
      module: 'macro',
      version: 'v1.0',
      hasData: snapshot !== null,
      quality: snapshot?.quality.mode || 'NO_DATA',
      lastUpdate: snapshot?.ts || null,
    });
  });

  /**
   * GET /api/v10/macro/snapshot
   * Get current macro snapshot (aggregated data)
   */
  fastify.get('/snapshot', async (request: FastifyRequest, reply: FastifyReply) => {
    const { refresh } = request.query as { refresh?: string };
    const forceRefresh = refresh === 'true' || refresh === '1';
    
    try {
      const snapshot = await getMacroSnapshot(forceRefresh);
      
      return reply.send({
        ok: true,
        data: snapshot,
      });
    } catch (error: any) {
      fastify.log.error('[Macro] Snapshot error:', error.message);
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get macro snapshot',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v10/macro/signal
   * Get current macro signal (processed for Meta-Brain)
   */
  fastify.get('/signal', async (request: FastifyRequest, reply: FastifyReply) => {
    const { refresh } = request.query as { refresh?: string };
    const forceRefresh = refresh === 'true' || refresh === '1';
    
    try {
      const signal = await getMacroSignal(forceRefresh);
      
      return reply.send({
        ok: true,
        data: signal,
      });
    } catch (error: any) {
      fastify.log.error('[Macro] Signal error:', error.message);
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get macro signal',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v10/macro/impact
   * Get macro impact for Meta-Brain integration
   */
  fastify.get('/impact', async (request: FastifyRequest, reply: FastifyReply) => {
    const { refresh } = request.query as { refresh?: string };
    const forceRefresh = refresh === 'true' || refresh === '1';
    
    try {
      const signal = await getMacroSignal(forceRefresh);
      const impact = calculateMacroImpact(signal);
      
      return reply.send({
        ok: true,
        data: {
          signal,
          impact,
        },
      });
    } catch (error: any) {
      fastify.log.error('[Macro] Impact error:', error.message);
      return reply.status(500).send({
        ok: false,
        error: 'Failed to calculate macro impact',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v10/macro/fear-greed
   * Get Fear & Greed index only
   */
  fastify.get('/fear-greed', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const snapshot = await getMacroSnapshot();
      
      return reply.send({
        ok: true,
        data: {
          fearGreed: snapshot.fearGreed,
          quality: snapshot.quality,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get Fear & Greed index',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v10/macro/dominance
   * Get market dominance data only
   */
  fastify.get('/dominance', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const snapshot = await getMacroSnapshot();
      
      return reply.send({
        ok: true,
        data: {
          dominance: snapshot.dominance,
          rsi: snapshot.rsi,
          quality: snapshot.quality,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get dominance data',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v10/macro/fear-greed/history
   * Get historical Fear & Greed data (7 days default, max 30)
   */
  fastify.get('/fear-greed/history', async (request: FastifyRequest, reply: FastifyReply) => {
    const { days } = request.query as { days?: string };
    const numDays = days ? parseInt(days, 10) : 7;
    
    try {
      const result = await fetchFearGreedHistory(numDays);
      
      return reply.send({
        ok: true,
        data: {
          history: result.data,
          quality: result.quality,
          days: result.data.length,
        },
      });
    } catch (error: any) {
      fastify.log.error('[Macro] Fear & Greed history error:', error.message);
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get Fear & Greed history',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v10/macro/refresh
   * Force refresh all macro data
   */
  fastify.post('/refresh', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Clear all caches
      clearFearGreedCache();
      clearDominanceCache();
      clearSnapshotCache();
      
      // Fetch fresh data
      const snapshot = await getMacroSnapshot(true);
      const signal = await getMacroSignal(true);
      
      return reply.send({
        ok: true,
        message: 'Macro data refreshed',
        data: {
          snapshot,
          signal,
        },
      });
    } catch (error: any) {
      fastify.log.error('[Macro] Refresh error:', error.message);
      return reply.status(500).send({
        ok: false,
        error: 'Failed to refresh macro data',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v10/macro/rules
   * Get current rule definitions (for UI display)
   */
  fastify.get('/rules', async (_request: FastifyRequest, reply: FastifyReply) => {
    const { FEAR_GREED_RULES, MACRO_THRESHOLDS } = await import('./contracts/macro.types.js');
    
    return reply.send({
      ok: true,
      data: {
        fearGreedRules: FEAR_GREED_RULES,
        thresholds: MACRO_THRESHOLDS,
        version: 'v1.0',
        locked: true,
      },
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // MACRO ALERT MONITORING
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/v10/macro/alerts/status
   * Get macro alert monitor status
   */
  fastify.get('/alerts/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const state = getMacroMonitorState();
    
    return reply.send({
      ok: true,
      data: state,
    });
  });

  /**
   * POST /api/v10/macro/alerts/start
   * Start macro alert monitoring
   */
  fastify.post('/alerts/start', async (_request: FastifyRequest, reply: FastifyReply) => {
    startMacroAlertMonitor();
    
    return reply.send({
      ok: true,
      message: 'Macro alert monitor started',
      data: getMacroMonitorState(),
    });
  });

  /**
   * POST /api/v10/macro/alerts/stop
   * Stop macro alert monitoring
   */
  fastify.post('/alerts/stop', async (_request: FastifyRequest, reply: FastifyReply) => {
    stopMacroAlertMonitor();
    
    return reply.send({
      ok: true,
      message: 'Macro alert monitor stopped',
      data: getMacroMonitorState(),
    });
  });

  /**
   * POST /api/v10/macro/alerts/trigger
   * Manually trigger macro alert check (for testing)
   */
  fastify.post('/alerts/trigger', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await triggerMacroAlertCheck();
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to trigger macro alert check',
        message: error.message,
      });
    }
  });

  fastify.log.info('[Macro] Routes registered at /api/v10/macro');
}
