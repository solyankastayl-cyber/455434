/**
 * Neural Layer API Routes
 * 
 * ML advisory layer endpoints (Settings-Controlled)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  getMLHealth,
  getNeuralOutput,
  getActiveModels,
  getTrainingStatus,
} from '../core/neural/index.js';

export async function neuralRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/ml/health
   * 
   * Get ML layer health status
   */
  app.get('/ml/health', async () => {
    try {
      const health = await getMLHealth();
      
      return {
        ok: true,
        data: health,
      };
    } catch (error) {
      app.log.error(error, '[Neural] Health error');
      return {
        ok: false,
        error: 'NEURAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  /**
   * GET /api/ml/predict
   * 
   * Get ML predictions for a subject
   */
  app.get('/ml/predict', async (request: FastifyRequest) => {
    const query = request.query as {
      token?: string;
      actor?: string;
      window?: string;
      evidence?: string;
      direction?: string;
      coverage?: string;
      risk?: string;
      confidence?: string;
    };
    
    const subjectId = query.token || query.actor || 'unknown';
    const subjectKind = query.actor ? 'actor' : 'entity';
    
    try {
      const output = await getNeuralOutput({
        subject: { kind: subjectKind, id: subjectId },
        window: query.window || '24h',
        engineScores: {
          evidence: parseFloat(query.evidence || '50'),
          direction: parseFloat(query.direction || '0'),
          coverage: parseFloat(query.coverage || '50'),
          risk: parseFloat(query.risk || '50'),
          confidence: parseFloat(query.confidence || '50'),
        },
      });
      
      return {
        ok: true,
        data: output,
      };
    } catch (error) {
      app.log.error(error, '[Neural] Predict error');
      return {
        ok: false,
        error: 'NEURAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  /**
   * GET /api/ml/models
   * 
   * Get active ML models
   */
  app.get('/ml/models', async () => {
    try {
      const models = await getActiveModels();
      
      return {
        ok: true,
        data: {
          calibration: models.calibration ? {
            version: models.calibration.version,
            trainedAt: models.calibration.trainedAt,
            metrics: models.calibration.metrics,
            sampleCount: models.calibration.datasetRange.sampleCount,
          } : null,
          outcome: models.outcome ? {
            version: models.outcome.version,
            trainedAt: models.outcome.trainedAt,
            metrics: models.outcome.metrics,
            sampleCount: models.outcome.datasetRange.sampleCount,
          } : null,
          ranking: models.ranking ? {
            version: models.ranking.version,
            trainedAt: models.ranking.trainedAt,
          } : null,
        },
      };
    } catch (error) {
      app.log.error(error, '[Neural] Models error');
      return {
        ok: false,
        error: 'NEURAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  /**
   * POST /api/ml/train
   * 
   * @deprecated REMOVED - Use /api/ml/sandbox/train instead
   * 
   * Training is now ONLY available through the isolated sandbox.
   * This endpoint is disabled to enforce sandbox-only architecture.
   */
  app.post('/ml/train', async () => {
    return {
      ok: false,
      error: 'ENDPOINT_DISABLED',
      message: 'Direct training is disabled. Use /api/ml/sandbox/train for isolated training.',
      redirect: '/api/ml/sandbox/train',
    };
  });
  
  /**
   * GET /api/ml/training-status
   * 
   * Get training status and requirements
   */
  app.get('/ml/training-status', async () => {
    try {
      const status = await getTrainingStatus();
      
      return {
        ok: true,
        data: status,
      };
    } catch (error) {
      app.log.error(error, '[Neural] Training status error');
      return {
        ok: false,
        error: 'NEURAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * GET /api/ml/drift/summary
   * 
   * Get drift metrics (dataset vs baseline)
   * READ-ONLY - no ML influence
   */
  app.get('/ml/drift/summary', async () => {
    try {
      const health = await getMLHealth();
      
      return {
        ok: true,
        data: {
          feature_drift: {
            coverage: 0.0,
            actor_diversity: 0.0,
            flow_entropy: 0.0,
          },
          label_drift: 0.0,
          status: health.safetyGates?.driftOk ? 'STABLE' : 'WARNING',
          baseline_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          last_evaluated: new Date().toISOString(),
        },
      };
    } catch (error) {
      app.log.error(error, '[Neural] Drift summary error');
      return {
        ok: false,
        error: 'NEURAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * GET /api/ml/readiness
   * 
   * Single source of truth for ML training readiness
   * READ-ONLY - no ML influence
   */
  app.get('/ml/readiness', async () => {
    try {
      const health = await getMLHealth();
      const blockingReasons: string[] = [];
      const recommendations: string[] = [];
      
      // Check dataset size
      if (!health.safetyGates?.datasetOk) {
        blockingReasons.push('DATASET_TOO_SMALL');
        recommendations.push(`Accumulate ≥ ${health.training?.minRequiredSamples || 100} labeled signals`);
      }
      
      // Check coverage
      if (!health.safetyGates?.coverageOk) {
        blockingReasons.push('COVERAGE_INSUFFICIENT');
        recommendations.push('Increase market coverage to ≥ 60%');
      }
      
      // Check drift
      if (!health.safetyGates?.driftOk) {
        blockingReasons.push('DRIFT_DETECTED');
        recommendations.push('Stabilize data distribution');
      }
      
      // Check model quality
      if (!health.safetyGates?.modelQualityOk) {
        blockingReasons.push('MODEL_QUALITY_UNKNOWN');
        recommendations.push('Train initial model to establish baseline');
      }
      
      const ready = blockingReasons.length === 0;
      
      return {
        ok: true,
        data: {
          ready,
          status: ready ? 'READY' : health.blocked ? 'BLOCKED' : 'NOT_READY',
          blocking_reasons: blockingReasons,
          recommendations,
          gates: health.safetyGates,
          last_evaluated: new Date().toISOString(),
        },
      };
    } catch (error) {
      app.log.error(error, '[Neural] Readiness error');
      return {
        ok: false,
        error: 'NEURAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  app.log.info('Neural Layer routes registered');
}
