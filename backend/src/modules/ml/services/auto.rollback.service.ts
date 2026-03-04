/**
 * STEP 3.4 — Auto-Rollback Service
 * =================================
 * Automatic rollback when validation fails.
 */

import { getDb } from '../../../db/mongodb.js';
import { createAuditRecord, applyMetaBrainLockdown } from './promotion.execution.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type RollbackReason = 
  | 'DECISION_VIOLATION'
  | 'MACRO_OVERRIDE'
  | 'CONFIDENCE_INFLATION'
  | 'DRIFT_SPIKE'
  | 'CRITICAL_EVENT'
  | 'DEGRADED_STREAK'
  | 'MANUAL';

export interface RollbackResult {
  success: boolean;
  rollbackId: string;
  rolledBackModel: string;
  restoredModel: string | null;
  reason: RollbackReason;
  timestamp: Date;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// ROLLBACK EXECUTION
// ═══════════════════════════════════════════════════════════════

export async function executeRollback(
  reason: RollbackReason,
  details?: string
): Promise<RollbackResult> {
  const db = await getDb();
  const rollbackId = `rollback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  // 1. Get current state
  const currentState = await db.collection('mlops_promotion_state').findOne({ _id: 'current' });
  
  if (!currentState) {
    return {
      success: false,
      rollbackId,
      rolledBackModel: 'unknown',
      restoredModel: null,
      reason,
      timestamp: new Date(),
      error: 'No promotion state found',
    };
  }
  
  const rolledBackModel = currentState.activeModelId;
  const restoredModel = currentState.previousActiveModelId;
  
  // 2. Update promotion state
  await db.collection('mlops_promotion_state').updateOne(
    { _id: 'current' },
    {
      $set: {
        mode: 'OFF',
        activeModelId: restoredModel,
        rolledBackModelId: rolledBackModel,
        rollbackReason: reason,
        rollbackDetails: details,
        rollbackAt: new Date(),
        rollbackId,
        updatedAt: new Date(),
      },
    }
  );
  
  // 3. Mark rolled back model as ROLLED_BACK
  if (rolledBackModel) {
    await db.collection('ml_model_registry').updateOne(
      { modelId: rolledBackModel },
      { 
        $set: { 
          stage: 'ROLLED_BACK', 
          rolledBackAt: new Date(),
          rollbackReason: reason,
        } 
      }
    );
  }
  
  // 4. Restore previous model to ACTIVE
  if (restoredModel) {
    await db.collection('ml_model_registry').updateOne(
      { modelId: restoredModel },
      { $set: { stage: 'ACTIVE', restoredAt: new Date() } }
    );
  }
  
  // 5. Reset ML modifiers
  await db.collection('mlops_lockdown_config').updateOne(
    { _id: 'metabrain' },
    {
      $set: {
        mlScope: 'DISABLED',
        decisionDirection: 'UNLOCKED',
        updatedAt: new Date(),
      },
    }
  );
  
  // 6. Stop validation job
  await db.collection('mlops_validation_jobs').updateMany(
    { status: 'RUNNING' },
    { 
      $set: { 
        status: 'STOPPED', 
        stoppedReason: 'ROLLBACK',
        stoppedAt: new Date(),
      } 
    }
  );
  
  // 7. Create audit record
  await createAuditRecord({
    event: 'ML_ROLLBACK_EXECUTED',
    modelId: rolledBackModel || 'unknown',
    promotionTime: new Date(),
    regime: 'N/A',
    healthWindow: 'N/A',
    violations: 1,
    metadata: {
      rollbackId,
      reason,
      details,
      rolledBackModel,
      restoredModel,
    },
  });
  
  // 8. Create incident record
  await db.collection('mlops_incidents').insertOne({
    incidentId: rollbackId,
    type: 'ROLLBACK',
    reason,
    details,
    rolledBackModel,
    restoredModel,
    timestamp: new Date(),
    resolved: true,
    resolvedAt: new Date(),
  });
  
  return {
    success: true,
    rollbackId,
    rolledBackModel: rolledBackModel || 'unknown',
    restoredModel,
    reason,
    timestamp: new Date(),
  };
}

// ═══════════════════════════════════════════════════════════════
// ROLLBACK TRIGGERS
// ═══════════════════════════════════════════════════════════════

export async function checkAndTriggerRollback(): Promise<RollbackResult | null> {
  const db = await getDb();
  
  // Check for recent CRITICAL events
  const recentCritical = await db.collection('mlops_health_events').findOne({
    state: 'CRITICAL',
    timestamp: { $gte: new Date(Date.now() - 15 * 60 * 1000) }, // Last 15 min
  });
  
  if (recentCritical) {
    return executeRollback('CRITICAL_EVENT', `Critical event: ${JSON.stringify(recentCritical.checks)}`);
  }
  
  // Check for validation result requiring rollback
  const validationNeedsRollback = await db.collection('mlops_validation_results').findOne({
    shouldRollback: true,
    processed: { $ne: true },
  });
  
  if (validationNeedsRollback) {
    await db.collection('mlops_validation_results').updateOne(
      { _id: validationNeedsRollback._id },
      { $set: { processed: true } }
    );
    
    return executeRollback(
      validationNeedsRollback.rollbackReason?.includes('CRITICAL') ? 'CRITICAL_EVENT' : 'DEGRADED_STREAK',
      validationNeedsRollback.rollbackReason
    );
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════
// WHAT ROLLBACK DOES NOT TOUCH
// ═══════════════════════════════════════════════════════════════
// 
// ✅ Historical decisions - preserved
// ✅ Outcome tracking - continues
// ✅ Macro engine - untouched
// ✅ Labs logic - untouched
// ✅ Exchange data - untouched
//
// ═══════════════════════════════════════════════════════════════
