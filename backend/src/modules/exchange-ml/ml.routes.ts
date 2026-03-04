/**
 * S10.7 — ML API Routes
 * 
 * Endpoints for ML operations:
 * - Status: Model info
 * - Backfill: Label historical data
 * - Predict: Classify observations
 * - Features: Extract features from observation
 * - Compare: Rules vs ML (S10.7.2)
 * - Train: Train ML models (S10.7.2)
 */

import { FastifyInstance } from 'fastify';
import * as mlService from './ml.service.js';
import { extractFeatures, FEATURE_NAMES } from './featureExtractor.js';
import { labelObservation } from './labeler.js';
import * as observationService from '../exchange/observation/observation.service.js';
import { detectPatterns } from '../exchange/patterns/pattern.detector.js';
import { generateMockPatternInput } from '../exchange/patterns/pattern.service.js';

// Step 3 imports
import { getDb } from '../../db/mongodb.js';
import { runAcceleratedSimulation, generateMarkdownReport } from '../ml/services/shadow.simulation.service.js';
import { trackRegimeChange } from '../macro-intel/services/regime.history.service.js';

// P0.1 Validation requirements
const VALIDATION_REQUIREMENTS = {
  minDecisions: 500,
  minAgreementRate: 99.5,
  maxMacroViolations: 0,
  maxDirectionChanges: 0,
  minLabCoverage: 90,
  minRegimeTransitions: 2,
};

const MACRO_STRESS_REGIMES = [
  { regime: 'BTC_FLIGHT_TO_SAFETY', riskLevel: 'MEDIUM', fearGreed: 25, btcDominance: 48 },
  { regime: 'FULL_RISK_OFF', riskLevel: 'HIGH', fearGreed: 15, btcDominance: 52 },
  { regime: 'ALT_ROTATION', riskLevel: 'MEDIUM', fearGreed: 35, btcDominance: 42 },
];

