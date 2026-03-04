/**
 * Self-Learning Service - Main Orchestrator (ETAP 5.1-5.4)
 * 
 * Coordinates the entire self-learning loop:
 * 1. Guards check
 * 2. Dataset freeze
 * 3. Model training (PR#2)
 * 4. Evaluation gate (PR#2)
 * 5. Promotion (PR#3)
 */
import { canRetrain, getGuardSummary, type GuardSnapshot } from './retrain_guard.service.js';
import { freezeDataset, type FreezeResult } from './dataset_freezer.service.js';
import { logSelfLearningEvent } from './audit_helpers.js';
import { getSelfLearningConfig, updateSelfLearningConfig } from './self_learning_config.model.js';
import { trainModel, type TrainModelResult } from './model_trainer.service.js';
import { evaluateModel as runEvaluator, type EvaluateModelResult } from './model_evaluator.service.js';
import { runEvaluationGate, type GateResult } from './evaluation_gate_v2.service.js';
import { MLModelVersionModel, updateModelStatus } from './ml_model_version.model.js';
import { EVALUATION_RULES } from './evaluation_rules.js';

export interface RetrainAttemptResult {
  success: boolean;
  horizon: '7d' | '30d';
  
  // Guards
  guardSnapshot: GuardSnapshot;
  guardPassed: boolean;
  
  // Dataset (if guards passed)
  datasetVersion?: string;
  datasetResult?: FreezeResult;
  
  // Training (PR#2)
  modelVersion?: string;
  trainResult?: TrainModelResult;
  trainMetrics?: any;
  
  // Evaluation (PR#2)
  evalResult?: EvaluateModelResult;
  evalReport?: any;
  
  // Gate Decision (PR#2)
  gateResult?: GateResult;
  gateDecision?: 'APPROVED' | 'REJECTED' | 'BLOCKED';
  
  // Errors
  error?: string;
  blockedReasons?: string[];
  
  // Timing
  timestamp: Date;
  duration: number;
}

/**
 * Main entry point: Attempt retrain for a horizon
 * 
 * This is called by scheduler or manual trigger.
 */
