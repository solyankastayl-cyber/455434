/**
 * Shadow ML API Routes (Block F5)
 * 
 * Endpoints for Shadow ML management:
 * - Runtime mode control
 * - Shadow inference
 * - Prediction stats
 * - Kill switch
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  setMLMode,
  getMLRuntimeStatus,
  triggerKillSwitch,
  resetKillSwitch,
  runShadowInference,
  runBatchShadowInference,
  getShadowPredictionStats,
  extractFeatures,
  type ShadowInferenceInput,
  type MLRuntimeMode,
} from './shadow_ml.service.js';
import {
  runMLEvaluation,
  getLatestEvaluation,
  getEvaluationHistory,
} from './ml_evaluation.service.js';
import { TrainingSampleModel } from './training_sample.model.js';

export async function shadowMLRoutes(app: FastifyInstance): Promise<void> {
  
  // ============================================================
  // RUNTIME MODE CONTROL
  // ============================================================
  
  /**
   * GET /api/ml/status
   * Get current ML runtime status
   */
  app.get('/ml/status', async () => {
    try {
      const status = await getMLRuntimeStatus();
      return { ok: true, data: status };
    } catch (err: any) {
      return { ok: false, error: 'Failed to get ML status', details: err.message };
    }
  });
  
  /**
   * POST /api/ml/mode
   * Set ML runtime mode
   */
  app.post('/ml/mode', async (request: FastifyRequest) => {
    const body = request.body as { mode: MLRuntimeMode };
    
    if (!body.mode || !['OFF', 'SHADOW', 'ASSIST', 'ADVISOR'].includes(body.mode)) {
      return { ok: false, error: 'Invalid mode. Use: OFF, SHADOW, ASSIST, ADVISOR' };
    }
    
    try {
      const result = await setMLMode(body.mode, 'api-user');
      return { ok: result.success, message: result.message, data: result.state };
    } catch (err: any) {
      return { ok: false, error: 'Failed to set ML mode', details: err.message };
    }
  });
  
  /**
   * POST /api/ml/enable-shadow
   * Quick enable shadow mode
   */
  app.post('/ml/enable-shadow', async () => {
    try {
      const result = await setMLMode('SHADOW', 'api-enable-shadow');
      return { ok: result.success, message: result.message, data: result.state };
    } catch (err: any) {
      return { ok: false, error: 'Failed to enable shadow mode', details: err.message };
    }
  });
  
  /**
   * POST /api/ml/disable
   * Quick disable ML
   */
  app.post('/ml/disable', async () => {
    try {
      const result = await setMLMode('OFF', 'api-disable');
      return { ok: result.success, message: result.message, data: result.state };
    } catch (err: any) {
      return { ok: false, error: 'Failed to disable ML', details: err.message };
    }
  });
  
  // ============================================================
  // KILL SWITCH
  // ============================================================
  
  /**
   * POST /api/ml/kill
   * Trigger kill switch
   */
  app.post('/ml/kill', async (request: FastifyRequest) => {
    const body = request.body as { reason?: string };
    
    try {
      await triggerKillSwitch(body.reason || 'Manual kill via API');
      return { ok: true, message: 'Kill switch triggered' };
    } catch (err: any) {
      return { ok: false, error: 'Failed to trigger kill switch', details: err.message };
    }
  });
  
  /**
   * POST /api/ml/kill/reset
   * Reset kill switch
   */
  app.post('/ml/kill/reset', async () => {
    try {
      await resetKillSwitch('api-reset');
      return { ok: true, message: 'Kill switch reset' };
    } catch (err: any) {
      return { ok: false, error: 'Failed to reset kill switch', details: err.message };
    }
  });
  
  // ============================================================
  // SHADOW INFERENCE
  // ============================================================
  
  /**
   * POST /api/ml/shadow/infer
   * Run shadow inference for a token
   */
  app.post('/ml/shadow/infer', async (request: FastifyRequest) => {
    const body = request.body as {
      tokenAddress: string;
      symbol: string;
      windowType?: '1h' | '6h' | '24h';
      rulesDecision: {
        bucket: 'BUY' | 'WATCH' | 'SELL';
        confidence: number;
        risk: number;
        compositeScore: number;
      };
      features?: Record<string, number>;
    };
    
    if (!body.tokenAddress || !body.rulesDecision) {
      return { ok: false, error: 'Missing required fields: tokenAddress, rulesDecision' };
    }
    
    try {
      const input: ShadowInferenceInput = {
        tokenAddress: body.tokenAddress,
        symbol: body.symbol || 'UNKNOWN',
        windowType: body.windowType || '24h',
        rulesDecision: body.rulesDecision,
        features: body.features ? body.features as any : extractFeatures({
          features: {
            confidence: body.rulesDecision.confidence,
            risk: body.rulesDecision.risk,
            coverage: 50,
          },
        }),
        source: 'live',
      };
      
      const result = await runShadowInference(input);
      
      return {
        ok: !result.error,
        data: {
          prediction: result.prediction,
          modelVersion: result.modelVersion,
          latencyMs: result.latencyMs,
          inputHash: result.inputHash,
        },
        error: result.error,
      };
    } catch (err: any) {
      return { ok: false, error: 'Shadow inference failed', details: err.message };
    }
  });
  
  /**
   * POST /api/ml/shadow/batch
   * Run shadow inference on all training samples (for evaluation)
   */
  app.post('/ml/shadow/batch', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string };
    const limit = parseInt(query.limit || '100');
    
    try {
      // Get training samples
      const samples = await TrainingSampleModel.find()
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();
      
      const inputs: ShadowInferenceInput[] = samples.map(sample => ({
        tokenAddress: sample.tokenAddress,
        symbol: sample.symbol,
        windowType: sample.windowHours === 24 ? '24h' : sample.windowHours === 72 ? '6h' : '1h',
        rulesDecision: {
          bucket: sample.bucket as 'BUY' | 'WATCH' | 'SELL',
          confidence: sample.features?.confidence || 50,
          risk: sample.features?.risk || 50,
          compositeScore: sample.features?.confidence || 50,
        },
        features: extractFeatures(sample),
        source: sample.source as 'live' | 'simulated' || 'simulated',
      }));
      
      const results = await runBatchShadowInference(inputs);
      
      const successCount = results.filter(r => !r.error).length;
      const errorCount = results.filter(r => r.error).length;
      const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length;
      
      return {
        ok: true,
        data: {
          processed: results.length,
          success: successCount,
          errors: errorCount,
          avgLatencyMs: Math.round(avgLatency),
        },
      };
    } catch (err: any) {
      return { ok: false, error: 'Batch inference failed', details: err.message };
    }
  });
  
  // ============================================================
  // PREDICTION STATS
  // ============================================================
  
  /**
   * GET /api/ml/shadow/stats
   * Get shadow prediction statistics
   */
  app.get('/ml/shadow/stats', async (request: FastifyRequest) => {
    const query = request.query as { days?: string };
    const days = parseInt(query.days || '7');
    
    try {
      const stats = await getShadowPredictionStats(days);
      return { ok: true, data: stats };
    } catch (err: any) {
      return { ok: false, error: 'Failed to get prediction stats', details: err.message };
    }
  });
  
  // ============================================================
  // EVALUATION (F5.4)
  // ============================================================
  
  /**
   * POST /api/ml/evaluate
   * Run ML evaluation
   */
  app.post('/ml/evaluate', async (request: FastifyRequest) => {
    const query = request.query as { modelVersion?: string };
    
    try {
      const result = await runMLEvaluation(query.modelVersion);
      return { ok: true, data: result };
    } catch (err: any) {
      return { ok: false, error: 'Evaluation failed', details: err.message };
    }
  });
  
  /**
   * GET /api/ml/evaluation/latest
   * Get latest evaluation result
   */
  app.get('/ml/evaluation/latest', async (request: FastifyRequest) => {
    const query = request.query as { modelVersion?: string };
    
    try {
      const result = await getLatestEvaluation(query.modelVersion);
      if (!result) {
        return { ok: false, error: 'No evaluation found' };
      }
      return { ok: true, data: result };
    } catch (err: any) {
      return { ok: false, error: 'Failed to get evaluation', details: err.message };
    }
  });
  
  /**
   * GET /api/ml/evaluation/history
   * Get evaluation history
   */
  app.get('/ml/evaluation/history', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string };
    const limit = parseInt(query.limit || '10');
    
    try {
      const results = await getEvaluationHistory(limit);
      return { ok: true, data: { evaluations: results, count: results.length } };
    } catch (err: any) {
      return { ok: false, error: 'Failed to get evaluation history', details: err.message };
    }
  });
  
  app.log.info('[Shadow ML] F5 routes registered');
}
