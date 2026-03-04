/**
 * Training Executor Service - B4.2
 * 
 * Executes training jobs via ML Service
 * Handles retries, timeouts, and error recovery
 */
import axios, { AxiosError } from 'axios';
import { TrainingRouterService, type TrainingJob } from './training_router.service.js';
import { MlRetrainQueueModel } from '../../ml_retrain/ml_retrain_queue.model.js';
import { MlModelRegistryModel } from '../../ml_retrain/ml_model_registry.model.js';

export interface TrainingResult {
  success: boolean;
  modelId?: string;
  modelVersion?: string;
  featurePack?: string;
  metrics?: {
    accuracy?: number;
    f1?: number;
    precision?: number;
    recall?: number;
  };
  featureCount?: number;
  dexIncluded?: boolean;
  error?: string;
  duration?: number;
}

export interface TrainingExecutionOptions {
  timeout?: number; // milliseconds
  retries?: number;
}

/**
 * Training Executor Service
 */
export class TrainingExecutorService {
  private router: TrainingRouterService;
  
  constructor() {
    this.router = new TrainingRouterService();
  }
  
  /**
   * Execute a training job
   */
  async execute(
    job: TrainingJob,
    options: TrainingExecutionOptions = {}
  ): Promise<TrainingResult> {
    const startTime = Date.now();
    
    // Validate job
    const validation = this.router.validate(job);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }
    
    // Get route
    const route = this.router.route(job);
    
    // Create queue entry
    const queueEntry = await MlRetrainQueueModel.create({
      network: job.network,
      modelType: job.task,
      reason: 'MANUAL',
      status: 'PENDING',
      mlVersion: 'v3.0', // Mark as v3
      v23Config: {
        featurePack: job.featurePack,
        datasetId: job.datasetId,
      },
    });
    
    try {
      // Update status to RUNNING
      queueEntry.status = 'RUNNING';
      queueEntry.startedAt = new Date();
      await queueEntry.save();
      
      console.log(`[Training] Executing ${job.featurePack} training for ${job.network}/${job.task}`);
      console.log(`[Training] Route: ${route.endpoint}`);
      
      // Execute training via ML Service
      const response = await axios.post(
        route.endpoint,
        {
          task: job.task,
          network: job.network,
          datasetId: job.datasetId,
          featurePack: job.featurePack,
          seed: job.seed, // P1.1: Pass seed for stability testing
        },
        {
          timeout: options.timeout || 120000, // 2 minutes default
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      
      const mlResult = response.data;
      
      // Mark queue entry as DONE
      queueEntry.status = 'DONE';
      queueEntry.finishedAt = new Date();
      await queueEntry.save();
      
      // Register model in registry (SHADOW status)
      if (mlResult.modelId) {
        await this.registerModel(job, mlResult);
      }
      
      const duration = Date.now() - startTime;
      
      console.log(
        `[Training] Success: modelId=${mlResult.modelId}, ` +
        `pack=${job.featurePack}, duration=${duration}ms`
      );
      
      return {
        success: true,
        modelId: mlResult.modelId,
        modelVersion: mlResult.version,
        featurePack: job.featurePack,
        metrics: mlResult.metrics,
        featureCount: mlResult.featureCount,
        dexIncluded: job.featurePack === 'PACK_A_PLUS_DEX',
        duration,
      };
      
    } catch (error) {
      // Mark queue entry as FAILED
      queueEntry.status = 'FAILED';
      queueEntry.finishedAt = new Date();
      queueEntry.error = error instanceof Error ? error.message : String(error);
      await queueEntry.save();
      
      const errorMsg = this.extractErrorMessage(error);
      
      console.error(`[Training] Failed: ${errorMsg}`);
      
      return {
        success: false,
        error: errorMsg,
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * Register trained model in registry
   */
  private async registerModel(job: TrainingJob, mlResult: any): Promise<void> {
    const modelVersion = mlResult.version || `v3.0_${job.featurePack.toLowerCase()}_${Date.now()}`;
    
    await MlModelRegistryModel.create({
      modelType: job.task,
      network: job.network,
      version: modelVersion,
      status: 'SHADOW', // Always SHADOW for v3 training
      metrics: mlResult.metrics || {},
      artifactPath: mlResult.artifactPath || `/models/${job.network}/${modelVersion}`,
      trainedAt: new Date(),
      
      // B4.2: Feature pack metadata
      featureMeta: {
        featurePack: job.featurePack,
        dexIncluded: job.featurePack === 'PACK_A_PLUS_DEX',
        featureCount: mlResult.featureCount,
        keptFeatures: mlResult.features || [],
      },
      
      // Governance: Start as NONE (requires evaluation + approval)
      approvalStatus: 'NONE',
    });
    
    console.log(`[Training] Model registered: ${modelVersion} (SHADOW)`);
  }
  
  /**
   * Extract error message from various error types
   */
  private extractErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.data) {
        const data = axiosError.response.data as any;
        return data.message || data.error || axiosError.message;
      }
      if (axiosError.code === 'ECONNREFUSED') {
        return 'ML Service unavailable (connection refused)';
      }
      if (axiosError.code === 'ETIMEDOUT') {
        return 'ML Service timeout';
      }
      return axiosError.message;
    }
    
    if (error instanceof Error) {
      return error.message;
    }
    
    return String(error);
  }
}

export default TrainingExecutorService;
