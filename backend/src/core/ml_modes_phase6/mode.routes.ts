/**
 * Phase 6: ML Mode Routes
 * API endpoints for mode switching and kill switch
 */
import { FastifyInstance } from 'fastify';
import { modeService, MLMode } from './mode.service.js';
import { modeAttackTestsService } from './mode_attack_tests.service.js';

export async function registerModeRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/ml/mode/state
   * Get current ML mode and kill switch status
   */
  app.get('/api/ml/mode/state', async (request, reply) => {
    try {
      const state = await modeService.getState();
      
      return reply.code(200).send({
        success: true,
        ...state,
      });
    } catch (error: any) {
      console.error('[Phase6] Get state error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/ml/mode/set
   * Set ML mode: OFF | ADVISOR | ASSIST
   */
  app.post('/api/ml/mode/set', async (request, reply) => {
    try {
      const { mode, triggeredBy = 'user' } = request.body as any;
      
      // Validate mode
      const validModes: MLMode[] = ['OFF', 'ADVISOR', 'ASSIST'];
      if (!validModes.includes(mode)) {
        return reply.code(400).send({
          success: false,
          error: `Invalid mode: ${mode}. Valid modes: ${validModes.join(', ')}`,
        });
      }
      
      const result = await modeService.setMode(mode, triggeredBy);
      
      return reply.code(result.success ? 200 : 400).send({
        success: result.success,
        mode: result.mode,
        blocked: result.blocked,
        reason: result.reason,
      });
    } catch (error: any) {
      console.error('[Phase6] Set mode error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/ml/mode/kill
   * Trigger kill switch manually
   */
  app.post('/api/ml/mode/kill', async (request, reply) => {
    try {
      const { reason = 'Manual trigger', triggeredBy = 'user' } = request.body as any;
      
      const result = await modeService.triggerKillSwitch(
        { type: 'MANUAL', value: reason },
        triggeredBy
      );
      
      return reply.code(200).send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error('[Phase6] Kill switch error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/ml/mode/reset
   * Reset (re-arm) kill switch
   */
  app.post('/api/ml/mode/reset', async (request, reply) => {
    try {
      const { triggeredBy = 'user' } = request.body as any;
      
      const result = await modeService.resetKillSwitch(triggeredBy);
      
      return reply.code(200).send({
        success: true,
        message: 'Kill switch re-armed',
      });
    } catch (error: any) {
      console.error('[Phase6] Reset error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/ml/mode/health-check
   * Run health check with metrics
   */
  app.post('/api/ml/mode/health-check', async (request, reply) => {
    try {
      const { flipRate = 0, ece = 0 } = request.body as any;
      
      const result = await modeService.healthCheck({ flipRate, ece });
      
      return reply.code(200).send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error('[Phase6] Health check error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/ml/mode/audit
   * Get mode change audit history
   */
  app.get('/api/ml/mode/audit', async (request, reply) => {
    try {
      const { limit = 50 } = request.query as any;
      
      const audits = await modeService.getAuditHistory(Number(limit));
      
      return reply.code(200).send({
        success: true,
        count: audits.length,
        audits,
      });
    } catch (error: any) {
      console.error('[Phase6] Audit error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/ml/mode/kill-events
   * Get kill switch event history
   */
  app.get('/api/ml/mode/kill-events', async (request, reply) => {
    try {
      const { limit = 20 } = request.query as any;
      
      const events = await modeService.getKillSwitchEvents(Number(limit));
      
      return reply.code(200).send({
        success: true,
        count: events.length,
        events,
      });
    } catch (error: any) {
      console.error('[Phase6] Kill events error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/ml/mode/attack-tests
   * Run Phase 6 attack tests
   */
  app.post('/api/ml/mode/attack-tests', async (request, reply) => {
    try {
      const results = await modeAttackTestsService.runAllTests();
      
      return reply.code(200).send({
        success: true,
        ...results,
      });
    } catch (error: any) {
      console.error('[Phase6] Attack tests error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  console.log('[Phase6] ML Mode routes registered');
}
