/**
 * ML Training API Routes (P0.8)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  startTraining,
  validateAndActivateModel,
  getTrainingStatus,
  runInference,
  buildTrainingDataset,
  getDatasetStats
} from '../services/index.js';
import {
  listModels,
  getActiveModel,
  getModelById,
  getModelStats,
  activateModel
} from '../storage/ml_model.model.js';
import {
  listTrainingRuns,
  getTrainingRun,
  getTrainingRunStats
} from '../storage/ml_training_run.model.js';
import {
  getEntityInferences,
  getInferenceStats
} from '../storage/ml_inference_log.model.js';

// ============================================
// Types
// ============================================

interface TrainingBody {
  modelType: 'CONFIDENCE_MODIFIER' | 'ANOMALY_DETECTOR' | 'CALIBRATION';
  targetVersion: string;
  trigger?: 'SCHEDULED' | 'MANUAL' | 'DRIFT_DETECTED' | 'CALIBRATION';
  notes?: string;
  datasetConfig?: {
    entityTypes?: string[];
    minCoverage?: number;
    windowDays?: number;
    limit?: number;
  };
}

interface InferenceBody {
  entityType: 'WALLET' | 'TOKEN' | 'ACTOR';
  entityId: string;
  windowHours?: number;
}

// ============================================
// Routes
// ============================================

export async function mlTrainingRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ==========================================
  // Training
  // ==========================================
  
  /**
   * POST /api/ml/training/start
   * Start a new training run
   */
  fastify.post<{ Body: TrainingBody }>('/start', async (request, reply) => {
    const { modelType, targetVersion, trigger = 'MANUAL', notes, datasetConfig } = request.body;
    
    if (!modelType || !targetVersion) {
      return reply.status(400).send({ error: 'modelType and targetVersion required' });
    }
    
    const windowDays = datasetConfig?.windowDays || 30;
    const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    
    const result = await startTraining({
      modelType,
      targetVersion,
      trigger,
      triggeredBy: 'API',
      notes,
      datasetConfig: {
        entityTypes: (datasetConfig?.entityTypes || ['WALLET', 'TOKEN', 'ACTOR']) as any,
        minCoverage: datasetConfig?.minCoverage || 0.5,
        windowStart,
        windowEnd: new Date(),
        limit: datasetConfig?.limit || 10000
      }
    });
    
    return result;
  });
  
  /**
   * GET /api/ml/training/runs
   * List training runs
   */
  fastify.get<{
    Querystring: { modelType?: string; status?: string; limit?: string };
  }>('/runs', async (request, reply) => {
    const { modelType, status, limit = '20' } = request.query;
    
    const runs = await listTrainingRuns(
      { 
        modelType: modelType as any, 
        status: status as any 
      },
      parseInt(limit)
    );
    
    return {
      count: runs.length,
      runs: runs.map(r => ({
        runId: r.runId,
        modelType: r.modelType,
        targetVersion: r.targetVersion,
        status: r.status,
        trigger: r.trigger,
        gatesCheckPassed: r.gatesCheckPassed,
        trainSamples: r.trainSamples,
        durationMs: r.durationMs,
        outputModelId: r.outputModelId,
        createdAt: r.createdAt
      }))
    };
  });
  
  /**
   * GET /api/ml/training/runs/:runId
   * Get training run details
   */
  fastify.get<{ Params: { runId: string } }>('/runs/:runId', async (request, reply) => {
    const run = await getTrainingRun(request.params.runId);
    
    if (!run) {
      return reply.status(404).send({ error: 'Training run not found' });
    }
    
    return run;
  });
  
  /**
   * GET /api/ml/training/runs/:runId/status
   * Get training run status
   */
  fastify.get<{ Params: { runId: string } }>('/runs/:runId/status', async (request, reply) => {
    const status = await getTrainingStatus(request.params.runId);
    
    if (!status) {
      return reply.status(404).send({ error: 'Training run not found' });
    }
    
    return status;
  });
  
  /**
   * GET /api/ml/training/stats
   * Get training statistics
   */
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    return getTrainingRunStats();
  });
  
  // ==========================================
  // Models
  // ==========================================
  
  /**
   * GET /api/ml/training/models
   * List models
   */
  fastify.get<{
    Querystring: { type?: string; status?: string; limit?: string };
  }>('/models', async (request, reply) => {
    const { type, status, limit = '20' } = request.query;
    
    const models = await listModels(
      { type: type as any, status: status as any },
      parseInt(limit)
    );
    
    return {
      count: models.length,
      models: models.map(m => ({
        modelId: m.modelId,
        version: m.version,
        type: m.type,
        status: m.status,
        trainedAt: m.trainedAt,
        metrics: m.metrics,
        sampleCount: m.sampleCount,
        deployedAt: m.deployedAt
      }))
    };
  });
  
  /**
   * GET /api/ml/training/models/:modelId
   * Get model details
   */
  fastify.get<{ Params: { modelId: string } }>('/models/:modelId', async (request, reply) => {
    const model = await getModelById(request.params.modelId);
    
    if (!model) {
      return reply.status(404).send({ error: 'Model not found' });
    }
    
    return model;
  });
  
  /**
   * GET /api/ml/training/models/active/:type
   * Get active model by type
   */
  fastify.get<{ Params: { type: string } }>('/models/active/:type', async (request, reply) => {
    const model = await getActiveModel(request.params.type as any);
    
    if (!model) {
      return reply.status(404).send({ error: 'No active model found for this type' });
    }
    
    return model;
  });
  
  /**
   * POST /api/ml/training/models/:modelId/activate
   * Activate a model
   */
  fastify.post<{ Params: { modelId: string } }>('/models/:modelId/activate', async (request, reply) => {
    const model = await activateModel(request.params.modelId);
    
    if (!model) {
      return reply.status(404).send({ error: 'Model not found' });
    }
    
    return {
      success: true,
      model: {
        modelId: model.modelId,
        version: model.version,
        status: model.status,
        deployedAt: model.deployedAt
      }
    };
  });
  
  /**
   * GET /api/ml/training/models/stats
   * Get model statistics
   */
  fastify.get('/models/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    return getModelStats();
  });
  
  // ==========================================
  // Inference
  // ==========================================
  
  /**
   * POST /api/ml/training/inference
   * Run inference for an entity
   */
  fastify.post<{ Body: InferenceBody }>('/inference', async (request, reply) => {
    const { entityType, entityId, windowHours = 24 } = request.body;
    
    if (!entityType || !entityId) {
      return reply.status(400).send({ error: 'entityType and entityId required' });
    }
    
    const result = await runInference({
      entityType,
      entityId,
      windowHours,
      requestSource: 'API'
    });
    
    return result;
  });
  
  /**
   * GET /api/ml/training/inference/:entityType/:entityId
   * Get inference history for entity
   */
  fastify.get<{
    Params: { entityType: string; entityId: string };
    Querystring: { limit?: string };
  }>('/inference/:entityType/:entityId', async (request, reply) => {
    const { entityId } = request.params;
    const limit = parseInt(request.query.limit || '20');
    
    const inferences = await getEntityInferences(entityId, limit);
    
    return {
      count: inferences.length,
      inferences
    };
  });
  
  /**
   * GET /api/ml/training/inference/stats
   * Get inference statistics
   */
  fastify.get<{
    Querystring: { sinceHours?: string };
  }>('/inference/stats', async (request, reply) => {
    const sinceHours = parseInt(request.query.sinceHours || '24');
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    
    return getInferenceStats(since);
  });
  
  // ==========================================
  // Dataset
  // ==========================================
  
  /**
   * POST /api/ml/training/dataset/build
   * Build a training dataset (preview)
   */
  fastify.post<{
    Body: {
      entityTypes?: string[];
      minCoverage?: number;
      windowDays?: number;
      limit?: number;
    };
  }>('/dataset/build', async (request, reply) => {
    const { entityTypes, minCoverage, windowDays = 30, limit = 1000 } = request.body;
    
    try {
      const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
      
      const dataset = await buildTrainingDataset({
        entityTypes: (entityTypes || ['WALLET', 'TOKEN', 'ACTOR']) as any,
        minCoverage: minCoverage || 0.5,
        windowStart,
        windowEnd: new Date(),
        limit
      });
      
      const stats = getDatasetStats(dataset);
      
      return {
        version: dataset.version,
        taxonomyVersion: dataset.taxonomyVersion,
        featureCount: dataset.featureCount,
        sampleCount: dataset.sampleCount,
        trainSamples: dataset.trainSamples,
        valSamples: dataset.valSamples,
        avgCoverage: dataset.avgCoverage,
        passRate: dataset.passRate,
        blockedCount: dataset.blockedCount,
        datasetHash: dataset.datasetHash,
        stats
      };
    } catch (error) {
      return reply.status(400).send({ 
        error: 'Failed to build dataset',
        message: (error as Error).message 
      });
    }
  });
  
  // ==========================================
  // Health & Info
  // ==========================================
  
  /**
   * GET /api/ml/training/health
   * Health check
   */
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const [modelStats, runStats, inferenceStats] = await Promise.all([
      getModelStats(),
      getTrainingRunStats(),
      getInferenceStats(new Date(Date.now() - 24 * 60 * 60 * 1000))
    ]);
    
    const hasActiveModel = modelStats.activeModels > 0;
    
    return {
      status: hasActiveModel ? 'healthy' : 'no_active_model',
      module: 'ML Training Loop (P0.8)',
      version: 'v1',
      models: {
        total: modelStats.totalModels,
        active: modelStats.activeModels
      },
      training: {
        totalRuns: runStats.totalRuns,
        successRate: runStats.successRate,
        gatesBlocked: runStats.gatesBlockedCount
      },
      inference: {
        last24h: inferenceStats.totalInferences,
        gatesPassRate: inferenceStats.totalInferences > 0 
          ? Math.round((inferenceStats.gatesPassedCount / inferenceStats.totalInferences) * 100)
          : 0,
        avgModifier: inferenceStats.avgConfidenceModifier
      }
    };
  });
  
  /**
   * GET /api/ml/training/info
   * Module info
   */
  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    return {
      module: 'ML Training Loop',
      version: 'v1',
      phase: 'P0.8',
      description: 'ML lifecycle management with enforced quality gates',
      principle: 'ML is a consumer, not source of truth. Gates are enforced, not optional.',
      
      components: {
        gateEnforcer: 'Hard enforcement of P0.7 gates before any ML operation',
        datasetBuilder: 'Builds training data from feature snapshots',
        trainingOrchestrator: 'Manages training lifecycle',
        inferenceService: 'Runs inference with gate checks'
      },
      
      outputType: 'confidence_modifier only',
      
      constraints: [
        'ML cannot run if gates fail',
        'ML cannot modify core data',
        'ML can be completely disabled',
        'All operations are logged'
      ],
      
      endpoints: {
        training: {
          start: 'POST /api/ml/training/start',
          runs: 'GET /api/ml/training/runs',
          status: 'GET /api/ml/training/runs/:runId/status'
        },
        models: {
          list: 'GET /api/ml/training/models',
          active: 'GET /api/ml/training/models/active/:type',
          activate: 'POST /api/ml/training/models/:modelId/activate'
        },
        inference: {
          run: 'POST /api/ml/training/inference',
          history: 'GET /api/ml/training/inference/:entityType/:entityId',
          stats: 'GET /api/ml/training/inference/stats'
        },
        dataset: {
          build: 'POST /api/ml/training/dataset/build'
        }
      }
    };
  });
}
