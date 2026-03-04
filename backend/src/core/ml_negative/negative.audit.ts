/**
 * Negative Sample Audit
 * 
 * EPIC 8: Logging for negative sample pipeline decisions
 */

import mongoose, { Schema, Document } from 'mongoose';

export type NegativeAuditEventType = 
  | 'RUN_STARTED'
  | 'RUN_COMPLETED'
  | 'RUN_FAILED'
  | 'SAMPLE_LABELED'
  | 'SAMPLE_REJECTED'
  | 'BALANCE_ADJUSTED'
  | 'QUOTA_LIMITED';

export interface INegativeAuditLog extends Document {
  eventType: NegativeAuditEventType;
  runId: string;
  tokenAddress?: string;
  
  details: {
    reason?: string;
    label?: number;
    negativeType?: string;
    oldCount?: number;
    newCount?: number;
    limitedType?: string;
    [key: string]: unknown;
  };
  
  timestamp: Date;
}

const NegativeAuditLogSchema = new Schema<INegativeAuditLog>({
  eventType: { type: String, required: true, index: true },
  runId: { type: String, required: true, index: true },
  tokenAddress: { type: String, index: true },
  
  details: { type: Schema.Types.Mixed, default: {} },
  
  timestamp: { type: Date, default: Date.now, index: true },
});

// TTL: keep logs for 60 days
NegativeAuditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

export const NegativeAuditLogModel = mongoose.model<INegativeAuditLog>(
  'ml_negative_audit_logs', 
  NegativeAuditLogSchema
);

/**
 * Log negative pipeline event
 */
export async function logNegativeEvent(
  eventType: NegativeAuditEventType,
  runId: string,
  details: INegativeAuditLog['details'],
  tokenAddress?: string
): Promise<void> {
  try {
    await NegativeAuditLogModel.create({
      eventType,
      runId,
      tokenAddress,
      details,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error('[NegativeAudit] Failed to log event:', err);
  }
}

/**
 * Log run start
 */
export async function logRunStarted(
  runId: string,
  config: { horizon: string; maxCandidates: number; targetSamples: number }
): Promise<void> {
  await logNegativeEvent('RUN_STARTED', runId, {
    horizon: config.horizon,
    maxCandidates: config.maxCandidates,
    targetSamples: config.targetSamples,
  });
}

/**
 * Log run completion
 */
export async function logRunCompleted(
  runId: string,
  stats: {
    samplesGenerated: number;
    positiveCount: number;
    negativeCount: number;
    negPosRatio: number;
  }
): Promise<void> {
  await logNegativeEvent('RUN_COMPLETED', runId, stats);
}

/**
 * Log run failure
 */
export async function logRunFailed(runId: string, reason: string): Promise<void> {
  await logNegativeEvent('RUN_FAILED', runId, { reason });
}

/**
 * Log sample labeled
 */
export async function logSampleLabeled(
  runId: string,
  tokenAddress: string,
  label: number,
  negativeType?: string,
  reason?: string
): Promise<void> {
  await logNegativeEvent('SAMPLE_LABELED', runId, {
    label,
    negativeType,
    reason,
  }, tokenAddress);
}

/**
 * Log sample rejected (insufficient data)
 */
export async function logSampleRejected(
  runId: string,
  tokenAddress: string,
  reason: string
): Promise<void> {
  await logNegativeEvent('SAMPLE_REJECTED', runId, { reason }, tokenAddress);
}

/**
 * Log balance adjustment
 */
export async function logBalanceAdjusted(
  runId: string,
  oldCount: number,
  newCount: number,
  reason: string
): Promise<void> {
  await logNegativeEvent('BALANCE_ADJUSTED', runId, {
    oldCount,
    newCount,
    reason,
  });
}

/**
 * Log quota limited
 */
export async function logQuotaLimited(
  runId: string,
  limitedType: string,
  available: number,
  target: number
): Promise<void> {
  await logNegativeEvent('QUOTA_LIMITED', runId, {
    limitedType,
    available,
    target,
    reason: `Type ${limitedType}: only ${available} available, needed ${target}`,
  });
}

/**
 * Get audit logs for run
 */
export async function getAuditLogsForRun(
  runId: string,
  limit: number = 100
): Promise<INegativeAuditLog[]> {
  return NegativeAuditLogModel.find({ runId })
    .sort({ timestamp: 1 })
    .limit(limit)
    .lean();
}

/**
 * Get recent audit logs
 */
export async function getRecentAuditLogs(
  hours: number = 24,
  limit: number = 200
): Promise<INegativeAuditLog[]> {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hours);
  
  return NegativeAuditLogModel.find({ timestamp: { $gte: cutoff } })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}