export async function attemptRetrain(horizon: '7d' | '30d'): Promise<RetrainAttemptResult> {
  const start = Date.now();
  const timestamp = new Date();
  
  console.log(`[Self-Learning] ========== RETRAIN ATTEMPT: ${horizon} ==========`);
  
  try {
    // ========== STEP 1: GUARDS CHECK ==========
    console.log(`[Self-Learning] Step 1: Checking guards...`);
    
    const guardSnapshot = await canRetrain(horizon);
    
    if (!guardSnapshot.overallPass) {
      console.log(`[Self-Learning] ❌ Guards blocked retrain:`);
      console.log(getGuardSummary(guardSnapshot));
      
      return {
        success: false,
        horizon,
        guardSnapshot,
        guardPassed: false,
        blockedReasons: guardSnapshot.blockReasons,
        timestamp,
        duration: Date.now() - start,
      };
    }
    
    console.log(`[Self-Learning] ✅ All guards passed`);
    
    // ========== STEP 2: DATASET FREEZE ==========
    console.log(`[Self-Learning] Step 2: Freezing dataset...`);
    
    const freezeResult = await freezeDataset({ horizon });
    
    console.log(`[Self-Learning] ✅ Dataset frozen: ${freezeResult.datasetVersionId}`);
    console.log(`[Self-Learning]    Samples: ${freezeResult.sampleCount}`);
    console.log(`[Self-Learning]    LIVE share: ${(freezeResult.sourceMix.liveShare * 100).toFixed(1)}%`);
    console.log(`[Self-Learning]    Avg quality: ${freezeResult.quality.avgQualityScore.toFixed(2)}`);
    
    // ========== STEP 3: MODEL TRAINING (PR#2) ==========
    console.log(`[Self-Learning] Step 3: Model training...`);
    
    const trainResult = await trainModel({
      datasetVersionId: freezeResult.datasetVersionId,
      horizon,
      algorithm: 'lightgbm',
      triggeredBy: 'scheduler',
    });
    
    if (!trainResult.success) {
      console.log(`[Self-Learning] ❌ Training failed: ${trainResult.error}`);
      
      await logSelfLearningEvent({
        eventType: 'TRAIN_FAILED',
        horizon,
        datasetVersionId: freezeResult.datasetVersionId,
        details: { error: trainResult.error },
        triggeredBy: 'scheduler',
        severity: 'error',
      });
      
      return {
        success: false,
        horizon,
        guardSnapshot,
        guardPassed: true,
        datasetVersion: freezeResult.datasetVersionId,
        datasetResult: freezeResult,
        trainResult,
        error: trainResult.error,
        timestamp,
        duration: Date.now() - start,
      };
    }
    
    console.log(`[Self-Learning] ✅ Model trained: ${trainResult.modelId}`);
    console.log(`[Self-Learning]    Precision: ${trainResult.trainMetrics?.precision?.toFixed(3) || 'N/A'}`);
    
    // ========== STEP 4: MODEL EVALUATION (PR#2) ==========
    console.log(`[Self-Learning] Step 4: Model evaluation...`);
    
    const evalResult = await runEvaluator({
      modelId: trainResult.modelId!,
      evaluatedBy: 'scheduler',
    });
    
    if (!evalResult.success) {
      console.log(`[Self-Learning] ❌ Evaluation failed: ${evalResult.error}`);
      
      await logSelfLearningEvent({
        eventType: 'EVAL_FAILED',
        horizon,
        modelVersionId: trainResult.modelId,
        details: { error: evalResult.error },
        triggeredBy: 'scheduler',
        severity: 'error',
      });
      
      return {
        success: false,
        horizon,
        guardSnapshot,
        guardPassed: true,
        datasetVersion: freezeResult.datasetVersionId,
        datasetResult: freezeResult,
        modelVersion: trainResult.modelId,
        trainResult,
        trainMetrics: trainResult.trainMetrics,
        evalResult,
        error: evalResult.error,
        timestamp,
        duration: Date.now() - start,
      };
    }
    
    console.log(`[Self-Learning] ✅ Model evaluated: ${evalResult.evaluationId}`);
    
    // ========== STEP 5: EVALUATION GATE (PR#2) ==========
    console.log(`[Self-Learning] Step 5: Evaluation gate...`);
    
    const gateResult = await runEvaluationGate({
      evaluationId: evalResult.evaluationId!,
      modelId: trainResult.modelId!,
      horizon,
    });
    
    console.log(`[Self-Learning] Gate decision: ${gateResult.decision}`);
    console.log(`[Self-Learning] Reasons: ${gateResult.reasons.join(', ')}`);
    
    // Update model status based on gate decision
    if (gateResult.decision === 'APPROVED') {
      await updateModelStatus(trainResult.modelId!, 'APPROVED', 'Passed evaluation gate');
      
      await logSelfLearningEvent({
        eventType: 'EVAL_PASSED',
        horizon,
        modelVersionId: trainResult.modelId,
        evalReportId: evalResult.evaluationId,
        details: {
          decision: gateResult.decision,
          reasons: gateResult.reasons,
        },
        triggeredBy: 'scheduler',
        severity: 'info',
      });
    } else if (gateResult.decision === 'REJECTED') {
      await updateModelStatus(trainResult.modelId!, 'REJECTED', gateResult.reasons.join('; '));
      
      await logSelfLearningEvent({
        eventType: 'EVAL_FAILED',
        horizon,
        modelVersionId: trainResult.modelId,
        evalReportId: evalResult.evaluationId,
        details: {
          decision: gateResult.decision,
          reasons: gateResult.reasons,
        },
        triggeredBy: 'scheduler',
        severity: 'warning',
      });
    } else {
      // BLOCKED
      await logSelfLearningEvent({
        eventType: 'EVAL_INCONCLUSIVE',
        horizon,
        modelVersionId: trainResult.modelId,
        evalReportId: evalResult.evaluationId,
        details: {
          decision: gateResult.decision,
          reasons: gateResult.reasons,
        },
        triggeredBy: 'scheduler',
        severity: 'warning',
      });
    }
    
    // ========== STEP 6: PROMOTION (PR#3 - TODO) ==========
    console.log(`[Self-Learning] Step 6: Promotion (not implemented yet - PR#3)`);
    
    // TODO PR#3: Promote if gate passed AND autoPromoteOnPass is enabled
    // For now, approved models stay as APPROVED and require manual promotion
    
    // ========== UPDATE CONFIG: LAST ATTEMPT ==========
    const updateData: any = {
      lastRetrainAttemptAt: timestamp,
    };
    
    if (gateResult.decision === 'APPROVED') {
      updateData.lastSuccessfulRetrainAt = timestamp;
    }
    
    await updateSelfLearningConfig(updateData, 'system');
    
    const duration = Date.now() - start;
    
    console.log(`[Self-Learning] ========== RETRAIN ATTEMPT COMPLETE (${duration}ms) ==========`);
    console.log(`[Self-Learning] Result: ${gateResult.decision}`);
    
    return {
      success: gateResult.decision === 'APPROVED',
      horizon,
      guardSnapshot,
      guardPassed: true,
      datasetVersion: freezeResult.datasetVersionId,
      datasetResult: freezeResult,
      modelVersion: trainResult.modelId,
      trainResult,
      trainMetrics: trainResult.trainMetrics,
      evalResult,
      evalReport: evalResult.report,
      gateResult,
      gateDecision: gateResult.decision,
      timestamp,
      duration,
    };
    
  } catch (error: any) {
    console.error(`[Self-Learning] ❌ Retrain attempt failed:`, error);
    
    const duration = Date.now() - start;
    
    await logSelfLearningEvent({
      eventType: 'TRAIN_FAILED',
      horizon,
      details: {
        error: error.message,
        stack: error.stack,
      },
      triggeredBy: 'system',
      severity: 'error',
    });
    
    return {
      success: false,
      horizon,
      guardSnapshot: {} as GuardSnapshot,
      guardPassed: false,
      error: error.message,
      timestamp,
      duration,
    };
  }
}

