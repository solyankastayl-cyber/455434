/**
 * System Ingestion Alerts (P0.1)
 * 
 * Non-ML system alerts for ingestion issues.
 * These are infrastructure alerts, not market signals.
 */

import mongoose, { Schema, Document } from 'mongoose';
import * as HealthService from './ingestion_health.service.js';

// ============================================
// Types
// ============================================

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertStatus = 'ACTIVE' | 'RESOLVED' | 'ACKNOWLEDGED';
export type AlertCategory = 
  | 'CHAIN_LAG'
  | 'CHAIN_ERROR'
  | 'CHAIN_PAUSED'
  | 'NO_EVENTS'
  | 'HIGH_ERROR_RATE'
  | 'RPC_BUDGET'
  | 'REPLAY_FAILURE'
  | 'SYSTEM';

export interface ISystemAlert {
  alertId: string;
  
  // Classification
  category: AlertCategory;
  severity: AlertSeverity;
  status: AlertStatus;
  
  // Context
  chain?: string;
  message: string;
  details?: Record<string, any>;
  
  // Metrics that triggered alert
  metric: string;
  value: number | string;
  threshold?: number | string;
  
  // Lifecycle
  triggeredAt: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolvedAt?: Date;
  autoResolved: boolean;
  
  // Deduplication
  fingerprint: string;  // For deduplication
  occurrenceCount: number;
  lastOccurrenceAt: Date;
}

export interface ISystemAlertDocument extends ISystemAlert, Document {}

// ============================================
// Schema
// ============================================

const SystemAlertSchema = new Schema<ISystemAlertDocument>({
  alertId: { type: String, required: true, unique: true },
  
  category: { 
    type: String, 
    enum: ['CHAIN_LAG', 'CHAIN_ERROR', 'CHAIN_PAUSED', 'NO_EVENTS', 'HIGH_ERROR_RATE', 'RPC_BUDGET', 'REPLAY_FAILURE', 'SYSTEM'],
    required: true,
    index: true
  },
  severity: { 
    type: String, 
    enum: ['INFO', 'WARNING', 'CRITICAL'],
    required: true,
    index: true
  },
  status: { 
    type: String, 
    enum: ['ACTIVE', 'RESOLVED', 'ACKNOWLEDGED'],
    default: 'ACTIVE',
    index: true
  },
  
  chain: { type: String, index: true },
  message: { type: String, required: true },
  details: { type: Schema.Types.Mixed },
  
  metric: { type: String, required: true },
  value: { type: Schema.Types.Mixed, required: true },
  threshold: { type: Schema.Types.Mixed },
  
  triggeredAt: { type: Date, default: Date.now },
  acknowledgedAt: { type: Date },
  acknowledgedBy: { type: String },
  resolvedAt: { type: Date },
  autoResolved: { type: Boolean, default: false },
  
  fingerprint: { type: String, required: true, index: true },
  occurrenceCount: { type: Number, default: 1 },
  lastOccurrenceAt: { type: Date, default: Date.now }
});

SystemAlertSchema.index({ status: 1, severity: 1 });
SystemAlertSchema.index({ triggeredAt: -1 });

export const SystemAlertModel = mongoose.model<ISystemAlertDocument>(
  'system_ingestion_alert',
  SystemAlertSchema
);

// ============================================
// Alert Management
// ============================================

/**
 * Generate alert fingerprint for deduplication
 */
function generateFingerprint(category: AlertCategory, chain?: string, metric?: string): string {
  return `${category}:${chain || 'global'}:${metric || 'none'}`;
}

/**
 * Generate unique alert ID
 */
