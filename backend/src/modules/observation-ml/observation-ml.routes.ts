/**
 * S6.5 — ObservationModel Routes
 * ===============================
 * 
 * API endpoints for ObservationModel v1.
 * Training, prediction, and comparison with Rules v0.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { observationMLService } from './observation-ml.service.js';

export async function registerObservationMLRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v6/observation/ml/status
   * Get ML model status and training readiness
   */
  app.get('/api/v6/observation/ml/status', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = await observationMLService.getStatus();
      
      return reply.send({
        ok: true,
        data: status,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'ML_STATUS_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v6/observation/ml/train
   * Train the ObservationModel v1
   */
  app.post('/api/v6/observation/ml/train', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { force?: boolean };
    
    try {
      console.log(`[ObservationML] Training request, force=${body.force}`);
      
      const result = await observationMLService.train({ force: body.force });
      
      return reply.send({
        ok: true,
        data: {
          ...result,
          message: result.status === 'TRAINED'
            ? `Model ${result.model_id} trained successfully. Accuracy: ${(result.metrics.accuracy * 100).toFixed(1)}%`
            : result.status === 'INSUFFICIENT_DATA'
              ? `Insufficient data for training. Need ${500} samples, have ${result.train_size}.`
              : 'Training failed.',
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'ML_TRAIN_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v6/observation/ml/compare
   * Compare Rules v0 vs ML v1 performance
   */
  app.get('/api/v6/observation/ml/compare', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const comparison = await observationMLService.compareWithRules();
      
      return reply.send({
        ok: true,
        data: {
          ...comparison,
          summary: comparison.improvement
            ? {
                accuracy_change: `${comparison.improvement.accuracy_delta > 0 ? '+' : ''}${(comparison.improvement.accuracy_delta * 100).toFixed(1)}%`,
                precision_change: `${comparison.improvement.precision_delta > 0 ? '+' : ''}${(comparison.improvement.precision_delta * 100).toFixed(1)}%`,
                recall_change: `${comparison.improvement.recall_delta > 0 ? '+' : ''}${(comparison.improvement.recall_delta * 100).toFixed(1)}%`,
              }
            : null,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'ML_COMPARE_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v6/observation/ml/features
   * Get feature importance
   */
  app.get('/api/v6/observation/ml/features', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = await observationMLService.getStatus();
      
      return reply.send({
        ok: true,
        data: {
          hasModel: status.hasModel,
          feature_importance: status.feature_importance,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'ML_FEATURES_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v6/observation/ml/predict
   * Predict for a specific observation
   */
  app.post('/api/v6/observation/ml/predict', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { observation_id: string };
    
    try {
      const { observationService } = await import('../observation/observation.service.js');
      
      const observation = await observationService.getObservation(body.observation_id);
      if (!observation) {
        return reply.status(404).send({
          ok: false,
          error: 'NOT_FOUND',
          message: `Observation ${body.observation_id} not found`,
        });
      }
      
      const prediction = await observationMLService.predict(observation);
      
      if (!prediction) {
        return reply.status(400).send({
          ok: false,
          error: 'NO_MODEL',
          message: 'No trained model available. Train the model first.',
        });
      }
      
      return reply.send({
        ok: true,
        data: {
          observation_id: body.observation_id,
          rules_v0: observation.decision,
          ml_v1: prediction,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'ML_PREDICT_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v6/observation/ml/training-data
   * Get training data statistics
   */
  app.get('/api/v6/observation/ml/training-data', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = await observationMLService.getStatus();
      
      return reply.send({
        ok: true,
        data: {
          total: status.trainingStats.total,
          byClass: status.trainingStats.byClass,
          ready: status.trainingStats.ready,
          minRequired: status.trainingStats.minRequired,
          progress: Math.min(100, (status.trainingStats.total / status.trainingStats.minRequired) * 100),
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'ML_TRAINING_DATA_ERROR',
        message: error.message,
      });
    }
  });
  
  console.log('[ObservationML] S6.5 routes registered');
}
