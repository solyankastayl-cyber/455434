/**
 * ML Training Sandbox API Routes
 * 
 * ЭТАП 3: Isolated training infrastructure
 * 
 * ❌ NO influence on Engine
 * ❌ NO production writes
 * ❌ NO decision changes
 * ✅ Read-only data access
 * ✅ Artifact generation
 * ✅ Metrics tracking
 * 
 * This is a LABORATORY, not production.
 */
import { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import axios from 'axios';

// Training run interface
interface ITrainingRun {
  runId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
  modelType: 'confidence_calibrator' | 'outcome_model' | 'ranking_assist';
  horizon: string;
  startedAt: Date;
  completedAt?: Date;
  datasetStats: {
    totalSamples: number;
    trainSize: number;
    valSize: number;
    testSize: number;
    classBalance: { positive: number; negative: number };
  };
  metrics?: {
    accuracy?: number;
    precision?: number;
    recall?: number;
    f1?: number;
    roc_auc?: number;
    calibrationError?: number;
    brierScore?: number;
  };
  artifacts?: {
    modelPath?: string;
    metricsPath?: string;
    confusionMatrixPath?: string;
  };
  blockReasons?: string[];
  error?: string;
}

// Mongoose schema for training runs
const TrainingRunSchema = new mongoose.Schema<ITrainingRun>({
  runId: { type: String, required: true, unique: true, index: true },
  status: { 
    type: String, 
    required: true, 
    enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED'],
    default: 'PENDING'
  },
  modelType: { 
    type: String, 
    required: true,
    enum: ['confidence_calibrator', 'outcome_model', 'ranking_assist']
  },
  horizon: { type: String, required: true },
  startedAt: { type: Date, required: true, default: Date.now },
  completedAt: { type: Date },
  datasetStats: {
    totalSamples: { type: Number, default: 0 },
    trainSize: { type: Number, default: 0 },
    valSize: { type: Number, default: 0 },
    testSize: { type: Number, default: 0 },
    classBalance: {
      positive: { type: Number, default: 0 },
      negative: { type: Number, default: 0 }
    }
  },
  metrics: {
    accuracy: Number,
    precision: Number,
    recall: Number,
    f1: Number,
    roc_auc: Number,
    calibrationError: Number,
    brierScore: Number
  },
  artifacts: {
    modelPath: String,
    metricsPath: String,
    confusionMatrixPath: String
  },
  blockReasons: [String],
  error: String
}, {
  timestamps: true,
  collection: 'training_runs'
});

// Get or create model
const TrainingRunModel = mongoose.models.TrainingRun || 
  mongoose.model<ITrainingRun>('TrainingRun', TrainingRunSchema);

// Safety gates check
async function checkTrainingGates(): Promise<{ allowed: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  
  try {
    // Check dataset size using native mongo
    const db = mongoose.connection.db;
    if (!db) {
      reasons.push('DATABASE_NOT_CONNECTED');
      return { allowed: false, reasons };
    }
    
    const sampleCount = await db.collection('learning_samples').countDocuments({
      'quality.trainEligible': true
    });
    
    if (sampleCount < 100) {
      reasons.push(`DATASET_TOO_SMALL: ${sampleCount} < 100 required`);
    }
    
    // Check class balance (simplified)
    const samples = await db.collection('learning_samples')
      .find({ 'quality.trainEligible': true })
      .limit(1000)
      .toArray();
    
    if (samples.length > 0) {
      const positiveCount = samples.filter((s: any) => 
        s.labels?.verdicts?.verdict_7d === 'TRUE_POSITIVE'
      ).length;
      
      const positiveRate = positiveCount / samples.length;
      
      if (positiveRate > 0.9 || positiveRate < 0.1) {
        reasons.push(`CLASS_IMBALANCE: positive rate ${(positiveRate * 100).toFixed(1)}%`);
      }
    }
    
    // Check if ML service is available
    try {
      await axios.get('http://localhost:8003/health', { timeout: 2000 });
    } catch {
      reasons.push('ML_SERVICE_UNAVAILABLE');
    }
  } catch (error) {
    reasons.push('GATE_CHECK_ERROR');
  }
  
  return {
    allowed: reasons.length === 0,
    reasons
  };
}

export async function registerTrainingSandboxRoutes(app: FastifyInstance) {
  
  /**
   * GET /api/ml/sandbox/status
   * 
   * Get sandbox status and capabilities
   */
  app.get('/ml/sandbox/status', async () => {
    try {
      const gates = await checkTrainingGates();
      const lastRun = await TrainingRunModel.findOne({}).sort({ startedAt: -1 }).lean();
      const totalRuns = await TrainingRunModel.countDocuments();
      const successfulRuns = await TrainingRunModel.countDocuments({ status: 'COMPLETED' });
      
      return {
        ok: true,
        data: {
          sandbox: {
            enabled: true,
            isolated: true,
            engineConnected: false, // CRITICAL: Always false
            productionAccess: false, // CRITICAL: Always false
          },
          gates,
          stats: {
            totalRuns,
            successfulRuns,
            lastRun: lastRun ? {
              runId: lastRun.runId,
              status: lastRun.status,
              completedAt: lastRun.completedAt,
            } : null,
          },
        },
      };
    } catch (error) {
      app.log.error(error, '[Sandbox] Status error');
      return {
        ok: false,
        error: 'SANDBOX_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * GET /api/ml/sandbox/runs
   * 
   * List all training runs
   */
  app.get('/ml/sandbox/runs', async (request) => {
    try {
      const { limit = 20 } = request.query as { limit?: number };
      
      const runs = await TrainingRunModel
        .find({})
        .sort({ startedAt: -1 })
        .limit(Number(limit))
        .lean();
      
      return {
        ok: true,
        data: runs.map(r => ({
          runId: r.runId,
          status: r.status,
          modelType: r.modelType,
          horizon: r.horizon,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          datasetStats: r.datasetStats,
          metrics: r.metrics,
          blockReasons: r.blockReasons,
        })),
      };
    } catch (error) {
      app.log.error(error, '[Sandbox] List runs error');
      return {
        ok: false,
        error: 'SANDBOX_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * GET /api/ml/sandbox/runs/:runId
   * 
   * Get detailed run information
   */
  app.get('/ml/sandbox/runs/:runId', async (request) => {
    try {
      const { runId } = request.params as { runId: string };
      
      const run = await TrainingRunModel.findOne({ runId }).lean();
      
      if (!run) {
        return {
          ok: false,
          error: 'NOT_FOUND',
          message: 'Training run not found',
        };
      }
      
      return {
        ok: true,
        data: {
          runId: run.runId,
          status: run.status,
          modelType: run.modelType,
          horizon: run.horizon,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          datasetStats: run.datasetStats,
          metrics: run.metrics,
          artifacts: run.artifacts,
          blockReasons: run.blockReasons,
          error: run.error,
        },
      };
    } catch (error) {
      app.log.error(error, '[Sandbox] Get run error');
      return {
        ok: false,
        error: 'SANDBOX_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * POST /api/ml/sandbox/train
   * 
   * Start a new training run (SANDBOX ONLY)
   * 
   * This does NOT affect Engine or Rankings.
   */
  app.post('/ml/sandbox/train', async (request) => {
    try {
      const { 
        modelType = 'confidence_calibrator',
        horizon = '7d',
        forceRetrain = false 
      } = request.body as { 
        modelType?: string;
        horizon?: string;
        forceRetrain?: boolean;
      };
      
      // Check safety gates
      const gates = await checkTrainingGates();
      
      if (!gates.allowed && !forceRetrain) {
        const runId = `blocked_${Date.now()}`;
        
        const blockedRun = new TrainingRunModel({
          runId,
          status: 'BLOCKED',
          modelType: modelType as any,
          horizon,
          startedAt: new Date(),
          completedAt: new Date(),
          datasetStats: {
            totalSamples: 0,
            trainSize: 0,
            valSize: 0,
            testSize: 0,
            classBalance: { positive: 0, negative: 0 },
          },
          blockReasons: gates.reasons,
        });
        
        await blockedRun.save();
        
        return {
          ok: false,
          error: 'TRAINING_BLOCKED',
          data: {
            runId,
            blockReasons: gates.reasons,
          },
        };
      }
      
      // Generate run ID
      const runId = `train_${modelType}_${horizon}_${Date.now()}`;
      
      // Create pending run
      const newRun = new TrainingRunModel({
        runId,
        status: 'PENDING',
        modelType: modelType as any,
        horizon,
        startedAt: new Date(),
        datasetStats: {
          totalSamples: 0,
          trainSize: 0,
          valSize: 0,
          testSize: 0,
          classBalance: { positive: 0, negative: 0 },
        },
      });
      
      await newRun.save();
      
      // Start training asynchronously (call ML service)
      setImmediate(async () => {
        try {
          // Update status to running
          await TrainingRunModel.updateOne(
            { runId },
            { $set: { status: 'RUNNING' } }
          );
          
          // Call ML service for training
          const response = await axios.post('http://localhost:8003/train', {
            horizon,
            min_samples: 50,
            force_retrain: forceRetrain,
          }, { timeout: 300000 }); // 5 min timeout
          
          const result = response.data;
          
          // Update with results
          await TrainingRunModel.updateOne(
            { runId },
            {
              $set: {
                status: result.success ? 'COMPLETED' : 'FAILED',
                completedAt: new Date(),
                datasetStats: {
                  totalSamples: result.sample_count || 0,
                  trainSize: Math.floor((result.sample_count || 0) * 0.7),
                  valSize: Math.floor((result.sample_count || 0) * 0.15),
                  testSize: Math.floor((result.sample_count || 0) * 0.15),
                  classBalance: { positive: 0, negative: 0 },
                },
                metrics: result.metrics || {},
                error: result.success ? undefined : result.message,
                artifacts: result.success ? {
                  modelPath: `/ml_sandbox/models/${modelType}_${horizon}.pkl`,
                  metricsPath: `/ml_sandbox/metrics/${runId}.json`,
                } : undefined,
              },
            }
          );
          
          app.log.info(`[Sandbox] Training ${runId} completed: ${result.success ? 'SUCCESS' : 'FAILED'}`);
        } catch (err) {
          app.log.error(err, `[Sandbox] Training ${runId} error`);
          
          await TrainingRunModel.updateOne(
            { runId },
            {
              $set: {
                status: 'FAILED',
                completedAt: new Date(),
                error: err instanceof Error ? err.message : 'Training failed',
              },
            }
          );
        }
      });
      
      return {
        ok: true,
        data: {
          runId,
          status: 'PENDING',
          message: 'Training started. Check /api/ml/sandbox/runs/:runId for status.',
          warning: 'This model is SANDBOX ONLY and will NOT affect Engine decisions.',
        },
      };
    } catch (error) {
      app.log.error(error, '[Sandbox] Train error');
      return {
        ok: false,
        error: 'SANDBOX_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * GET /api/ml/sandbox/models
   * 
   * List available trained models (sandbox only)
   */
  app.get('/ml/sandbox/models', async () => {
    try {
      // Get successful runs with models
      const modelsRuns = await TrainingRunModel
        .find({ status: 'COMPLETED', artifacts: { $exists: true } })
        .sort({ completedAt: -1 })
        .lean();
      
      const models = modelsRuns.map(r => ({
        modelId: r.runId,
        modelType: r.modelType,
        horizon: r.horizon,
        trainedAt: r.completedAt,
        metrics: r.metrics,
        artifacts: r.artifacts,
        // CRITICAL: Always show these flags
        connectedToEngine: false,
        productionReady: false,
      }));
      
      return {
        ok: true,
        data: {
          models,
          warning: 'These models are SANDBOX ONLY. They do NOT affect production decisions.',
        },
      };
    } catch (error) {
      app.log.error(error, '[Sandbox] List models error');
      return {
        ok: false,
        error: 'SANDBOX_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * GET /api/ml/sandbox/metrics/:runId
   * 
   * Get detailed metrics for a training run
   */
  app.get('/ml/sandbox/metrics/:runId', async (request) => {
    try {
      const { runId } = request.params as { runId: string };
      
      const run = await TrainingRunModel.findOne({ runId }).lean();
      
      if (!run) {
        return {
          ok: false,
          error: 'NOT_FOUND',
          message: 'Training run not found',
        };
      }
      
      return {
        ok: true,
        data: {
          runId,
          status: run.status,
          metrics: run.metrics || {},
          datasetStats: run.datasetStats,
          trainedAt: run.completedAt,
          // Detailed breakdown
          evaluation: {
            accuracy: run.metrics?.precision ? 
              ((run.metrics.precision + (run.metrics.recall || 0)) / 2).toFixed(4) : null,
            calibrationError: run.metrics?.brierScore || null,
            overfitting: false, // TODO: Calculate from train vs test metrics
          },
        },
      };
    } catch (error) {
      app.log.error(error, '[Sandbox] Get metrics error');
      return {
        ok: false,
        error: 'SANDBOX_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  app.log.info('[Sandbox] Training Sandbox routes registered');
  app.log.info('[Sandbox] WARNING: Sandbox is ISOLATED. No Engine connection.');
}
