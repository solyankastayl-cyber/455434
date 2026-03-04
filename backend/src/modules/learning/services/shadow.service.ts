/**
 * PHASE 5.3 — Shadow Monitoring Service
 * =======================================
 * Evaluates model health and triggers auto-rollback
 */

import { v4 as uuidv4 } from 'uuid';
import { MlModelRegistry, MlModelDoc } from '../storage/ml_model.model.js';
import { MlRun } from '../storage/ml_run.model.js';
import { DecisionOutcomeModel } from '../storage/outcome.model.js';
import { ActiveModelState } from '../runtime/active_model.state.js';
import { rollbackToPrevious, retireCandidate } from '../jobs/promotion.job.js';

// ═══════════════════════════════════════════════════════════════
// HEALTH THRESHOLDS (LOCKED v1)
// ═══════════════════════════════════════════════════════════════

export const SHADOW_CONFIG = {
  // ECE thresholds for health states
  ECE_HEALTHY: 0.20,     // ece ≤ 0.20 = HEALTHY
  ECE_DEGRADED: 0.30,    // 0.20 < ece ≤ 0.30 = DEGRADED
  // ece > 0.30 = CRITICAL

  // Streak thresholds for actions
  CRITICAL_STREAK_THRESHOLD: 3,  // 3 CRITICAL → action
  
  // Window settings
  DEFAULT_WINDOW_SIZE: 50,       // outcomes per window
  MIN_OUTCOMES_FOR_EVAL: 20,     // minimum outcomes to evaluate
};

export type HealthState = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

// ═══════════════════════════════════════════════════════════════
// HEALTH CALCULATION
// ═══════════════════════════════════════════════════════════════

export function calculateHealthState(ece: number): HealthState {
  if (ece <= SHADOW_CONFIG.ECE_HEALTHY) return 'HEALTHY';
  if (ece <= SHADOW_CONFIG.ECE_DEGRADED) return 'DEGRADED';
  return 'CRITICAL';
}

/**
 * Calculate ECE from recent outcomes
 * Uses model's predicted confidence vs actual outcome
 */
export async function calculateECEFromOutcomes(
  modelId: string,
  windowSize: number = SHADOW_CONFIG.DEFAULT_WINDOW_SIZE
): Promise<{ ece: number; samples: number } | null> {
  // Get recent calculated outcomes
  const outcomes = await DecisionOutcomeModel
    .find({ 
      status: 'CALCULATED',
      directionCorrect: { $ne: null },
    })
    .sort({ decisionTimestamp: -1 })
    .limit(windowSize)
    .lean();

  if (outcomes.length < SHADOW_CONFIG.MIN_OUTCOMES_FOR_EVAL) {
    return null;
  }

  // Calculate ECE using calibration bins
  const bins: { count: number; correct: number; confSum: number }[] = 
    Array(10).fill(null).map(() => ({ count: 0, correct: 0, confSum: 0 }));

  for (const outcome of outcomes) {
    const conf = outcome.confidence;
    const correct = outcome.directionCorrect ? 1 : 0;
    
    const binIdx = Math.min(9, Math.floor(conf * 10));
    bins[binIdx].count++;
    bins[binIdx].confSum += conf;
    bins[binIdx].correct += correct;
  }

  // ECE calculation
  let ece = 0;
  for (const bin of bins) {
    if (bin.count > 0) {
      const avgConf = bin.confSum / bin.count;
      const avgCorrect = bin.correct / bin.count;
      ece += (bin.count / outcomes.length) * Math.abs(avgConf - avgCorrect);
    }
  }

  return { ece, samples: outcomes.length };
}

// ═══════════════════════════════════════════════════════════════
// SHADOW EVALUATION
// ═══════════════════════════════════════════════════════════════

export interface ShadowEvalResult {
  runId: string;
  activeId: string | null;
  activeHealth: HealthState | null;
  activeECE: number | null;
  candidateId: string | null;
  candidateHealth: HealthState | null;
  candidateECE: number | null;
  actions: string[];
  samples: number;
}

/**
 * Run shadow evaluation for active and candidate models
 */
