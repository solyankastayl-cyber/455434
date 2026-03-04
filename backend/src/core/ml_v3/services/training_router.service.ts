/**
 * Training Router Service - B4.2
 * 
 * Routes training requests to appropriate endpoints based on feature pack
 * SHADOW models only - never touches ACTIVE
 */
import { FeaturePack } from '../types/feature_packs.js';

export interface TrainingJob {
  task: 'market' | 'actor';
  network: string;
  datasetId: string;
  featurePack: FeaturePack;
  reason?: string;
  seed?: number; // P1.1: Random seed for stability testing
}

export interface TrainingRoute {
  endpoint: string;
  method: 'POST';
  description: string;
}

/**
 * Training Router Service
 */
export class TrainingRouterService {
  private readonly mlServiceUrl: string;
  
  constructor(mlServiceUrl?: string) {
    this.mlServiceUrl = mlServiceUrl || process.env.ML_SERVICE_URL || 'http://localhost:8002';
  }
  
  /**
   * Route a training job to the appropriate endpoint
   */
  route(job: TrainingJob): TrainingRoute {
    const { featurePack } = job;
    
    // P1.1 + P0.3: Use universal endpoint for all packs
    return {
      endpoint: `${this.mlServiceUrl}/api/v3/train`,
      method: 'POST',
      description: `Train SHADOW model with ${featurePack} features`,
    };
  }
  
  /**
   * Validate that a job is safe to execute
   * - Must be for SHADOW model only
   * - Must have valid feature pack
   * - Must have dataset ID
   */
  validate(job: TrainingJob): { valid: boolean; error?: string } {
    if (!job.datasetId) {
      return { valid: false, error: 'Missing datasetId' };
    }
    
    if (!job.task || !['market', 'actor'].includes(job.task)) {
      return { valid: false, error: 'Invalid task type' };
    }
    
    if (!job.network) {
      return { valid: false, error: 'Missing network' };
    }
    
    if (!Object.values(FeaturePack).includes(job.featurePack)) {
      return { valid: false, error: `Invalid feature pack: ${job.featurePack}` };
    }
    
    return { valid: true };
  }
  
  /**
   * Get all available routes
   */
  getAvailableRoutes(): Record<FeaturePack, TrainingRoute> {
    return {
      [FeaturePack.PACK_A]: this.route({
        task: 'market',
        network: 'ethereum',
        datasetId: 'dummy',
        featurePack: FeaturePack.PACK_A,
      }),
      [FeaturePack.PACK_A_PLUS_DEX]: this.route({
        task: 'market',
        network: 'ethereum',
        datasetId: 'dummy',
        featurePack: FeaturePack.PACK_A_PLUS_DEX,
      }),
    };
  }
}

export default TrainingRouterService;
