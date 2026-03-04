/**
 * Self-Learning Routes (ETAP 5.1-5.4)
 * 
 * API endpoints for self-learning loop control and monitoring.
 * 
 * ETAP 5.1: Guards, Config, Status
 * ETAP 5.2: Dataset Freeze
 * ETAP 5.3: Model Training (PR#2)
 * ETAP 5.4: Evaluation Gate (PR#2)
 */
import { FastifyPluginAsync } from 'fastify';
import { getSelfLearningStatus, triggerManualRetrain } from './self_learning_orchestrator.service.js';
import { canRetrain, getGuardSummary } from './retrain_guard.service.js';
import { getRecentAuditEvents, getLastGuardBlock } from './audit_helpers.js';
import { getSelfLearningConfig, updateSelfLearningConfig } from './self_learning_config.model.js';
import { trainModel, getModelById, getModels } from './model_trainer.service.js';
import { evaluateModel, getEvaluationReport, getLatestEvaluationForModel } from './model_evaluator.service.js';
import { runEvaluationGate, getGateResult } from './evaluation_gate_v2.service.js';
import { MLModelVersionModel, getActiveModel, getLatestCandidate } from './ml_model_version.model.js';
import { getRecentEvaluations, getEvaluationForCandidate } from './model_evaluation_report.model.js';
import { EVALUATION_RULES } from './evaluation_rules.js';