export async function runShadowEvaluation(
  windowSize: number = SHADOW_CONFIG.DEFAULT_WINDOW_SIZE
): Promise<ShadowEvalResult> {
  const runId = uuidv4();
  const startedAt = new Date();
  
  await MlRun.create({
    runId,
    type: 'SHADOW_EVAL',
    status: 'RUNNING',
    startedAt,
    meta: { windowSize },
  });

  console.log(`[ShadowEval] Starting evaluation ${runId}`);

  const result: ShadowEvalResult = {
    runId,
    activeId: ActiveModelState.getActive(),
    activeHealth: null,
    activeECE: null,
    candidateId: ActiveModelState.getCandidate(),
    candidateHealth: null,
    candidateECE: null,
    actions: [],
    samples: 0,
  };

  try {
    // Calculate ECE from outcomes
    const eceResult = await calculateECEFromOutcomes(result.activeId || '', windowSize);
    
    if (!eceResult) {
      result.actions.push('SKIPPED: Insufficient outcomes');
      await MlRun.updateOne(
        { runId },
        { $set: { status: 'DONE', finishedAt: new Date(), meta: result } }
      );
      return result;
    }

    result.samples = eceResult.samples;

    // Evaluate ACTIVE model
    if (result.activeId) {
      const activeModel = await MlModelRegistry.findOne({ modelId: result.activeId });
      if (activeModel) {
        result.activeECE = eceResult.ece;
        result.activeHealth = calculateHealthState(eceResult.ece);

        // Update model's shadow state
        await updateModelHealth(activeModel, result.activeHealth);

        // Check for auto-rollback
        if (activeModel.shadow && activeModel.shadow.critStreak >= SHADOW_CONFIG.CRITICAL_STREAK_THRESHOLD) {
          result.actions.push('AUTO_ROLLBACK: Active model critical streak exceeded');
          try {
            await rollbackToPrevious();
            result.actions.push('ROLLBACK_SUCCESS');
          } catch (e: any) {
            result.actions.push(`ROLLBACK_FAILED: ${e.message}`);
          }
        }
      }
    }

    // Evaluate CANDIDATE model (using same ECE for comparison)
    if (result.candidateId) {
      const candidateModel = await MlModelRegistry.findOne({ modelId: result.candidateId });
      if (candidateModel) {
        // For candidate, use its stored metrics ECE
        result.candidateECE = candidateModel.metrics.ece;
        result.candidateHealth = calculateHealthState(candidateModel.metrics.ece);

        // Update candidate's shadow state based on comparison
        const candidateHealth = result.candidateECE > eceResult.ece 
          ? 'DEGRADED' 
          : calculateHealthState(result.candidateECE);
        
        await updateModelHealth(candidateModel, candidateHealth);

        // Check for auto-retire
        if (candidateModel.shadow && candidateModel.shadow.critStreak >= SHADOW_CONFIG.CRITICAL_STREAK_THRESHOLD) {
          result.actions.push('AUTO_RETIRE: Candidate model critical streak exceeded');
          try {
            await retireCandidate(result.candidateId);
            result.actions.push('RETIRE_SUCCESS');
            result.candidateId = null;
          } catch (e: any) {
            result.actions.push(`RETIRE_FAILED: ${e.message}`);
          }
        }
      }
    }

    // Update run status
    await MlRun.updateOne(
      { runId },
      { $set: { status: 'DONE', finishedAt: new Date(), meta: result } }
    );

    console.log(`[ShadowEval] Completed:`, result);
    return result;

  } catch (e: any) {
    console.error(`[ShadowEval] Failed:`, e);
    await MlRun.updateOne(
      { runId },
      { $set: { status: 'FAILED', finishedAt: new Date(), error: e.message } }
    );
    throw e;
  }
}

/**
 * Update model's health state and streaks
 */
async function updateModelHealth(model: MlModelDoc, health: HealthState): Promise<void> {
  const shadow = model.shadow || { critStreak: 0, degStreak: 0 };
  
  let newCritStreak = shadow.critStreak;
  let newDegStreak = shadow.degStreak;

  switch (health) {
    case 'HEALTHY':
      // Reset both streaks
      newCritStreak = 0;
      newDegStreak = 0;
      break;
    case 'DEGRADED':
      // Reset crit streak, increment deg streak
      newCritStreak = 0;
      newDegStreak = shadow.degStreak + 1;
      break;
    case 'CRITICAL':
      // Increment both streaks
      newCritStreak = shadow.critStreak + 1;
      newDegStreak = shadow.degStreak + 1;
      break;
  }

  await MlModelRegistry.updateOne(
    { modelId: model.modelId },
    {
      $set: {
        'shadow.critStreak': newCritStreak,
        'shadow.degStreak': newDegStreak,
        'shadow.lastEvalAt': new Date(),
        'shadow.lastHealth': health,
      },
    }
  );

  console.log(`[Shadow] Model ${model.modelId} health: ${health}, crit: ${newCritStreak}, deg: ${newDegStreak}`);
}

