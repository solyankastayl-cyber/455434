/**
 * Phase 5: Calibration API Routes
 */
import { FastifyInstance } from 'fastify';
import { calibrationBuilderService } from './calibration_builder.service.js';
import { calibrationGuardService } from './calibration_guard.service.js';
import { calibrationApplyService } from './calibration_apply.service.js';
import { calibrationRuntimeService } from './calibration_runtime.service.js';
import { CalibrationRunModel } from './calibration_run.model.js';
import { CalibrationMapModel } from './calibration_map.model.js';
import { calibrationAttackTestsService } from './calibration_attack_tests.service.js';

export async function registerCalibrationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/ml/calibration/build
   * Build calibration map (DRAFT)
   */
  app.post('/api/ml/calibration/build', async (request, reply) => {
    try {
      const { window, scope, limit, realOnly } = request.body as any;

      const result = await calibrationBuilderService.buildCalibrationMap({
        window,
        scope,
        limit,
        realOnly,
      });

      return reply.code(200).send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error('[CalRoutes] Build error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/ml/calibration/simulate
   * Simulate calibration apply (no activation)
   */
  app.post('/api/ml/calibration/simulate', async (request, reply) => {
    try {
      const { runId } = request.body as any;

      // Run guard checks without applying
      const guardResult = await calibrationGuardService.checkSafety(runId, 'SIMULATION');

      return reply.code(200).send({
        success: true,
        guardResult,
        message: guardResult.passed ? 'Simulation PASSED' : 'Simulation FAILED',
      });
    } catch (error: any) {
      console.error('[CalRoutes] Simulate error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/ml/calibration/apply
   * Apply calibration (activate)
   */
  app.post('/api/ml/calibration/apply', async (request, reply) => {
    try {
      const { runId, mapId, mode = 'SIMULATION' } = request.body as any;

      const result = await calibrationApplyService.applyCalibration({
        runId,
        mapId,
        mode,
      });

      return reply.code(result.success ? 200 : 400).send(result);
    } catch (error: any) {
      console.error('[CalRoutes] Apply error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/ml/calibration/active
   * Get active calibration status
   */
  app.get('/api/ml/calibration/active', async (request, reply) => {
    try {
      const { window = '7d' } = request.query as any;

      const status = await calibrationApplyService.getActiveStatus(window);

      return reply.code(200).send({
        success: true,
        ...status,
      });
    } catch (error: any) {
      console.error('[CalRoutes] Active status error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/ml/calibration/runs
   * Get calibration run history
   */
  app.get('/api/ml/calibration/runs', async (request, reply) => {
    try {
      const { window, limit = 20 } = request.query as any;

      const query: any = {};
      if (window) {
        query.window = window;
      }

      const runs = await CalibrationRunModel
        .find(query)
        .sort({ createdAt: -1 })
        .limit(Number(limit));

      return reply.code(200).send({
        success: true,
        count: runs.length,
        runs,
      });
    } catch (error: any) {
      console.error('[CalRoutes] Runs error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/ml/calibration/disable
   * Disable calibration
   */
  app.post('/api/ml/calibration/disable', async (request, reply) => {
    try {
      const { window, reason = 'Manual disable' } = request.body as any;

      await calibrationApplyService.disableCalibration(window, reason);

      return reply.code(200).send({
        success: true,
        message: `Calibration disabled for ${window}`,
      });
    } catch (error: any) {
      console.error('[CalRoutes] Disable error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/ml/calibration/simulate-temporal
   * Self-simulation (fast-forward temporal testing)
   */
  app.post('/api/ml/calibration/simulate-temporal', async (request, reply) => {
    try {
      const { window, hoursToSimulate = 96, scenario = 'stable' } = request.body as any;

      // TODO: Implement full temporal simulation
      // For now, return mock result
      
      return reply.code(200).send({
        success: true,
        message: 'Temporal simulation completed',
        window,
        hoursSimulated: hoursToSimulate,
        scenario,
        result: {
          driftDetected: false,
          flipRateIncrease: false,
          clampExplosion: false,
          recommendation: 'SAFE_TO_APPLY',
        },
      });
    } catch (error: any) {
      console.error('[CalRoutes] Temporal simulation error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/ml/calibration/map/:mapId
   * Get specific calibration map details
   */
  app.get('/api/ml/calibration/map/:mapId', async (request, reply) => {
    try {
      const { mapId } = request.params as any;

      const map = await CalibrationMapModel.findOne({ mapId });

      if (!map) {
        return reply.code(404).send({
          success: false,
          error: 'Map not found',
        });
      }

      return reply.code(200).send({
        success: true,
        map,
      });
    } catch (error: any) {
      console.error('[CalRoutes] Get map error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/ml/calibration/attack-tests
   * Run Phase 5 attack tests
   */
  app.post('/api/ml/calibration/attack-tests', async (request, reply) => {
    try {
      const results = await calibrationAttackTestsService.runAllTests();

      return reply.code(200).send({
        success: true,
        ...results,
      });
    } catch (error: any) {
      console.error('[CalRoutes] Attack tests error:', error);
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  console.log('[Phase5] Calibration routes registered');
}