function generateAlertId(): string {
  return `SYSALERT-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Create or update alert (deduplicating by fingerprint)
 */
export async function triggerAlert(params: {
  category: AlertCategory;
  severity: AlertSeverity;
  chain?: string;
  message: string;
  metric: string;
  value: number | string;
  threshold?: number | string;
  details?: Record<string, any>;
}): Promise<ISystemAlertDocument> {
  const fingerprint = generateFingerprint(params.category, params.chain, params.metric);
  
  // Check for existing active alert with same fingerprint
  const existing = await SystemAlertModel.findOne({
    fingerprint,
    status: 'ACTIVE'
  });
  
  if (existing) {
    // Update existing alert
    existing.occurrenceCount++;
    existing.lastOccurrenceAt = new Date();
    existing.value = params.value;
    if (params.details) {
      existing.details = { ...existing.details, ...params.details };
    }
    // Escalate severity if needed
    if (params.severity === 'CRITICAL' && existing.severity !== 'CRITICAL') {
      existing.severity = 'CRITICAL';
    }
    await existing.save();
    return existing;
  }
  
  // Create new alert
  const alert = await SystemAlertModel.create({
    alertId: generateAlertId(),
    fingerprint,
    ...params
  });
  
  console.log(`[SystemAlert] ${params.severity}: ${params.message}`);
  
  return alert;
}

/**
 * Auto-resolve alert when condition clears
 */
export async function autoResolveAlert(fingerprint: string): Promise<void> {
  await SystemAlertModel.updateMany(
    { fingerprint, status: 'ACTIVE' },
    { 
      $set: { 
        status: 'RESOLVED',
        resolvedAt: new Date(),
        autoResolved: true
      }
    }
  );
}

/**
 * Acknowledge alert
 */
export async function acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<void> {
  await SystemAlertModel.updateOne(
    { alertId },
    {
      $set: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        acknowledgedBy
      }
    }
  );
}

/**
 * Manually resolve alert
 */
export async function resolveAlert(alertId: string): Promise<void> {
  await SystemAlertModel.updateOne(
    { alertId },
    {
      $set: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        autoResolved: false
      }
    }
  );
}

// ============================================
// Alert Checking
// ============================================

/**
 * Check health and trigger/resolve alerts
 */
export async function checkAndTriggerAlerts(): Promise<{
  triggered: number;
  resolved: number;
}> {
  const health = await HealthService.calculateHealth();
  let triggered = 0;
  let resolved = 0;
  
  // Check each chain
  for (const [chain, chainHealth] of Object.entries(health.chains)) {
    // Chain lag alerts
    const lagFingerprint = generateFingerprint('CHAIN_LAG', chain);
    if (chainHealth.lag >= 200) {
      await triggerAlert({
        category: 'CHAIN_LAG',
        severity: 'CRITICAL',
        chain,
        message: `Chain ${chain} is ${chainHealth.lag} blocks behind`,
        metric: 'block_lag',
        value: chainHealth.lag,
        threshold: 200
      });
      triggered++;
    } else if (chainHealth.lag >= 50) {
      await triggerAlert({
        category: 'CHAIN_LAG',
        severity: 'WARNING',
        chain,
        message: `Chain ${chain} is ${chainHealth.lag} blocks behind`,
        metric: 'block_lag',
        value: chainHealth.lag,
        threshold: 50
      });
      triggered++;
    } else {
      await autoResolveAlert(lagFingerprint);
      resolved++;
    }
    
    // No events alerts
    const noEventsFingerprint = generateFingerprint('NO_EVENTS', chain);
    if (chainHealth.minutesSinceSync > 15) {
      await triggerAlert({
        category: 'NO_EVENTS',
        severity: 'CRITICAL',
        chain,
        message: `Chain ${chain} has not synced for ${chainHealth.minutesSinceSync} minutes`,
        metric: 'minutes_since_sync',
        value: chainHealth.minutesSinceSync,
        threshold: 15
      });
      triggered++;
    } else if (chainHealth.minutesSinceSync > 5) {
      await triggerAlert({
        category: 'NO_EVENTS',
        severity: 'WARNING',
        chain,
        message: `Chain ${chain} has not synced for ${chainHealth.minutesSinceSync} minutes`,
        metric: 'minutes_since_sync',
        value: chainHealth.minutesSinceSync,
        threshold: 5
      });
      triggered++;
    } else if (chainHealth.minutesSinceSync >= 0) {
      await autoResolveAlert(noEventsFingerprint);
      resolved++;
    }
    
    // Error rate alerts
    const errorFingerprint = generateFingerprint('HIGH_ERROR_RATE', chain);
    if (chainHealth.errorRate >= 0.25) {
      await triggerAlert({
        category: 'HIGH_ERROR_RATE',
        severity: 'CRITICAL',
        chain,
        message: `Chain ${chain} has high error rate: ${Math.round(chainHealth.errorRate * 100)}%`,
        metric: 'error_rate',
        value: chainHealth.errorRate,
        threshold: 0.25
      });
      triggered++;
    } else if (chainHealth.errorRate >= 0.1) {
      await triggerAlert({
        category: 'HIGH_ERROR_RATE',
        severity: 'WARNING',
        chain,
        message: `Chain ${chain} has elevated error rate: ${Math.round(chainHealth.errorRate * 100)}%`,
        metric: 'error_rate',
        value: chainHealth.errorRate,
        threshold: 0.1
      });
      triggered++;
    } else {
      await autoResolveAlert(errorFingerprint);
      resolved++;
    }
  }
  
  return { triggered, resolved };
}

// ============================================
// Queries
// ============================================

/**
 * Get active alerts
 */
export async function getActiveAlerts(): Promise<ISystemAlertDocument[]> {
  return SystemAlertModel.find({ status: 'ACTIVE' })
    .sort({ severity: -1, triggeredAt: -1 })
    .lean();
}

/**
 * Get alerts by severity
 */
export async function getAlertsBySeverity(severity: AlertSeverity): Promise<ISystemAlertDocument[]> {
  return SystemAlertModel.find({ severity, status: 'ACTIVE' })
    .sort({ triggeredAt: -1 })
    .lean();
}

/**
 * Get alerts for chain
 */
export async function getAlertsForChain(chain: string): Promise<ISystemAlertDocument[]> {
  return SystemAlertModel.find({ chain: chain.toUpperCase(), status: 'ACTIVE' })
    .sort({ triggeredAt: -1 })
    .lean();
}

/**
 * Get alert history
 */
export async function getAlertHistory(limit: number = 100): Promise<ISystemAlertDocument[]> {
  return SystemAlertModel.find({})
    .sort({ triggeredAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get alert statistics
 */
export async function getAlertStats(): Promise<{
  active: { total: number; critical: number; warning: number };
  resolved: number;
  last24h: number;
}> {
  const [active, resolved, last24h] = await Promise.all([
    SystemAlertModel.aggregate([
      { $match: { status: 'ACTIVE' } },
      { $group: { _id: '$severity', count: { $sum: 1 } } }
    ]),
    SystemAlertModel.countDocuments({ status: 'RESOLVED' }),
    SystemAlertModel.countDocuments({
      triggeredAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    })
  ]);
  
  const activeCounts = active.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {} as Record<string, number>);
  
  return {
    active: {
      total: (activeCounts['CRITICAL'] || 0) + (activeCounts['WARNING'] || 0) + (activeCounts['INFO'] || 0),
      critical: activeCounts['CRITICAL'] || 0,
      warning: activeCounts['WARNING'] || 0
    },
    resolved,
    last24h
  };
}