// ═══════════════════════════════════════════════════════════════
// MANUAL EVALUATION (with provided ECE values)
// ═══════════════════════════════════════════════════════════════

export interface ManualEvalParams {
  activeECE?: number;
  candidateECE?: number;
  windowSamples?: number;
}

export async function runManualEvaluation(params: ManualEvalParams): Promise<ShadowEvalResult> {
  const runId = uuidv4();
  
  await MlRun.create({
    runId,
    type: 'SHADOW_EVAL',
    status: 'RUNNING',
    startedAt: new Date(),
    meta: { ...params, manual: true },
  });

  const result: ShadowEvalResult = {
    runId,
    activeId: ActiveModelState.getActive(),
    activeHealth: null,
    activeECE: params.activeECE ?? null,
    candidateId: ActiveModelState.getCandidate(),
    candidateHealth: null,
    candidateECE: params.candidateECE ?? null,
    actions: [],
    samples: params.windowSamples || 0,
  };

  try {
    // Evaluate active
    if (result.activeECE !== null) {
      result.activeHealth = calculateHealthState(result.activeECE);
      
      if (result.activeId) {
        const activeModel = await MlModelRegistry.findOne({ modelId: result.activeId });
        if (activeModel) {
          await updateModelHealth(activeModel, result.activeHealth);
        }
      }
    }

    // Evaluate candidate
    if (result.candidateECE !== null) {
      result.candidateHealth = calculateHealthState(result.candidateECE);
      
      if (result.candidateId) {
        const candidateModel = await MlModelRegistry.findOne({ modelId: result.candidateId });
        if (candidateModel) {
          await updateModelHealth(candidateModel, result.candidateHealth);
        }
      }
    }

    await MlRun.updateOne(
      { runId },
      { $set: { status: 'DONE', finishedAt: new Date(), meta: result } }
    );

    return result;
  } catch (e: any) {
    await MlRun.updateOne(
      { runId },
      { $set: { status: 'FAILED', finishedAt: new Date(), error: e.message } }
    );
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════
// HEALTH SUMMARY
// ═══════════════════════════════════════════════════════════════

export interface ShadowHealthSummary {
  active: {
    modelId: string | null;
    health: HealthState | null;
    critStreak: number;
    degStreak: number;
    lastEvalAt: Date | null;
  };
  candidate: {
    modelId: string | null;
    health: HealthState | null;
    critStreak: number;
    degStreak: number;
    lastEvalAt: Date | null;
  };
  config: typeof SHADOW_CONFIG;
}

export async function getShadowHealthSummary(): Promise<ShadowHealthSummary> {
  const activeId = ActiveModelState.getActive();
  const candidateId = ActiveModelState.getCandidate();

  const summary: ShadowHealthSummary = {
    active: {
      modelId: activeId,
      health: null,
      critStreak: 0,
      degStreak: 0,
      lastEvalAt: null,
    },
    candidate: {
      modelId: candidateId,
      health: null,
      critStreak: 0,
      degStreak: 0,
      lastEvalAt: null,
    },
    config: SHADOW_CONFIG,
  };

  if (activeId) {
    const activeModel = await MlModelRegistry.findOne({ modelId: activeId });
    if (activeModel?.shadow) {
      summary.active.health = activeModel.shadow.lastHealth || null;
      summary.active.critStreak = activeModel.shadow.critStreak || 0;
      summary.active.degStreak = activeModel.shadow.degStreak || 0;
      summary.active.lastEvalAt = activeModel.shadow.lastEvalAt || null;
    }
  }

  if (candidateId) {
    const candidateModel = await MlModelRegistry.findOne({ modelId: candidateId });
    if (candidateModel?.shadow) {
      summary.candidate.health = candidateModel.shadow.lastHealth || null;
      summary.candidate.critStreak = candidateModel.shadow.critStreak || 0;
      summary.candidate.degStreak = candidateModel.shadow.degStreak || 0;
      summary.candidate.lastEvalAt = candidateModel.shadow.lastEvalAt || null;
    }
  }

  return summary;
}

console.log('[Phase 5.3] Shadow Monitoring Service loaded');
