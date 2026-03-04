/**
 * Temporal Audit Log
 * 
 * EPIC 7: Logging for temporal feature events
 * 
 * Logs:
 * - Regime transitions
 * - Extreme acceleration
 * - Low consistency (noise detection)
 */

import mongoose, { Schema, Document } from 'mongoose';

export type TemporalEventType = 
  | 'REGIME_TRANSITION'
  | 'EXTREME_ACCELERATION'
  | 'NOISE_DETECTED'
  | 'FEATURE_COMPUTED'
  | 'VALIDATION_FAILED';

export interface ITemporalAuditLog extends Document {
  eventType: TemporalEventType;
  tokenAddress: string;
  metric: string;
  window: string;
  
  details: {
    previousRegime?: string;
    newRegime?: string;
    acceleration?: number;
    consistency?: number;
    slope?: number;
    reason?: string;
  };
  
  timestamp: Date;
}

const TemporalAuditLogSchema = new Schema<ITemporalAuditLog>({
  eventType: { type: String, required: true, index: true },
  tokenAddress: { type: String, required: true, index: true },
  metric: { type: String, required: true },
  window: { type: String, required: true },
  
  details: { type: Schema.Types.Mixed, default: {} },
  
  timestamp: { type: Date, default: Date.now, index: true },
});

// TTL: keep logs for 30 days
TemporalAuditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const TemporalAuditLogModel = mongoose.model<ITemporalAuditLog>(
  'temporal_audit_logs', 
  TemporalAuditLogSchema
);

// Thresholds for logging
const EXTREME_ACCELERATION_THRESHOLD = 0.5;
const LOW_CONSISTENCY_THRESHOLD = 0.2;

/**
 * Log a temporal event
 */
export async function logTemporalEvent(
  eventType: TemporalEventType,
  tokenAddress: string,
  metric: string,
  window: string,
  details: ITemporalAuditLog['details']
): Promise<void> {
  try {
    await TemporalAuditLogModel.create({
      eventType,
      tokenAddress,
      metric,
      window,
      details,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error('[TemporalAudit] Failed to log event:', err);
  }
}

/**
 * Log regime transition
 */
export async function logRegimeTransition(
  tokenAddress: string,
  metric: string,
  window: string,
  previousRegime: string,
  newRegime: string
): Promise<void> {
  if (previousRegime === newRegime) return;
  
  await logTemporalEvent('REGIME_TRANSITION', tokenAddress, metric, window, {
    previousRegime,
    newRegime,
  });
}

/**
 * Log extreme acceleration
 */
export async function logExtremeAcceleration(
  tokenAddress: string,
  metric: string,
  window: string,
  acceleration: number
): Promise<void> {
  if (Math.abs(acceleration) < EXTREME_ACCELERATION_THRESHOLD) return;
  
  await logTemporalEvent('EXTREME_ACCELERATION', tokenAddress, metric, window, {
    acceleration,
  });
}

/**
 * Log noise detection (low consistency)
 */
export async function logNoiseDetected(
  tokenAddress: string,
  metric: string,
  window: string,
  consistency: number
): Promise<void> {
  if (consistency >= LOW_CONSISTENCY_THRESHOLD) return;
  
  await logTemporalEvent('NOISE_DETECTED', tokenAddress, metric, window, {
    consistency,
    reason: `Consistency ${consistency.toFixed(3)} below threshold ${LOW_CONSISTENCY_THRESHOLD}`,
  });
}

/**
 * Log feature computation (summary)
 */
export async function logFeatureComputed(
  tokenAddress: string,
  metric: string,
  window: string,
  slope: number,
  acceleration: number,
  consistency: number,
  regime: string
): Promise<void> {
  // Only log significant features (not noise)
  if (regime === 'NOISE' && Math.abs(slope) < 0.01) return;
  
  // Check for events worth logging
  if (Math.abs(acceleration) >= EXTREME_ACCELERATION_THRESHOLD) {
    await logExtremeAcceleration(tokenAddress, metric, window, acceleration);
  }
  
  if (consistency < LOW_CONSISTENCY_THRESHOLD) {
    await logNoiseDetected(tokenAddress, metric, window, consistency);
  }
}

/**
 * Get recent audit events
 */
export async function getRecentAuditEvents(
  hours: number = 24,
  limit: number = 100
): Promise<ITemporalAuditLog[]> {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hours);
  
  return TemporalAuditLogModel.find({ timestamp: { $gte: cutoff } })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get audit events by token
 */
export async function getAuditEventsByToken(
  tokenAddress: string,
  limit: number = 50
): Promise<ITemporalAuditLog[]> {
  return TemporalAuditLogModel.find({ tokenAddress })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

/**
 * Count events by type
 */
export async function countEventsByType(hours: number = 24): Promise<Record<string, number>> {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hours);
  
  const result = await TemporalAuditLogModel.aggregate([
    { $match: { timestamp: { $gte: cutoff } } },
    { $group: { _id: '$eventType', count: { $sum: 1 } } }
  ]);
  
  return result.reduce((acc, r) => {
    acc[r._id] = r.count;
    return acc;
  }, {} as Record<string, number>);
}
