/**
 * L3.1 - Constitution Binding Hook
 * L3.2 - Drift Auto-Revoke Hook
 * L3.3 - Drift Recovery Logic
 * L3.5 - Auto-Promotion Logic
 */

import { Db } from 'mongodb';
import { ModelId, DriftSeverity, LifecycleStatus, ModelLifecycleState } from './lifecycle.types.js';

// ═══════════════════════════════════════════════════════════════
// L3.1 — CONSTITUTION BINDING HOOK
// ═══════════════════════════════════════════════════════════════

export interface ConstitutionApplyResult {
  applied: boolean;
  skipped: boolean;
  newStatus?: LifecycleStatus;
  reason?: string;
}

/**
 * When constitution is applied:
 * - If hash changed AND status was APPLIED → reset to WARMUP (PROD) or SIMULATION (DEV)
 * - Records event CONSTITUTION_APPLIED
 */
export async function applyConstitutionHook(
  db: Db,
  modelId: ModelId,
  newHash: string,
  currentState: ModelLifecycleState
): Promise<ConstitutionApplyResult> {
  const stateCollection = db.collection('model_lifecycle_state');
  const eventsCollection = db.collection('model_lifecycle_events');
  const now = new Date().toISOString();

  // If hash is the same — skip
  if (currentState.constitutionHash === newHash) {
    return { applied: false, skipped: true, reason: 'Hash unchanged' };
  }

  const oldHash = currentState.constitutionHash;
  const wasApplied = currentState.status === 'APPLIED' || currentState.status === 'APPLIED_MANUAL';
  
  // Determine next status
  let nextStatus: LifecycleStatus;
  let warmup = currentState.warmup;
  
  if (wasApplied) {
    // Constitution changed while APPLIED → must re-validate
    if (currentState.systemMode === 'DEV') {
      nextStatus = 'SIMULATION';
    } else {
      nextStatus = 'WARMUP';
      warmup = {
        startedAt: now,
        targetDays: 30,
        resolvedDays: 0,
        progressPct: 0,
      };
    }
  } else {
    // Keep current status if not APPLIED
    nextStatus = currentState.status;
  }

  // Update state
  await stateCollection.updateOne(
    { modelId },
    {
      $set: {
        constitutionHash: newHash,
        governanceAppliedAt: now,
        status: nextStatus,
        warmup,
        updatedAt: now,
      },
    }
  );

  // Record event
  await eventsCollection.insertOne({
    modelId,
    engineVersion: 'v2.1',
    ts: now,
    type: 'CONSTITUTION_APPLIED',
    actor: 'ADMIN',
    meta: {
      oldHash,
      newHash,
      previousStatus: currentState.status,
      newStatus: nextStatus,
      statusChanged: wasApplied,
    },
  });

  console.log(`[Lifecycle] Constitution applied for ${modelId}: ${oldHash?.slice(0, 8) || 'null'} → ${newHash.slice(0, 8)}, status: ${nextStatus}`);

  return {
    applied: true,
    skipped: false,
    newStatus: nextStatus,
    reason: wasApplied ? 'Status reset due to constitution change' : 'Hash updated',
  };
}

// ═══════════════════════════════════════════════════════════════
// L3.2 — DRIFT AUTO-REVOKE HOOK
// ═══════════════════════════════════════════════════════════════

export interface DriftUpdateResult {
  updated: boolean;
  revoked: boolean;
  reason?: string;
}

/**
 * When drift is updated:
 * - Always update drift.severity and drift.lastCheckedAt
 * - If APPLIED AND drift=CRITICAL → auto-revoke
 */
