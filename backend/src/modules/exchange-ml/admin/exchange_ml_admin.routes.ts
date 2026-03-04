/**
 * Exchange Auto-Learning Loop - Admin Routes (PR1-PR6 + Performance)
 * 
 * Admin API endpoints for the complete ML lifecycle.
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { getDb } from '../../../db/mongodb.js';
import { getExchangeDatasetService } from '../dataset/exchange_dataset.service.js';
import { getExchangeFeatureBuilder } from '../dataset/exchange_feature_builder.js';
import { getExchangeLabelScheduler } from '../jobs/exchange_label_scheduler.js';
import { getExchangeLabelWorker, PriceProvider } from '../jobs/exchange_label_worker.js';
import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';
// PR2: Training imports
import { getExchangeTrainerService } from '../training/exchange_trainer.service.js';
import { getExchangeModelRegistryService } from '../training/exchange_model_registry.service.js';
import { getExchangeRetrainScheduler } from '../training/exchange_retrain_scheduler.js';
// PR3: Shadow imports
import { getExchangeShadowRecorderService } from '../shadow/exchange_shadow_recorder.service.js';
import { getExchangeShadowMetricsService } from '../shadow/exchange_shadow_metrics.service.js';
import { getExchangeInferenceService } from '../shadow/exchange_inference.service.js';
// PR4/5/6: Lifecycle imports
import { getExchangeAutoPromotionService } from '../lifecycle/exchange_auto_promotion.service.js';
import { getExchangeAutoRollbackService } from '../lifecycle/exchange_auto_rollback.service.js';
import { getExchangeGuardrailsService } from '../lifecycle/exchange_guardrails.service.js';
import { getExchangeEventLoggerService } from '../lifecycle/exchange_event_logger.service.js';
import { getExchangeLifecycleScheduler } from '../lifecycle/exchange_lifecycle_scheduler.js';
// Performance Layer imports
import { getHorizonPerformanceService } from '../performance/horizon-performance.service.js';
import { getCrossHorizonBiasService } from '../performance/cross-horizon-bias.service.js';
import { getExchangeDecayAuditJob } from '../performance/jobs/decay-audit.job.js';
import { getHorizonCascadeService } from '../performance/horizon_cascade.service.js';

// ═══════════════════════════════════════════════════════════════
// FEATURE FLAG CHECK
// ═══════════════════════════════════════════════════════════════

function isDatasetEnabled(): boolean {
  return process.env.EXCHANGE_DATASET_ENABLED === 'true';
}

function isRetrainEnabled(): boolean {
  return process.env.EXCHANGE_RETRAIN_ENABLED === 'true';
}

function isShadowEnabled(): boolean {
  return process.env.EXCHANGE_SHADOW_ENABLED === 'true';
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function exchangeMLAdminRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  const db = getDb();
  
  // ═══════════════════════════════════════════════════════════════
  // STATUS & CONFIG
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-ml/status
   * Get overall status of the Exchange ML system
   */
  fastify.get('/api/admin/exchange-ml/status', async (_request, _reply) => {
    const datasetService = getExchangeDatasetService(db);
    const schedulerStats = await getExchangeLabelScheduler(db).getStats();
    const datasetStats = await datasetService.getStats();
    
    return {
      ok: true,
      data: {
        featureFlags: {
          EXCHANGE_ML_ENABLED: process.env.EXCHANGE_ML_ENABLED === 'true',
          EXCHANGE_DATASET_ENABLED: isDatasetEnabled(),
          EXCHANGE_RETRAIN_ENABLED: process.env.EXCHANGE_RETRAIN_ENABLED === 'true',
          EXCHANGE_SHADOW_ENABLED: process.env.EXCHANGE_SHADOW_ENABLED === 'true',
          EXCHANGE_AUTOPROMOTE_ENABLED: process.env.EXCHANGE_AUTOPROMOTE_ENABLED === 'true',
          EXCHANGE_AUTOROLLBACK_ENABLED: process.env.EXCHANGE_AUTOROLLBACK_ENABLED === 'true',
        },
        dataset: datasetStats,
        scheduler: schedulerStats,
        phase: 'PR1',
        version: 'v4.0.0',
      },
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/config
   * Get current configuration
   */
  fastify.get('/api/admin/exchange-ml/config', async (_request, _reply) => {
    return {
      ok: true,
      data: {
        dataset: {
          enabled: isDatasetEnabled(),
          featureVersion: 'v1.0.0',
        },
        labeling: {
          winThresholdPct: parseFloat(process.env.EXCHANGE_WIN_THRESHOLD_PCT || '0.01'),
          neutralZonePct: parseFloat(process.env.EXCHANGE_NEUTRAL_ZONE_PCT || '0.005'),
          maxAgeDays: parseInt(process.env.EXCHANGE_MAX_AGE_DAYS || '45', 10),
        },
        retrain: {
          enabled: process.env.EXCHANGE_RETRAIN_ENABLED === 'true',
          minSamples: parseInt(process.env.EXCHANGE_RETRAIN_MIN_SAMPLES || '500', 10),
          cron: process.env.EXCHANGE_RETRAIN_CRON || '0 */6 * * *',
        },
        shadow: {
          enabled: process.env.EXCHANGE_SHADOW_ENABLED === 'true',
          windowSize: parseInt(process.env.EXCHANGE_SHADOW_WINDOW || '200', 10),
        },
        promotion: {
          autoEnabled: process.env.EXCHANGE_AUTOPROMOTE_ENABLED === 'true',
          minImprovement: parseFloat(process.env.EXCHANGE_PROMOTE_MIN_IMPROVEMENT || '0.02'),
          minSamples: parseInt(process.env.EXCHANGE_PROMOTE_MIN_SAMPLES || '300', 10),
        },
        rollback: {
          autoEnabled: process.env.EXCHANGE_AUTOROLLBACK_ENABLED === 'true',
          degradeThreshold: parseFloat(process.env.EXCHANGE_DEGRADE_THRESHOLD || '-0.03'),
        },
      },
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // DATASET MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-ml/dataset/stats
   * Get dataset statistics
   */
  fastify.get('/api/admin/exchange-ml/dataset/stats', async (_request, _reply) => {
    const datasetService = getExchangeDatasetService(db);
    const stats = await datasetService.getStats();
    
    return {
      ok: true,
      data: stats,
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/dataset/samples
   * Get recent samples
   */
  fastify.get('/api/admin/exchange-ml/dataset/samples', async (request, _reply) => {
    const query = request.query as {
      horizon?: ExchangeHorizon;
      status?: string;
      limit?: string;
    };
    
    const datasetService = getExchangeDatasetService(db);
    
    let samples;
    if (query.status === 'RESOLVED') {
      samples = await datasetService.getResolvedSamples({
        horizon: query.horizon,
        limit: parseInt(query.limit || '50', 10),
      });
    } else {
      samples = await datasetService.getPendingSamples({
        horizon: query.horizon,
        limit: parseInt(query.limit || '50', 10),
      });
    }
    
    // Remove _id from response (MongoDB ObjectId serialization issue)
    const cleanSamples = samples.map(s => ({
      ...s,
      _id: s._id?.toString(),
    }));
    
    return {
      ok: true,
      data: {
        samples: cleanSamples,
        count: cleanSamples.length,
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/dataset/create-sample
   * Manually create a sample (for testing)
   */
  fastify.post('/api/admin/exchange-ml/dataset/create-sample', async (request, _reply) => {
    if (!isDatasetEnabled()) {
      return {
        ok: false,
        error: 'DATASET_DISABLED',
        message: 'Dataset collection is disabled. Set EXCHANGE_DATASET_ENABLED=true',
      };
    }
    
    const body = request.body as {
      symbol: string;
      horizon: ExchangeHorizon;
    };
    
    if (!body.symbol || !body.horizon) {
      return {
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'symbol and horizon are required',
      };
    }
    
    try {
      const datasetService = getExchangeDatasetService(db);
      const featureBuilder = getExchangeFeatureBuilder(db);
      
      console.log(`[Admin] Building features for ${body.symbol}...`);
      
      // Build features
      const features = await featureBuilder.buildFeatures(body.symbol);
      if (!features) {
        return {
          ok: false,
          error: 'FEATURE_BUILD_FAILED',
          message: `Could not build features for ${body.symbol}`,
        };
      }
      
      console.log(`[Admin] Features built, price=${features.price}`);
      
      // Create sample
      const result = await datasetService.createSample({
        symbol: body.symbol,
        horizon: body.horizon,
        t0: new Date(),
        features,
        entryPrice: features.price,
        signalMeta: {
          verdictId: `admin-${Date.now()}`,
          confidence: 0.5,
          direction: 'NEUTRAL',
        },
      });
      
      return {
        ok: true,
        data: {
          sampleId: result.id,
          created: result.created,
          message: result.created ? 'Sample created' : 'Sample already exists',
        },
      };
    } catch (err: any) {
      console.error('[Admin] Create sample error:', err);
      return {
        ok: false,
        error: 'INTERNAL_ERROR',
        message: err.message || 'Unknown error',
      };
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // LABELING JOBS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-ml/jobs/stats
   * Get labeling job statistics
   */
  fastify.get('/api/admin/exchange-ml/jobs/stats', async (_request, _reply) => {
    const scheduler = getExchangeLabelScheduler(db);
    const stats = await scheduler.getStats();
    
    return {
      ok: true,
      data: stats,
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/jobs/run-scheduler
   * Manually trigger the scheduler to create jobs
   */
  fastify.post('/api/admin/exchange-ml/jobs/run-scheduler', async (_request, _reply) => {
    if (!isDatasetEnabled()) {
      return {
        ok: false,
        error: 'DATASET_DISABLED',
        message: 'Dataset collection is disabled',
      };
    }
    
    const scheduler = getExchangeLabelScheduler(db);
    const jobsCreated = await scheduler.createMissingJobs();
    
    return {
      ok: true,
      data: {
        jobsCreated,
        message: `Created ${jobsCreated} new labeling jobs`,
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/jobs/run-worker
   * Manually trigger the worker to process jobs
   */
  fastify.post('/api/admin/exchange-ml/jobs/run-worker', async (_request, _reply) => {
    if (!isDatasetEnabled()) {
      return {
        ok: false,
        error: 'DATASET_DISABLED',
        message: 'Dataset collection is disabled',
      };
    }
    
    // Simple price provider for manual runs
    const datasetService = getExchangeDatasetService(db);
    const featureBuilder = getExchangeFeatureBuilder(db);
    
    const priceProvider: PriceProvider = {
      getCurrentPrice: async (symbol: string) => {
        const features = await featureBuilder.buildFeatures(symbol);
        return features?.price ?? null;
      },
    };
    
    const worker = getExchangeLabelWorker(db, priceProvider);
    const result = await worker.processReadyJobs();
    
    return {
      ok: true,
      data: {
        ...result,
        message: `Processed ${result.total} jobs: ${result.succeeded} succeeded, ${result.failed} failed`,
      },
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/jobs/worker-stats
   * Get worker statistics
   */
  fastify.get('/api/admin/exchange-ml/jobs/worker-stats', async (_request, _reply) => {
    // Simple price provider
    const featureBuilder = getExchangeFeatureBuilder(db);
    const priceProvider: PriceProvider = {
      getCurrentPrice: async (symbol: string) => {
        const features = await featureBuilder.buildFeatures(symbol);
        return features?.price ?? null;
      },
    };
    
    const worker = getExchangeLabelWorker(db, priceProvider);
    const stats = worker.getStats();
    
    return {
      ok: true,
      data: stats,
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/admin/exchange-ml/init
   * Initialize indexes and start services
   */
  fastify.post('/api/admin/exchange-ml/init', async (_request, _reply) => {
    try {
      // Ensure indexes
      const datasetService = getExchangeDatasetService(db);
      await datasetService.ensureIndexes();
      
      const scheduler = getExchangeLabelScheduler(db);
      await scheduler.ensureIndexes();
      
      return {
        ok: true,
        data: {
          message: 'Exchange ML initialized successfully',
          indexes: 'created',
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'INIT_FAILED',
        message: err.message,
      };
    }
  });
  
  /**
   * POST /api/admin/exchange-ml/start
   * Start the scheduler and worker services
   */
  fastify.post('/api/admin/exchange-ml/start', async (_request, _reply) => {
    if (!isDatasetEnabled()) {
      return {
        ok: false,
        error: 'DATASET_DISABLED',
        message: 'Dataset collection is disabled. Set EXCHANGE_DATASET_ENABLED=true',
      };
    }
    
    // Start scheduler
    const scheduler = getExchangeLabelScheduler(db);
    scheduler.start();
    
    // Start worker with price provider
    const featureBuilder = getExchangeFeatureBuilder(db);
    const priceProvider: PriceProvider = {
      getCurrentPrice: async (symbol: string) => {
        const features = await featureBuilder.buildFeatures(symbol);
        return features?.price ?? null;
      },
    };
    
    const worker = getExchangeLabelWorker(db, priceProvider);
    worker.start();
    
    return {
      ok: true,
      data: {
        message: 'Exchange ML services started',
        scheduler: 'running',
        worker: 'running',
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/stop
   * Stop the scheduler and worker services
   */
  fastify.post('/api/admin/exchange-ml/stop', async (_request, _reply) => {
    const scheduler = getExchangeLabelScheduler(db);
    scheduler.stop();
    
    // Note: Worker instance might not exist if not started
    try {
      const featureBuilder = getExchangeFeatureBuilder(db);
      const priceProvider: PriceProvider = {
        getCurrentPrice: async (symbol: string) => {
          const features = await featureBuilder.buildFeatures(symbol);
          return features?.price ?? null;
        },
      };
      const worker = getExchangeLabelWorker(db, priceProvider);
      worker.stop();
    } catch (err) {
      // Ignore if worker not initialized
    }
    
    return {
      ok: true,
      data: {
        message: 'Exchange ML services stopped',
        scheduler: 'stopped',
        worker: 'stopped',
      },
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PR2: TRAINING MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-ml/training/stats
   * Get training statistics
   */
  fastify.get('/api/admin/exchange-ml/training/stats', async (_request, _reply) => {
    const trainerService = getExchangeTrainerService(db);
    const stats = await trainerService.getStats();
    
    return {
      ok: true,
      data: stats,
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/training/train
   * Manually trigger model training
   */
  fastify.post('/api/admin/exchange-ml/training/train', async (request, _reply) => {
    if (!isRetrainEnabled() && !isDatasetEnabled()) {
      return {
        ok: false,
        error: 'RETRAIN_DISABLED',
        message: 'Retrain is disabled. Set EXCHANGE_RETRAIN_ENABLED=true',
      };
    }
    
    const body = request.body as {
      horizon: ExchangeHorizon;
    };
    
    if (!body.horizon || !['1D', '7D', '30D'].includes(body.horizon)) {
      return {
        ok: false,
        error: 'INVALID_HORIZON',
        message: 'horizon must be 1D, 7D, or 30D',
      };
    }
    
    try {
      const trainerService = getExchangeTrainerService(db);
      const result = await trainerService.trainModel({
        horizon: body.horizon,
        trigger: 'MANUAL',
      });
      
      return {
        ok: result.success,
        data: {
          runId: result.runId,
          modelId: result.modelId,
          message: result.success ? 'Training completed' : `Training failed: ${result.error}`,
        },
        error: result.error,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'TRAINING_ERROR',
        message: err.message,
      };
    }
  });
  
  /**
   * GET /api/admin/exchange-ml/training/runs
   * Get recent training runs
   */
  fastify.get('/api/admin/exchange-ml/training/runs', async (request, _reply) => {
    const query = request.query as {
      horizon?: ExchangeHorizon;
      limit?: string;
    };
    
    const trainerService = getExchangeTrainerService(db);
    
    let runs;
    if (query.horizon) {
      runs = await trainerService.getRunsByHorizon(
        query.horizon,
        parseInt(query.limit || '10', 10)
      );
    } else {
      runs = await trainerService.getRecentRuns(parseInt(query.limit || '10', 10));
    }
    
    // Clean _id for response
    const cleanRuns = runs.map(r => ({
      ...r,
      _id: r._id?.toString(),
    }));
    
    return {
      ok: true,
      data: {
        runs: cleanRuns,
        count: cleanRuns.length,
      },
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/training/run/:runId
   * Get specific training run
   */
  fastify.get('/api/admin/exchange-ml/training/run/:runId', async (request, _reply) => {
    const params = request.params as { runId: string };
    
    const trainerService = getExchangeTrainerService(db);
    const run = await trainerService.getTrainingRun(params.runId);
    
    if (!run) {
      return {
        ok: false,
        error: 'NOT_FOUND',
        message: `Training run ${params.runId} not found`,
      };
    }
    
    return {
      ok: true,
      data: {
        ...run,
        _id: run._id?.toString(),
      },
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PR2: MODEL REGISTRY
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-ml/registry/status
   * Get model registry status
   */
  fastify.get('/api/admin/exchange-ml/registry/status', async (_request, _reply) => {
    const registryService = getExchangeModelRegistryService(db);
    await registryService.initializeRegistries();
    
    const stats = await registryService.getStats();
    
    // Clean _id for response
    const cleanRegistries = stats.registries.map(r => ({
      ...r,
      _id: r._id?.toString(),
    }));
    
    return {
      ok: true,
      data: {
        registries: cleanRegistries,
        summary: stats.summary,
      },
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/registry/models
   * Get all models
   */
  fastify.get('/api/admin/exchange-ml/registry/models', async (request, _reply) => {
    const query = request.query as { horizon?: ExchangeHorizon };
    
    const trainerService = getExchangeTrainerService(db);
    
    let models;
    if (query.horizon) {
      models = await trainerService.getModelsByHorizon(query.horizon);
    } else {
      // Get all horizons
      const all1D = await trainerService.getModelsByHorizon('1D');
      const all7D = await trainerService.getModelsByHorizon('7D');
      const all30D = await trainerService.getModelsByHorizon('30D');
      models = [...all1D, ...all7D, ...all30D];
    }
    
    // Clean and minimize artifact data in response
    const cleanModels = models.map(m => ({
      modelId: m.modelId,
      horizon: m.horizon,
      algo: m.algo,
      version: m.version,
      status: m.status,
      trainedAt: m.trainedAt,
      metrics: {
        accuracy: m.metrics?.accuracy,
        precision: m.metrics?.precision,
        recall: m.metrics?.recall,
        f1Score: m.metrics?.f1Score,
      },
      datasetInfo: m.datasetInfo,
      createdAt: m.createdAt,
      promotedAt: m.promotedAt,
    }));
    
    return {
      ok: true,
      data: {
        models: cleanModels,
        count: cleanModels.length,
      },
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/registry/model/:modelId
   * Get specific model details
   */
  fastify.get('/api/admin/exchange-ml/registry/model/:modelId', async (request, _reply) => {
    const params = request.params as { modelId: string };
    
    const trainerService = getExchangeTrainerService(db);
    const model = await trainerService.getModel(params.modelId);
    
    if (!model) {
      return {
        ok: false,
        error: 'NOT_FOUND',
        message: `Model ${params.modelId} not found`,
      };
    }
    
    return {
      ok: true,
      data: {
        ...model,
        _id: model._id?.toString(),
        // Hide raw weights in detailed view (too large)
        artifact: model.artifact ? {
          type: model.artifact.type,
          thresholds: model.artifact.thresholds,
          hasWeights: !!model.artifact.weights,
          weightsCount: model.artifact.weights?.length || 0,
        } : null,
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/registry/promote
   * Promote shadow model to active
   */
  fastify.post('/api/admin/exchange-ml/registry/promote', async (request, _reply) => {
    const body = request.body as { horizon: ExchangeHorizon };
    
    if (!body.horizon || !['1D', '7D', '30D'].includes(body.horizon)) {
      return {
        ok: false,
        error: 'INVALID_HORIZON',
        message: 'horizon must be 1D, 7D, or 30D',
      };
    }
    
    const registryService = getExchangeModelRegistryService(db);
    const result = await registryService.promoteShadowToActive(body.horizon);
    
    return {
      ok: result.success,
      data: result.success ? { promotedModelId: result.promotedModelId } : undefined,
      error: result.error,
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/registry/rollback
   * Rollback to previous model
   */
  fastify.post('/api/admin/exchange-ml/registry/rollback', async (request, _reply) => {
    const body = request.body as { horizon: ExchangeHorizon };
    
    if (!body.horizon || !['1D', '7D', '30D'].includes(body.horizon)) {
      return {
        ok: false,
        error: 'INVALID_HORIZON',
        message: 'horizon must be 1D, 7D, or 30D',
      };
    }
    
    const registryService = getExchangeModelRegistryService(db);
    const result = await registryService.rollbackToPrevious(body.horizon);
    
    return {
      ok: result.success,
      data: result.success ? { rolledBackTo: result.rolledBackTo } : undefined,
      error: result.error,
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/registry/set-active
   * Manually set active model
   */
  fastify.post('/api/admin/exchange-ml/registry/set-active', async (request, _reply) => {
    const body = request.body as { modelId: string; horizon: ExchangeHorizon };
    
    if (!body.modelId || !body.horizon) {
      return {
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'modelId and horizon are required',
      };
    }
    
    const registryService = getExchangeModelRegistryService(db);
    const result = await registryService.setActiveModel(body.modelId, body.horizon);
    
    return {
      ok: result.success,
      data: result.success ? { activeModelId: body.modelId } : undefined,
      error: result.error,
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PR2: RETRAIN SCHEDULER
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-ml/retrain/status
   * Get retrain scheduler status
   */
  fastify.get('/api/admin/exchange-ml/retrain/status', async (_request, _reply) => {
    const scheduler = getExchangeRetrainScheduler(db);
    const status = scheduler.getStatus();
    
    return {
      ok: true,
      data: status,
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/retrain/start
   * Start retrain scheduler
   */
  fastify.post('/api/admin/exchange-ml/retrain/start', async (_request, _reply) => {
    if (!isRetrainEnabled()) {
      return {
        ok: false,
        error: 'RETRAIN_DISABLED',
        message: 'Retrain is disabled. Set EXCHANGE_RETRAIN_ENABLED=true',
      };
    }
    
    const scheduler = getExchangeRetrainScheduler(db);
    scheduler.start();
    
    return {
      ok: true,
      data: {
        message: 'Retrain scheduler started',
        status: scheduler.getStatus(),
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/retrain/stop
   * Stop retrain scheduler
   */
  fastify.post('/api/admin/exchange-ml/retrain/stop', async (_request, _reply) => {
    const scheduler = getExchangeRetrainScheduler(db);
    scheduler.stop();
    
    return {
      ok: true,
      data: {
        message: 'Retrain scheduler stopped',
        status: scheduler.getStatus(),
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/retrain/trigger
   * Manually trigger retrain for a horizon
   */
  fastify.post('/api/admin/exchange-ml/retrain/trigger', async (request, _reply) => {
    const body = request.body as { horizon: ExchangeHorizon };
    
    if (!body.horizon || !['1D', '7D', '30D'].includes(body.horizon)) {
      return {
        ok: false,
        error: 'INVALID_HORIZON',
        message: 'horizon must be 1D, 7D, or 30D',
      };
    }
    
    const scheduler = getExchangeRetrainScheduler(db);
    const result = await scheduler.triggerRetrain(body.horizon, 'Manual trigger (admin API)');
    
    return {
      ok: result.success,
      data: result.success ? { runId: result.runId } : undefined,
      error: result.error,
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/retrain/trigger-all
   * Manually trigger retrain for all horizons
   */
  fastify.post('/api/admin/exchange-ml/retrain/trigger-all', async (_request, _reply) => {
    const scheduler = getExchangeRetrainScheduler(db);
    const results = await scheduler.triggerRetrainAll();
    
    return {
      ok: true,
      data: {
        results,
        message: 'Retrain triggered for all horizons',
      },
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PR2: INIT TRAINING SUBSYSTEM
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/admin/exchange-ml/training/init
   * Initialize training indexes and registries
   */
  fastify.post('/api/admin/exchange-ml/training/init', async (_request, _reply) => {
    try {
      const trainerService = getExchangeTrainerService(db);
      const registryService = getExchangeModelRegistryService(db);
      
      await trainerService.ensureIndexes();
      await registryService.ensureIndexes();
      await registryService.initializeRegistries();
      
      return {
        ok: true,
        data: {
          message: 'Training subsystem initialized',
          indexes: 'created',
          registries: 'initialized',
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'INIT_FAILED',
        message: err.message,
      };
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PR3: SHADOW MODE
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-ml/shadow/stats
   * Get shadow comparison statistics
   */
  fastify.get('/api/admin/exchange-ml/shadow/stats', async (request, _reply) => {
    const query = request.query as { horizon?: ExchangeHorizon };
    
    const metricsService = getExchangeShadowMetricsService(db);
    
    if (query.horizon) {
      const metrics = await metricsService.calculateMetrics(query.horizon);
      return {
        ok: true,
        data: {
          horizon: query.horizon,
          metrics,
          featureEnabled: isShadowEnabled(),
        },
      };
    }
    
    // All horizons
    const allMetrics = await metricsService.calculateAllMetrics();
    
    return {
      ok: true,
      data: {
        metrics: allMetrics,
        featureEnabled: isShadowEnabled(),
      },
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/shadow/comparison
   * Get detailed shadow vs active comparison
   */
  fastify.get('/api/admin/exchange-ml/shadow/comparison', async (request, _reply) => {
    const query = request.query as { horizon: ExchangeHorizon };
    
    if (!query.horizon || !['1D', '7D', '30D'].includes(query.horizon)) {
      return {
        ok: false,
        error: 'INVALID_HORIZON',
        message: 'horizon must be 1D, 7D, or 30D',
      };
    }
    
    const metricsService = getExchangeShadowMetricsService(db);
    
    const [metrics, windowStats, promotionCheck] = await Promise.all([
      metricsService.calculateMetrics(query.horizon),
      metricsService.getWindowStats(query.horizon),
      metricsService.checkPromotionReadiness(query.horizon),
    ]);
    
    return {
      ok: true,
      data: {
        comparison: {
          active: {
            modelId: metrics.activeModelId,
            accuracy: metrics.activeAccuracy,
            winRate: metrics.activeWinRate,
            precision: metrics.activePrecision,
            recall: metrics.activeRecall,
            stability: metrics.activeStability,
          },
          shadow: {
            modelId: metrics.shadowModelId,
            accuracy: metrics.shadowAccuracy,
            winRate: metrics.shadowWinRate,
            precision: metrics.shadowPrecision,
            recall: metrics.shadowRecall,
            stability: metrics.shadowStability,
          },
          delta: {
            accuracy: metrics.accuracyDelta,
            winRate: metrics.winRateDelta,
          },
          agreementRate: metrics.agreementRate,
        },
        windowStats: {
          shortWindow: windowStats.short,
          longWindow: windowStats.long,
        },
        promotion: promotionCheck,
        sampleCounts: {
          total: metrics.totalPredictions,
          resolved: metrics.resolvedPredictions,
          pending: metrics.pendingPredictions,
        },
        timeRange: {
          oldest: metrics.oldestPrediction,
          newest: metrics.newestPrediction,
        },
        featureEnabled: isShadowEnabled(),
      },
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/shadow/predictions
   * Get recent shadow predictions
   */
  fastify.get('/api/admin/exchange-ml/shadow/predictions', async (request, _reply) => {
    const query = request.query as {
      horizon: ExchangeHorizon;
      resolvedOnly?: string;
      limit?: string;
    };
    
    if (!query.horizon || !['1D', '7D', '30D'].includes(query.horizon)) {
      return {
        ok: false,
        error: 'INVALID_HORIZON',
        message: 'horizon must be 1D, 7D, or 30D',
      };
    }
    
    const recorderService = getExchangeShadowRecorderService(db);
    
    const predictions = await recorderService.getRecentPredictions({
      horizon: query.horizon,
      resolvedOnly: query.resolvedOnly === 'true',
      limit: parseInt(query.limit || '50', 10),
    });
    
    // Clean _id
    const clean = predictions.map(p => ({
      ...p,
      _id: p._id?.toString(),
    }));
    
    return {
      ok: true,
      data: {
        predictions: clean,
        count: clean.length,
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/shadow/init
   * Initialize shadow indexes
   */
  fastify.post('/api/admin/exchange-ml/shadow/init', async (_request, _reply) => {
    try {
      const recorderService = getExchangeShadowRecorderService(db);
      await recorderService.ensureIndexes();
      
      return {
        ok: true,
        data: {
          message: 'Shadow subsystem initialized',
          indexes: 'created',
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'INIT_FAILED',
        message: err.message,
      };
    }
  });
  
  /**
   * POST /api/admin/exchange-ml/shadow/test-inference
   * Test dual inference with sample data
   */
  fastify.post('/api/admin/exchange-ml/shadow/test-inference', async (request, _reply) => {
    const body = request.body as {
      horizon: ExchangeHorizon;
      symbol?: string;
      features?: number[];
    };
    
    if (!body.horizon || !['1D', '7D', '30D'].includes(body.horizon)) {
      return {
        ok: false,
        error: 'INVALID_HORIZON',
        message: 'horizon must be 1D, 7D, or 30D',
      };
    }
    
    // Generate test features if not provided
    const testFeatures = body.features || [
      0.02,   // priceChange24h
      0.05,   // priceChange7d
      1.1,    // volumeRatio
      55,     // rsi14
      0.1,    // macdSignal
      0.05,   // bbWidth
      0.0001, // fundingRate
      0.03,   // oiChange24h
      0.3,    // sentimentScore
      0.75,   // regimeConfidence
      0.85,   // btcCorrelation
      0.2,    // marketStress
    ];
    
    const inferenceService = getExchangeInferenceService(db);
    
    const result = await inferenceService.predict({
      sampleId: `test_${Date.now()}`,
      symbol: body.symbol || 'BTCUSDT',
      horizon: body.horizon,
      features: testFeatures,
    });
    
    return {
      ok: true,
      data: {
        result,
        testFeatures,
        cacheStats: inferenceService.getCacheStats(),
        featureEnabled: isShadowEnabled(),
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/shadow/set-shadow
   * Manually set shadow model for testing
   */
  fastify.post('/api/admin/exchange-ml/shadow/set-shadow', async (request, _reply) => {
    const body = request.body as {
      modelId: string;
      horizon: ExchangeHorizon;
    };
    
    if (!body.modelId || !body.horizon) {
      return {
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'modelId and horizon are required',
      };
    }
    
    const registryService = getExchangeModelRegistryService(db);
    const result = await registryService.registerShadowModel(body.modelId, body.horizon);
    
    return {
      ok: result.success,
      data: result.success ? { shadowModelId: body.modelId } : undefined,
      error: result.error,
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/shadow/promotion-check
   * Check if shadow is ready for promotion
   */
  fastify.get('/api/admin/exchange-ml/shadow/promotion-check', async (request, _reply) => {
    const query = request.query as { horizon: ExchangeHorizon };
    
    if (!query.horizon || !['1D', '7D', '30D'].includes(query.horizon)) {
      return {
        ok: false,
        error: 'INVALID_HORIZON',
        message: 'horizon must be 1D, 7D, or 30D',
      };
    }
    
    const metricsService = getExchangeShadowMetricsService(db);
    const result = await metricsService.checkPromotionReadiness(query.horizon);
    
    return {
      ok: true,
      data: result,
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PR4: AUTO-PROMOTION
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-ml/promotion/evaluate
   * Evaluate promotion for a horizon
   */
  fastify.get('/api/admin/exchange-ml/promotion/evaluate', async (request, _reply) => {
    const query = request.query as { horizon?: ExchangeHorizon };
    
    const promotionService = getExchangeAutoPromotionService(db);
    
    if (query.horizon) {
      const result = await promotionService.evaluatePromotion(query.horizon);
      return {
        ok: true,
        data: {
          horizon: query.horizon,
          result,
        },
      };
    }
    
    const results = await promotionService.evaluateAllHorizons();
    return {
      ok: true,
      data: { results },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/promotion/execute
   * Execute promotion for a horizon
   */
  fastify.post('/api/admin/exchange-ml/promotion/execute', async (request, _reply) => {
    const body = request.body as { horizon: ExchangeHorizon };
    
    if (!body.horizon || !['1D', '7D', '30D'].includes(body.horizon)) {
      return {
        ok: false,
        error: 'INVALID_HORIZON',
        message: 'horizon must be 1D, 7D, or 30D',
      };
    }
    
    const promotionService = getExchangeAutoPromotionService(db);
    const result = await promotionService.executePromotion(body.horizon);
    
    return {
      ok: result.promoted,
      data: {
        promoted: result.promoted,
        promotedModelId: result.promotedModelId,
        checks: result.result.checks,
      },
      error: !result.promoted ? result.result.reason : undefined,
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/promotion/execute-all
   * Execute promotion for all horizons
   */
  fastify.post('/api/admin/exchange-ml/promotion/execute-all', async (_request, _reply) => {
    const promotionService = getExchangeAutoPromotionService(db);
    const results = await promotionService.executeAllPromotions();
    
    return {
      ok: true,
      data: results,
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PR5: AUTO-ROLLBACK
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-ml/rollback/evaluate
   * Evaluate rollback for a horizon
   */
  fastify.get('/api/admin/exchange-ml/rollback/evaluate', async (request, _reply) => {
    const query = request.query as { horizon?: ExchangeHorizon };
    
    const rollbackService = getExchangeAutoRollbackService(db);
    
    if (query.horizon) {
      const result = await rollbackService.evaluateRollback(query.horizon);
      return {
        ok: true,
        data: {
          horizon: query.horizon,
          result,
        },
      };
    }
    
    const results = await rollbackService.evaluateAllHorizons();
    return {
      ok: true,
      data: { results },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/rollback/execute
   * Execute rollback for a horizon
   */
  fastify.post('/api/admin/exchange-ml/rollback/execute', async (request, _reply) => {
    const body = request.body as { horizon: ExchangeHorizon };
    
    if (!body.horizon || !['1D', '7D', '30D'].includes(body.horizon)) {
      return {
        ok: false,
        error: 'INVALID_HORIZON',
        message: 'horizon must be 1D, 7D, or 30D',
      };
    }
    
    const rollbackService = getExchangeAutoRollbackService(db);
    const result = await rollbackService.executeRollback(body.horizon);
    
    return {
      ok: result.rolledBack,
      data: {
        rolledBack: result.rolledBack,
        rolledBackTo: result.rolledBackTo,
        checks: result.result.checks,
      },
      error: !result.rolledBack ? result.result.reason : undefined,
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PR6: GUARDRAILS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-ml/guardrails/status
   * Get guardrails status
   */
  fastify.get('/api/admin/exchange-ml/guardrails/status', async (_request, _reply) => {
    const guardrails = getExchangeGuardrailsService(db);
    const status = guardrails.getStatus();
    
    return {
      ok: true,
      data: status,
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/guardrails/kill-switch
   * Toggle kill switch
   */
  fastify.post('/api/admin/exchange-ml/guardrails/kill-switch', async (request, _reply) => {
    const body = request.body as { enabled: boolean; reason?: string };
    
    const guardrails = getExchangeGuardrailsService(db);
    
    if (body.enabled) {
      await guardrails.activateKillSwitch(body.reason);
    } else {
      await guardrails.deactivateKillSwitch(body.reason);
    }
    
    return {
      ok: true,
      data: {
        killSwitch: guardrails.isKillSwitchActive(),
        message: body.enabled ? 'Kill switch activated' : 'Kill switch deactivated',
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/guardrails/promotion-lock
   * Toggle promotion lock
   */
  fastify.post('/api/admin/exchange-ml/guardrails/promotion-lock', async (request, _reply) => {
    const body = request.body as { enabled: boolean; reason?: string };
    
    const guardrails = getExchangeGuardrailsService(db);
    
    if (body.enabled) {
      await guardrails.lockPromotion(body.reason);
    } else {
      await guardrails.unlockPromotion(body.reason);
    }
    
    return {
      ok: true,
      data: {
        promotionLock: guardrails.isPromotionLocked(),
        message: body.enabled ? 'Promotion locked' : 'Promotion unlocked',
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/guardrails/set-drift
   * Set drift state for testing
   */
  fastify.post('/api/admin/exchange-ml/guardrails/set-drift', async (request, _reply) => {
    const body = request.body as {
      horizon: ExchangeHorizon;
      state: 'NORMAL' | 'WARNING' | 'CRITICAL';
    };
    
    if (!body.horizon || !body.state) {
      return {
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'horizon and state are required',
      };
    }
    
    const guardrails = getExchangeGuardrailsService(db);
    guardrails.setDriftState(body.horizon, body.state);
    
    return {
      ok: true,
      data: {
        horizon: body.horizon,
        driftState: body.state,
      },
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PR4/5/6: LIFECYCLE SCHEDULER
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-ml/lifecycle/status
   * Get lifecycle scheduler status
   */
  fastify.get('/api/admin/exchange-ml/lifecycle/status', async (_request, _reply) => {
    const scheduler = getExchangeLifecycleScheduler(db);
    const guardrails = getExchangeGuardrailsService(db);
    
    return {
      ok: true,
      data: {
        scheduler: scheduler.getStatus(),
        guardrails: guardrails.getStatus(),
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/lifecycle/start
   * Start lifecycle scheduler
   */
  fastify.post('/api/admin/exchange-ml/lifecycle/start', async (_request, _reply) => {
    const scheduler = getExchangeLifecycleScheduler(db);
    scheduler.start();
    
    return {
      ok: true,
      data: {
        message: 'Lifecycle scheduler started',
        status: scheduler.getStatus(),
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/lifecycle/stop
   * Stop lifecycle scheduler
   */
  fastify.post('/api/admin/exchange-ml/lifecycle/stop', async (_request, _reply) => {
    const scheduler = getExchangeLifecycleScheduler(db);
    scheduler.stop();
    
    return {
      ok: true,
      data: {
        message: 'Lifecycle scheduler stopped',
        status: scheduler.getStatus(),
      },
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PR4/5/6: EVENT LOG
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-ml/events
   * Get recent model events
   */
  fastify.get('/api/admin/exchange-ml/events', async (request, _reply) => {
    const query = request.query as {
      horizon?: ExchangeHorizon;
      type?: string;
      limit?: string;
    };
    
    const eventLogger = getExchangeEventLoggerService(db);
    
    const events = await eventLogger.getRecentEvents({
      horizon: query.horizon,
      type: query.type as any,
      limit: parseInt(query.limit || '50', 10),
    });
    
    // Clean _id
    const clean = events.map(e => ({
      ...e,
      _id: e._id?.toString(),
    }));
    
    return {
      ok: true,
      data: {
        events: clean,
        count: clean.length,
      },
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/events/stats
   * Get event statistics
   */
  fastify.get('/api/admin/exchange-ml/events/stats', async (_request, _reply) => {
    const eventLogger = getExchangeEventLoggerService(db);
    const stats = await eventLogger.getStats();
    
    return {
      ok: true,
      data: stats,
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/lifecycle/init
   * Initialize lifecycle indexes
   */
  fastify.post('/api/admin/exchange-ml/lifecycle/init', async (_request, _reply) => {
    try {
      const eventLogger = getExchangeEventLoggerService(db);
      await eventLogger.ensureIndexes();
      
      return {
        ok: true,
        data: {
          message: 'Lifecycle subsystem initialized',
          indexes: 'created',
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'INIT_FAILED',
        message: err.message,
      };
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // HORIZON PERFORMANCE & CROSS-HORIZON BIAS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-ml/performance/stats
   * Get horizon performance statistics
   */
  fastify.get('/api/admin/exchange-ml/performance/stats', async (request, _reply) => {
    const query = request.query as { horizon?: ExchangeHorizon };
    
    const performanceService = getHorizonPerformanceService(db);
    
    if (query.horizon) {
      const stats = await performanceService.getStats(query.horizon);
      return {
        ok: true,
        data: {
          horizon: query.horizon,
          stats: stats ? {
            ...stats,
            _id: undefined,
          } : null,
        },
      };
    }
    
    const allStats = await performanceService.getAllStats();
    
    return {
      ok: true,
      data: {
        stats: allStats.map(s => ({
          ...s,
          _id: undefined,
        })),
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/performance/update
   * Manually trigger performance stats update
   */
  fastify.post('/api/admin/exchange-ml/performance/update', async (request, _reply) => {
    const body = request.body as { horizon?: ExchangeHorizon };
    
    const performanceService = getHorizonPerformanceService(db);
    
    try {
      if (body.horizon) {
        const stats = await performanceService.updateStats(body.horizon);
        return {
          ok: true,
          data: {
            horizon: body.horizon,
            stats: {
              ...stats,
              _id: undefined,
            },
            message: `Stats updated for ${body.horizon}`,
          },
        };
      }
      
      const allStats = await performanceService.updateAllStats();
      
      return {
        ok: true,
        data: {
          stats: Object.fromEntries(
            Object.entries(allStats).map(([k, v]) => [k, { ...v, _id: undefined }])
          ),
          message: 'Stats updated for all horizons',
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'UPDATE_FAILED',
        message: err.message,
      };
    }
  });
  
  /**
   * GET /api/admin/exchange-ml/performance/bias/diagnostics
   * Get cross-horizon bias diagnostics
   */
  fastify.get('/api/admin/exchange-ml/performance/bias/diagnostics', async (_request, _reply) => {
    const biasService = getCrossHorizonBiasService(db);
    
    const diagnostics = await biasService.getDiagnostics();
    const config = biasService.getConfig();
    
    return {
      ok: true,
      data: {
        diagnostics,
        config,
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/performance/bias/apply
   * Test bias application on a confidence value
   */
  fastify.post('/api/admin/exchange-ml/performance/bias/apply', async (request, _reply) => {
    const body = request.body as {
      horizon: ExchangeHorizon;
      confidence: number;
    };
    
    if (!body.horizon || !['1D', '7D', '30D'].includes(body.horizon)) {
      return {
        ok: false,
        error: 'INVALID_HORIZON',
        message: 'horizon must be 1D, 7D, or 30D',
      };
    }
    
    if (typeof body.confidence !== 'number' || body.confidence < 0 || body.confidence > 1) {
      return {
        ok: false,
        error: 'INVALID_CONFIDENCE',
        message: 'confidence must be a number between 0 and 1',
      };
    }
    
    const biasService = getCrossHorizonBiasService(db);
    const result = await biasService.apply(body.horizon, body.confidence);
    
    return {
      ok: true,
      data: {
        input: {
          horizon: body.horizon,
          confidence: body.confidence,
        },
        result,
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/performance/init
   * Initialize performance indexes
   */
  fastify.post('/api/admin/exchange-ml/performance/init', async (_request, _reply) => {
    try {
      const performanceService = getHorizonPerformanceService(db);
      await performanceService.ensureIndexes();
      
      // Initialize stats for all horizons
      await performanceService.getOrCreateStats('1D');
      await performanceService.getOrCreateStats('7D');
      await performanceService.getOrCreateStats('30D');
      
      return {
        ok: true,
        data: {
          message: 'Performance subsystem initialized',
          indexes: 'created',
          stats: 'initialized',
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'INIT_FAILED',
        message: err.message,
      };
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // DECAY STATS & AUDIT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-ml/performance/decay/stats
   * Get full performance stats with decay information
   */
  fastify.get('/api/admin/exchange-ml/performance/decay/stats', async (request, _reply) => {
    const query = request.query as { horizon?: ExchangeHorizon };
    
    const performanceService = getHorizonPerformanceService(db);
    
    if (query.horizon) {
      const perf = await performanceService.getPerformanceWithDecay(query.horizon);
      return {
        ok: true,
        data: { [query.horizon]: perf },
      };
    }
    
    const allPerf = await performanceService.getAllPerformanceWithDecay();
    
    return {
      ok: true,
      data: allPerf,
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/performance/decay/config
   * Get current decay configuration
   */
  fastify.get('/api/admin/exchange-ml/performance/decay/config', async (_request, _reply) => {
    const performanceService = getHorizonPerformanceService(db);
    const config = performanceService.getDecayConfig();
    
    return {
      ok: true,
      data: {
        config,
        envVars: {
          EXCH_BIAS_DECAY_ENABLED: process.env.EXCH_BIAS_DECAY_ENABLED || 'false',
          EXCH_BIAS_DECAY_MIN_EFFECTIVE_SAMPLES: process.env.EXCH_BIAS_DECAY_MIN_EFFECTIVE_SAMPLES || '15',
          EXCH_BIAS_DECAY_TAU_1D: process.env.EXCH_BIAS_DECAY_TAU_1D || '7',
          EXCH_BIAS_DECAY_TAU_7D: process.env.EXCH_BIAS_DECAY_TAU_7D || '14',
          EXCH_BIAS_DECAY_TAU_30D: process.env.EXCH_BIAS_DECAY_TAU_30D || '21',
        },
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/performance/decay/reload-config
   * Reload decay configuration from environment
   */
  fastify.post('/api/admin/exchange-ml/performance/decay/reload-config', async (_request, _reply) => {
    const performanceService = getHorizonPerformanceService(db);
    performanceService.reloadDecayConfig();
    const config = performanceService.getDecayConfig();
    
    return {
      ok: true,
      data: {
        message: 'Decay config reloaded',
        config,
      },
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/performance/decay/audit/status
   * Get decay audit job status
   */
  fastify.get('/api/admin/exchange-ml/performance/decay/audit/status', async (_request, _reply) => {
    const auditJob = getExchangeDecayAuditJob(db);
    const status = auditJob.getStatus();
    
    return {
      ok: true,
      data: status,
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/performance/decay/audit/run
   * Manually trigger decay audit
   */
  fastify.post('/api/admin/exchange-ml/performance/decay/audit/run', async (_request, _reply) => {
    const auditJob = getExchangeDecayAuditJob(db);
    const result = await auditJob.runAudit();
    
    return {
      ok: true,
      data: {
        message: 'Audit run complete',
        ...result,
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/performance/decay/audit/start
   * Start the decay audit scheduler
   */
  fastify.post('/api/admin/exchange-ml/performance/decay/audit/start', async (_request, _reply) => {
    const auditJob = getExchangeDecayAuditJob(db);
    auditJob.start();
    
    return {
      ok: true,
      data: {
        message: 'Decay audit job started',
        status: auditJob.getStatus(),
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/performance/decay/audit/stop
   * Stop the decay audit scheduler
   */
  fastify.post('/api/admin/exchange-ml/performance/decay/audit/stop', async (_request, _reply) => {
    const auditJob = getExchangeDecayAuditJob(db);
    auditJob.stop();
    
    return {
      ok: true,
      data: {
        message: 'Decay audit job stopped',
        status: auditJob.getStatus(),
      },
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // HORIZON CASCADE (BLOCK 3)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-ml/cascade/state
   * Get cascade state for a symbol
   */
  fastify.get('/api/admin/exchange-ml/cascade/state', async (request, _reply) => {
    const query = request.query as { symbol?: string };
    const symbol = (query.symbol || 'BTC').toUpperCase();
    
    const cascadeService = getHorizonCascadeService(db);
    const state = await cascadeService.getState(symbol);
    
    return {
      ok: true,
      data: {
        symbol,
        state,
      },
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/cascade/all
   * Get all cascade states
   */
  fastify.get('/api/admin/exchange-ml/cascade/all', async (_request, _reply) => {
    const cascadeService = getHorizonCascadeService(db);
    const states = await cascadeService.getAllStates();
    
    return {
      ok: true,
      data: {
        states,
        count: states.length,
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/cascade/recompute
   * Recompute cascade state for a symbol
   */
  fastify.post('/api/admin/exchange-ml/cascade/recompute', async (request, _reply) => {
    const body = request.body as { symbol?: string };
    const symbol = (body.symbol || 'BTC').toUpperCase();
    
    const cascadeService = getHorizonCascadeService(db);
    const state = await cascadeService.recompute(symbol);
    
    return {
      ok: true,
      data: {
        symbol,
        state,
      },
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/cascade/influence
   * Get cascade influence for training
   */
  fastify.get('/api/admin/exchange-ml/cascade/influence', async (request, _reply) => {
    const query = request.query as {
      symbol?: string;
      targetHorizon?: ExchangeHorizon;
      qualityState?: 'GOOD' | 'NORMAL' | 'BAD';
    };
    
    const symbol = (query.symbol || 'BTC').toUpperCase();
    const targetHorizon = query.targetHorizon || '7D';
    
    const cascadeService = getHorizonCascadeService(db);
    const influence = await cascadeService.getInfluence({
      symbol,
      targetHorizon,
      targetQualityState: query.qualityState,
    });
    
    return {
      ok: true,
      data: {
        symbol,
        targetHorizon,
        influence,
      },
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/cascade/config
   * Get cascade configuration
   */
  fastify.get('/api/admin/exchange-ml/cascade/config', async (_request, _reply) => {
    const cascadeService = getHorizonCascadeService(db);
    const config = cascadeService.getConfig();
    
    return {
      ok: true,
      data: config,
    };
  });
  
  console.log('[Exchange ML Admin] Routes registered (PR1-PR6 + Performance + Decay + Cascade)');
}

export default exchangeMLAdminRoutes;