/**
 * Get self-learning status
 */
export async function getSelfLearningStatus() {
  const config = await getSelfLearningConfig();
  
  // Check guard status for both horizons
  const guard7d = await canRetrain('7d');
  const guard30d = await canRetrain('30d');
  
  // Calculate next eligible time
  const nextEligibleAt = config.lastSuccessfulRetrainAt
    ? new Date(
        config.lastSuccessfulRetrainAt.getTime() +
        config.retrainCooldownHours * 60 * 60 * 1000
      )
    : new Date(); // Immediately eligible if never run
  
  const isEligibleNow = new Date() >= nextEligibleAt;
  
  return {
    enabled: config.selfLearningEnabled,
    config: {
      retrainCooldownHours: config.retrainCooldownHours,
      minTrainSamples: config.minTrainSamples,
      maxDriftLevelAllowed: config.maxDriftLevelAllowed,
      minLiveShare: config.minLiveShare,
      autoPromoteOnPass: config.autoPromoteOnPass,
    },
    lastRun: {
      attemptAt: config.lastRetrainAttemptAt,
      successAt: config.lastSuccessfulRetrainAt,
    },
    schedule: {
      cron: config.retrainScheduleCron,
      nextEligibleAt,
      isEligibleNow,
    },
    guards: {
      '7d': {
        passed: guard7d.overallPass,
        blockReasons: guard7d.blockReasons,
      },
      '30d': {
        passed: guard30d.overallPass,
        blockReasons: guard30d.blockReasons,
      },
    },
  };
}

/**
 * Manual retrain trigger (admin/internal)
 */
export async function triggerManualRetrain(
  horizon: '7d' | '30d',
  operator: string = 'manual'
): Promise<RetrainAttemptResult> {
  console.log(`[Self-Learning] Manual retrain triggered by ${operator} for ${horizon}`);
  
  await logSelfLearningEvent({
    eventType: 'MANUAL_INTERVENTION',
    horizon,
    details: {
      action: 'trigger_retrain',
      operator,
    },
    triggeredBy: 'manual',
    operator,
    severity: 'info',
  });
  
  return attemptRetrain(horizon);
}
