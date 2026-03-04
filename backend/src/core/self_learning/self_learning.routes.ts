/**
 * Self-Learning Routes
 * 
 * ETAP 5: API endpoints for self-learning system.
 * 
 * Control:
 * - GET  /api/self-learning/status
 * - POST /api/self-learning/toggle
 * - POST /api/self-learning/retrain/run
 * 
 * Dataset:
 * - GET  /api/self-learning/datasets
 * - POST /api/self-learning/datasets/freeze
 * 
 * Models:
 * - GET  /api/self-learning/models
 * - POST /api/self-learning/train
 * - POST /api/self-learning/evaluate/:modelVersionId
 * 
 * Guard:
 * - GET  /api/self-learning/guard/:horizon
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SelfLearningRuntimeModel } from './self_learning.runtime.model.js';
import { canRetrain, getGuardStatus, formatGuardResult } from './retrain.guard.js';
import { 
  startScheduler, 
  stopScheduler, 
  getSchedulerStatus,
  triggerManualRetrain,
} from './retrain.scheduler.js';
import {
  freezeDataset,
  listDatasets,
  getDatasetStats,
  getDatasetVersion,
  verifyDataset,
} from './dataset_freezer.service.js';
import { getTrainingHistory, getLatestTrainedModel } from './model_trainer.service.js';
import { ModelVersionModel } from './model_version.model.js';
import type { Horizon } from './self_learning.types.js';

// PR #2 imports
import { runTraining, type TrainParams } from './training.runner.js';
import { 
  getModelById, 
  getActiveModel, 
  listModelsByHorizon, 
  promoteModel, 
  rejectModel,
  getModelStats,
} from './model_registry.service.js';
import { 
  evaluateModel, 
  getEvaluation, 
  reEvaluateModel,
} from './evaluation_gate.service.js';
import { DEFAULT_POLICY, describePolicyThresholds } from './evaluation_policy.js';

// PR #3 imports - updated for new services
import { 
  promoteCandidate,
  getPromotionStatus,
  canPromote,
} from './promotion.service.js';
import { 
  rollback,
  getRollbackStatus,
} from './rollback.service.js';
import { 
  getMonitorStatus, 
  runMonitor,
  SHADOW_THRESHOLDS,
} from './shadow_monitor.service.js';
import { 
  blend,
  getCurrentMlModifier,
  getBlendingConfig,
} from './confidence_blender.service.js';
import { 
  getPointer,
  getAllPointers,
} from './active_model_pointer.model.js';

// ==================== ROUTES ====================

export async function selfLearningRoutes(app: FastifyInstance): Promise<void> {
  
  // ==================== CONTROL ====================
  
  /**
   * GET /api/self-learning/status
   * Get overall self-learning status
   */
  app.get('/self-learning/status', async (_request, reply: FastifyReply) => {
    try {
      const config = await SelfLearningRuntimeModel.getConfig();
      const scheduler = getSchedulerStatus();
      const datasetStats = await getDatasetStats();
      
      // Get model counts
      const [trainedModels, promotedModels] = await Promise.all([
        ModelVersionModel.countDocuments({ status: 'TRAINED' }),
        ModelVersionModel.countDocuments({ status: 'PROMOTED' }),
      ]);
      
      return reply.send({
        ok: true,
        data: {
          config: {
            enabled: config.enabled,
            mode: config.mode,
            horizons: config.horizons,
            scheduleEnabled: config.scheduleEnabled,
            scheduleCron: config.scheduleCron,
            minNewSamples: config.minNewSamples,
            cooldownDays: config.cooldownDays,
          },
          lastRetrain: {
            at: config.lastRetrainAt,
            horizon: config.lastRetrainHorizon,
            decision: config.lastRetrainDecision,
            modelVersion: config.lastRetrainModelVersion,
          },
          scheduler: {
            running: scheduler.running,
            isProcessing: scheduler.isProcessing,
          },
          datasets: datasetStats,
          models: {
            trained: trainedModels,
            promoted: promotedModels,
          },
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/self-learning/toggle
   * Enable/disable self-learning
   */
  app.post('/self-learning/toggle', async (
    request: FastifyRequest<{
      Body: { enabled?: boolean; mode?: string; scheduleEnabled?: boolean };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { enabled, mode, scheduleEnabled } = request.body || {};
      
      const updates: any = {};
      if (typeof enabled === 'boolean') updates.enabled = enabled;
      if (mode) updates.mode = mode;
      if (typeof scheduleEnabled === 'boolean') updates.scheduleEnabled = scheduleEnabled;
      
      const config = await SelfLearningRuntimeModel.updateConfig(updates);
      
      // Start/stop scheduler based on config
      if (config.enabled && config.scheduleEnabled) {
        await startScheduler();
      } else {
        stopScheduler();
      }
      
      return reply.send({
        ok: true,
        data: {
          enabled: config.enabled,
          mode: config.mode,
          scheduleEnabled: config.scheduleEnabled,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/self-learning/retrain/run
   * Manual retrain trigger (with guard check)
   */
  app.post('/self-learning/retrain/run', async (
    request: FastifyRequest<{
      Body: { horizon?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const horizon = (request.body?.horizon || '7d') as Horizon;
      
      // Check if enabled
      const config = await SelfLearningRuntimeModel.getConfig();
      if (!config.enabled) {
        return reply.status(403).send({
          ok: false,
          error: 'Self-learning is disabled',
        });
      }
      
      // Check guard first
      const guardStatus = await getGuardStatus(horizon);
      if (!guardStatus.canRetrain) {
        return reply.status(403).send({
          ok: false,
          error: 'Guard denied retrain',
          guard: guardStatus.checks,
          formatted: guardStatus.formatted,
        });
      }
      
      // Trigger retrain
      const result = await triggerManualRetrain(horizon);
      
      return reply.send({
        ok: result.success,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ==================== GUARD ====================
  
  /**
   * GET /api/self-learning/guard/:horizon
   * Get guard status for horizon
   */
  app.get('/self-learning/guard/:horizon', async (
    request: FastifyRequest<{
      Params: { horizon: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const horizon = request.params.horizon as Horizon;
      const guardStatus = await getGuardStatus(horizon);
      
      return reply.send({
        ok: true,
        data: {
          canRetrain: guardStatus.canRetrain,
          checks: guardStatus.checks,
          formatted: guardStatus.formatted,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ==================== DATASETS ====================
  
  /**
   * GET /api/self-learning/datasets
   * List datasets
   */
  app.get('/self-learning/datasets', async (
    request: FastifyRequest<{
      Querystring: { horizon?: string; limit?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { horizon, limit = '20' } = request.query;
      const datasets = await listDatasets(
        horizon as Horizon | undefined,
        parseInt(limit)
      );
      
      return reply.send({
        ok: true,
        data: {
          datasets: datasets.map(d => ({
            ...d,
            _id: undefined,
          })),
          total: datasets.length,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/self-learning/datasets/freeze
   * Manually freeze a dataset
   */
  app.post('/self-learning/datasets/freeze', async (
    request: FastifyRequest<{
      Body: { horizon?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const horizon = (request.body?.horizon || '7d') as Horizon;
      
      const result = await freezeDataset({
        horizon,
        createdBy: 'manual',
      });
      
      return reply.send({
        ok: result.success,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/self-learning/datasets/:version
   * Get specific dataset
   */
  app.get('/self-learning/datasets/:version', async (
    request: FastifyRequest<{
      Params: { version: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const dataset = await getDatasetVersion(request.params.version);
      
      if (!dataset) {
        return reply.status(404).send({
          ok: false,
          error: 'Dataset not found',
        });
      }
      
      return reply.send({
        ok: true,
        data: {
          ...dataset,
          _id: undefined,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/self-learning/datasets/:version/verify
   * Verify dataset integrity
   */
  app.post('/self-learning/datasets/:version/verify', async (
    request: FastifyRequest<{
      Params: { version: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const result = await verifyDataset(request.params.version);
      
      return reply.send({
        ok: result.valid,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ==================== MODELS ====================
  
  /**
   * GET /api/self-learning/models
   * List model versions
   */
  app.get('/self-learning/models', async (
    request: FastifyRequest<{
      Querystring: { horizon?: string; limit?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { horizon, limit = '20' } = request.query;
      
      const query: any = {};
      if (horizon) query.horizon = horizon;
      
      const models = await ModelVersionModel.find(query)
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .lean();
      
      return reply.send({
        ok: true,
        data: {
          models: models.map(m => ({
            ...m,
            _id: undefined,
          })),
          total: models.length,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/self-learning/models/latest/:horizon
   * Get latest model for horizon
   */
  app.get('/self-learning/models/latest/:horizon', async (
    request: FastifyRequest<{
      Params: { horizon: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const model = await getLatestTrainedModel(request.params.horizon as Horizon);
      
      if (!model) {
        return reply.status(404).send({
          ok: false,
          error: 'No model found',
        });
      }
      
      return reply.send({
        ok: true,
        data: {
          ...model,
          _id: undefined,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ==================== SCHEDULER ====================
  
  /**
   * GET /api/self-learning/scheduler/status
   * Get scheduler status
   */
  app.get('/self-learning/scheduler/status', async (_request, reply: FastifyReply) => {
    try {
      const status = getSchedulerStatus();
      
      return reply.send({
        ok: true,
        data: status,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/self-learning/scheduler/start
   * Start scheduler
   */
  app.post('/self-learning/scheduler/start', async (_request, reply: FastifyReply) => {
    try {
      const result = await startScheduler();
      
      return reply.send({
        ok: result.success,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/self-learning/scheduler/stop
   * Stop scheduler
   */
  app.post('/self-learning/scheduler/stop', async (_request, reply: FastifyReply) => {
    try {
      const result = stopScheduler();
      
      return reply.send({
        ok: result.success,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ==================== PR #2: TRAINING & EVALUATION ====================
  
  /**
   * POST /api/self-learning/train
   * Train a new model version
   */
  app.post('/self-learning/train', async (
    request: FastifyRequest<{
      Body: { datasetVersionId: string; seed?: number; hyperParams?: object };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { datasetVersionId, seed, hyperParams } = request.body || {};
      
      if (!datasetVersionId) {
        return reply.status(400).send({
          ok: false,
          error: 'datasetVersionId is required',
        });
      }
      
      const result = await runTraining({
        datasetVersionId,
        seed,
        hyperParams,
      });
      
      return reply.send({
        ok: result.success,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/self-learning/evaluate/:modelVersionId
   * Evaluate a model against baseline
   */
  app.post('/self-learning/evaluate/:modelVersionId', async (
    request: FastifyRequest<{
      Params: { modelVersionId: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { modelVersionId } = request.params;
      
      const result = await evaluateModel(modelVersionId);
      
      return reply.send({
        ok: true,
        data: {
          modelVersionId: result.modelVersionId,
          decision: result.decision,
          deltas: result.deltas,
          reasons: result.reasons,
          baselineSource: result.baselineSource,
          baselineModelId: result.baselineModelId,
          evaluatedAt: result.evaluatedAt,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/self-learning/evaluations/:modelVersionId
   * Get evaluation result for model
   */
  app.get('/self-learning/evaluations/:modelVersionId', async (
    request: FastifyRequest<{
      Params: { modelVersionId: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const result = await getEvaluation(request.params.modelVersionId);
      
      if (!result) {
        return reply.status(404).send({
          ok: false,
          error: 'Model not found',
        });
      }
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/self-learning/models/:id
   * Get specific model version
   */
  app.get('/self-learning/models/:id', async (
    request: FastifyRequest<{
      Params: { id: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const model = await getModelById(request.params.id);
      
      if (!model) {
        return reply.status(404).send({
          ok: false,
          error: 'Model not found',
        });
      }
      
      return reply.send({
        ok: true,
        data: {
          ...model,
          _id: undefined,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/self-learning/models/active/:horizon
   * Get active (promoted) model for horizon
   */
  app.get('/self-learning/models/active/:horizon', async (
    request: FastifyRequest<{
      Params: { horizon: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const model = await getActiveModel(request.params.horizon as Horizon);
      
      if (!model) {
        return reply.send({
          ok: true,
          data: null,
          message: 'No active model for this horizon',
        });
      }
      
      return reply.send({
        ok: true,
        data: {
          ...model,
          _id: undefined,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/self-learning/models/:id/promote
   * Promote model (only if evaluation passed)
   */
  app.post('/self-learning/models/:id/promote', async (
    request: FastifyRequest<{
      Params: { id: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { id } = request.params;
      
      // Check evaluation first
      const evaluation = await getEvaluation(id);
      
      if (!evaluation?.evaluated) {
        return reply.status(400).send({
          ok: false,
          error: 'Model must be evaluated before promotion',
        });
      }
      
      if (evaluation.decision !== 'PROMOTE') {
        return reply.status(400).send({
          ok: false,
          error: `Cannot promote: evaluation decision is ${evaluation.decision}`,
          reasons: evaluation.reasons,
        });
      }
      
      const model = await promoteModel(id);
      
      return reply.send({
        ok: true,
        data: {
          modelVersion: model.modelVersion,
          status: model.status,
          promotedAt: model.promotedAt,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/self-learning/policy
   * Get evaluation policy thresholds
   */
  app.get('/self-learning/policy', async (_request, reply: FastifyReply) => {
    try {
      return reply.send({
        ok: true,
        data: {
          policy: DEFAULT_POLICY,
          description: describePolicyThresholds(DEFAULT_POLICY),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/self-learning/models/stats
   * Get model statistics
   */
  app.get('/self-learning/models/stats', async (_request, reply: FastifyReply) => {
    try {
      const stats = await getModelStats();
      
      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ==================== PR #3: PROMOTION, SHADOW, AUDIT ====================
  
  /**
   * POST /api/self-learning/promote/:modelVersionId
   * Atomic promotion (requires PROMOTE decision)
   */
  app.post('/self-learning/promote/:modelVersionId', async (
    request: FastifyRequest<{
      Params: { modelVersionId: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const result = await promoteModelAtomic(request.params.modelVersionId);
      
      return reply.send({
        ok: result.success,
        data: result,
      });
    } catch (error: any) {
      // Return specific error for PromotionError
      if (error.name === 'PromotionError') {
        return reply.status(400).send({
          ok: false,
          error: error.message,
        });
      }
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/self-learning/rollback
   * Rollback to previous model
   */
  app.post('/self-learning/rollback', async (
    request: FastifyRequest<{
      Body: { horizon?: string; reason?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const horizon = (request.body?.horizon || '7d') as Horizon;
      const reason = request.body?.reason || 'Manual rollback';
      
      const result = await rollbackModelAtomic(horizon, reason, 'MANUAL');
      
      return reply.send({
        ok: result.success,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/self-learning/shadow/status
   * Get shadow monitoring status
   */
  app.get('/self-learning/shadow/status', async (
    request: FastifyRequest<{
      Querystring: { horizon?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const horizon = (request.query.horizon || '7d') as Horizon;
      const status = await getShadowStatus(horizon);
      const modelState = await getActiveModelState(horizon);
      
      return reply.send({
        ok: true,
        data: {
          ...status,
          modelState,
          thresholds: SHADOW_THRESHOLDS,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/self-learning/shadow/thresholds
   * Get shadow monitoring thresholds
   */
  app.get('/self-learning/shadow/thresholds', async (_request, reply: FastifyReply) => {
    return reply.send({
      ok: true,
      data: {
        thresholds: SHADOW_THRESHOLDS,
        modifiers: CONFIDENCE_MODIFIERS,
      },
    });
  });
  
  /**
   * GET /api/self-learning/confidence/:horizon
   * Get current ML modifier for horizon
   */
  app.get('/self-learning/confidence/:horizon', async (
    request: FastifyRequest<{
      Params: { horizon: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const horizon = request.params.horizon as Horizon;
      const { modifier, healthStatus } = await getMLModifier(horizon);
      
      return reply.send({
        ok: true,
        data: {
          horizon,
          mlModifier: modifier,
          healthStatus,
          modifiers: CONFIDENCE_MODIFIERS,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/self-learning/confidence/calculate
   * Calculate final confidence with all modifiers
   */
  app.post('/self-learning/confidence/calculate', async (
    request: FastifyRequest<{
      Body: { horizon?: string; ruleConfidence: number; driftModifier: number };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { horizon = '7d', ruleConfidence, driftModifier } = request.body;
      
      const breakdown = await getConfidenceBreakdown(
        horizon as Horizon,
        ruleConfidence,
        driftModifier
      );
      
      return reply.send({
        ok: true,
        data: breakdown,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/self-learning/audit
   * Get audit trail
   */
  app.get('/self-learning/audit', async (
    request: FastifyRequest<{
      Querystring: { horizon?: string; modelVersionId?: string; limit?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { horizon, modelVersionId, limit = '100' } = request.query;
      
      let auditTrail;
      if (modelVersionId) {
        auditTrail = await getAuditTrail(modelVersionId, parseInt(limit));
      } else if (horizon) {
        auditTrail = await getHorizonAuditTrail(horizon as Horizon, parseInt(limit));
      } else {
        auditTrail = await getHorizonAuditTrail('7d', parseInt(limit));
      }
      
      return reply.send({
        ok: true,
        data: {
          events: auditTrail.map(e => ({
            ...e,
            _id: undefined,
          })),
          total: auditTrail.length,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * GET /api/self-learning/audit/timeline
   * Reconstruct timeline for investigation
   */
  app.get('/self-learning/audit/timeline', async (
    request: FastifyRequest<{
      Querystring: { horizon?: string; startTime: string; endTime: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { horizon = '7d', startTime, endTime } = request.query;
      
      const timeline = await reconstructTimeline(
        horizon as Horizon,
        new Date(startTime),
        new Date(endTime)
      );
      
      return reply.send({
        ok: true,
        data: {
          horizon,
          startTime,
          endTime,
          events: timeline.map(e => ({
            ...e,
            _id: undefined,
          })),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  app.log.info('[SelfLearning] Routes registered: /api/self-learning/*');
}