export async function handleDriftUpdateHook(
  db: Db,
  modelId: ModelId,
  severity: DriftSeverity,
  details?: { deltaHitRate?: number; deltaSharpe?: number; deltaCalibration?: number }
): Promise<DriftUpdateResult> {
  const stateCollection = db.collection('model_lifecycle_state');
  const eventsCollection = db.collection('model_lifecycle_events');
  const now = new Date().toISOString();

  const currentState = await stateCollection.findOne({ modelId }) as ModelLifecycleState | null;
  if (!currentState) {
    return { updated: false, revoked: false, reason: 'State not found' };
  }

  const oldSeverity = currentState.drift?.severity || 'OK';

  // Always update drift
  await stateCollection.updateOne(
    { modelId },
    {
      $set: {
        'drift.severity': severity,
        'drift.lastCheckedAt': now,
        'drift.deltaHitRate': details?.deltaHitRate,
        'drift.deltaSharpe': details?.deltaSharpe,
        'drift.deltaCalibration': details?.deltaCalibration,
        updatedAt: now,
      },
    }
  );

  // Check for auto-revoke
  const wasApplied = currentState.status === 'APPLIED' || currentState.status === 'APPLIED_MANUAL';
  const isProd = currentState.systemMode === 'PROD';
  
  if (wasApplied && severity === 'CRITICAL' && isProd) {
    // Auto-revoke
    await stateCollection.updateOne(
      { modelId },
      {
        $set: {
          status: 'REVOKED',
          updatedAt: now,
        },
      }
    );

    await eventsCollection.insertOne({
      modelId,
      engineVersion: 'v2.1',
      ts: now,
      type: 'DRIFT_CRITICAL_REVOKE',
      actor: 'SYSTEM',
      meta: {
        previousStatus: currentState.status,
        reason: 'Drift severity CRITICAL',
        oldSeverity,
        newSeverity: severity,
      },
    });

    console.log(`[Lifecycle] Auto-revoked ${modelId} due to CRITICAL drift`);
    return { updated: true, revoked: true, reason: 'Auto-revoked due to CRITICAL drift' };
  }

  // Record drift change event if severity changed
  if (severity !== oldSeverity) {
    const eventType = severity === 'CRITICAL' ? 'DRIFT_CRITICAL' : 
                      severity === 'WARN' ? 'DRIFT_WARN' : null;
    
    if (eventType) {
      await eventsCollection.insertOne({
        modelId,
        engineVersion: 'v2.1',
        ts: now,
        type: eventType,
        actor: 'SYSTEM',
        meta: { oldSeverity, newSeverity: severity },
      });
    }
  }

  // L3.3 — Check for drift recovery
  await handleDriftRecoveryHook(db, modelId, severity, currentState, oldSeverity);

  return { updated: true, revoked: false };
}

// ═══════════════════════════════════════════════════════════════
// L3.3 — DRIFT RECOVERY LOGIC
// ═══════════════════════════════════════════════════════════════

/**
 * When drift recovers from CRITICAL:
 * - If status was REVOKED → transition to WARMUP (not back to APPLIED)
 */
async function handleDriftRecoveryHook(
  db: Db,
  modelId: ModelId,
  newSeverity: DriftSeverity,
  currentState: ModelLifecycleState,
  oldSeverity: DriftSeverity
): Promise<void> {
  // Only act if recovering from CRITICAL
  if (currentState.status !== 'REVOKED') return;
  if (oldSeverity !== 'CRITICAL') return;
  if (newSeverity === 'CRITICAL') return;
  if (currentState.systemMode !== 'PROD') return;

  const stateCollection = db.collection('model_lifecycle_state');
  const eventsCollection = db.collection('model_lifecycle_events');
  const now = new Date().toISOString();

  // Transition to WARMUP
  await stateCollection.updateOne(
    { modelId },
    {
      $set: {
        status: 'WARMUP',
        warmup: {
          startedAt: now,
          targetDays: 30,
          resolvedDays: 0,
          progressPct: 0,
        },
        updatedAt: now,
      },
    }
  );

  await eventsCollection.insertOne({
    modelId,
    engineVersion: 'v2.1',
    ts: now,
    type: 'DRIFT_RECOVERY_WARMUP',
    actor: 'SYSTEM',
    meta: {
      previousStatus: 'REVOKED',
      newStatus: 'WARMUP',
      reason: `Drift normalized: ${oldSeverity} → ${newSeverity}`,
    },
  });

  console.log(`[Lifecycle] ${modelId} drift recovered, entering WARMUP`);
}

// ═══════════════════════════════════════════════════════════════
// L3.5 — AUTO-PROMOTION LOGIC
// ═══════════════════════════════════════════════════════════════

export interface AutoPromotionResult {
  promoted: boolean;
  blocked: boolean;
  reason: string;
}

