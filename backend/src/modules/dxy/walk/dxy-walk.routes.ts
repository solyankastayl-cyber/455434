/**
 * DXY WALK-FORWARD ROUTES — A3.5 + A3.6 + A3.7
 * 
 * ISOLATION: DXY walk-forward API. No BTC/SPX imports.
 * 
 * Endpoints:
 * - POST /api/fractal/dxy/walk/run - Run walk-forward validation
 * - POST /api/fractal/dxy/walk/resolve - Resolve outcomes
 * - GET /api/fractal/dxy/walk/summary - Get aggregated metrics
 * - POST /api/fractal/dxy/walk/calibrate/threshold - A3.6 threshold grid
 * - POST /api/fractal/dxy/walk/calibrate/weight - A3.6 weight mode grid
 * - POST /api/fractal/dxy/walk/calibrate/window - A3.6 window length grid
 * - POST /api/fractal/dxy/calibrate/grid-90d - A3.7 90d calibration grid
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  runWalkForward,
  resolveWalkOutcomes,
  recomputeWalkMetrics,
} from './dxy-walk.service.js';
import {
  runThresholdGrid,
  runWeightModeGrid,
  runWindowGrid,
  formatGridTable,
} from './dxy-calibration.service.js';
import {
  runGrid90d,
  getLatestCalibrationRun,
} from './dxy-calibration-90d.service.js';
import { runGrid90dV2 } from './dxy-calibration-90d-v2.service.js';
import {
  WALK_CONSTANTS,
  type WalkMode,
  type WalkRunParams,
  type WeightMode,
} from './dxy-walk.types.js';
import type { Grid90dRequest } from './dxy-calibration-90d.types.js';
import type { Grid90dV2Request } from './dxy-calibration-90d-v2.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPER: Validate date format (YYYY-MM-DD)
// ═══════════════════════════════════════════════════════════════

function isValidDateFormat(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  
  // Check if it's a valid date
  const parts = dateStr.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return date.getFullYear() === parts[0] && 
         date.getMonth() === parts[1] - 1 && 
         date.getDate() === parts[2];
}

// ═══════════════════════════════════════════════════════════════
// REGISTER ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerDxyWalkRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/fractal/dxy/walk';
  
  /**
   * POST /api/fractal/dxy/walk/run
   * 
   * Run walk-forward validation for DXY
   * 
   * Body:
   *   from: string (YYYY-MM-DD)
   *   to: string (YYYY-MM-DD)
   *   stepDays?: number (default: 7)
   *   windowLen?: number (default: 120)
   *   topK?: number (default: 10)
   *   threshold?: number (default: 0.001)
   *   modes?: ['SYNTHETIC', 'HYBRID'] (default: both)
   *   horizons?: number[] (default: [7, 14, 30, 90])
   * 
   * Response:
   *   ok, processed, createdSignals, createdOutcomes, skippedNoData, durationMs
   */
  fastify.post(`${prefix}/run`, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as WalkRunParams;
    
    if (!body.from || !body.to) {
      return reply.code(400).send({
        ok: false,
        error: 'Missing required params: from, to',
      });
    }
    
    if (!isValidDateFormat(body.from) || !isValidDateFormat(body.to)) {
      return reply.code(400).send({
        ok: false,
        error: 'Invalid date format. Expected YYYY-MM-DD',
      });
    }
    
    try {
      const result = await runWalkForward(body);
      return result;
    } catch (error: any) {
      console.error('[DXY Walk Run] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/fractal/dxy/walk/resolve
   * 
   * Resolve walk-forward outcomes (fill in actual returns)
   * 
   * Body:
   *   from: string (YYYY-MM-DD)
   *   to: string (YYYY-MM-DD)
   * 
   * Response:
   *   ok, attempted, resolved, skippedFuture, durationMs
   */
  fastify.post(`${prefix}/resolve`, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { from: string; to: string };
    
    if (!body.from || !body.to) {
      return reply.code(400).send({
        ok: false,
        error: 'Missing required params: from, to',
      });
    }
    
    if (!isValidDateFormat(body.from) || !isValidDateFormat(body.to)) {
      return reply.code(400).send({
        ok: false,
        error: 'Invalid date format. Expected YYYY-MM-DD',
      });
    }
    
    try {
      const result = await resolveWalkOutcomes(body);
      return result;
    } catch (error: any) {
      console.error('[DXY Walk Resolve] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/fractal/dxy/walk/summary
   * 
   * Get aggregated walk-forward metrics
   * 
   * Query:
   *   horizon: number (default: 30)
   *   mode: 'SYNTHETIC' | 'HYBRID' (default: 'HYBRID')
   *   from: string (YYYY-MM-DD) (default: '2000-01-01')
   *   to: string (YYYY-MM-DD) (default: '2020-12-31')
   * 
   * Response:
   *   ok, mode, horizonDays, samples, actionable, hitRate, avgReturn, bias, etc.
   */
  fastify.get(`${prefix}/summary`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as {
      horizon?: string;
      mode?: string;
      from?: string;
      to?: string;
    };
    
    const horizonDays = query.horizon ? parseInt(query.horizon) : 30;
    const mode = (query.mode?.toUpperCase() || 'HYBRID') as WalkMode;
    const fromStr = query.from || '2000-01-01';
    const toStr = query.to || '2020-12-31';
    
    // Parse dates
    const fromParts = fromStr.split('-').map(Number);
    const toParts = toStr.split('-').map(Number);
    const from = new Date(fromParts[0], fromParts[1] - 1, fromParts[2]);
    const to = new Date(toParts[0], toParts[1] - 1, toParts[2]);
    
    try {
      const result = await recomputeWalkMetrics(mode, horizonDays, from, to);
      return result;
    } catch (error: any) {
      console.error('[DXY Walk Summary] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/fractal/dxy/walk/status
   * 
   * Get walk-forward validation status (counts, etc.)
   */
  fastify.get(`${prefix}/status`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { DxyWalkSignalModel } = await import('./models/dxy_walk_signal.model.js');
      const { DxyWalkOutcomeModel } = await import('./models/dxy_walk_outcome.model.js');
      const { DxyWalkMetricsModel } = await import('./models/dxy_walk_metrics.model.js');
      
      const [signalsCount, outcomesCount, resolvedCount, metricsCount] = await Promise.all([
        DxyWalkSignalModel.countDocuments(),
        DxyWalkOutcomeModel.countDocuments(),
        DxyWalkOutcomeModel.countDocuments({ exitPrice: { $ne: null } }),
        DxyWalkMetricsModel.countDocuments(),
      ]);
      
      // Get date range
      const [firstSignal, lastSignal] = await Promise.all([
        DxyWalkSignalModel.findOne().sort({ asOf: 1 }).select({ asOf: 1 }).lean(),
        DxyWalkSignalModel.findOne().sort({ asOf: -1 }).select({ asOf: 1 }).lean(),
      ]);
      
      return {
        ok: true,
        signals: signalsCount,
        outcomes: {
          total: outcomesCount,
          resolved: resolvedCount,
          pending: outcomesCount - resolvedCount,
        },
        metrics: metricsCount,
        dateRange: {
          from: firstSignal?.asOf ? new Date(firstSignal.asOf).toISOString().split('T')[0] : null,
          to: lastSignal?.asOf ? new Date(lastSignal.asOf).toISOString().split('T')[0] : null,
        },
        constants: WALK_CONSTANTS,
      };
    } catch (error: any) {
      console.error('[DXY Walk Status] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * DELETE /api/fractal/dxy/walk/reset
   * 
   * Reset all walk-forward data (for testing)
   */
  fastify.delete(`${prefix}/reset`, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { DxyWalkSignalModel } = await import('./models/dxy_walk_signal.model.js');
      const { DxyWalkOutcomeModel } = await import('./models/dxy_walk_outcome.model.js');
      const { DxyWalkMetricsModel } = await import('./models/dxy_walk_metrics.model.js');
      
      const [signalsDeleted, outcomesDeleted, metricsDeleted] = await Promise.all([
        DxyWalkSignalModel.deleteMany({}),
        DxyWalkOutcomeModel.deleteMany({}),
        DxyWalkMetricsModel.deleteMany({}),
      ]);
      
      return {
        ok: true,
        deleted: {
          signals: signalsDeleted.deletedCount,
          outcomes: outcomesDeleted.deletedCount,
          metrics: metricsDeleted.deletedCount,
        },
      };
    } catch (error: any) {
      console.error('[DXY Walk Reset] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // A3.6 CALIBRATION ENDPOINTS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/fractal/dxy/walk/calibrate/threshold
   * 
   * Run threshold calibration grid (Set A)
   * Tests: 0.001, 0.0025, 0.005, 0.01
   */
  fastify.post(`${prefix}/calibrate/threshold`, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      from?: string;
      to?: string;
      stepDays?: number;
      horizons?: number[];
      thresholds?: number[];
      windowLen?: number;
      topK?: number;
    };
    
    const from = body.from || '2000-01-01';
    const to = body.to || '2020-12-31';
    const stepDays = body.stepDays || 7;
    const horizons = body.horizons || [7, 14, 30, 90];
    const thresholds = body.thresholds || [0.001, 0.0025, 0.005, 0.01];
    const windowLen = body.windowLen || 120;
    const topK = body.topK || 10;
    
    try {
      console.log('[A3.6] Starting threshold calibration grid...');
      const result = await runThresholdGrid(from, to, stepDays, horizons, thresholds, windowLen, topK);
      
      // Add formatted table
      const table = formatGridTable(result.results);
      console.log('[A3.6] Threshold grid results:\n' + table);
      
      return {
        ...result,
        table,
      };
    } catch (error: any) {
      console.error('[A3.6 Threshold Grid] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/fractal/dxy/walk/calibrate/weight
   * 
   * Run weight mode calibration grid (Set B)
   * Tests: W1 (lower clamp), W2 (sim^2), W3 (strong entropy)
   */
  fastify.post(`${prefix}/calibrate/weight`, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      from?: string;
      to?: string;
      stepDays?: number;
      horizons?: number[];
      threshold: number;
      windowLen?: number;
      topK?: number;
    };
    
    if (!body.threshold) {
      return reply.code(400).send({
        ok: false,
        error: 'Missing required param: threshold (use best from threshold grid)',
      });
    }
    
    const from = body.from || '2000-01-01';
    const to = body.to || '2020-12-31';
    const stepDays = body.stepDays || 7;
    const horizons = body.horizons || [7, 14, 30, 90];
    const windowLen = body.windowLen || 120;
    const topK = body.topK || 10;
    
    try {
      console.log('[A3.6] Starting weight mode calibration grid...');
      const result = await runWeightModeGrid(from, to, stepDays, horizons, body.threshold, windowLen, topK);
      
      const table = formatGridTable(result.results);
      console.log('[A3.6] Weight mode grid results:\n' + table);
      
      return {
        ...result,
        table,
      };
    } catch (error: any) {
      console.error('[A3.6 Weight Grid] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/fractal/dxy/walk/calibrate/window
   * 
   * Run window length calibration grid (Set C)
   * Tests: 120, 180, 240
   */
  fastify.post(`${prefix}/calibrate/window`, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      from?: string;
      to?: string;
      stepDays?: number;
      horizons?: number[];
      threshold: number;
      weightMode: WeightMode;
      windowLengths?: number[];
      topK?: number;
    };
    
    if (!body.threshold || !body.weightMode) {
      return reply.code(400).send({
        ok: false,
        error: 'Missing required params: threshold, weightMode',
      });
    }
    
    const from = body.from || '2000-01-01';
    const to = body.to || '2020-12-31';
    const stepDays = body.stepDays || 7;
    const horizons = body.horizons || [7, 14, 30, 90];
    const windowLengths = body.windowLengths || [120, 180, 240];
    const topK = body.topK || 10;
    
    try {
      console.log('[A3.6] Starting window length calibration grid...');
      const result = await runWindowGrid(from, to, stepDays, horizons, body.threshold, body.weightMode, topK, windowLengths);
      
      const table = formatGridTable(result.results);
      console.log('[A3.6] Window length grid results:\n' + table);
      
      return {
        ...result,
        table,
      };
    } catch (error: any) {
      console.error('[A3.6 Window Grid] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // A3.7 — 90d CALIBRATION GRID
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/fractal/dxy/calibrate/grid-90d
   * 
   * Run 90d horizon calibration grid
   * Does NOT modify defaults - only calculates and returns results
   * 
   * Body:
   *   oosFrom: string (YYYY-MM-DD)
   *   oosTo: string
   *   stepDays?: number (default: 7)
   *   focus: "90d"
   *   topK?: number (default: 10)
   *   grid: {
   *     windowLen: number[] (e.g. [240, 300])
   *     threshold: number[] (e.g. [0.01, 0.015, 0.02])
   *     weightMode: string[] (e.g. ["W2", "W3"])
   *   }
   * 
   * Response:
   *   ok, runId, best, top5, results, passedConfigs, totalConfigs
   */
  fastify.post('/api/fractal/dxy/calibrate/grid-90d', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Grid90dRequest;
    
    if (!body.oosFrom || !body.oosTo) {
      return reply.code(400).send({
        ok: false,
        error: 'Missing required params: oosFrom, oosTo',
      });
    }
    
    if (body.focus !== '90d') {
      return reply.code(400).send({
        ok: false,
        error: 'This endpoint is for focus=90d only',
      });
    }
    
    if (!body.grid || !body.grid.windowLen || !body.grid.threshold || !body.grid.weightMode) {
      return reply.code(400).send({
        ok: false,
        error: 'Missing required grid params: windowLen, threshold, weightMode',
      });
    }
    
    try {
      console.log('[A3.7] Starting 90d calibration grid...');
      const result = await runGrid90d(body);
      return result;
    } catch (error: any) {
      console.error('[A3.7 Grid-90d] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/fractal/dxy/calibrate/latest
   * 
   * Get latest calibration run results
   */
  fastify.get('/api/fractal/dxy/calibrate/latest', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { focus?: string };
    const focus = query.focus || '90d';
    
    try {
      const run = await getLatestCalibrationRun(focus);
      if (!run) {
        return { ok: false, error: 'No calibration runs found' };
      }
      return { ok: true, run };
    } catch (error: any) {
      console.error('[Calibration Latest] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // A3.7.v2 — 90d CONTROLLED TIGHTENING
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/fractal/dxy/calibrate/grid-90d-v2
   * 
   * Run 90d calibration with Quality Gate + Winsorization
   * Train/Val/OOS split for proper validation
   * 
   * Body:
   *   trainFrom, trainTo: train period
   *   valFrom, valTo: validation period
   *   oosFrom, oosTo: out-of-sample period
   *   stepDays?: number
   *   topK?: number
   *   grid: {
   *     windowLen: number[]
   *     threshold: number[]
   *     weightMode: WeightMode[]
   *     winsor: ReplayWinsorMode[]
   *     similarityMin: number[]
   *     entropyMax: number[]
   *     absReturnMin: number[]
   *     replayWeightMin: number[]
   *   }
   */
  fastify.post('/api/fractal/dxy/calibrate/grid-90d-v2', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Grid90dV2Request;
    
    if (!body.trainFrom || !body.trainTo || !body.valFrom || !body.valTo || !body.oosFrom || !body.oosTo) {
      return reply.code(400).send({
        ok: false,
        error: 'Missing required params: trainFrom, trainTo, valFrom, valTo, oosFrom, oosTo',
      });
    }
    
    if (!body.grid) {
      return reply.code(400).send({
        ok: false,
        error: 'Missing required param: grid',
      });
    }
    
    try {
      console.log('[A3.7.v2] Starting 90d controlled tightening grid...');
      const result = await runGrid90dV2(body);
      return result;
    } catch (error: any) {
      console.error('[A3.7.v2 Grid] Error:', error);
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  console.log('[DXY Walk] Routes registered at /api/fractal/dxy/walk/*');
  console.log('[DXY Walk] A3.6 Calibration routes registered at /api/fractal/dxy/walk/calibrate/*');
  console.log('[DXY Walk] A3.7 90d Grid route registered at /api/fractal/dxy/calibrate/grid-90d');
}
