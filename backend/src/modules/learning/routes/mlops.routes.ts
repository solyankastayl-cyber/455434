/**
 * PHASE 5.2 & 5.3 — MLOps Routes
 * ===============================
 * Admin API for model management and shadow monitoring
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MlModelRegistry } from '../storage/ml_model.model.js';
import { MlRun } from '../storage/ml_run.model.js';
import { ActiveModelState } from '../runtime/active_model.state.js';
import { runRetrainJob, RetrainParams } from '../jobs/retrain.job.js';
import { promoteCandidate, rollbackToPrevious, retireCandidate } from '../jobs/promotion.job.js';
import { 
  runShadowEvaluation, 
  runManualEvaluation, 
  getShadowHealthSummary,
  ManualEvalParams,
  SHADOW_CONFIG,
} from '../services/shadow.service.js';

export async function mlopsRoutes(app: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // MODEL REGISTRY
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/v10/mlops/models
   * List all models with current state
   */
  app.get('/api/v10/mlops/models', async (
    request: FastifyRequest<{ Querystring: { stage?: string; limit?: string } }>,
    reply: FastifyReply
  ) => {
    const { stage, limit = '50' } = request.query;
    
    const query: any = {};
    if (stage) query.stage = stage;

    const models = await MlModelRegistry
      .find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    // Sanitize _id
    const sanitized = models.map(m => {
      const { _id, ...rest } = m as any;
      return rest;
    });

    return reply.send({
      ok: true,
      models: sanitized,
      state: ActiveModelState.getState(),
    });
  });

  /**
   * GET /api/v10/mlops/models/:modelId
   * Get specific model details
   */
  app.get('/api/v10/mlops/models/:modelId', async (
    request: FastifyRequest<{ Params: { modelId: string } }>,
    reply: FastifyReply
  ) => {
    const { modelId } = request.params;
    
    const model = await MlModelRegistry.findOne({ modelId }).lean();
    
    if (!model) {
      return reply.status(404).send({
        ok: false,
        error: 'MODEL_NOT_FOUND',
      });
    }

    const { _id, ...rest } = model as any;

    return reply.send({
      ok: true,
      model: rest,
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // RUNS HISTORY
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/v10/mlops/runs
   * List ML operation runs
   */
  app.get('/api/v10/mlops/runs', async (
    request: FastifyRequest<{ Querystring: { type?: string; status?: string; limit?: string } }>,
    reply: FastifyReply
  ) => {
    const { type, status, limit = '50' } = request.query;
    
    const query: any = {};
    if (type) query.type = type;
    if (status) query.status = status;

    const runs = await MlRun
      .find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    const sanitized = runs.map(r => {
      const { _id, ...rest } = r as any;
      return rest;
    });

    return reply.send({
      ok: true,
      runs: sanitized,
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // RETRAIN
  // ═══════════════════════════════════════════════════════════════

  /**
   * POST /api/v10/mlops/retrain
   * Trigger model retraining (creates CANDIDATE)
   */
  app.post('/api/v10/mlops/retrain', async (
    request: FastifyRequest<{ Body: RetrainParams }>,
    reply: FastifyReply
  ) => {
    try {
      const params = request.body || {};
      const result = await runRetrainJob(params);
      
      return reply.send({
        ok: true,
        ...result,
      });
    } catch (error) {
      console.error('[MLOps] Retrain failed:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      return reply.status(500).send({
        ok: false,
        error: 'RETRAIN_FAILED',
        message,
        stack: process.env.NODE_ENV !== 'production' ? stack : undefined,
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // PROMOTION / ROLLBACK
  // ═══════════════════════════════════════════════════════════════

  /**
   * POST /api/v10/mlops/promote
   * Promote CANDIDATE to ACTIVE
   */
  app.post('/api/v10/mlops/promote', async (
    request: FastifyRequest<{ Body: { modelId: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { modelId } = request.body || {};
      
      if (!modelId) {
        return reply.status(400).send({
          ok: false,
          error: 'MISSING_MODEL_ID',
        });
      }

      const result = await promoteCandidate(modelId);
      
      return reply.send({
        ok: true,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'PROMOTION_FAILED',
        message,
      });
    }
  });

  /**
   * POST /api/v10/mlops/rollback
   * Rollback to previous ACTIVE model
   */
  app.post('/api/v10/mlops/rollback', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const result = await rollbackToPrevious();
      
      return reply.send({
        ok: true,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'ROLLBACK_FAILED',
        message,
      });
    }
  });

  /**
   * POST /api/v10/mlops/retire
   * Retire CANDIDATE model
   */
  app.post('/api/v10/mlops/retire', async (
    request: FastifyRequest<{ Body: { modelId: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { modelId } = request.body || {};
      
      if (!modelId) {
        return reply.status(400).send({
          ok: false,
          error: 'MISSING_MODEL_ID',
        });
      }

      const result = await retireCandidate(modelId);
      
      return reply.send({
        ok: true,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'RETIRE_FAILED',
        message,
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // SHADOW MONITORING (Phase 5.3)
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/v10/mlops/shadow/health
   * Get current shadow health summary
   */
  app.get('/api/v10/mlops/shadow/health', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const summary = await getShadowHealthSummary();
      
      return reply.send({
        ok: true,
        ...summary,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'HEALTH_CHECK_FAILED',
        message,
      });
    }
  });

  /**
   * POST /api/v10/mlops/shadow/evaluate
   * Run shadow evaluation
   */
  app.post('/api/v10/mlops/shadow/evaluate', async (
    request: FastifyRequest<{ Body: ManualEvalParams }>,
    reply: FastifyReply
  ) => {
    try {
      const params = request.body || {};
      
      let result;
      if (params.activeECE !== undefined || params.candidateECE !== undefined) {
        // Manual evaluation with provided ECE values
        result = await runManualEvaluation(params);
      } else {
        // Automatic evaluation from outcomes
        result = await runShadowEvaluation(params.windowSamples);
      }
      
      return reply.send({
        ok: true,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'SHADOW_EVAL_FAILED',
        message,
      });
    }
  });

  /**
   * GET /api/v10/mlops/shadow/config
   * Get shadow monitoring configuration
   */
  app.get('/api/v10/mlops/shadow/config', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      ok: true,
      config: SHADOW_CONFIG,
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/v10/mlops/state
   * Get current MLOps state
   */
  app.get('/api/v10/mlops/state', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      ok: true,
      state: ActiveModelState.getState(),
    });
  });

  /**
   * POST /api/v10/mlops/state/initialize
   * Initialize state from database
   */
  app.post('/api/v10/mlops/state/initialize', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      await ActiveModelState.initialize();
      
      return reply.send({
        ok: true,
        state: ActiveModelState.getState(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'INIT_FAILED',
        message,
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // P1.C — ADMIN SYSTEM VISIBILITY
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/v10/admin/system-status
   * P1.C: Admin visibility for pre-merge monitoring
   * Returns: regime, model, invariant violations, system health
   */
  app.get('/api/v10/admin/system-status', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const { getMacroIntelContext } = await import('../../macro-intel/services/macro-intel.snapshot.service.js');
      const { getInvariantCount } = await import('../../meta-brain/invariants/invariant.registry.js');
      
      // Get current macro context
      let macroContext;
      try {
        macroContext = await getMacroIntelContext();
      } catch {
        macroContext = { regime: 'UNKNOWN', riskLevel: 'UNKNOWN' };
      }
      
      // Get MLOps state
      const mlOpsState = ActiveModelState.getState();
      
      // Get invariants info
      const invariantInfo = getInvariantCount();
      
      // Calculate uptime
      const uptimeMs = process.uptime() * 1000;
      const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
      const uptimeMins = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
      
      return reply.send({
        ok: true,
        timestamp: new Date().toISOString(),
        
        // Regime status
        regime: {
          current: macroContext.regime,
          riskLevel: macroContext.riskLevel,
        },
        
        // ML model status
        model: {
          activeModelId: mlOpsState.activeModelId,
          stage: mlOpsState.stage,
          mode: mlOpsState.mode,
          lastEvaluation: mlOpsState.lastEvaluation,
        },
        
        // Invariants status
        invariants: {
          version: 'v1.1',
          total: invariantInfo.total,
          hard: invariantInfo.hard,
          soft: invariantInfo.soft,
          violationsCounter: 0, // TODO: Track runtime violations
          lastCheck: new Date().toISOString(),
        },
        
        // System health
        health: {
          status: 'OK',
          uptime: `${uptimeHours}h ${uptimeMins}m`,
          memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        },
        
        // Lockdown status
        lockdown: {
          state: 'LOCKED_PRE_MERGE',
          version: '1.0.0',
          sealedAt: '2026-02-09T21:00:00.000Z',
          canMerge: true,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'STATUS_FETCH_FAILED',
        message,
      });
    }
  });

  /**
   * GET /api/v10/admin/lockdown-state
   * Returns the full lockdown state JSON
   */
  app.get('/api/v10/admin/lockdown-state', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const lockdownPath = path.join(process.cwd(), '..', 'docs', 'LOCKDOWN_STATE_v1.json');
      const content = await fs.readFile(lockdownPath, 'utf-8');
      const lockdownState = JSON.parse(content);
      
      return reply.send({
        ok: true,
        ...lockdownState,
      });
    } catch (error) {
      // Return inline if file not found
      return reply.send({
        ok: true,
        version: '1.0.0',
        status: 'LOCKED_PRE_MERGE',
        note: 'Lockdown file not found, returning defaults',
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // P1.3 — ADMIN KILL-SWITCHES
  // ═══════════════════════════════════════════════════════════════

  // In-memory kill switch state (would be in DB for production)
  const killSwitches = {
    mlInfluence: true,        // ML can affect decisions
    macroInfluence: true,     // Macro can affect decisions
    intelligenceLayer: false, // Reserved for P2
    strongActions: true,      // STRONG actions allowed
    autoLearning: true,       // Auto-learning active
  };
  
  const killSwitchLog: Array<{
    switch: string;
    from: boolean;
    to: boolean;
    by: string;
    reason: string;
    timestamp: string;
  }> = [];

  /**
   * GET /api/v10/admin/kill-switches
   * P1.3: View current kill switch states
   */
  app.get('/api/v10/admin/kill-switches', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      ok: true,
      switches: killSwitches,
      lastChanges: killSwitchLog.slice(-10),
      warning: 'Kill switches affect system behavior. Use with caution.',
    });
  });

  /**
   * POST /api/v10/admin/kill-switches/toggle
   * P1.3: Toggle a kill switch
   * Body: { switch: string, enabled: boolean, reason: string }
   */
  app.post('/api/v10/admin/kill-switches/toggle', async (
    request: FastifyRequest<{
      Body: { switch: string; enabled: boolean; reason: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { switch: switchName, enabled, reason } = request.body;
      
      // Validate switch exists
      if (!(switchName in killSwitches)) {
        return reply.status(400).send({
          ok: false,
          error: 'INVALID_SWITCH',
          message: `Unknown switch: ${switchName}`,
          validSwitches: Object.keys(killSwitches),
        });
      }
      
      // Validate reason provided
      if (!reason || reason.length < 5) {
        return reply.status(400).send({
          ok: false,
          error: 'REASON_REQUIRED',
          message: 'Reason must be at least 5 characters',
        });
      }
      
      // Get old value
      const oldValue = killSwitches[switchName as keyof typeof killSwitches];
      
      // Update
      (killSwitches as any)[switchName] = enabled;
      
      // Log change
      const logEntry = {
        switch: switchName,
        from: oldValue,
        to: enabled,
        by: 'admin', // Would be auth user in production
        reason,
        timestamp: new Date().toISOString(),
      };
      killSwitchLog.push(logEntry);
      
      console.log(`[KILL_SWITCH] ${switchName}: ${oldValue} → ${enabled} | Reason: ${reason}`);
      
      return reply.send({
        ok: true,
        message: `Kill switch '${switchName}' set to ${enabled}`,
        previous: oldValue,
        current: enabled,
        logEntry,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'TOGGLE_FAILED',
        message,
      });
    }
  });

  /**
   * GET /api/v10/admin/kill-switches/log
   * P1.3: View kill switch change history
   */
  app.get('/api/v10/admin/kill-switches/log', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      ok: true,
      count: killSwitchLog.length,
      log: killSwitchLog,
    });
  });

  /**
   * POST /api/v10/admin/emergency-stop
   * P1.3: Emergency stop - disable all influences
   */
  app.post('/api/v10/admin/emergency-stop', async (
    request: FastifyRequest<{
      Body: { reason: string; confirm: boolean };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { reason, confirm } = request.body;
      
      if (!confirm) {
        return reply.status(400).send({
          ok: false,
          error: 'CONFIRMATION_REQUIRED',
          message: 'Set confirm=true to execute emergency stop',
        });
      }
      
      if (!reason || reason.length < 10) {
        return reply.status(400).send({
          ok: false,
          error: 'REASON_REQUIRED',
          message: 'Emergency stop reason must be at least 10 characters',
        });
      }
      
      // Disable all influences
      const timestamp = new Date().toISOString();
      const changes: string[] = [];
      
      for (const [key, value] of Object.entries(killSwitches)) {
        if (value === true) {
          (killSwitches as any)[key] = false;
          changes.push(key);
          killSwitchLog.push({
            switch: key,
            from: true,
            to: false,
            by: 'EMERGENCY_STOP',
            reason,
            timestamp,
          });
        }
      }
      
      console.error(`[EMERGENCY_STOP] All influences disabled! Reason: ${reason}`);
      console.error(`[EMERGENCY_STOP] Disabled switches: ${changes.join(', ')}`);
      
      return reply.send({
        ok: true,
        message: 'EMERGENCY STOP EXECUTED',
        disabledSwitches: changes,
        reason,
        timestamp,
        warning: 'System is now in SAFE mode. All influences disabled.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'EMERGENCY_STOP_FAILED',
        message,
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // P0.1 — STEP 3 VALIDATION WINDOW (ACCELERATED)
  // ═══════════════════════════════════════════════════════════════

  // In-memory Step3 state (production would use MongoDB)
  let step3State = {
    mode: 'UNLOCKED' as 'LOCKED' | 'UNLOCKED',
    activeModelId: 'model_v1_active',
    candidateModelId: null as string | null,
    validationState: 'IDLE' as string,
    validationStartedAt: null as string | null,
    validationWindowEndsAt: null as string | null,
    windowDurationMinutes: null as number | null,
    cooldownEndsAt: null as string | null,
  };

  /**
   * GET /api/v10/mlops/step3/config
   * P0.1: Get Step3 configuration
   */
  app.get('/api/v10/mlops/step3/config', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const { step3ConfigService } = await import('../../mlops/step3/services/step3.config.service.js');
      const config = step3ConfigService.getConfig();
      const env = step3ConfigService.getEnvironment();
      
      return reply.send({
        ok: true,
        environment: env,
        config,
        note: env === 'production' 
          ? 'Production: minimum 24h window enforced'
          : 'Non-production: accelerated window allowed',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'CONFIG_ERROR',
        message,
      });
    }
  });

  /**
   * GET /api/v10/mlops/step3/status
   * P0.1: Get Step3 validation status
   */
  app.get('/api/v10/mlops/step3/status', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const { step3ConfigService } = await import('../../mlops/step3/services/step3.config.service.js');
      const { step3WindowService } = await import('../../mlops/step3/services/step3.window.service.js');
      const config = step3ConfigService.getConfig();
      
      let remainingSeconds = null;
      let remainingFormatted = null;
      
      if (step3State.validationWindowEndsAt) {
        remainingSeconds = step3WindowService.getRemainingSeconds(step3State.validationWindowEndsAt);
        remainingFormatted = step3WindowService.formatRemaining(step3State.validationWindowEndsAt);
      }
      
      return reply.send({
        ok: true,
        status: {
          mode: step3State.mode,
          activeModelId: step3State.activeModelId,
          candidateModelId: step3State.candidateModelId,
          validationState: step3State.validationState,
          validationStartedAt: step3State.validationStartedAt,
          validationWindowEndsAt: step3State.validationWindowEndsAt,
          windowDurationMinutes: step3State.windowDurationMinutes,
          remainingSeconds,
          remainingFormatted,
          cooldownEndsAt: step3State.cooldownEndsAt,
          locked: step3State.mode === 'LOCKED',
        },
        config: {
          validationWindowMinutes: config.validationWindowMinutes,
          cooldownDays: config.cooldownDays,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'STATUS_ERROR',
        message,
      });
    }
  });

  /**
   * POST /api/v10/mlops/step3/start-validation
   * P0.1: Start validation window (simulate promotion)
   */
  app.post('/api/v10/mlops/step3/start-validation', async (
    request: FastifyRequest<{
      Body: { candidateId: string; reason: string; validationWindowMinutes?: number };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { candidateId, reason, validationWindowMinutes } = request.body;
      
      if (!candidateId || !reason) {
        return reply.status(400).send({
          ok: false,
          error: 'INVALID_INPUT',
          message: 'candidateId and reason are required',
        });
      }
      
      const { step3ConfigService } = await import('../../mlops/step3/services/step3.config.service.js');
      const { step3WindowService } = await import('../../mlops/step3/services/step3.window.service.js');
      const config = step3ConfigService.getConfig();
      
      // Calculate window end
      const endsAt = step3WindowService.computeValidationEndsAt(validationWindowMinutes);
      const actualMinutes = validationWindowMinutes 
        ? step3ConfigService.clampWindowMinutes(validationWindowMinutes)
        : config.validationWindowMinutes;
      
      // Update state
      step3State = {
        ...step3State,
        candidateModelId: candidateId,
        validationState: 'RUNNING',
        validationStartedAt: new Date().toISOString(),
        validationWindowEndsAt: endsAt.toISOString(),
        windowDurationMinutes: actualMinutes,
        mode: 'LOCKED',
      };
      
      console.log(`[Step3] Validation started: ${candidateId}, window: ${actualMinutes}min`);
      
      return reply.send({
        ok: true,
        message: 'Validation window started',
        candidateId,
        windowMinutes: actualMinutes,
        endsAt: endsAt.toISOString(),
        remaining: step3WindowService.formatRemaining(endsAt.toISOString()),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'START_VALIDATION_FAILED',
        message,
      });
    }
  });

  /**
   * POST /api/v10/mlops/step3/confirm
   * P0.1: Confirm promotion (only after window closes)
   */
  app.post('/api/v10/mlops/step3/confirm', async (
    request: FastifyRequest<{
      Body: { force?: boolean; reason?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { force, reason } = request.body || {};
      
      if (!step3State.validationWindowEndsAt) {
        return reply.status(400).send({
          ok: false,
          error: 'NO_VALIDATION_WINDOW',
          message: 'No validation window active',
        });
      }
      
      const { step3ConfigService } = await import('../../mlops/step3/services/step3.config.service.js');
      const { step3WindowService } = await import('../../mlops/step3/services/step3.window.service.js');
      const config = step3ConfigService.getConfig();
      
      const isWindowClosed = step3WindowService.isWindowClosed(step3State.validationWindowEndsAt);
      
      if (!isWindowClosed) {
        // Check if early confirm is allowed
        if (!force || !config.allowEarlyConfirm) {
          const remaining = step3WindowService.formatRemaining(step3State.validationWindowEndsAt);
          return reply.status(409).send({
            ok: false,
            error: 'WINDOW_OPEN',
            message: `Validation window still open. ${remaining}`,
            remainingSeconds: step3WindowService.getRemainingSeconds(step3State.validationWindowEndsAt),
            hint: config.allowEarlyConfirm 
              ? 'Use force=true with reason to confirm early'
              : 'Early confirm not allowed in this environment',
          });
        }
        
        // Early confirm (non-prod only)
        if (!reason || reason.length < 10) {
          return reply.status(400).send({
            ok: false,
            error: 'REASON_REQUIRED',
            message: 'Early confirm requires reason (min 10 chars)',
          });
        }
        
        console.warn(`[Step3] EARLY_CONFIRM: ${reason}`);
      }
      
      // Confirm promotion
      const cooldownEndsAt = step3WindowService.computeCooldownEndsAt();
      
      step3State = {
        ...step3State,
        validationState: 'CONFIRMED',
        mode: 'LOCKED',
        activeModelId: step3State.candidateModelId || step3State.activeModelId,
        candidateModelId: null,
        cooldownEndsAt: cooldownEndsAt.toISOString(),
      };
      
      console.log(`[Step3] Promotion CONFIRMED, cooldown until: ${cooldownEndsAt.toISOString()}`);
      
      return reply.send({
        ok: true,
        message: 'Promotion confirmed',
        activeModelId: step3State.activeModelId,
        cooldownEndsAt: cooldownEndsAt.toISOString(),
        earlyConfirm: !isWindowClosed,
        audit: {
          type: isWindowClosed ? 'PROMOTION_CONFIRMED' : 'EARLY_CONFIRM',
          timestamp: new Date().toISOString(),
          reason: reason || 'Window closed normally',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'CONFIRM_FAILED',
        message,
      });
    }
  });

  /**
   * POST /api/v10/mlops/step3/fast-forward
   * P0.1: Fast-forward validation window (non-prod only)
   */
  app.post('/api/v10/mlops/step3/fast-forward', async (
    request: FastifyRequest<{
      Body: { minutes?: number };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { step3ConfigService } = await import('../../mlops/step3/services/step3.config.service.js');
      const config = step3ConfigService.getConfig();
      
      if (!config.allowFastForward) {
        return reply.status(403).send({
          ok: false,
          error: 'NOT_ALLOWED',
          message: 'Fast-forward not allowed in production',
        });
      }
      
      if (!step3State.validationWindowEndsAt) {
        return reply.status(400).send({
          ok: false,
          error: 'NO_VALIDATION_WINDOW',
          message: 'No validation window to fast-forward',
        });
      }
      
      // Set window end to now
      step3State.validationWindowEndsAt = new Date().toISOString();
      step3State.validationState = 'PASSED';
      
      console.warn(`[Step3] FAST_FORWARD: Window closed artificially`);
      
      return reply.send({
        ok: true,
        message: 'Validation window fast-forwarded',
        validationState: step3State.validationState,
        note: 'You can now call /confirm',
        audit: {
          type: 'FAST_FORWARD',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'FAST_FORWARD_FAILED',
        message,
      });
    }
  });

  /**
   * POST /api/v10/mlops/step3/rollback
   * P0.1: Rollback to previous model
   */
  app.post('/api/v10/mlops/step3/rollback', async (
    request: FastifyRequest<{
      Body: { reason: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { reason } = request.body || {};
      
      if (!reason || reason.length < 10) {
        return reply.status(400).send({
          ok: false,
          error: 'REASON_REQUIRED',
          message: 'Rollback requires reason (min 10 chars)',
        });
      }
      
      // Reset state
      step3State = {
        ...step3State,
        candidateModelId: null,
        validationState: 'ROLLED_BACK',
        validationStartedAt: null,
        validationWindowEndsAt: null,
        windowDurationMinutes: null,
        mode: 'UNLOCKED',
      };
      
      console.warn(`[Step3] ROLLBACK: ${reason}`);
      
      return reply.send({
        ok: true,
        message: 'Rolled back to previous model',
        activeModelId: step3State.activeModelId,
        audit: {
          type: 'ROLLBACK_TRIGGERED',
          timestamp: new Date().toISOString(),
          reason,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        ok: false,
        error: 'ROLLBACK_FAILED',
        message,
      });
    }
  });

  app.log.info('[Phase 5.2/5.3] MLOps routes registered');
  app.log.info('[P1.C] Admin system-status endpoint registered');
  app.log.info('[P1.3] Admin kill-switches endpoints registered');
  app.log.info('[P0.1] Step3 validation window endpoints registered');
}

console.log('[Phase 5.2/5.3] MLOps Routes loaded');