/**
 * Check if model should be auto-promoted from WARMUP to APPLIED
 * Conditions:
 * - systemMode = PROD
 * - status = WARMUP
 * - liveSamples >= 30
 * - drift.severity != CRITICAL
 */
export async function checkAutoPromotionHook(
  db: Db,
  modelId: ModelId
): Promise<AutoPromotionResult> {
  const stateCollection = db.collection('model_lifecycle_state');
  const eventsCollection = db.collection('model_lifecycle_events');

  const state = await stateCollection.findOne({ modelId }) as ModelLifecycleState | null;
  if (!state) {
    return { promoted: false, blocked: false, reason: 'State not found' };
  }

  // Must be PROD
  if (state.systemMode !== 'PROD') {
    return { promoted: false, blocked: false, reason: 'Not in PROD mode' };
  }

  // Must be in WARMUP
  if (state.status !== 'WARMUP') {
    return { promoted: false, blocked: false, reason: `Not in WARMUP (current: ${state.status})` };
  }

  const liveSamples = state.live?.liveSamples || 0;
  const driftSeverity = state.drift?.severity || 'OK';

  // Check live samples threshold
  if (liveSamples < 30) {
    return { promoted: false, blocked: false, reason: `Need ${30 - liveSamples} more live samples` };
  }

  // Check drift blocker
  if (driftSeverity === 'CRITICAL') {
    return { promoted: false, blocked: true, reason: 'Drift CRITICAL blocks auto-promotion' };
  }

  // WARN drift also blocks auto-promotion (conservative)
  if (driftSeverity === 'WARN') {
    return { promoted: false, blocked: true, reason: 'Drift WARN blocks auto-promotion' };
  }

  // All checks passed — promote!
  const now = new Date().toISOString();

  await stateCollection.updateOne(
    { modelId },
    {
      $set: {
        status: 'APPLIED',
        governanceAppliedAt: now,
        updatedAt: now,
      },
    }
  );

  await eventsCollection.insertOne({
    modelId,
    engineVersion: 'v2.1',
    ts: now,
    type: 'AUTO_APPLY',
    actor: 'SYSTEM',
    meta: {
      liveSamples,
      driftSeverity,
      reason: 'Auto-promoted after meeting all criteria',
    },
  });

  console.log(`[Lifecycle] ${modelId} auto-promoted to APPLIED (samples=${liveSamples}, drift=${driftSeverity})`);

  return { promoted: true, blocked: false, reason: 'Auto-promoted to APPLIED' };
}

/**
 * Increment live samples (called by daily runner)
 * Triggers auto-promotion check if in WARMUP
 */
export async function incrementLiveSamplesHook(
  db: Db,
  modelId: ModelId,
  count: number = 1
): Promise<{ liveSamples: number; promoted: boolean }> {
  const stateCollection = db.collection('model_lifecycle_state');

  const state = await stateCollection.findOne({ modelId }) as ModelLifecycleState | null;
  if (!state) {
    return { liveSamples: 0, promoted: false };
  }

  const newLiveSamples = (state.live?.liveSamples || 0) + count;
  const now = new Date().toISOString();

  // Update live samples
  await stateCollection.updateOne(
    { modelId },
    {
      $set: {
        'live.liveSamples': newLiveSamples,
        'live.lastLiveAsOfDate': now,
        updatedAt: now,
      },
    }
  );

  // Also increment warmup resolved days if in WARMUP
  if (state.status === 'WARMUP') {
    const resolvedDays = (state.warmup?.resolvedDays || 0) + count;
    const targetDays = state.warmup?.targetDays || 30;
    const progressPct = Math.min(100, Math.round((resolvedDays / targetDays) * 100));

    await stateCollection.updateOne(
      { modelId },
      {
        $set: {
          'warmup.resolvedDays': resolvedDays,
          'warmup.progressPct': progressPct,
        },
      }
    );
  }

  // Check auto-promotion
  const promotionResult = await checkAutoPromotionHook(db, modelId);

  return { liveSamples: newLiveSamples, promoted: promotionResult.promoted };
}

console.log('[Lifecycle] Hooks loaded (L3.1, L3.2, L3.3, L3.5)');
