/**
 * Audit Logger Service
 * 
 * ETAP 5.8: Fire-and-forget audit logging.
 * Non-blocking, always logs, never fails the main operation.
 */
import { AuditLogModel, type IAuditLog, type AuditAction } from './audit_log.model.js';
import type { Horizon } from './self_learning.types.js';
import { randomUUID } from 'crypto';

// ==================== TYPES ====================

export interface AuditEvent {
  horizon: Horizon;
  modelVersionId: string;
  datasetVersionId?: string;
  action: AuditAction;
  reason: string;
  metricsSnapshot?: {
    precision?: number;
    recall?: number;
    f1?: number;
    lift?: number;
    ece?: number;
    divergenceRate?: number;
    confidenceStd?: number;
  };
  evaluationDecision?: 'PROMOTE' | 'HOLD' | 'REJECT';
  healthStatus?: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  mlModifier?: number;
  rolledBackFrom?: string;
  rolledBackTo?: string;
  previousState?: {
    activeModelId?: string;
    healthStatus?: string;
    mlModifier?: number;
  };
  triggeredBy: 'SCHEDULER' | 'MANUAL' | 'AUTO' | 'SYSTEM';
}

// ==================== SERVICE ====================

/**
 * Log audit event (fire-and-forget)
 * Never throws, always completes main operation
 */
export async function logAuditEvent(event: AuditEvent): Promise<void> {
  try {
    const auditId = `audit_${Date.now()}_${randomUUID().slice(0, 8)}`;
    
    await AuditLogModel.create({
      auditId,
      timestamp: new Date(),
      ...event,
    });
    
    console.log(`[Audit] ${event.action} - ${event.reason}`);
  } catch (error) {
    // Fire-and-forget - log error but don't throw
    console.error('[Audit] Failed to log event:', error);
  }
}

/**
 * Log TRAIN event
 */
export async function logTrainEvent(
  horizon: Horizon,
  modelVersionId: string,
  datasetVersionId: string,
  metrics: Record<string, number>,
  triggeredBy: 'SCHEDULER' | 'MANUAL'
): Promise<void> {
  await logAuditEvent({
    horizon,
    modelVersionId,
    datasetVersionId,
    action: 'TRAIN',
    reason: `Model trained on dataset ${datasetVersionId}`,
    metricsSnapshot: metrics,
    triggeredBy,
  });
}

/**
 * Log EVALUATE event
 */
export async function logEvaluateEvent(
  horizon: Horizon,
  modelVersionId: string,
  decision: 'PROMOTE' | 'HOLD' | 'REJECT',
  reasons: string[],
  metrics: Record<string, number>
): Promise<void> {
  await logAuditEvent({
    horizon,
    modelVersionId,
    action: 'EVALUATE',
    reason: reasons.join('; '),
    evaluationDecision: decision,
    metricsSnapshot: metrics,
    triggeredBy: 'AUTO',
  });
}

/**
 * Log PROMOTE event
 */
export async function logPromoteEvent(
  horizon: Horizon,
  modelVersionId: string,
  previousModelId: string | null
): Promise<void> {
  await logAuditEvent({
    horizon,
    modelVersionId,
    action: 'PROMOTE',
    reason: `Promoted to active model`,
    previousState: previousModelId ? { activeModelId: previousModelId } : undefined,
    triggeredBy: 'AUTO',
  });
}

/**
 * Log ROLLBACK event
 */
export async function logRollbackEvent(
  horizon: Horizon,
  fromModelId: string,
  toModelId: string,
  reason: string,
  triggeredBy: 'AUTO' | 'MANUAL'
): Promise<void> {
  await logAuditEvent({
    horizon,
    modelVersionId: toModelId,
    action: triggeredBy === 'AUTO' ? 'AUTO_ROLLBACK' : 'ROLLBACK',
    reason,
    rolledBackFrom: fromModelId,
    rolledBackTo: toModelId,
    triggeredBy,
  });
}

/**
 * Log HEALTH_CHECK event
 */
export async function logHealthCheckEvent(
  horizon: Horizon,
  modelVersionId: string,
  healthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL',
  metrics: Record<string, number>,
  previousHealth?: string
): Promise<void> {
  await logAuditEvent({
    horizon,
    modelVersionId,
    action: 'HEALTH_CHECK',
    reason: `Health status: ${healthStatus}`,
    healthStatus,
    metricsSnapshot: metrics,
    previousState: previousHealth ? { healthStatus: previousHealth } : undefined,
    triggeredBy: 'SYSTEM',
  });
}

/**
 * Log CONFIDENCE_ADJUST event
 */
export async function logConfidenceAdjustEvent(
  horizon: Horizon,
  modelVersionId: string,
  mlModifier: number,
  healthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL',
  previousModifier?: number
): Promise<void> {
  await logAuditEvent({
    horizon,
    modelVersionId,
    action: 'CONFIDENCE_ADJUST',
    reason: `mlModifier set to ${mlModifier} due to ${healthStatus} status`,
    healthStatus,
    mlModifier,
    previousState: previousModifier !== undefined ? { mlModifier: previousModifier } : undefined,
    triggeredBy: 'SYSTEM',
  });
}

// ==================== QUERY ====================

/**
 * Get audit trail for model
 */
export async function getAuditTrail(
  modelVersionId: string,
  limit: number = 100
): Promise<IAuditLog[]> {
  return AuditLogModel.find({ modelVersionId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get audit trail for horizon
 */
export async function getHorizonAuditTrail(
  horizon: Horizon,
  limit: number = 100
): Promise<IAuditLog[]> {
  return AuditLogModel.find({ horizon })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get recent audit events by action
 */
export async function getAuditByAction(
  action: AuditAction,
  limit: number = 50
): Promise<IAuditLog[]> {
  return AuditLogModel.find({ action })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

/**
 * Reconstruct timeline for investigation
 */
export async function reconstructTimeline(
  horizon: Horizon,
  startTime: Date,
  endTime: Date
): Promise<IAuditLog[]> {
  return AuditLogModel.find({
    horizon,
    timestamp: { $gte: startTime, $lte: endTime },
  })
    .sort({ timestamp: 1 })
    .lean();
}
