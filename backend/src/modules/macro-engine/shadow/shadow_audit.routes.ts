/**
 * P6.5 — Shadow Audit & Health Routes
 * 
 * Endpoints:
 * - GET /api/macro-engine/health — Health snapshot
 * - GET /api/macro-engine/shadow/audit — Audit history
 * - GET /api/macro-engine/shadow/alerts — Recent alerts
 * - POST /api/macro-engine/shadow/check — Force divergence check
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getShadowAuditService } from './shadow_audit.service.js';
import { getAlertDispatchService } from './alert_dispatch.service.js';

export async function shadowAuditRoutes(fastify: FastifyInstance): Promise<void> {
  const shadowService = getShadowAuditService();
  const alertService = getAlertDispatchService();
  
  // Initialize on startup
  await shadowService.initialize();
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/health — P6.5 Health Snapshot
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/macro-engine/health', async (
    request: FastifyRequest<{ Querystring: { asset?: string } }>,
    reply: FastifyReply
  ) => {
    const asset = request.query.asset || 'dxy';
    
    try {
      const health = await shadowService.getHealthSnapshot(asset);
      return reply.send(health);
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'HEALTH_CHECK_FAILED',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/shadow/audit — Audit history
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/macro-engine/shadow/audit', async (
    request: FastifyRequest<{ Querystring: { asset?: string; limit?: string } }>,
    reply: FastifyReply
  ) => {
    const asset = request.query.asset || 'dxy';
    const limit = parseInt(request.query.limit || '50', 10);
    
    try {
      const history = await shadowService.getAuditHistory(asset, limit);
      return reply.send({
        ok: true,
        asset: asset.toUpperCase(),
        count: history.length,
        history,
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'AUDIT_FETCH_FAILED',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/macro-engine/shadow/check — Force divergence check
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/api/macro-engine/shadow/check', async (
    request: FastifyRequest<{ Body: { asset?: string } }>,
    reply: FastifyReply
  ) => {
    const asset = request.body?.asset || 'dxy';
    
    try {
      const alerts = await shadowService.checkDivergence(asset);
      
      // Dispatch alerts
      if (alerts.length > 0) {
        await alertService.dispatchMany(alerts);
      }
      
      // Check auto-downgrade
      const downgradeCheck = await shadowService.shouldAutoDowngrade(asset);
      
      return reply.send({
        ok: true,
        asset: asset.toUpperCase(),
        alertsGenerated: alerts.length,
        alerts,
        autoDowngrade: downgradeCheck,
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'DIVERGENCE_CHECK_FAILED',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/macro-engine/shadow/status — Shadow mode status
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/macro-engine/shadow/status', async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      ok: true,
      shadowModeEnabled: true,
      activeEngine: 'v2',
      shadowEngine: 'v1',
      alertConfig: alertService.getConfig(),
      thresholds: {
        hitRateDriftPp: -2.0,
        signMismatchRatio: 0.50,
        confidenceDropPct: 0.40,
        regimeFlipsMax: 3,
        autoDowngradeAlerts: 3,
      },
    });
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/macro-engine/shadow/configure — Configure alerts
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/api/macro-engine/shadow/configure', async (
    request: FastifyRequest<{
      Body: {
        telegram?: { enabled?: boolean; botToken?: string; chatId?: string };
        slack?: { enabled?: boolean; webhookUrl?: string };
      };
    }>,
    reply: FastifyReply
  ) => {
    const { telegram, slack } = request.body || {};
    
    if (telegram) {
      alertService.configure({ telegram: { ...telegram } as any });
    }
    if (slack) {
      alertService.configure({ slack: { ...slack } as any });
    }
    
    return reply.send({
      ok: true,
      config: alertService.getConfig(),
    });
  });
  
  console.log('[Shadow] Routes registered at /api/macro-engine/health, /shadow/*');
}
