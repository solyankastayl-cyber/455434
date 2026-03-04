/**
 * STEP 3 — ML Promotion Execution Service
 * ========================================
 * Controlled promotion from SHADOW to ACTIVE_SAFE
 * with precondition validation and audit logging.
 */

import { getDb } from '../../../db/mongodb.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type PromotionMode = 'ACTIVE_SAFE' | 'ACTIVE_FULL';
export type HealthState = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
export type LockdownState = 'UNLOCKED' | 'LOCKED' | 'COOLDOWN';

export interface PromotionPreconditions {
  shadowReportApproved: boolean;
  noCriticalEvents24h: boolean;
  noDegradedEvents24h: boolean;
  driftNone: boolean;
  macroRespected: boolean;
  disagreementBelowThreshold: boolean;
  allPassed: boolean;
  failedConditions: string[];
}

export interface PromotionRequest {
  targetModel: string;
  promotionMode: PromotionMode;
  applyScope: 'confidence_only' | 'full';
  constraints: {
    onlyLowerConfidence: boolean;
    respectMacroBlocks: boolean;
    liveDataOnly: boolean;
  };
  reason?: string;
}

export interface PromotionResult {
  success: boolean;
  promotionId: string;
  previousActiveModel: string | null;
  newActiveModel: string;
  promotedAt: Date;
  mode: PromotionMode;
  lockdownState: LockdownState;
  validationWindowHours: number;
  error?: string;
}

export interface MetaBrainLockdownConfig {
  decisionDirection: 'LOCKED' | 'UNLOCKED';
  macroPriority: 'ABSOLUTE' | 'ADVISORY';
  mlScope: 'CONFIDENCE_ONLY' | 'FULL' | 'DISABLED';
  lockedAt: Date | null;
  lockedBy: string | null;
}

