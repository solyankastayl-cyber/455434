/**
 * PHASE 3 — ML Routes
 * ====================
 * API for training, inference, and diagnostics
 */

import { FastifyInstance } from 'fastify';
import { mlTrainService } from '../services/ml.train.service.js';
import { mlInferenceService } from '../services/ml.inference.service.js';
import { mlDiagnosticsService } from '../services/ml.diagnostics.service.js';
import { mlDatasetBuilder } from '../services/ml.dataset.builder.js';
import { runAcceleratedSimulation, generateMarkdownReport } from '../services/shadow.simulation.service.js';

export async function registerMlRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // DATASET
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/v10/ml/dataset/stats — Dataset statistics
  fastify.get('/api/v10/ml/dataset/stats', async () => {
    const count = await mlDatasetBuilder.count();
    const byHorizon = await mlDatasetBuilder.count({ horizonBars: 6 });
    
    return {
      ok: true,
      totalRows: count,
      horizonBars6: byHorizon,
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // TRAINING
  // ═══════════════════════════════════════════════════════════════
  
  // POST /api/v10/ml/train — Train baseline models
  fastify.post<{
    Body: {
      symbols?: string[];
      horizonBars?: number;
      minRows?: number;
    };
  }>('/api/v10/ml/train', async (request) => {
    try {
      const result = await mlTrainService.trainBaseline({
        symbols: request.body?.symbols,
        horizonBars: request.body?.horizonBars ?? 6,
        minRows: request.body?.minRows ?? 100,
      });
      
      return {
        ok: true,
        message: 'Training completed',
        logreg: {
          version: result.logreg.version,
          metrics: result.logreg.metrics,
        },
        tree: {
          version: result.tree.version,
          metrics: result.tree.metrics,
        },
        summary: result.summary,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
      };
    }
  });
  
  // GET /api/v10/ml/models — List trained models
  fastify.get('/api/v10/ml/models', async () => {
    const models = await mlTrainService.listModels();
    
    return {
      ok: true,
      count: models.length,
      models: models.map((m) => ({
        modelType: m.modelType,
        version: m.version,
        trainedAt: m.trainedAt,
        metrics: m.metrics,
        isActive: (m as any).isActive,
      })),
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // INFERENCE
  // ═══════════════════════════════════════════════════════════════
  
  // POST /api/v10/ml/calibrate — Calibrate confidence
  fastify.post<{
    Body: {
      features: Record<string, number>;
      rawConfidence: number;
      model?: 'LOGREG' | 'TREE';
    };
  }>('/api/v10/ml/calibrate', async (request) => {
    const result = await mlInferenceService.calibrateConfidence(
      request.body.features,
      request.body.rawConfidence,
      request.body.model
    );
    
    return {
      ok: true,
      ...result,
    };
  });
  
  // GET /api/v10/ml/ready — Check if inference is ready
  fastify.get('/api/v10/ml/ready', async () => {
    await mlInferenceService.reload();
    const ready = mlInferenceService.isReady();
    
    return {
      ok: true,
      ready,
      message: ready ? 'ML models loaded' : 'No trained models available',
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // DIAGNOSTICS
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/v10/ml/health — Model health and drift
  fastify.get('/api/v10/ml/health', async () => {
    const health = await mlDiagnosticsService.getModelHealth();
    
    return {
      ok: true,
      ...health,
    };
  });
  
  // GET /api/v10/ml/drift — Check for drift
  fastify.get<{ Querystring: { symbol?: string } }>(
    '/api/v10/ml/drift',
    async (request) => {
      const drift = await mlDiagnosticsService.checkDrift(request.query.symbol);
      
      return {
        ok: true,
        ...drift,
      };
    }
  );
  
  // GET /api/v10/ml/features — Feature importance
  fastify.get('/api/v10/ml/features', async () => {
    const features = await mlDiagnosticsService.getFeatureStats();
    
    return {
      ok: true,
      count: features.length,
      features,
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // SHADOW TRAINING SIMULATION
  // ═══════════════════════════════════════════════════════════════
  
  // POST /api/v10/ml/shadow/simulate — Run accelerated shadow training simulation
  fastify.post<{
    Body: {
      decisions?: number;
      durationHours?: number;
      format?: 'json' | 'markdown';
    };
  }>('/api/v10/ml/shadow/simulate', async (request) => {
    const numDecisions = request.body?.decisions ?? 500;
    const durationHours = request.body?.durationHours ?? 72;
    const format = request.body?.format ?? 'json';
    
    const result = await runAcceleratedSimulation(numDecisions, durationHours);
    
    if (format === 'markdown') {
      const report = generateMarkdownReport(result);
      return {
        ok: true,
        format: 'markdown',
        report,
        verdict: result.promotionDecision.verdict,
      };
    }
    
    return {
      ok: true,
      format: 'json',
      simulation: result,
    };
  });
  
  console.log('[Phase 3] ML Routes registered');
}
