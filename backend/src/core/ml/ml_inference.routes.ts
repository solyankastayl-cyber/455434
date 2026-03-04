/**
 * P3 ML Inference Routes
 * 
 * API endpoints for ML predictions:
 * - POST /api/v2/ml/predict/actor - Actor classification
 * - POST /api/v2/ml/predict/market - Market direction
 * - GET /api/v2/signals/market - Combined market signal
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ActorPredictService } from './actor_predict.service.js';
import { MarketPredictService } from './market_predict.service.js';
import { SignalEnsembleService } from './signal_ensemble.service.js';
import { reloadModels } from './model_loader.js';
import type { MarketSignal } from './ml_inference.types.js';

// ============================================
// REQUEST TYPES
// ============================================

interface ActorPredictRequest {
  network: string;
  actorId: string;
}

interface MarketPredictRequest {
  network: string;
  timeBucket?: number;
}

interface MarketSignalQuery {
  network: string;
  window?: MarketSignal['window'];
}

// ============================================
// ROUTES
// ============================================

export async function mlInferenceRoutes(app: FastifyInstance): Promise<void> {
  
  // ============================================
  // P3.1 - ACTOR ML
  // ============================================
  
  /**
   * POST /api/v2/ml/predict/actor
   * Predict actor class (SMART / NEUTRAL / NOISY)
   */
  app.post('/predict/actor', async (
    request: FastifyRequest<{ Body: ActorPredictRequest }>,
    reply: FastifyReply
  ) => {
    const { network, actorId } = request.body || {};
    
    if (!network) {
      return reply.code(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: 'network is required',
      });
    }
    
    if (!actorId) {
      return reply.code(400).send({
        ok: false,
        error: 'ACTOR_ID_REQUIRED',
        message: 'actorId is required',
      });
    }
    
    try {
      const prediction = await ActorPredictService.predict(network, actorId);
      
      return reply.send({
        ok: true,
        data: prediction,
      });
    } catch (error: any) {
      app.log.error(`[P3.1] Actor prediction failed: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: 'PREDICTION_FAILED',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v2/ml/predict/actor/batch
   * Batch predict multiple actors
   */
  app.post('/predict/actor/batch', async (
    request: FastifyRequest<{ Body: { network: string; actorIds: string[] } }>,
    reply: FastifyReply
  ) => {
    const { network, actorIds } = request.body || {};
    
    if (!network || !actorIds?.length) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'network and actorIds[] are required',
      });
    }
    
    try {
      const predictions = await ActorPredictService.batchPredict(
        network, 
        actorIds.slice(0, 100) // limit to 100
      );
      
      return reply.send({
        ok: true,
        data: { predictions },
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'PREDICTION_FAILED',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v2/ml/actors/smart
   * Get top SMART actors
   */
  app.get('/actors/smart', async (
    request: FastifyRequest<{ Querystring: { network: string; limit?: number } }>,
    reply: FastifyReply
  ) => {
    const { network, limit = 50 } = request.query;
    
    if (!network) {
      return reply.code(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: 'network is required',
      });
    }
    
    try {
      const actors = await ActorPredictService.getTopByClass(
        network, 
        'SMART', 
        Math.min(100, limit)
      );
      
      return reply.send({
        ok: true,
        data: { actors, count: actors.length },
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'QUERY_FAILED',
        message: error.message,
      });
    }
  });
  
  // ============================================
  // P3.0 - MARKET ML
  // ============================================
  
  /**
   * POST /api/v2/ml/predict/market
   * Predict market direction
   */
  app.post('/predict/market', async (
    request: FastifyRequest<{ Body: MarketPredictRequest }>,
    reply: FastifyReply
  ) => {
    const { network, timeBucket } = request.body || {};
    
    if (!network) {
      return reply.code(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: 'network is required',
      });
    }
    
    try {
      const prediction = await MarketPredictService.predict(network, timeBucket);
      
      return reply.send({
        ok: true,
        data: prediction,
      });
    } catch (error: any) {
      app.log.error(`[P3.0] Market prediction failed: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: 'PREDICTION_FAILED',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v2/ml/predict/market/all
   * Predict for all networks
   */
  app.get('/predict/market/all', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const predictions = await MarketPredictService.predictAll();
      
      return reply.send({
        ok: true,
        data: predictions,
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'PREDICTION_FAILED',
        message: error.message,
      });
    }
  });
  
  // ============================================
  // P0.1 - ML STATUS & POLICY
  // ============================================
  
  /**
   * GET /api/v2/ml/status
   * Full ML runtime status (P0.1)
   */
  app.get('/status', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const { getMLStatus } = await import('./ml_policy.js');
      const { checkPythonHealth } = await import('./ml_python_client.js');
      
      const status = getMLStatus();
      
      // Check Python health if enabled
      if (status.ml.pythonService.enabled) {
        status.ml.pythonService.healthy = await checkPythonHealth();
      }
      
      return reply.send({
        ok: true,
        data: status,
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'STATUS_FAILED',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v2/ml/policy
   * Update ML policy (admin only)
   */
  app.post('/policy', async (
    request: FastifyRequest<{ Body: any }>,
    reply: FastifyReply
  ) => {
    try {
      const { updatePolicy } = await import('./ml_policy.js');
      updatePolicy(request.body || {});
      
      return reply.send({
        ok: true,
        message: 'Policy updated',
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'UPDATE_FAILED',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v2/ml/circuit-breaker/reset
   * Reset circuit breaker
   */
  app.post('/circuit-breaker/reset', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const { resetCircuitBreaker } = await import('./ml_policy.js');
      resetCircuitBreaker();
      
      return reply.send({
        ok: true,
        message: 'Circuit breaker reset',
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'RESET_FAILED',
        message: error.message,
      });
    }
  });
  
  // ============================================
  // MODEL MANAGEMENT
  // ============================================
  
  /**
   * POST /api/v2/ml/models/reload
   * Reload model cache (after training)
   */
  app.post('/models/reload', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      reloadModels();
      
      return reply.send({
        ok: true,
        message: 'Models cache cleared, will reload on next prediction',
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'RELOAD_FAILED',
        message: error.message,
      });
    }
  });
  
  // ============================================
  // P0.2 - BACKTEST ENDPOINTS
  // ============================================
  
  /**
   * GET /api/v2/ml/backtest/market
   * Get market model backtest results
   */
  app.get('/backtest/market', async (
    request: FastifyRequest<{ Querystring: { network?: string; window?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { backtestMarket } = await import('./ml_backtest.service.js');
      const network = request.query.network || 'ethereum';
      const windowDays = parseInt(request.query.window || '30', 10);
      
      const result = await backtestMarket(network, windowDays);
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'BACKTEST_FAILED',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v2/ml/backtest/actor
   * Get actor model backtest results
   */
  app.get('/backtest/actor', async (
    request: FastifyRequest<{ Querystring: { network?: string; window?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { backtestActor } = await import('./ml_backtest.service.js');
      const network = request.query.network || 'ethereum';
      const windowDays = parseInt(request.query.window || '30', 10);
      
      const result = await backtestActor(network, windowDays);
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'BACKTEST_FAILED',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v2/ml/accuracy/history
   * Get accuracy history for a model
   */
  app.get('/accuracy/history', async (
    request: FastifyRequest<{ Querystring: { network?: string; type?: string; limit?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { getAccuracyHistory } = await import('./ml_backtest.service.js');
      const network = request.query.network || 'ethereum';
      const signalType = (request.query.type || 'market') as 'market' | 'actor';
      const limit = parseInt(request.query.limit || '30', 10);
      
      const history = await getAccuracyHistory(network, signalType, limit);
      
      return reply.send({
        ok: true,
        data: { history },
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'HISTORY_FAILED',
        message: error.message,
      });
    }
  });
  
  app.log.info('[P3] ML Inference routes registered');
  app.log.info('[P0.1] ML Status & Policy routes registered');
  app.log.info('[P0.2] ML Backtest routes registered');
}

// ============================================
// P3.2 - SIGNAL ENSEMBLE ROUTES
// ============================================

export async function signalEnsembleRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v2/signals/market
   * Get combined market signal (Exchange Pressure + Zones + ML)
   */
  app.get('/', async (
    request: FastifyRequest<{ Querystring: MarketSignalQuery }>,
    reply: FastifyReply
  ) => {
    const { network, window = '24h' } = request.query;
    
    if (!network) {
      return reply.code(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: 'network is required',
      });
    }
    
    try {
      const signal = await SignalEnsembleService.build(
        network, 
        window as MarketSignal['window']
      );
      
      return reply.send({
        ok: true,
        data: signal,
      });
    } catch (error: any) {
      app.log.error(`[P3.2] Signal ensemble failed: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: 'SIGNAL_FAILED',
        message: error.message,
      });
    }
  });
  
  /**
   * GET /api/v2/signals/market/all
   * Get signals for all networks
   */
  app.get('/all', async (
    request: FastifyRequest<{ Querystring: { window?: string } }>,
    reply: FastifyReply
  ) => {
    const { window = '24h' } = request.query;
    
    try {
      const signals = await SignalEnsembleService.buildAll(
        window as MarketSignal['window']
      );
      
      return reply.send({
        ok: true,
        data: signals,
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'SIGNAL_FAILED',
        message: error.message,
      });
    }
  });
  
  app.log.info('[P3.2] Signal Ensemble routes registered');
}

export default { mlInferenceRoutes, signalEnsembleRoutes };
