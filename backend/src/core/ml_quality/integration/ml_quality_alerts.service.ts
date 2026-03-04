/**
 * ML Quality Alerts Integration (P0.7)
 * 
 * Generates system alerts for ML quality issues.
 * These alerts BLOCK ML, not inform ML.
 */

import { SystemAlertModel, SystemAlertType, AlertStatus } from '../../system_alerts/system_alert.model.js';
import { GateCheckResult } from '../gates/feature_gates_engine.service.js';
import { BatchDriftResult } from '../drift/feature_distribution_monitor.service.js';
import { BlockReason } from '../storage/feature_coverage.model.js';

// ============================================
// Alert Mapping
// ============================================

// Map our internal types to SystemAlert types
function getAlertType(blockedBy: BlockReason[]): SystemAlertType {
  // All quality gate failures map to ML_GATE_BLOCK
  return 'ML_GATE_BLOCK';
}

// ============================================
// Alert Generation
// ============================================

/**
 * Create alert from gate check result
 */
export async function createGateAlert(
  entityId: string,
  entityType: string,
  result: GateCheckResult
): Promise<void> {
  if (result.decision.allowed) {
    // No alert needed if gates passed
    return;
  }
  
  // Determine severity based on block reasons
  let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM';
  
  const blockedBy = result.decision.blockedBy;
  
  if (blockedBy.includes('LOW_TOTAL_COVERAGE') || blockedBy.includes('LOW_ROUTES_COVERAGE')) {
    severity = blockedBy.length > 2 ? 'HIGH' : 'MEDIUM';
  }
  
  if (blockedBy.includes('STALE_DATA') || blockedBy.includes('STALE_ROUTES_DATA')) {
    severity = 'HIGH';
  }
  
  if (blockedBy.includes('MISSING_CRITICAL_FEATURES')) {
    severity = 'HIGH';
  }
  
  // Create message
  const message = buildAlertMessage(result);
  
  // Check for existing active alert
  const existing = await SystemAlertModel.findOne({
    type: 'ML_GATE_BLOCK',
    'entityRef.entityId': entityId,
    status: { $in: ['OPEN', 'ACKED'] }
  });
  
  if (existing) {
    // Update existing alert
    await SystemAlertModel.updateOne(
      { _id: existing._id },
      {
        $set: {
          severity,
          message,
          'metadata.gateResult': {
            score: result.decision.score,
            blockedBy: result.decision.blockedBy,
            coverage: result.coverageResult.coverage.coverageRatio
          },
          updatedAt: new Date()
        }
      }
    );
    return;
  }
  
  // Create new alert
  await SystemAlertModel.create({
    alertId: `ML_GATE:${entityType}:${entityId.slice(0, 16)}:${Date.now()}`,
    type: 'ML_GATE_BLOCK',
    category: 'ML',
    severity,
    source: 'ml',
    title: `ML Blocked: Quality Gates Failed (${entityType})`,
    message,
    status: 'OPEN',
    entityRef: {
      entityType,
      entityId,
      label: `${entityType}:${entityId.slice(0, 8)}...`
    },
    metadata: {
      gateResult: {
        score: result.decision.score,
        blockedBy: result.decision.blockedBy,
        coverage: result.coverageResult.coverage.coverageRatio,
        missingCritical: result.coverageResult.missingCritical
      }
    },
    createdAt: new Date()
  });
}

/**
 * Create drift alert
 */
export async function createDriftAlert(
  result: BatchDriftResult
): Promise<void> {
  // Only alert on WARN or CRITICAL
  const warnOrCritical = result.alerts.filter(a => 
    a.alertLevel === 'WARN' || a.alertLevel === 'CRITICAL'
  );
  
  if (warnOrCritical.length === 0) {
    return;
  }
  
  const hasCritical = warnOrCritical.some(a => a.alertLevel === 'CRITICAL');
  const severity = hasCritical ? 'HIGH' : 'MEDIUM';
  
  // Create message
  const topAlerts = warnOrCritical.slice(0, 5);
  const message = [
    `Drift detected in ${warnOrCritical.length} features.`,
    `Critical: ${result.summary.critical}, Warning: ${result.summary.warn}`,
    '',
    'Top affected features:',
    ...topAlerts.map(a => `- ${a.feature}: ${a.message}`)
  ].join('\n');
  
  // Check for existing
  const existing = await SystemAlertModel.findOne({
    type: 'ML_DRIFT_HIGH',
    status: { $in: ['OPEN', 'ACKED'] },
    createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } // Last hour
  });
  
  if (existing) {
    // Update existing
    await SystemAlertModel.updateOne(
      { _id: existing._id },
      {
        $set: {
          severity,
          message,
          'metadata.driftSummary': result.summary,
          'metadata.topAlerts': topAlerts,
          updatedAt: new Date()
        }
      }
    );
    return;
  }
  
  // Create new
  await SystemAlertModel.create({
    alertId: `ML_DRIFT:${Date.now()}`,
    type: 'ML_DRIFT_HIGH',
    category: 'ML',
    severity,
    source: 'ml',
    title: 'ML Feature Drift Detected',
    message,
    status: 'OPEN',
    metadata: {
      driftSummary: result.summary,
      featuresAnalyzed: result.featuresAnalyzed,
      topAlerts
    },
    createdAt: new Date()
  });
}

/**
 * Resolve ML quality alerts when gates pass
 */
export async function resolveQualityAlerts(
  entityId: string,
  entityType: string
): Promise<number> {
  const result = await SystemAlertModel.updateMany(
    {
      category: 'ML',
      'entityRef.entityId': entityId,
      'entityRef.entityType': entityType,
      status: { $in: ['OPEN', 'ACKED'] }
    },
    {
      $set: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedBy: 'ml_quality_auto'
      }
    }
  );
  
  return result.modifiedCount;
}

// ============================================
// Helpers
// ============================================

function buildAlertMessage(result: GateCheckResult): string {
  const lines: string[] = [];
  
  lines.push(`Quality Score: ${result.decision.score}/100`);
  lines.push(`Coverage: ${Math.round(result.coverageResult.coverage.coverageRatio * 100)}%`);
  
  if (result.decision.blockedBy.length > 0) {
    lines.push('');
    lines.push('Blocked by:');
    for (const reason of result.decision.blockedBy) {
      lines.push(`- ${formatBlockReason(reason)}`);
    }
  }
  
  if (result.coverageResult.missingCritical.length > 0) {
    lines.push('');
    lines.push('Missing critical features:');
    lines.push(result.coverageResult.missingCritical.join(', '));
  }
  
  return lines.join('\n');
}

function formatBlockReason(reason: BlockReason): string {
  const map: Record<BlockReason, string> = {
    'LOW_TOTAL_COVERAGE': 'Total feature coverage below threshold',
    'LOW_ROUTES_COVERAGE': 'Routes feature coverage too low',
    'LOW_DEX_COVERAGE': 'DEX feature coverage too low',
    'LOW_ACTOR_COVERAGE': 'Actor feature coverage too low',
    'STALE_DATA': 'Data is too old',
    'STALE_ROUTES_DATA': 'Routes data is stale',
    'STALE_DEX_DATA': 'DEX data is stale',
    'STALE_MARKET_DATA': 'Market data is stale',
    'MISSING_CRITICAL_FEATURES': 'Critical features missing',
    'HIGH_NULL_RATIO': 'Too many null values',
    'DRIFT_DETECTED': 'Feature distribution drift detected'
  };
  
  return map[reason] || reason;
}

// Export type for external use
export type MLQualityAlertType = 'ML_GATE_BLOCK' | 'ML_DRIFT_HIGH';
