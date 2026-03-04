/**
 * Self-Learning Audit Helpers (ETAP 5.1-5.8)
 * 
 * Helper functions for logging self-learning events using existing audit_log model.
 */
import { AuditLogModel } from './audit_log.model.js';

export type SelfLearningEventType =
  | 'GUARD_BLOCKED'
  | 'DATASET_FROZEN'
  | 'TRAIN_STARTED'
  | 'TRAIN_FINISHED'
  | 'TRAIN_FAILED'
  | 'EVAL_STARTED'
  | 'EVAL_PASSED'
  | 'EVAL_FAILED'
  | 'EVAL_INCONCLUSIVE'
  | 'PROMOTION_STARTED'
  | 'PROMOTION_COMPLETE'
  | 'ROLLBACK_TRIGGERED'
  | 'ROLLBACK_COMPLETE'
  | 'CONFIG_CHANGED'
  | 'MANUAL_INTERVENTION'
  // PR#3 events
  | 'PROMOTE_STARTED'
  | 'PROMOTE_SUCCEEDED'
  | 'PROMOTE_BLOCKED'
  | 'ROLLBACK_STARTED'
  | 'ROLLBACK_SUCCEEDED'
  | 'ROLLBACK_FAILED'
  | 'AUTO_ROLLBACK_TRIGGERED'
  | 'MONITOR_REPORT'
  | 'JOB_STARTED'
  | 'JOB_COMPLETED'
  | 'JOB_FAILED';

/**
 * Log self-learning event
 */
export async function logSelfLearningEvent(event: {
  eventType: SelfLearningEventType;
  horizon?: '7d' | '30d';
  datasetVersionId?: string;
  modelVersionId?: string;
  evalReportId?: string;
  details?: any;
  configSnapshot?: any;
  triggeredBy?: 'scheduler' | 'manual' | 'system' | 'rollback_guard' | 'api' | 'shadow_monitor';
  operator?: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
}) {
  // Map event type to action
  const actionMap: Record<string, string> = {
    'GUARD_BLOCKED': 'HEALTH_CHECK',
    'DATASET_FROZEN': 'TRAIN',
    'TRAIN_STARTED': 'TRAIN',
    'TRAIN_FINISHED': 'TRAIN',
    'TRAIN_FAILED': 'TRAIN',
    'EVAL_STARTED': 'EVALUATE',
    'EVAL_PASSED': 'EVALUATE',
    'EVAL_FAILED': 'EVALUATE',
    'EVAL_INCONCLUSIVE': 'EVALUATE',
    'PROMOTION_STARTED': 'PROMOTE',
    'PROMOTION_COMPLETE': 'PROMOTE',
    'ROLLBACK_TRIGGERED': 'ROLLBACK',
    'ROLLBACK_COMPLETE': 'ROLLBACK',
    'CONFIG_CHANGED': 'HEALTH_CHECK',
    'MANUAL_INTERVENTION': 'HEALTH_CHECK',
    // PR#3 events
    'PROMOTE_STARTED': 'PROMOTE',
    'PROMOTE_SUCCEEDED': 'PROMOTE',
    'PROMOTE_BLOCKED': 'PROMOTE',
    'ROLLBACK_STARTED': 'ROLLBACK',
    'ROLLBACK_SUCCEEDED': 'ROLLBACK',
    'ROLLBACK_FAILED': 'ROLLBACK',
    'AUTO_ROLLBACK_TRIGGERED': 'ROLLBACK',
    'MONITOR_REPORT': 'HEALTH_CHECK',
    'JOB_STARTED': 'HEALTH_CHECK',
    'JOB_COMPLETED': 'HEALTH_CHECK',
    'JOB_FAILED': 'HEALTH_CHECK',
  };

  const action = actionMap[event.eventType] || 'HEALTH_CHECK';
  
  // Map triggeredBy to enum values
  const triggeredByMap: Record<string, string> = {
    'scheduler': 'SCHEDULER',
    'manual': 'MANUAL',
    'system': 'SYSTEM',
    'api': 'MANUAL',
    'rollback_guard': 'AUTO',
    'shadow_monitor': 'AUTO',
  };
  
  const triggeredByEnum = triggeredByMap[event.triggeredBy || 'system'] || 'SYSTEM';
  
  return AuditLogModel.create({
    auditId: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date(),
    horizon: event.horizon || '7d',
    modelVersionId: event.modelVersionId || 'unknown',
    datasetVersionId: event.datasetVersionId,
    action: action as any,
    reason: `${event.eventType}: ${event.details?.message || JSON.stringify(event.details || {})}`,
    triggeredBy: triggeredByEnum as any,
    metadata: {
      eventType: event.eventType,
      triggeredBy: event.triggeredBy || 'system',
      operator: event.operator,
      severity: event.severity,
      configSnapshot: event.configSnapshot,
      ...event.details,
    },
  });
}

/**
 * Get recent audit events
 */
export async function getRecentAuditEvents(
  limit: number = 50,
  filters?: {
    eventType?: SelfLearningEventType | SelfLearningEventType[];
    horizon?: '7d' | '30d';
    severity?: string | string[];
    since?: Date;
  }
) {
  const query: any = {};
  
  if (filters?.horizon) {
    query.horizon = filters.horizon;
  }
  
  if (filters?.since) {
    query.timestamp = { $gte: filters.since };
  }
  
  // Event type filter (via metadata)
  if (filters?.eventType) {
    const eventTypes = Array.isArray(filters.eventType) ? filters.eventType : [filters.eventType];
    query['metadata.eventType'] = { $in: eventTypes };
  }
  
  return AuditLogModel
    .find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get audit events for specific model
 */
export async function getAuditForModel(modelVersionId: string) {
  return AuditLogModel
    .find({ modelVersionId })
    .sort({ timestamp: 1 })
    .lean();
}

/**
 * Get last guard block reasons
 */
export async function getLastGuardBlock(horizon?: '7d' | '30d') {
  const query: any = { 'metadata.eventType': 'GUARD_BLOCKED' };
  
  if (horizon) {
    query.horizon = horizon;
  }
  
  return AuditLogModel
    .findOne(query)
    .sort({ timestamp: -1 })
    .lean();
}

// Re-export model for direct queries
export { AuditLogModel as SelfLearningAuditLogModel };