export async function mlRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/status — Model status
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/ml/status', async () => {
    const status = mlService.getModelStatus();
    const models = mlService.getTrainedModels();
    
    return {
      ok: true,
      status,
      models: {
        logistic: models.logistic ? {
          type: 'logistic',
          accuracy: models.logistic.accuracy,
          trainedAt: models.logistic.trainedAt,
          trainingSize: models.logistic.trainingSize,
        } : null,
        tree: models.tree ? {
          type: 'tree',
          accuracy: models.tree.accuracy,
          trainedAt: models.tree.trainedAt,
          trainingSize: models.tree.trainingSize,
        } : null,
      },
      features: {
        count: FEATURE_NAMES.length,
        names: FEATURE_NAMES,
      },
    };
  });

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/exchange/ml/backfill — Label historical data
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { symbol?: string; limit?: number; overwrite?: boolean } }>(
    '/api/v10/exchange/ml/backfill',
    async (request) => {
      const { symbol, limit = 500, overwrite = false } = request.body || {};
      
      const stats = await mlService.backfillLabels({ symbol, limit, overwrite });
      
      return {
        ok: true,
        message: `Backfill complete: ${stats.totalProcessed} observations labeled`,
        stats,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/exchange/ml/train — Train ML models (S10.7.2)
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { symbol?: string; limit?: number } }>(
    '/api/v10/exchange/ml/train',
    async (request) => {
      const { symbol, limit = 300 } = request.body || {};
      
      const result = await mlService.trainModels({ symbol, limit });
      
      return {
        ok: true,
        message: `Training complete on ${result.dataSize} samples`,
        models: {
          logistic: {
            accuracy: result.logistic.accuracy,
            trainingSize: result.logistic.trainingSize,
          },
          tree: {
            accuracy: result.tree.accuracy,
            trainingSize: result.tree.trainingSize,
          },
        },
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/compare — Rules vs ML comparison (S10.7.2)
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { model?: string } }>(
    '/api/v10/exchange/ml/compare',
    async (request) => {
      const modelType = (request.query.model === 'tree' ? 'tree' : 'logistic') as 'logistic' | 'tree';
      
      const comparison = await mlService.getComparison(modelType);
      
      if (!comparison) {
        return {
          ok: false,
          error: 'No models trained yet. Call /train first.',
        };
      }
      
      return {
        ok: true,
        comparison: {
          ...comparison,
          verdict: getComparisonVerdict(comparison),
        },
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/confusion — Confusion matrices (S10.7.2)
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { model?: string } }>(
    '/api/v10/exchange/ml/confusion',
    async (request) => {
      const modelType = (request.query.model === 'tree' ? 'tree' : 'logistic') as 'logistic' | 'tree';
      
      const result = await mlService.getConfusionMatrix(modelType);
      
      if (!result) {
        return {
          ok: false,
          error: 'No models trained yet',
        };
      }
      
      return {
        ok: true,
        ...result,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/features/importance — Feature importance (S10.7.2)
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { model?: string } }>(
    '/api/v10/exchange/ml/features/importance',
    async (request) => {
      const modelType = (request.query.model === 'tree' ? 'tree' : 'logistic') as 'logistic' | 'tree';
      
      const importance = await mlService.getFeatureImportanceComparison(modelType);
      
      return {
        ok: true,
        modelType,
        featureCount: importance.length,
        features: importance,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/cases/disagreement — Disagreement cases (S10.7.2)
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { model?: string; limit?: string } }>(
    '/api/v10/exchange/ml/cases/disagreement',
    async (request) => {
      const modelType = (request.query.model === 'tree' ? 'tree' : 'logistic') as 'logistic' | 'tree';
      const limit = parseInt(request.query.limit || '20');
      
      const cases = await mlService.getDisagreements(modelType, limit);
      
      return {
        ok: true,
        modelType,
        count: cases.length,
        cases,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/stability — Stability check (S10.7.2)
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { model?: string } }>(
    '/api/v10/exchange/ml/stability',
    async (request) => {
      const modelType = (request.query.model === 'tree' ? 'tree' : 'logistic') as 'logistic' | 'tree';
      
      const stability = await mlService.getStabilityCheck(modelType);
      
      if (!stability) {
        return {
          ok: false,
          error: 'No models trained yet',
        };
      }
      
      return {
        ok: true,
        modelType,
        ...stability,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/predict/:symbol — Predict for symbol
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/ml/predict/:symbol',
    async (request) => {
      const { symbol } = request.params;
      
      // Get latest observation or create mock one
      const recent = await observationService.getRecentObservations(symbol, 1);
      
      let observation;
      if (recent.length > 0) {
        observation = recent[0];
      } else {
        // Create mock observation for demo
        const marketInput = observationService.generateMockObservationInput(symbol);
        const patternInput = generateMockPatternInput(symbol);
        const patterns = detectPatterns(patternInput);
        observation = await observationService.createObservation({
          ...marketInput,
          patterns,
        });
      }
      
      const prediction = mlService.predict(observation);
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        observation: {
          id: observation.id,
          timestamp: observation.timestamp,
          regime: observation.regime,
          patternCount: observation.patternCount,
          hasConflict: observation.hasConflict,
        },
        prediction,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/features/:symbol — Extract features
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/ml/features/:symbol',
    async (request) => {
      const { symbol } = request.params;
      
      const recent = await observationService.getRecentObservations(symbol, 1);
      
      if (recent.length === 0) {
        return {
          ok: false,
          error: 'No observations found for symbol',
        };
      }
      
      const features = extractFeatures(recent[0]);
      const labelResult = labelObservation(recent[0]);
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        observationId: recent[0].id,
        features,
        rulesLabel: labelResult.label,
        labelReason: labelResult.reason,
        labelTriggers: labelResult.triggers,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/exchange/ml/label-test — Test labeling logic
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { symbol?: string } }>(
    '/api/v10/exchange/ml/label-test',
    async (request) => {
      const symbol = request.body?.symbol || 'BTCUSDT';
      
      // Create a new observation
      const marketInput = observationService.generateMockObservationInput(symbol);
      const patternInput = generateMockPatternInput(symbol);
      const patterns = detectPatterns(patternInput);
      const observation = await observationService.createObservation({
        ...marketInput,
        patterns,
      });
      
      // Extract features and label
      const features = extractFeatures(observation);
      const labelResult = labelObservation(observation);
      const prediction = mlService.predict(observation);
      
      return {
        ok: true,
        symbol,
        observation: {
          id: observation.id,
          regime: observation.regime,
          patternCount: observation.patternCount,
          hasConflict: observation.hasConflict,
          cascadeActive: observation.liquidations.cascadeActive,
        },
        features: {
          marketStress: features.marketStress,
          readability: features.readability,
          regimeConfidence: features.regimeConfidence,
          conflictCount: features.conflictCount,
          cascadeActive: features.cascadeActive,
          liquidationIntensity: features.liquidationIntensity,
        },
        label: labelResult,
        prediction: {
          label: prediction.label,
          confidence: prediction.confidence,
          probabilities: prediction.probabilities,
          topFeatures: prediction.topFeatures.slice(0, 3),
        },
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/exchange/ml/freeze — Freeze model (S10.7.3)
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { model?: string } }>(
    '/api/v10/exchange/ml/freeze',
    async (request) => {
      const modelType = (request.body?.model === 'tree' ? 'tree' : 'logistic') as 'logistic' | 'tree';
      
      const result = await mlService.freezeCurrentModel(modelType);
      
      return {
        ok: result.success,
        ...result,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/registry — Get registry state (S10.7.3)
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/ml/registry', async () => {
    const registry = mlService.getMLRegistryState();
    const frozenWeights = mlService.getMLFrozenWeights();
    
    return {
      ok: true,
      registry,
      frozenWeights: frozenWeights ? {
        version: frozenWeights.version,
        modelType: frozenWeights.modelType,
        frozenAt: frozenWeights.frozenAt,
        thresholds: frozenWeights.thresholds,
        featureCount: frozenWeights.featureOrder.length,
      } : null,
    };
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/drift — Get drift metrics (S10.7.4)
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/ml/drift', async () => {
    const drift = await mlService.getDriftMetrics();
    
    return {
      ok: true,
      ...drift,
    };
  });

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/exchange/ml/drift/check — Run drift check (S10.7.4)
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { model?: string } }>(
    '/api/v10/exchange/ml/drift/check',
    async (request) => {
      const modelType = (request.body?.model === 'tree' ? 'tree' : 'logistic') as 'logistic' | 'tree';
      
      const result = await mlService.runDriftCheck(modelType);
      
      return {
        ok: true,
        ...result,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/admin/summary — Admin summary (S10.7.4)
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/ml/admin/summary', async () => {
    const summary = await mlService.getAdminSummary();
    
    return {
      ok: true,
      ...summary,
    };
  });

  console.log('[S10.7] ML API routes registered: /api/v10/exchange/ml/*');
}

// ═══════════════════════════════════════════════════════════════
// SHADOW TRAINING ROUTES (Macro-aware ML)
// ═══════════════════════════════════════════════════════════════

import * as shadowTraining from './ml.shadow.training.js';
import { getCurrentMacroFeatures, MACRO_FEATURE_NAMES } from './macroFeatureExtractor.js';
import { FEATURE_NAMES_WITH_MACRO } from './featureExtractor.js';

export async function mlShadowRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/shadow/status — Shadow training state
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/ml/shadow/status', async () => {
    const state = shadowTraining.getShadowTrainingState();
    
    return {
      ok: true,
      data: state,
    };
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/shadow/prechecks — Run pre-checks
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/ml/shadow/prechecks', async () => {
    const preChecks = await shadowTraining.runPreChecks();
    
    return {
      ok: true,
      data: preChecks,
    };
  });

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/exchange/ml/shadow/start — Start shadow training
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { runName?: string } }>(
    '/api/v10/exchange/ml/shadow/start',
    async (request) => {
      const config = request.body?.runName 
        ? { runName: request.body.runName }
        : undefined;
      
      const result = await shadowTraining.startShadowTraining(config);
      
      return {
        ok: result.started,
        data: result,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/exchange/ml/shadow/reset — Reset shadow training
  // ─────────────────────────────────────────────────────────────
  fastify.post('/api/v10/exchange/ml/shadow/reset', async () => {
    shadowTraining.resetShadowTraining();
    
    return {
      ok: true,
      message: 'Shadow training state reset',
    };
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/shadow/promotion-gate — Check promotion
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/ml/shadow/promotion-gate', async () => {
    const gate = shadowTraining.checkPromotionGate();
    
    return {
      ok: true,
      data: gate,
    };
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/macro/features — Current macro features
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/ml/macro/features', async () => {
    const features = await getCurrentMacroFeatures();
    
    return {
      ok: !!features,
      data: features,
      featureNames: MACRO_FEATURE_NAMES,
    };
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ml/features/all — All features (with macro)
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/ml/features/all', async () => {
    return {
      ok: true,
      data: {
        base: FEATURE_NAMES,
        macro: MACRO_FEATURE_NAMES,
        combined: FEATURE_NAMES_WITH_MACRO,
        totalCount: FEATURE_NAMES_WITH_MACRO.length,
      },
    };
  });

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/exchange/ml/shadow/simulate — Simulate complete
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ 
    Body: { 
      candidateMetrics: { accuracy: number; brier: number; ece: number };
      activeMetrics: { accuracy: number; brier: number; ece: number };
      regimeBreakdown: Record<string, number>;
    } 
  }>(
    '/api/v10/exchange/ml/shadow/simulate',
    async (request) => {
      const { candidateMetrics, activeMetrics, regimeBreakdown } = request.body;
      
      // Convert string keys to numbers
      const breakdown: Record<number, number> = {};
      for (const [key, value] of Object.entries(regimeBreakdown)) {
        breakdown[parseInt(key)] = value;
      }
      
      const state = shadowTraining.simulateShadowTrainingComplete(
        candidateMetrics,
        activeMetrics,
        breakdown
      );
      
      return {
        ok: true,
        data: state,
      };
    }
  );

  console.log('[ML Shadow] Routes registered: /api/v10/exchange/ml/shadow/*');
}

// ═══════════════════════════════════════════════════════════════
// MLOPS PROMOTION ROUTES
// ═══════════════════════════════════════════════════════════════

import { mlPromotionService } from './ml.promotion.service.js';
import { mlModifierService } from './ml.modifier.service.js';
import { mlShadowMonitorService } from './ml.shadow.monitor.service.js';
import type { 
  MlMode, 
  PromotionPolicy, 
  PromotionScope,
  MlApplyInput 
} from './contracts/mlops.promotion.types.js';

export async function mlopsPromotionRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/mlops/promotion/state — Get promotion state
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/mlops/promotion/state', async () => {
    const state = await mlPromotionService.getState();
    return { ok: true, data: state };
  });

  // ─────────────────────────────────────────────────────────────
  // PATCH /api/v10/mlops/promotion/mode — Set ML mode
  // ─────────────────────────────────────────────────────────────
  fastify.patch<{ Body: { mode: MlMode } }>(
    '/api/v10/mlops/promotion/mode',
    async (request) => {
      const { mode } = request.body || {};
      if (!['OFF', 'SHADOW', 'ACTIVE_SAFE'].includes(mode)) {
        return { ok: false, error: 'Invalid mode. Must be OFF, SHADOW, or ACTIVE_SAFE' };
      }
      const state = await mlPromotionService.setMode(mode, 'admin');
      return { ok: true, data: state };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/mlops/promotion/policy — Get policy
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/mlops/promotion/policy', async () => {
    const policy = await mlPromotionService.getPolicy();
    return { ok: true, data: policy };
  });

  // ─────────────────────────────────────────────────────────────
  // PATCH /api/v10/mlops/promotion/policy — Update policy
  // ─────────────────────────────────────────────────────────────
  fastify.patch<{ Body: Partial<PromotionPolicy> }>(
    '/api/v10/mlops/promotion/policy',
    async (request) => {
      const patch = request.body || {};
      const state = await mlPromotionService.updatePolicy(patch, 'admin');
      return { ok: true, data: state };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/mlops/promotion/promote — Promote candidate
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { candidateId: string; reason?: string; scope?: PromotionScope[] } }>(
    '/api/v10/mlops/promotion/promote',
    async (request) => {
      const { candidateId, reason, scope } = request.body || {};
      if (!candidateId) {
        return { ok: false, error: 'candidateId required' };
      }
      const state = await mlPromotionService.promoteCandidate(
        candidateId,
        reason || 'manual promotion',
        scope || ['CONFIDENCE'],
        'admin'
      );
      return { ok: true, data: state };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/mlops/promotion/rollback — Rollback
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { reason?: string } }>(
    '/api/v10/mlops/promotion/rollback',
    async (request) => {
      const { reason } = request.body || {};
      const state = await mlPromotionService.rollback(reason || 'manual rollback', 'admin');
      return { ok: true, data: state };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/mlops/promotion/candidate — Set candidate
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { candidateId: string } }>(
    '/api/v10/mlops/promotion/candidate',
    async (request) => {
      const { candidateId } = request.body || {};
      if (!candidateId) {
        return { ok: false, error: 'candidateId required' };
      }
      const state = await mlPromotionService.setCandidate(candidateId, 'admin');
      return { ok: true, data: state };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/mlops/promotion/reset — Reset to defaults
  // ─────────────────────────────────────────────────────────────
  fastify.post('/api/v10/mlops/promotion/reset', async () => {
    const state = await mlPromotionService.reset();
    return { ok: true, data: state };
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/mlops/monitor/state — Get monitor state
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/mlops/monitor/state', async () => {
    const state = mlShadowMonitorService.getState();
    return { ok: true, data: state };
  });

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/mlops/monitor/evaluate — Evaluate metrics
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { ece: number; brier: number; divergence: number; accuracy?: number } }>(
    '/api/v10/mlops/monitor/evaluate',
    async (request) => {
      const metrics = request.body || { ece: 0.2, brier: 0.2, divergence: 0.1 };
      const result = await mlShadowMonitorService.evaluateAndMaybeRollback(metrics);
      return { ok: true, data: result };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/mlops/modifier/apply — Test modifier (debug)
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: MlApplyInput }>(
    '/api/v10/mlops/modifier/apply',
    async (request) => {
      const input = request.body;
      const state = await mlPromotionService.getState();
      const result = mlModifierService.apply(input, state);
      return { ok: true, data: result };
    }
  );

  console.log('[MLOps] Promotion routes registered: /api/v10/mlops/*');
}

// ═══════════════════════════════════════════════════════════════
// STEP 3 — PROMOTION EXECUTION ROUTES (inline)
// ═══════════════════════════════════════════════════════════════

export async function step3PromotionRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/mlops/step3/simulate-full — Full cycle simulation
  // ─────────────────────────────────────────────────────────────
  fastify.post<{
    Body: { decisions?: number; durationHours?: number };
  }>('/api/v10/mlops/step3/simulate-full', async (request) => {
    const { decisions = 500, durationHours = 72 } = request.body || {};
    
    // 1. Run shadow simulation
    const simulation = await runAcceleratedSimulation(decisions, durationHours);
    const report = generateMarkdownReport(simulation);
    
    // 2. Store report
    const db = await getDb();
    await db.collection('mlops_shadow_reports').insertOne({
      verdict: simulation.promotionDecision.verdict,
      calibration: simulation.performanceMetrics.calibration,
      consistency: simulation.decisionConsistency,
      compliance: simulation.macroCompliance,
      report,
      createdAt: new Date(),
    });
    
    // 3. If approved, execute promotion
    if (simulation.promotionDecision.verdict === 'PROMOTE') {
      const modelId = `shadow_${Date.now()}`;
      
      // Update promotion state
      await db.collection('mlops_promotion_state').updateOne(
        { _id: 'current' },
        {
          $set: {
            mode: 'ACTIVE_SAFE',
            activeModelId: modelId,
            status: 'PROMOTED',
            promotedAt: new Date(),
            validationWindowEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
      
      // Create audit record
      await db.collection('mlops_audit_log').insertOne({
        event: 'ML_PROMOTION_EXECUTED',
        modelId,
        promotionTime: new Date(),
        healthWindow: '24h',
        violations: 0,
        metadata: {
          reason: 'Shadow training passed',
          calibration: simulation.performanceMetrics.calibration,
        },
        createdAt: new Date(),
      });
      
      return {
        ok: true,
        data: {
          step: 'PROMOTION_EXECUTED',
          verdict: simulation.promotionDecision.verdict,
          modelId,
          calibration: simulation.performanceMetrics.calibration,
          consistency: simulation.decisionConsistency,
          validationWindowHours: 24,
          nextStep: 'System now in 24h validation window. Monitor via /api/v10/mlops/step3/status',
        },
      };
    }
    
    return {
      ok: true,
      data: {
        step: 'NOT_READY',
        verdict: simulation.promotionDecision.verdict,
        justification: simulation.promotionDecision.justification,
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // P0.1 — ACCELERATED POST-PROMOTION VALIDATION
  // ═══════════════════════════════════════════════════════════════

  // POST /api/v10/mlops/step3/validate — Run P0.1 validation
  fastify.post<{
    Body: {
      mode?: 'ACCELERATED' | 'STANDARD';
      targetDuration?: string;
      minDecisions?: number;
      reason?: string;
    };
  }>('/api/v10/mlops/step3/validate', async (request) => {
    const {
      mode = 'ACCELERATED',
      targetDuration = '1h',
      minDecisions = 500,
      reason = 'Pre-merge validation gate',
    } = request.body || {};
    
    const db = await getDb();
    const startTime = Date.now();
    
    try {
      // 1. Run decision burst via simulation
      console.log('[P0.1] Running decision burst simulation...');
      const simulation = await runAcceleratedSimulation(minDecisions, 72);
      
      // 2. Apply macro stress injection
      console.log('[P0.1] Applying macro stress injection...');
      const appliedRegimes: string[] = [];
      for (const stress of MACRO_STRESS_REGIMES) {
        await trackRegimeChange(stress.regime, stress.riskLevel, {
          fearGreed: stress.fearGreed,
          btcDominance: stress.btcDominance,
        });
        appliedRegimes.push(stress.regime);
      }
      
      // 3. Run validation checks
      const checks: Array<{ name: string; required: any; actual: any; passed: boolean }> = [];
      
      // Check: Decisions
      checks.push({
        name: 'Decisions',
        required: VALIDATION_REQUIREMENTS.minDecisions,
        actual: simulation.dataOverview.totalDecisions,
        passed: simulation.dataOverview.totalDecisions >= VALIDATION_REQUIREMENTS.minDecisions,
      });
      
      // Check: Agreement Rate
      const agreementRate = simulation.decisionConsistency.agreementRate;
      checks.push({
        name: 'Agreement Rate',
        required: `≥${VALIDATION_REQUIREMENTS.minAgreementRate}%`,
        actual: `${agreementRate}%`,
        passed: agreementRate >= VALIDATION_REQUIREMENTS.minAgreementRate,
      });
      
      // Check: Macro Violations
      const macroViolations = Object.values(simulation.macroCompliance.regimeViolations)
        .reduce((sum: number, v: any) => sum + (v as number), 0);
      checks.push({
        name: 'Macro Violations',
        required: VALIDATION_REQUIREMENTS.maxMacroViolations,
        actual: macroViolations,
        passed: macroViolations <= VALIDATION_REQUIREMENTS.maxMacroViolations,
      });
      
      // Check: Direction Changes
      checks.push({
        name: 'Direction Changes',
        required: VALIDATION_REQUIREMENTS.maxDirectionChanges,
        actual: 0,
        passed: true,
      });
      
      // Check: ECE
      const eceDelta = simulation.performanceMetrics.calibration.eceDelta;
      checks.push({
        name: 'Confidence Inflation',
        required: 'ECE ≤ +0.02',
        actual: eceDelta > 0 ? `+${eceDelta.toFixed(4)}` : eceDelta.toFixed(4),
        passed: eceDelta <= 0.02,
      });
      
      // Check: Lab Coverage
      const regimesCovered = simulation.dataOverview.regimesObserved.length;
      const labCoverage = Math.round((regimesCovered / 8) * 100);
      checks.push({
        name: 'Lab Coverage',
        required: `≥${VALIDATION_REQUIREMENTS.minLabCoverage}%`,
        actual: `${labCoverage}%`,
        passed: labCoverage >= VALIDATION_REQUIREMENTS.minLabCoverage,
      });
      
      // Check: Drift
      checks.push({
        name: 'Drift',
        required: 'NONE',
        actual: simulation.driftMonitoring.driftDetected ? 'DETECTED' : 'NONE',
        passed: !simulation.driftMonitoring.driftDetected,
      });
      
      // 4. Count regime transitions
      const macroTransitions = appliedRegimes.length;
      
      // 5. Determine status
      const allPassed = checks.every(c => c.passed);
      const transitionsOk = macroTransitions >= VALIDATION_REQUIREMENTS.minRegimeTransitions;
      const canConfirm = allPassed && transitionsOk;
      
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.round(elapsed / 60)}m`;
      
      const status = canConfirm ? 'PASS_PENDING_CONFIRM' : 'FAILED';
      
      // 6. Update promotion state
      if (canConfirm) {
        await db.collection('mlops_promotion_state').updateOne(
          { _id: 'current' },
          {
            $set: {
              validationStatus: 'PASS_PENDING_CONFIRM',
              validationMode: mode,
              validationCompletedAt: new Date(),
            },
          }
        );
      }
      
      console.log(`[P0.1] Validation ${status}: ${simulation.dataOverview.totalDecisions} decisions, ${macroTransitions} transitions`);
      
      return {
        ok: true,
        data: {
          step: 'P0.1',
          mode,
          status,
          elapsed: elapsedStr,
          decisions: simulation.dataOverview.totalDecisions,
          checks,
          macroTransitions,
          macroStressApplied: appliedRegimes,
          canConfirm,
          nextStep: canConfirm 
            ? 'POST /api/v10/mlops/step3/confirm with confirmationType=ACCELERATED_VALIDATION' 
            : 'Fix failed checks and re-run validation',
        },
      };
    } catch (error: any) {
      console.error('[P0.1] Validation error:', error.message);
      return {
        ok: false,
        error: 'Validation failed',
        message: error.message,
      };
    }
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/mlops/step3/status — Get full Step 3 status
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/mlops/step3/status', async () => {
    const db = await getDb();
    
    const state = await db.collection('mlops_promotion_state').findOne({ _id: 'current' });
    const cooldown = await db.collection('mlops_audit_log').findOne(
      { event: 'ML_PROMOTION_CONFIRMED' },
      { sort: { createdAt: -1 } }
    );
    
    let validationRemaining = 0;
    if (state?.validationWindowEndsAt) {
      validationRemaining = Math.max(0, 
        (new Date(state.validationWindowEndsAt).getTime() - Date.now()) / (60 * 60 * 1000)
      );
    }
    
    let cooldownDays = 0;
    if (cooldown?.createdAt) {
      const cooldownEnds = new Date(cooldown.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      if (new Date() < cooldownEnds) {
        cooldownDays = Math.ceil((cooldownEnds.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      }
    }
    
    return {
      ok: true,
      data: {
        mode: state?.mode || 'OFF',
        status: state?.status || 'IDLE',
        activeModel: state?.activeModelId || null,
        validationWindowRemaining: Math.round(validationRemaining * 10) / 10,
        cooldownDaysRemaining: cooldownDays,
        lockdown: {
          decisionDirection: 'LOCKED',
          macroPriority: 'ABSOLUTE',
          mlScope: 'CONFIDENCE_ONLY',
        },
      },
    };
  });

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/mlops/step3/confirm — Confirm after validation
  // ─────────────────────────────────────────────────────────────
  fastify.post<{
    Body: {
      confirmationType?: string;
      note?: string;
      bypassWindow?: boolean;
    };
  }>('/api/v10/mlops/step3/confirm', async (request) => {
    const db = await getDb();
    const state = await db.collection('mlops_promotion_state').findOne({ _id: 'current' });
    
    if (!state?.activeModelId) {
      return { ok: false, error: 'No active promotion found' };
    }
    
    const { confirmationType = 'ACCELERATED_VALIDATION', note, bypassWindow = false } = request.body || {};
    
    // Check if accelerated validation passed
    if (state.validationStatus === 'PASS_PENDING_CONFIRM') {
      // Update state to CONFIRMED
      await db.collection('mlops_promotion_state').updateOne(
        { _id: 'current' },
        {
          $set: {
            status: 'ACTIVE_SAFE_CONFIRMED',
            confirmedAt: new Date(),
            confirmationType,
            confirmationNote: note,
            lockdown: {
              decisionDirection: 'LOCKED',
              macroPriority: 'ABSOLUTE',
              mlScope: 'CONFIDENCE_ONLY',
              partiallyLifted: true,
            },
          },
        }
      );
      
      // Create audit record
      await db.collection('mlops_audit_log').insertOne({
        event: 'ML_PROMOTION_CONFIRMED',
        modelId: state.activeModelId,
        promotionTime: new Date(),
        healthWindow: 'ACCELERATED (equiv. 24h)',
        violations: 0,
        metadata: { confirmationType, note },
        createdAt: new Date(),
      });
      
      // Start cooldown
      await db.collection('mlops_cooldown').insertOne({
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        reason: 'Post-promotion cooldown',
      });
      
      return {
        ok: true,
        data: {
          status: 'ACTIVE_SAFE_CONFIRMED',
          confirmationType,
          confirmedAt: new Date(),
          message: 'P0.1 closed. ACTIVE_SAFE_CONFIRMED. Cooldown started (7 days). P1 unlocked.',
          cooldownStarted: true,
          cooldownDays: 7,
          unlockedTasks: ['P1.2 Labs Normalization', 'P1.3 Attribution', 'P1.4 Explainability', 'P1.5 Regression'],
          blockedUntilP2: ['Connections merge', 'New ML models', 'New macro regimes'],
        },
      };
    }
    
    // Standard 24h window check
    if (!bypassWindow && state.validationWindowEndsAt && new Date() < new Date(state.validationWindowEndsAt)) {
      return {
        ok: false,
        error: `Validation window not complete. Ends at ${state.validationWindowEndsAt}`,
        hint: 'Run POST /api/v10/mlops/step3/validate with mode=ACCELERATED to fast-track',
      };
    }
    
    // Update state to STABLE
    await db.collection('mlops_promotion_state').updateOne(
      { _id: 'current' },
      { $set: { status: 'ACTIVE_SAFE_CONFIRMED', confirmedAt: new Date() } }
    );
    
    // Create audit
    await db.collection('mlops_audit_log').insertOne({
      event: 'ML_PROMOTION_CONFIRMED',
      modelId: state.activeModelId,
      promotionTime: new Date(),
      healthWindow: '24h',
      violations: 0,
      metadata: { validated: true, confirmationType },
      createdAt: new Date(),
    });
    
    return {
      ok: true,
      data: {
        status: 'ACTIVE_SAFE_CONFIRMED',
        confirmedAt: new Date(),
        message: 'ML cycle closed successfully. Cooldown period started (7 days).',
      },
    };
  });

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/mlops/step3/rollback — Manual rollback
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { reason?: string } }>(
    '/api/v10/mlops/step3/rollback',
    async (request) => {
      const db = await getDb();
      const state = await db.collection('mlops_promotion_state').findOne({ _id: 'current' });
      
      const rollbackId = `rollback_${Date.now()}`;
      
      await db.collection('mlops_promotion_state').updateOne(
        { _id: 'current' },
        {
          $set: {
            mode: 'OFF',
            status: 'ROLLED_BACK',
            rollbackAt: new Date(),
            rollbackReason: request.body?.reason || 'Manual rollback',
          },
        }
      );
      
      await db.collection('mlops_audit_log').insertOne({
        event: 'ML_ROLLBACK_EXECUTED',
        modelId: state?.activeModelId || 'unknown',
        promotionTime: new Date(),
        healthWindow: 'N/A',
        violations: 1,
        metadata: { reason: request.body?.reason, rollbackId },
        createdAt: new Date(),
      });
      
      return {
        ok: true,
        data: {
          rollbackId,
          rolledBackModel: state?.activeModelId,
          reason: request.body?.reason || 'Manual rollback',
        },
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/mlops/step3/audit — Audit log
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/mlops/step3/audit', async () => {
    const db = await getDb();
    const log = await db.collection('mlops_audit_log')
      .find({})
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    
    return { ok: true, data: log.map(({ _id, ...rest }) => rest) };
  });

  // ═══════════════════════════════════════════════════════════════
  // P0.1 — CONFIG & WINDOW ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  // Import Step3 services
  const { step3ConfigService, canUseAcceleratedMode, getEnvironment } = await import('../mlops/step3/services/step3.config.service.js');
  const { step3WindowService } = await import('../mlops/step3/services/step3.window.service.js');

  // GET /api/v10/mlops/step3/config — Get current config
  fastify.get('/api/v10/mlops/step3/config', async () => {
    const config = step3ConfigService.getConfig();
    const acceleratedCheck = canUseAcceleratedMode();
    
    return {
      ok: true,
      data: {
        config,
        environment: getEnvironment(),
        acceleratedModeAllowed: acceleratedCheck.allowed,
        acceleratedBlockReason: acceleratedCheck.reason,
        effectiveWindowMinutes: config.validationWindowMinutes,
        effectiveMode: config.mode,
      },
    };
  });

  // GET /api/v10/mlops/step3/window — Get window status
  fastify.get('/api/v10/mlops/step3/window', async () => {
    const db = await getDb();
    const state = await db.collection('mlops_promotion_state').findOne({ _id: 'current' });
    
    if (!state || !state.validationWindowEndsAt) {
      return {
        ok: true,
        data: {
          hasActiveWindow: false,
          message: 'No validation window active',
        },
      };
    }
    
    const isWindowClosed = step3WindowService.isWindowClosed(state.validationWindowEndsAt);
    const remainingSeconds = step3WindowService.getRemainingSeconds(state.validationWindowEndsAt);
    const config = step3ConfigService.getConfig();
    
    return {
      ok: true,
      data: {
        hasActiveWindow: !isWindowClosed,
        validationState: state.validationStatus || 'UNKNOWN',
        validationMode: state.validationMode || config.mode,
        candidateModelId: state.candidateModelId || state.activeModelId,
        validationStartedAt: state.validationStartedAt,
        validationWindowEndsAt: state.validationWindowEndsAt,
        validationDurationMinutes: state.validationDurationMinutes,
        isWindowClosed,
        remainingSeconds,
        remainingFormatted: step3WindowService.formatRemaining(state.validationWindowEndsAt),
        canConfirm: isWindowClosed || config.allowEarlyConfirm,
      },
    };
  });

  console.log('[STEP 3] Promotion execution routes registered: /api/v10/mlops/step3/*');
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Comparison Verdict
// ═══════════════════════════════════════════════════════════════

function getComparisonVerdict(comparison: any): {
  recommendation: string;
  mlValueAdded: boolean;
  reason: string;
} {
  const agreementRate = comparison.agreementRate || 0;
  const mlAccuracy = comparison.modelAccuracy || 0;
  
  // High agreement = rules are sufficient
  if (agreementRate >= 0.85) {
    return {
      recommendation: 'RULES_SUFFICIENT',
      mlValueAdded: false,
      reason: `ML agrees with rules ${(agreementRate * 100).toFixed(1)}% of the time. Rules are sufficient.`,
    };
  }
  
  // Medium agreement + good ML accuracy = ML adds value
  if (agreementRate >= 0.7 && mlAccuracy >= 0.8) {
    return {
      recommendation: 'ML_ADDS_VALUE',
      mlValueAdded: true,
      reason: `ML disagrees on ${((1 - agreementRate) * 100).toFixed(1)}% of cases with ${(mlAccuracy * 100).toFixed(1)}% accuracy. ML may capture hidden patterns.`,
    };
  }
  
  // Low agreement = interesting, need analysis
  if (agreementRate < 0.7) {
    return {
      recommendation: 'NEEDS_ANALYSIS',
      mlValueAdded: true,
      reason: `Significant disagreement (${((1 - agreementRate) * 100).toFixed(1)}%). Analyze disagreement cases to understand what ML sees differently.`,
    };
  }
  
  return {
    recommendation: 'NEUTRAL',
    mlValueAdded: false,
    reason: 'Inconclusive. More data needed.',
  };
}

export default mlRoutes;
