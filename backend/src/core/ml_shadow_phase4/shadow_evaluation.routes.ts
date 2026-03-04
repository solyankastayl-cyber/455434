/**
 * PHASE 4 — Shadow ML Evaluation Routes
 * 
 * API endpoints for shadow evaluation (ML observation only)
 */
import { FastifyInstance } from 'fastify';
import { shadowEvaluationService } from './shadow_evaluation.service.js';
import { WindowType } from './ml_shadow_run.model.js';

export async function registerShadowEvaluationRoutes(app: FastifyInstance) {
  /**
   * POST /api/ml/shadow/run
   * Start a new shadow evaluation run
   */
  app.post<{
    Body: { window: WindowType; limit?: number; modelRef?: string };
  }>('/api/ml/shadow/run', async (request, reply) => {
    try {
      const { window, limit = 500, modelRef = 'latest' } = request.body;

      if (!['24h', '7d', '30d'].includes(window)) {
        return reply.code(400).send({ error: 'Invalid window' });
      }

      const run = await shadowEvaluationService.startRun(window, limit, modelRef);

      return reply.send({
        ok: true,
        data: {
          runId: run.runId,
          status: run.status,
          window: run.window,
          startedAt: run.startedAt,
        },
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/ml/shadow/run/:runId
   * Get run status
   */
  app.get<{
    Params: { runId: string };
  }>('/api/ml/shadow/run/:runId', async (request, reply) => {
    try {
      const { runId } = request.params;
      const run = await shadowEvaluationService.getRunStatus(runId);

      if (!run) {
        return reply.code(404).send({ error: 'Run not found' });
      }

      return reply.send({
        ok: true,
        data: run,
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/ml/shadow/summary
   * Get summary for UI
   */
  app.get<{
    Querystring: { window?: WindowType };
  }>('/api/ml/shadow/summary', async (request, reply) => {
    try {
      const { window = '7d' } = request.query;

      const summary = await shadowEvaluationService.getSummary(window);

      return reply.send({
        ok: true,
        data: summary,
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/ml/shadow/report/:runId
   * Get detailed report
   */
  app.get<{
    Params: { runId: string };
  }>('/api/ml/shadow/report/:runId', async (request, reply) => {
    try {
      const { runId } = request.params;
      const report = await shadowEvaluationService.getReport(runId);

      return reply.send({
        ok: true,
        data: report,
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/ml/shadow/strata
   * Get stratified metrics
   */
  app.get<{
    Querystring: { runId: string };
  }>('/api/ml/shadow/strata', async (request, reply) => {
    try {
      const { runId } = request.query;

      if (!runId) {
        return reply.code(400).send({ error: 'runId required' });
      }

      const strata = await shadowEvaluationService.getStrata(runId);

      return reply.send({
        ok: true,
        data: strata,
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * POST /api/ml/shadow/backfill
   * Manually trigger labels backfill
   */
  app.post<{
    Body: { window?: '24h' | '7d'; limit?: number };
  }>('/api/ml/shadow/backfill', async (request, reply) => {
    try {
      const { window, limit = 50 } = request.body || {};

      // Dynamic import to avoid circular dependency
      const { labelsBackfillService } = await import('./labels_backfill.service.js');

      let result;
      if (window) {
        result = await labelsBackfillService.backfillLabels(window, limit);
      } else {
        await labelsBackfillService.runFullBackfill(limit);
        result = await labelsBackfillService.getStatus();
      }

      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/ml/shadow/cron/status
   * Get cron jobs status
   */
  app.get('/api/ml/shadow/cron/status', async (request, reply) => {
    try {
      const { shadowMLCronService } = await import('./shadow_ml_cron.service.js');
      const status = shadowMLCronService.getStatus();

      return reply.send({
        ok: true,
        data: status,
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * POST /api/ml/shadow/cron/start
   * Start cron jobs
   */
  app.post('/api/ml/shadow/cron/start', async (request, reply) => {
    try {
      const { shadowMLCronService } = await import('./shadow_ml_cron.service.js');
      shadowMLCronService.start();

      return reply.send({
        ok: true,
        message: 'Cron jobs started',
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * POST /api/ml/shadow/cron/stop
   * Stop cron jobs
   */
  app.post('/api/ml/shadow/cron/stop', async (request, reply) => {
    try {
      const { shadowMLCronService } = await import('./shadow_ml_cron.service.js');
      shadowMLCronService.stop();

      return reply.send({
        ok: true,
        message: 'Cron jobs stopped',
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // ========== БЛОК 4.5: ALERTS + READINESS GATES ==========

  /**
   * GET /api/ml/alerts
   * Get all alerts (with filters)
   */
  app.get<{
    Querystring: { status?: string; severity?: string; type?: string };
  }>('/api/ml/alerts', async (request, reply) => {
    try {
      const { MLShadowAlertModel } = await import('./ml_shadow_alert.model.js');
      
      const query: any = {};
      if (request.query.status) query.status = request.query.status;
      if (request.query.severity) query.severity = request.query.severity;
      if (request.query.type) query.type = request.query.type;

      const alerts = await MLShadowAlertModel
        .find(query)
        .sort({ firstSeenAt: -1 })
        .limit(100)
        .exec();

      return reply.send({
        ok: true,
        data: alerts,
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/ml/alerts/summary
   * Get alerts summary
   */
  app.get('/api/ml/alerts/summary', async (request, reply) => {
    try {
      const { AlertManager } = await import('./alert_manager.service.js');
      const summary = await AlertManager.getSummary();

      return reply.send({
        ok: true,
        data: summary,
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * POST /api/ml/alerts/:alertId/ack
   * Acknowledge alert
   */
  app.post<{
    Params: { alertId: string };
  }>('/api/ml/alerts/:alertId/ack', async (request, reply) => {
    try {
      const { AlertManager } = await import('./alert_manager.service.js');
      const { alertId } = request.params;

      const success = await AlertManager.acknowledgeAlert(alertId);

      if (!success) {
        return reply.code(404).send({ error: 'Alert not found or not in OPEN state' });
      }

      return reply.send({
        ok: true,
        message: 'Alert acknowledged',
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/ml/shadow/readiness
   * Get Phase 5 readiness status
   */
  app.get('/api/ml/shadow/readiness', async (request, reply) => {
    try {
      const { ReadinessGatesService } = await import('./readiness_gates.service.js');
      
      // Evaluate gates (fresh evaluation)
      await ReadinessGatesService.evaluateAllGates();
      
      const status = await ReadinessGatesService.getReadinessStatus();

      return reply.send({
        ok: true,
        data: status,
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // ========== PHASE 4.6: ATTACK TESTS ==========

  /**
   * POST /api/ml/shadow/attack-tests
   * Run attack test suite (production readiness validation)
   */
  app.post('/api/ml/shadow/attack-tests', async (request, reply) => {
    try {
      const { attackTestFramework } = await import('./attack_tests.service.js');
      const results = await attackTestFramework.runAllTests();

      const passed = results.filter(r => r.status === 'PASS').length;
      const failed = results.filter(r => r.status === 'FAIL').length;

      return reply.send({
        ok: true,
        data: {
          summary: {
            total: results.length,
            passed,
            failed,
            successRate: ((passed / results.length) * 100).toFixed(1) + '%',
            productionReady: failed === 0,
          },
          results: results.map(r => ({
            id: r.id,
            name: r.name,
            category: r.category,
            status: r.status,
            details: r.details,
            duration: r.duration,
            invariantsHeld: r.invariantsHeld,
          })),
        },
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/ml/shadow/attack-tests/minimal
   * Run minimal daily regression (5 critical tests)
   */
  app.get('/api/ml/shadow/attack-tests/minimal', async (request, reply) => {
    try {
      const { attackTestFramework } = await import('./attack_tests.service.js');
      const allResults = await attackTestFramework.runAllTests();

      // Filter to minimal regression set: A1, B1, C1, D2, X1
      const minimalTests = ['A1', 'B1', 'C1', 'D2', 'X1'];
      const results = allResults.filter(r => minimalTests.includes(r.id));

      const passed = results.filter(r => r.status === 'PASS').length;
      const failed = results.filter(r => r.status === 'FAIL').length;

      return reply.send({
        ok: true,
        data: {
          summary: {
            type: 'MINIMAL_DAILY_REGRESSION',
            total: results.length,
            passed,
            failed,
            canDeploy: failed === 0,
          },
          results,
        },
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.code(500).send({ error: error.message });
    }
  });

  app.log.info('[Phase 4] Shadow ML Evaluation routes registered');
  app.log.info('[Phase 4.5] Alerts + Readiness Gates routes registered');
  app.log.info('[Phase 4.6] Attack Tests routes registered');
}