export interface AuditRecord {
  event: string;
  modelId: string;
  promotionTime: Date;
  regime: string;
  healthWindow: string;
  violations: number;
  metadata: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const COLLECTION_PROMOTION_STATE = 'mlops_promotion_state';
const COLLECTION_AUDIT = 'mlops_audit_log';
const COLLECTION_LOCKDOWN = 'mlops_lockdown_config';
const COLLECTION_HEALTH_EVENTS = 'mlops_health_events';

const VALIDATION_WINDOW_HOURS = 24;
const COOLDOWN_DAYS = 7;
const DISAGREEMENT_THRESHOLD = 0.15; // 15%

// ═══════════════════════════════════════════════════════════════
// PRECONDITION VALIDATION
// ═══════════════════════════════════════════════════════════════

export async function validatePreconditions(): Promise<PromotionPreconditions> {
  const db = await getDb();
  const failedConditions: string[] = [];
  
  // 1. Check shadow report approved (look for recent approved report)
  const recentReport = await db.collection('mlops_shadow_reports').findOne(
    { verdict: 'PROMOTE' },
    { sort: { createdAt: -1 } }
  );
  const shadowReportApproved = !!recentReport;
  if (!shadowReportApproved) failedConditions.push('Shadow report not approved');
  
  // 2. Check no CRITICAL events in last 24h
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const criticalEvents = await db.collection(COLLECTION_HEALTH_EVENTS).countDocuments({
    state: 'CRITICAL',
    timestamp: { $gte: twentyFourHoursAgo }
  });
  const noCriticalEvents24h = criticalEvents === 0;
  if (!noCriticalEvents24h) failedConditions.push(`${criticalEvents} CRITICAL events in last 24h`);
  
  // 3. Check no DEGRADED events in last 24h
  const degradedEvents = await db.collection(COLLECTION_HEALTH_EVENTS).countDocuments({
    state: 'DEGRADED',
    timestamp: { $gte: twentyFourHoursAgo }
  });
  const noDegradedEvents24h = degradedEvents === 0;
  if (!noDegradedEvents24h) failedConditions.push(`${degradedEvents} DEGRADED events in last 24h`);
  
  // 4. Check drift = NONE
  const driftState = await db.collection('mlops_drift_state').findOne({}, { sort: { timestamp: -1 } });
  const driftNone = !driftState || driftState.driftDetected === false;
  if (!driftNone) failedConditions.push('Drift detected');
  
  // 5. Check macro respected in shadow
  const macroViolations = await db.collection('mlops_macro_violations').countDocuments({
    timestamp: { $gte: twentyFourHoursAgo }
  });
  const macroRespected = macroViolations === 0;
  if (!macroRespected) failedConditions.push(`${macroViolations} macro violations`);
  
  // 6. Check disagreement below threshold
  const disagreementState = await db.collection('mlops_disagreement_state').findOne(
    {},
    { sort: { timestamp: -1 } }
  );
  const disagreementRate = disagreementState?.rate || 0;
  const disagreementBelowThreshold = disagreementRate < DISAGREEMENT_THRESHOLD;
  if (!disagreementBelowThreshold) {
    failedConditions.push(`Disagreement rate ${(disagreementRate * 100).toFixed(1)}% >= ${DISAGREEMENT_THRESHOLD * 100}%`);
  }
  
  return {
    shadowReportApproved,
    noCriticalEvents24h,
    noDegradedEvents24h,
    driftNone,
    macroRespected,
    disagreementBelowThreshold,
    allPassed: failedConditions.length === 0,
    failedConditions,
  };
}

// ═══════════════════════════════════════════════════════════════
// PROMOTION EXECUTION
// ═══════════════════════════════════════════════════════════════

export async function executePromotion(
  request: PromotionRequest,
  bypassPreconditions: boolean = false
): Promise<PromotionResult> {
  const db = await getDb();
  const promotionId = `promo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  // 1. Validate preconditions (unless bypassed for simulation)
  if (!bypassPreconditions) {
    const preconditions = await validatePreconditions();
    if (!preconditions.allPassed) {
      return {
        success: false,
        promotionId,
        previousActiveModel: null,
        newActiveModel: request.targetModel,
        promotedAt: new Date(),
        mode: request.promotionMode,
        lockdownState: 'UNLOCKED',
        validationWindowHours: 0,
        error: `Preconditions failed: ${preconditions.failedConditions.join(', ')}`,
      };
    }
  }
  
  // 2. Get current state
  const currentState = await db.collection(COLLECTION_PROMOTION_STATE).findOne({ _id: 'current' });
  const previousActiveModel = currentState?.activeModelId || null;
  
  // 3. Update promotion state
  await db.collection(COLLECTION_PROMOTION_STATE).updateOne(
    { _id: 'current' },
    {
      $set: {
        mode: request.promotionMode,
        activeModelId: request.targetModel,
        previousActiveModelId: previousActiveModel,
        scope: [request.applyScope === 'confidence_only' ? 'CONFIDENCE' : 'FULL'],
        policy: {
          version: 'policy:v1.1',
          applyOnlyWhenLive: request.constraints.liveDataOnly,
          neverFlipDecision: true,
          respectMacroBlocks: request.constraints.respectMacroBlocks,
          onlyLowerConfidence: request.constraints.onlyLowerConfidence,
        },
        promotedAt: new Date(),
        promotionId,
        validationWindowEndsAt: new Date(Date.now() + VALIDATION_WINDOW_HOURS * 60 * 60 * 1000),
        updatedAt: new Date(),
        updatedBy: 'system',
      },
    },
    { upsert: true }
  );
  
  // 4. Mark previous model as RETIRED_CANDIDATE
  if (previousActiveModel) {
    await db.collection('ml_model_registry').updateOne(
      { modelId: previousActiveModel },
      { $set: { stage: 'RETIRED_CANDIDATE', retiredAt: new Date() } }
    );
  }
  
  // 5. Mark new model as ACTIVE
  await db.collection('ml_model_registry').updateOne(
    { modelId: request.targetModel },
    { $set: { stage: 'ACTIVE', activatedAt: new Date() } }
  );
  
  // 6. Apply Meta-Brain Lockdown
  await applyMetaBrainLockdown({
    decisionDirection: 'LOCKED',
    macroPriority: 'ABSOLUTE',
    mlScope: 'CONFIDENCE_ONLY',
    lockedAt: new Date(),
    lockedBy: promotionId,
  });
  
  // 7. Reset shadow monitoring counters
  await db.collection('mlops_shadow_health').updateOne(
    { _id: 'current' },
    {
      $set: {
        criticalStreak: 0,
        degradedStreak: 0,
        lastResetAt: new Date(),
        resetReason: 'PROMOTION',
      },
    },
    { upsert: true }
  );
  
  // 8. Create audit record
  await createAuditRecord({
    event: 'ML_PROMOTION_EXECUTED',
    modelId: request.targetModel,
    promotionTime: new Date(),
    regime: 'CURRENT', // Will be filled by actual regime
    healthWindow: `${VALIDATION_WINDOW_HOURS}h`,
    violations: 0,
    metadata: {
      promotionId,
      previousModel: previousActiveModel,
      mode: request.promotionMode,
      reason: request.reason || 'Shadow training passed',
      constraints: request.constraints,
    },
  });
  
  // 9. Start post-promotion validation
  await startPostPromotionValidation(promotionId);
  
  return {
    success: true,
    promotionId,
    previousActiveModel,
    newActiveModel: request.targetModel,
    promotedAt: new Date(),
    mode: request.promotionMode,
    lockdownState: 'LOCKED',
    validationWindowHours: VALIDATION_WINDOW_HOURS,
  };
}

// ═══════════════════════════════════════════════════════════════
// META-BRAIN LOCKDOWN
// ═══════════════════════════════════════════════════════════════

export async function applyMetaBrainLockdown(config: MetaBrainLockdownConfig): Promise<void> {
  const db = await getDb();
  
  await db.collection(COLLECTION_LOCKDOWN).updateOne(
    { _id: 'metabrain' },
    {
      $set: {
        ...config,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
  
  // Create audit record for lockdown
  await createAuditRecord({
    event: 'META_BRAIN_LOCKDOWN_APPLIED',
    modelId: config.lockedBy || 'unknown',
    promotionTime: new Date(),
    regime: 'N/A',
    healthWindow: 'N/A',
    violations: 0,
    metadata: config,
  });
}

export async function getMetaBrainLockdownState(): Promise<MetaBrainLockdownConfig | null> {
  const db = await getDb();
  const state = await db.collection(COLLECTION_LOCKDOWN).findOne({ _id: 'metabrain' });
  
  if (!state) return null;
  
  return {
    decisionDirection: state.decisionDirection,
    macroPriority: state.macroPriority,
    mlScope: state.mlScope,
    lockedAt: state.lockedAt,
    lockedBy: state.lockedBy,
  };
}

// ═══════════════════════════════════════════════════════════════
// POST-PROMOTION VALIDATION
// ═══════════════════════════════════════════════════════════════

export async function startPostPromotionValidation(promotionId: string): Promise<void> {
  const db = await getDb();
  
  await db.collection('mlops_validation_jobs').insertOne({
    promotionId,
    status: 'RUNNING',
    startedAt: new Date(),
    checkInterval: 15, // minutes
    windowHours: VALIDATION_WINDOW_HOURS,
    checksCompleted: 0,
    lastCheckAt: null,
    health: 'HEALTHY',
  });
}

// ═══════════════════════════════════════════════════════════════
// AUDIT LOGGING
// ═══════════════════════════════════════════════════════════════

export async function createAuditRecord(record: AuditRecord): Promise<void> {
  const db = await getDb();
  
  await db.collection(COLLECTION_AUDIT).insertOne({
    ...record,
    createdAt: new Date(),
    immutable: true,
  });
}

export async function getAuditLog(limit: number = 50): Promise<AuditRecord[]> {
  const db = await getDb();
  
  const records = await db.collection(COLLECTION_AUDIT)
    .find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  
  return records.map(r => ({
    event: r.event,
    modelId: r.modelId,
    promotionTime: r.promotionTime,
    regime: r.regime,
    healthWindow: r.healthWindow,
    violations: r.violations,
    metadata: r.metadata,
  }));
}

// ═══════════════════════════════════════════════════════════════
// COOLDOWN CHECK
// ═══════════════════════════════════════════════════════════════

export async function checkCooldown(): Promise<{ inCooldown: boolean; endsAt: Date | null; daysRemaining: number }> {
  const db = await getDb();
  
  const lastPromotion = await db.collection(COLLECTION_AUDIT).findOne(
    { event: 'ML_PROMOTION_CONFIRMED' },
    { sort: { createdAt: -1 } }
  );
  
  if (!lastPromotion) {
    return { inCooldown: false, endsAt: null, daysRemaining: 0 };
  }
  
  const cooldownEnds = new Date(lastPromotion.createdAt.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();
  
  if (now < cooldownEnds) {
    const daysRemaining = Math.ceil((cooldownEnds.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    return { inCooldown: true, endsAt: cooldownEnds, daysRemaining };
  }
  
  return { inCooldown: false, endsAt: cooldownEnds, daysRemaining: 0 };
}
