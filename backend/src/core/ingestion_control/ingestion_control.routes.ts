/**
 * Ingestion Control API Routes (P0.1)
 * 
 * Health endpoint + Admin controls
 */

import { FastifyInstance } from 'fastify';
import * as SyncState from './chain_sync_state.service.js';
import * as HealthService from './ingestion_health.service.js';
import * as SystemAlerts from './system_alerts.service.js';
import * as ReplayGuard from './replay_guard.service.js';
import * as RpcBudget from './rpc_budget_manager.js';
import * as Orchestrator from './ingestion_orchestrator.service.js';
import { SUPPORTED_CHAINS } from './chain_sync_state.model.js';

export default async function ingestionControlRoutes(fastify: FastifyInstance) {
  
  // ========================================
  // Health Endpoints (Public)
  // ========================================
  
  /**
   * GET /api/health/ingestion
   * Main health endpoint for ingestion system
   */
  fastify.get('/health/ingestion', async (request, reply) => {
    try {
      const health = await HealthService.calculateHealth();
      
      // Set appropriate status code based on health
      const statusCode = health.overall === 'CRITICAL' ? 503 : 
                        health.overall === 'WARNING' ? 200 : 200;
      
      return reply.code(statusCode).send({
        ok: health.overall !== 'CRITICAL',
        status: health.overall,
        timestamp: health.timestamp,
        chains: health.chains,
        summary: health.summary,
        alerts: health.alerts
      });
    } catch (error: any) {
      fastify.log.error('[IngestionHealth] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: 'HEALTH_CHECK_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/health/ingestion/simple
   * Simplified health check (for load balancers)
   */
  fastify.get('/health/ingestion/simple', async (request, reply) => {
    try {
      const { healthy, reason } = await HealthService.isHealthyForOperations();
      
      return reply.code(healthy ? 200 : 503).send({
        ok: healthy,
        reason
      });
    } catch (error: any) {
      return reply.code(503).send({
        ok: false,
        reason: error.message
      });
    }
  });
  
  /**
   * GET /api/ingestion/status
   * Full ingestion status including RPC budget
   */
  fastify.get('/ingestion/status', async (request, reply) => {
    try {
      const status = await Orchestrator.getIngestionStatus();
      return { ok: true, data: status };
    } catch (error: any) {
      fastify.log.error('[IngestionStatus] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: 'STATUS_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/ingestion/chains
   * List all chain states
   */
  fastify.get('/ingestion/chains', async (request, reply) => {
    try {
      const states = await SyncState.getAllChainStates();
      return {
        ok: true,
        data: {
          chains: states,
          supported: SUPPORTED_CHAINS
        }
      };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/ingestion/chains/:chain
   * Get specific chain state
   */
  fastify.get('/ingestion/chains/:chain', async (request, reply) => {
    try {
      const { chain } = request.params as { chain: string };
      const state = await SyncState.getChainState(chain);
      
      if (!state) {
        return reply.code(404).send({
          ok: false,
          error: 'CHAIN_NOT_FOUND',
          message: `Chain ${chain} not initialized`
        });
      }
      
      const budgetStatus = RpcBudget.getBudgetStatus(chain);
      
      return {
        ok: true,
        data: {
          state,
          rpcBudget: budgetStatus,
          lag: SyncState.calculateLag(state)
        }
      };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Alerts Endpoints
  // ========================================
  
  /**
   * GET /api/ingestion/alerts
   * Get active system alerts
   */
  fastify.get('/ingestion/alerts', async (request, reply) => {
    try {
      const { severity, chain } = request.query as { severity?: string; chain?: string };
      
      let alerts;
      if (chain) {
        alerts = await SystemAlerts.getAlertsForChain(chain);
      } else if (severity) {
        alerts = await SystemAlerts.getAlertsBySeverity(severity as any);
      } else {
        alerts = await SystemAlerts.getActiveAlerts();
      }
      
      return {
        ok: true,
        data: { alerts, count: alerts.length }
      };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/ingestion/alerts/stats
   * Get alert statistics
   */
  fastify.get('/ingestion/alerts/stats', async (request, reply) => {
    try {
      const stats = await SystemAlerts.getAlertStats();
      return { ok: true, data: stats };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'STATS_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/ingestion/alerts/check
   * Manually trigger alert check
   */
  fastify.post('/ingestion/alerts/check', async (request, reply) => {
    try {
      const result = await SystemAlerts.checkAndTriggerAlerts();
      return {
        ok: true,
        data: result,
        message: `Triggered ${result.triggered}, resolved ${result.resolved} alerts`
      };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'CHECK_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Replay Guard Endpoints
  // ========================================
  
  /**
   * GET /api/ingestion/replay/stats
   * Get replay guard statistics
   */
  fastify.get('/ingestion/replay/stats', async (request, reply) => {
    try {
      const stats = await ReplayGuard.getReplayStats();
      return { ok: true, data: stats };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'STATS_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/ingestion/replay/failed
   * Get failed ranges
   */
  fastify.get('/ingestion/replay/failed', async (request, reply) => {
    try {
      const { chain } = request.query as { chain?: string };
      const ranges = await ReplayGuard.getUnresolvedFailedRanges(chain);
      return {
        ok: true,
        data: { ranges, count: ranges.length }
      };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/ingestion/replay/in-progress
   * Get in-progress windows
   */
  fastify.get('/ingestion/replay/in-progress', async (request, reply) => {
    try {
      const { chain } = request.query as { chain?: string };
      const entries = await ReplayGuard.getInProgress(chain);
      return {
        ok: true,
        data: { entries, count: entries.length }
      };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Admin Endpoints (Internal Only)
  // ========================================
  
  /**
   * POST /api/admin/ingestion/pause/:chain
   * Pause chain ingestion
   */
  fastify.post('/admin/ingestion/pause/:chain', async (request, reply) => {
    try {
      const { chain } = request.params as { chain: string };
      const { reason } = request.body as { reason?: string };
      
      const state = await SyncState.pauseChain(chain, reason || 'Manual pause via API');
      RpcBudget.forcePause(chain, 3600000); // 1 hour
      
      return {
        ok: true,
        data: state,
        message: `Chain ${chain} paused`
      };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'PAUSE_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/admin/ingestion/resume/:chain
   * Resume chain ingestion
   */
  fastify.post('/admin/ingestion/resume/:chain', async (request, reply) => {
    try {
      const { chain } = request.params as { chain: string };
      
      const state = await SyncState.resumeChain(chain);
      RpcBudget.forceUnpause(chain);
      
      return {
        ok: true,
        data: state,
        message: `Chain ${chain} resumed`
      };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'RESUME_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/admin/ingestion/reset/:chain
   * Reset chain to specific block (DANGEROUS)
   */
  fastify.post('/admin/ingestion/reset/:chain', async (request, reply) => {
    try {
      const { chain } = request.params as { chain: string };
      const { block, confirm } = request.body as { block: number; confirm?: boolean };
      
      if (!confirm) {
        return reply.code(400).send({
          ok: false,
          error: 'CONFIRMATION_REQUIRED',
          message: 'Set confirm: true to proceed with reset'
        });
      }
      
      if (typeof block !== 'number' || block < 0) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_BLOCK',
          message: 'block must be a non-negative number'
        });
      }
      
      const state = await SyncState.resetChain(chain, block);
      
      return {
        ok: true,
        data: state,
        message: `Chain ${chain} reset to block ${block}`
      };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'RESET_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/admin/ingestion/init
   * Initialize all chains
   */
  fastify.post('/admin/ingestion/init', async (request, reply) => {
    try {
      const body = request.body as { startBlocks?: Record<string, number> } || {};
      const startBlocks = body.startBlocks;
      
      await Orchestrator.initializeIngestion(startBlocks);
      
      return {
        ok: true,
        message: `Initialized ${SUPPORTED_CHAINS.length} chains`
      };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'INIT_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/admin/ingestion/cleanup
   * Cleanup old replay guard entries
   */
  fastify.post('/admin/ingestion/cleanup', async (request, reply) => {
    try {
      const [cleanupResult, staleResult] = await Promise.all([
        ReplayGuard.cleanupOldEntries(),
        ReplayGuard.resetStaleEntries()
      ]);
      
      return {
        ok: true,
        data: {
          deletedOldEntries: cleanupResult.deleted,
          resetStaleEntries: staleResult.reset
        }
      };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'CLEANUP_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/admin/ingestion/alerts/:alertId/acknowledge
   * Acknowledge an alert
   */
  fastify.post('/admin/ingestion/alerts/:alertId/acknowledge', async (request, reply) => {
    try {
      const { alertId } = request.params as { alertId: string };
      const { acknowledgedBy } = request.body as { acknowledgedBy?: string };
      
      await SystemAlerts.acknowledgeAlert(alertId, acknowledgedBy || 'admin');
      
      return {
        ok: true,
        message: `Alert ${alertId} acknowledged`
      };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'ACKNOWLEDGE_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/admin/ingestion/alerts/:alertId/resolve
   * Resolve an alert
   */
  fastify.post('/admin/ingestion/alerts/:alertId/resolve', async (request, reply) => {
    try {
      const { alertId } = request.params as { alertId: string };
      
      await SystemAlerts.resolveAlert(alertId);
      
      return {
        ok: true,
        message: `Alert ${alertId} resolved`
      };
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'RESOLVE_ERROR',
        message: error.message
      });
    }
  });
  
  fastify.log.info('[Ingestion Control] Routes registered');
}