const selfLearningRoutesV2: FastifyPluginAsync = async (fastify) => {
  
  /**
   * GET /api/self-learning-v2/status
   * Get overall self-learning status
   * 
   * RESILIENT: Never throws 500, always returns 200 with health status
   */
  fastify.get('/status', async (request, reply) => {
    const result: any = {
      health: 'OK',
      enabled: false,
      config: {},
      lastRun: {},
      schedule: {},
      guards: {},
      errors: [],
    };
    
    try {
      // Step 1: Get config
      try {
        const status = await getSelfLearningStatus();
        return reply.code(200).send({
          ok: true,
          data: status,
        });
      } catch (configErr: any) {
        fastify.log.error(configErr, '[Self-Learning] Config error');
        result.health = 'DEGRADED';
        result.errors.push(`Config error: ${configErr.message}`);
        
        // Try to return partial status
        return reply.code(200).send({
          ok: false,
          health: 'DEGRADED',
          error: 'Self-learning status degraded',
          data: result,
        });
      }
    } catch (err: any) {
      fastify.log.error(err, '[Self-Learning] Status endpoint error');
      
      return reply.code(200).send({
        ok: false,
        health: 'ERROR',
        error: err.message,
        data: {
          enabled: false,
          message: 'Self-learning system error',
        },
      });
    }
  });
  
  /**
   * GET /api/self-learning-v2/guard-check
   * Check guard status for a horizon
   */
  fastify.get<{ Querystring: { horizon?: '7d' | '30d' } }>(
    '/guard-check',
    async (request, reply) => {
      try {
        const { horizon = '7d' } = request.query;
        
        const guardSnapshot = await canRetrain(horizon);
        const summary = getGuardSummary(guardSnapshot);
        
        return reply.code(200).send({
          ok: true,
          data: {
            horizon,
            passed: guardSnapshot.overallPass,
            summary,
            snapshot: guardSnapshot,
          },
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error checking guards');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * POST /api/self-learning-v2/run
   * Manual retrain trigger (admin/internal)
   */
  fastify.post<{ Body: { horizon?: '7d' | '30d'; operator?: string } }>(
    '/run',
    async (request, reply) => {
      try {
        const { horizon = '7d', operator = 'manual' } = request.body || {};
        
        const result = await triggerManualRetrain(horizon, operator);
        
        return reply.code(200).send({
          ok: true,
          data: result,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error triggering retrain');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/audit
   * Get audit events
   */
  fastify.get<{ Querystring: {
    limit?: number;
    eventType?: string;
    horizon?: '7d' | '30d';
    severity?: string;
  } }>(
    '/audit',
    async (request, reply) => {
      try {
        const { limit = 50, eventType, horizon, severity } = request.query;
        
        const events = await getRecentAuditEvents(
          limit,
          {
            eventType: eventType as any,
            horizon,
            severity,
          }
        );
        
        return reply.code(200).send({
          ok: true,
          data: {
            events,
            count: events.length,
          },
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error getting audit');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/last-block
   * Get last guard block reason
   */
  fastify.get<{ Querystring: { horizon?: '7d' | '30d' } }>(
    '/last-block',
    async (request, reply) => {
      try {
        const { horizon } = request.query;
        
        const lastBlock = await getLastGuardBlock(horizon);
        
        if (!lastBlock) {
          return reply.code(404).send({
            ok: false,
            error: 'No guard blocks found',
          });
        }
        
        return reply.code(200).send({
          ok: true,
          data: lastBlock,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error getting last block');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/config
   * Get current config
   */
  fastify.get('/config', async (request, reply) => {
    try {
      const config = await getSelfLearningConfig();
      
      return reply.code(200).send({
        ok: true,
        data: config,
      });
    } catch (err: any) {
      fastify.log.error(err, '[Self-Learning] Error getting config');
      return reply.code(500).send({
        ok: false,
        error: err.message,
      });
    }
  });
  
  /**
   * PATCH /api/self-learning-v2/config
   * Update config (admin only)
   */
  fastify.patch<{ Body: { updates: any; updatedBy: string } }>(
    '/config',
    async (request, reply) => {
      try {
        const { updates, updatedBy = 'admin' } = request.body || {};
        
        if (!updates) {
          return reply.code(400).send({
            ok: false,
            error: 'Missing updates',
          });
        }
        
        const updated = await updateSelfLearningConfig(updates, updatedBy);
        
        return reply.code(200).send({
          ok: true,
          data: updated,
          message: 'Config updated successfully',
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error updating config');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  // ==================== PR#2: MODEL TRAINING ENDPOINTS ====================
  
  /**
   * POST /api/self-learning-v2/train
   * Manual model training trigger
   */
  fastify.post<{ Body: { 
    datasetVersionId: string;
    horizon?: '7d' | '30d';
    algorithm?: 'logreg' | 'lightgbm';
  } }>(
    '/train',
    async (request, reply) => {
      try {
        const { datasetVersionId, horizon = '7d', algorithm = 'lightgbm' } = request.body || {};
        
        if (!datasetVersionId) {
          return reply.code(400).send({
            ok: false,
            error: 'Missing datasetVersionId',
          });
        }
        
        const result = await trainModel({
          datasetVersionId,
          horizon,
          algorithm,
          triggeredBy: 'manual',
        });
        
        return reply.code(200).send({
          ok: result.success,
          data: result,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error training model');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/models
   * List models
   */
  fastify.get<{ Querystring: {
    horizon?: '7d' | '30d';
    status?: string;
    limit?: number;
  } }>(
    '/models',
    async (request, reply) => {
      try {
        const { horizon, status, limit = 50 } = request.query;
        
        const models = await getModels({
          horizon: horizon as '7d' | '30d',
          status: status as any,
          limit,
        });
        
        return reply.code(200).send({
          ok: true,
          data: {
            models,
            count: models.length,
          },
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error getting models');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/models/:modelId
   * Get model by ID
   */
  fastify.get<{ Params: { modelId: string } }>(
    '/models/:modelId',
    async (request, reply) => {
      try {
        const { modelId } = request.params;
        
        const model = await getModelById(modelId);
        
        if (!model) {
          return reply.code(404).send({
            ok: false,
            error: `Model not found: ${modelId}`,
          });
        }
        
        return reply.code(200).send({
          ok: true,
          data: model,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error getting model');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/models/active/:horizon
   * Get active model for horizon
   */
  fastify.get<{ Params: { horizon: string } }>(
    '/models/active/:horizon',
    async (request, reply) => {
      try {
        const horizon = request.params.horizon as '7d' | '30d';
        
        const model = await getActiveModel(horizon);
        
        if (!model) {
          return reply.code(404).send({
            ok: false,
            error: `No active model for horizon: ${horizon}`,
          });
        }
        
        return reply.code(200).send({
          ok: true,
          data: model,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error getting active model');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  // ==================== PR#2: EVALUATION ENDPOINTS ====================
  
  /**
   * POST /api/self-learning-v2/evaluate
   * Manual model evaluation trigger
   */
  fastify.post<{ Body: { modelId: string } }>(
    '/evaluate',
    async (request, reply) => {
      try {
        const { modelId } = request.body || {};
        
        if (!modelId) {
          return reply.code(400).send({
            ok: false,
            error: 'Missing modelId',
          });
        }
        
        const result = await evaluateModel({
          modelId,
          evaluatedBy: 'manual',
        });
        
        return reply.code(200).send({
          ok: result.success,
          data: result,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error evaluating model');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * POST /api/self-learning-v2/gate
   * Run evaluation gate on evaluated model
   */
  fastify.post<{ Body: { evaluationId: string; modelId: string; horizon?: '7d' | '30d' } }>(
    '/gate',
    async (request, reply) => {
      try {
        const { evaluationId, modelId, horizon = '7d' } = request.body || {};
        
        if (!evaluationId || !modelId) {
          return reply.code(400).send({
            ok: false,
            error: 'Missing evaluationId or modelId',
          });
        }
        
        const result = await runEvaluationGate({
          evaluationId,
          modelId,
          horizon,
        });
        
        return reply.code(200).send({
          ok: true,
          data: result,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error running gate');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/evaluations
   * List evaluation reports
   */
  fastify.get<{ Querystring: {
    horizon?: '7d' | '30d';
    decision?: string;
    limit?: number;
  } }>(
    '/evaluations',
    async (request, reply) => {
      try {
        const { horizon, decision, limit = 50 } = request.query;
        
        const evaluations = await getRecentEvaluations(limit, {
          horizon: horizon as '7d' | '30d',
          decision: decision as any,
        });
        
        return reply.code(200).send({
          ok: true,
          data: {
            evaluations,
            count: evaluations.length,
          },
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error getting evaluations');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/evaluations/:evaluationId
   * Get evaluation report by ID
   */
  fastify.get<{ Params: { evaluationId: string } }>(
    '/evaluations/:evaluationId',
    async (request, reply) => {
      try {
        const { evaluationId } = request.params;
        
        const report = await getEvaluationReport(evaluationId);
        
        if (!report) {
          return reply.code(404).send({
            ok: false,
            error: `Evaluation not found: ${evaluationId}`,
          });
        }
        
        return reply.code(200).send({
          ok: true,
          data: report,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error getting evaluation');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/rules
   * Get evaluation rules/thresholds
   */
  fastify.get('/rules', async (request, reply) => {
    return reply.code(200).send({
      ok: true,
      data: EVALUATION_RULES,
    });
  });
  
  // ==================== PR#3: PROMOTION ENDPOINTS ====================
  
  /**
   * POST /api/self-learning-v2/promote
   * Promote APPROVED model to ACTIVE
   */
  fastify.post<{ Body: { modelId: string; horizon: '7d' | '30d'; force?: boolean } }>(
    '/promote',
    async (request, reply) => {
      try {
        const { modelId, horizon, force = false } = request.body || {};
        
        if (!modelId || !horizon) {
          return reply.code(400).send({
            ok: false,
            error: 'Missing modelId or horizon',
          });
        }
        
        const { promoteCandidate } = await import('./promotion.service.js');
        
        const result = await promoteCandidate({
          modelId,
          horizon,
          triggeredBy: 'api',
          force,
        });
        
        return reply.code(200).send({
          ok: result.success,
          data: result,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error promoting model');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/promotion/status/:horizon
   * Get promotion status for horizon
   */
  fastify.get<{ Params: { horizon: string } }>(
    '/promotion/status/:horizon',
    async (request, reply) => {
      try {
        const horizon = request.params.horizon as '7d' | '30d';
        
        const { getPromotionStatus } = await import('./promotion.service.js');
        const status = await getPromotionStatus(horizon);
        
        return reply.code(200).send({
          ok: true,
          data: status,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error getting promotion status');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/promotion/can-promote/:modelId
   * Check if model can be promoted
   */
  fastify.get<{ Params: { modelId: string }; Querystring: { horizon: '7d' | '30d' } }>(
    '/promotion/can-promote/:modelId',
    async (request, reply) => {
      try {
        const { modelId } = request.params;
        const horizon = request.query.horizon || '7d';
        
        const { canPromote } = await import('./promotion.service.js');
        const result = await canPromote(modelId, horizon);
        
        return reply.code(200).send({
          ok: true,
          data: result,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error checking promotion');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  // ==================== PR#3: ROLLBACK ENDPOINTS ====================
  
  /**
   * POST /api/self-learning-v2/rollback
   * Rollback to previous model
   */
  fastify.post<{ Body: { horizon: '7d' | '30d'; reason?: string; type?: 'TO_PREVIOUS' | 'TO_RULES_ONLY' } }>(
    '/rollback',
    async (request, reply) => {
      try {
        const { horizon, reason = 'Manual rollback', type = 'TO_PREVIOUS' } = request.body || {};
        
        if (!horizon) {
          return reply.code(400).send({
            ok: false,
            error: 'Missing horizon',
          });
        }
        
        const { rollback } = await import('./rollback.service.js');
        
        const result = await rollback({
          horizon,
          reason,
          triggeredBy: 'api',
          type,
        });
        
        return reply.code(200).send({
          ok: result.success,
          data: result,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error rolling back');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/rollback/status/:horizon
   * Get rollback status for horizon
   */
  fastify.get<{ Params: { horizon: string } }>(
    '/rollback/status/:horizon',
    async (request, reply) => {
      try {
        const horizon = request.params.horizon as '7d' | '30d';
        
        const { getRollbackStatus } = await import('./rollback.service.js');
        const status = await getRollbackStatus(horizon);
        
        return reply.code(200).send({
          ok: true,
          data: status,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error getting rollback status');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/rollback/history
   * Get rollback history
   */
  fastify.get<{ Querystring: { horizon?: '7d' | '30d'; limit?: number } }>(
    '/rollback/history',
    async (request, reply) => {
      try {
        const { horizon, limit = 20 } = request.query;
        
        const { getRollbackHistory } = await import('./rollback.service.js');
        const history = await getRollbackHistory(horizon, limit);
        
        return reply.code(200).send({
          ok: true,
          data: {
            history,
            count: history.length,
          },
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error getting rollback history');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  // ==================== PR#3: SHADOW MONITOR ENDPOINTS ====================
  
  /**
   * GET /api/self-learning-v2/monitor/status/:horizon
   * Get monitor status for horizon
   */
  fastify.get<{ Params: { horizon: string } }>(
    '/monitor/status/:horizon',
    async (request, reply) => {
      try {
        const horizon = request.params.horizon as '7d' | '30d';
        
        const { getMonitorStatus } = await import('./shadow_monitor.service.js');
        const status = await getMonitorStatus(horizon);
        
        return reply.code(200).send({
          ok: true,
          data: status,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error getting monitor status');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * POST /api/self-learning-v2/monitor/run
   * Manual monitor trigger
   */
  fastify.post<{ Body: { horizon?: '7d' | '30d' } }>(
    '/monitor/run',
    async (request, reply) => {
      try {
        const { horizon } = request.body || {};
        
        const { runMonitor } = await import('./shadow_monitor.service.js');
        
        if (horizon) {
          const result = await runMonitor({ horizon });
          return reply.code(200).send({
            ok: result.success,
            data: result,
          });
        } else {
          // Run for both horizons
          const [result7d, result30d] = await Promise.all([
            runMonitor({ horizon: '7d' }),
            runMonitor({ horizon: '30d' }),
          ]);
          
          return reply.code(200).send({
            ok: true,
            data: { '7d': result7d, '30d': result30d },
          });
        }
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error running monitor');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/monitor/thresholds
   * Get monitor thresholds
   */
  fastify.get('/monitor/thresholds', async (request, reply) => {
    const { getMonitorThresholds } = await import('./shadow_monitor.service.js');
    return reply.code(200).send({
      ok: true,
      data: getMonitorThresholds(),
    });
  });
  
  /**
   * GET /api/self-learning-v2/monitor/reports
   * Get monitor reports
   */
  fastify.get<{ Querystring: { horizon?: '7d' | '30d'; decision?: string; limit?: number } }>(
    '/monitor/reports',
    async (request, reply) => {
      try {
        const { horizon, decision, limit = 50 } = request.query;
        
        const { ShadowMonitorReportModel } = await import('./shadow_monitor_report.model.js');
        
        const query: any = {};
        if (horizon) query.horizon = horizon;
        if (decision) query.decision = decision;
        
        const reports = await ShadowMonitorReportModel
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean();
        
        return reply.code(200).send({
          ok: true,
          data: {
            reports,
            count: reports.length,
          },
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error getting monitor reports');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/monitor/worker/status
   * Get monitor worker status
   */
  fastify.get('/monitor/worker/status', async (request, reply) => {
    const { getShadowMonitorWorkerStatus } = await import('../../jobs/shadow_monitor.job.js');
    return reply.code(200).send({
      ok: true,
      data: getShadowMonitorWorkerStatus(),
    });
  });
  
  /**
   * POST /api/self-learning-v2/monitor/worker/start
   * Start monitor worker
   */
  fastify.post('/monitor/worker/start', async (request, reply) => {
    const { startShadowMonitorWorker } = await import('../../jobs/shadow_monitor.job.js');
    const result = startShadowMonitorWorker();
    return reply.code(200).send({
      ok: result.success,
      data: result,
    });
  });
  
  /**
   * POST /api/self-learning-v2/monitor/worker/stop
   * Stop monitor worker
   */
  fastify.post('/monitor/worker/stop', async (request, reply) => {
    const { stopShadowMonitorWorker } = await import('../../jobs/shadow_monitor.job.js');
    const result = stopShadowMonitorWorker();
    return reply.code(200).send({
      ok: result.success,
      data: result,
    });
  });
  
  // ==================== PR#3: CONFIDENCE BLENDER ENDPOINTS ====================
  
  /**
   * POST /api/self-learning-v2/confidence/blend
   * Calculate blended confidence
   */
  fastify.post<{ Body: { baseConfidence: number; pSuccess: number | null; driftLevel: string; horizon: '7d' | '30d' } }>(
    '/confidence/blend',
    async (request, reply) => {
      try {
        const { baseConfidence, pSuccess, driftLevel, horizon } = request.body || {};
        
        if (baseConfidence === undefined || !driftLevel || !horizon) {
          return reply.code(400).send({
            ok: false,
            error: 'Missing required fields',
          });
        }
        
        const { blend } = await import('./confidence_blender.service.js');
        
        const result = blend({
          baseConfidence,
          pSuccess: pSuccess ?? null,
          driftLevel: driftLevel as any,
          horizon,
        });
        
        return reply.code(200).send({
          ok: true,
          data: result,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error blending confidence');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/self-learning-v2/confidence/config
   * Get blending configuration
   */
  fastify.get('/confidence/config', async (request, reply) => {
    const { getBlendingConfig } = await import('./confidence_blender.service.js');
    return reply.code(200).send({
      ok: true,
      data: getBlendingConfig(),
    });
  });
  
  /**
   * GET /api/self-learning-v2/confidence/:horizon
   * Get current ML modifier for horizon
   */
  fastify.get<{ Params: { horizon: string } }>(
    '/confidence/:horizon',
    async (request, reply) => {
      try {
        const horizon = request.params.horizon as '7d' | '30d';
        
        const { getCurrentMlModifier } = await import('./confidence_blender.service.js');
        const result = await getCurrentMlModifier(horizon);
        
        return reply.code(200).send({
          ok: true,
          data: result,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error getting ML modifier');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  // ==================== PR#3: ACTIVE POINTER ENDPOINTS ====================
  
  /**
   * GET /api/self-learning-v2/active
   * Get active model pointers for all horizons
   */
  fastify.get('/active', async (request, reply) => {
    try {
      const { getAllPointers } = await import('./active_model_pointer.model.js');
      const pointers = await getAllPointers();
      
      return reply.code(200).send({
        ok: true,
        data: pointers,
      });
    } catch (err: any) {
      fastify.log.error(err, '[Self-Learning] Error getting active pointers');
      return reply.code(500).send({
        ok: false,
        error: err.message,
      });
    }
  });
  
  /**
   * GET /api/self-learning-v2/active/:horizon
   * Get active model pointer for horizon
   */
  fastify.get<{ Params: { horizon: string } }>(
    '/active/:horizon',
    async (request, reply) => {
      try {
        const horizon = request.params.horizon as '7d' | '30d';
        
        const { getPointer } = await import('./active_model_pointer.model.js');
        const pointer = await getPointer(horizon);
        
        return reply.code(200).send({
          ok: true,
          data: pointer,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Self-Learning] Error getting active pointer');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
};

export default selfLearningRoutesV2;
