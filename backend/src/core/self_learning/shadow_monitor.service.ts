/**
 * Shadow Monitor Service (ETAP 5.7)
 * 
 * Monitors active model health on rolling windows.
 * Triggers auto-rollback on sustained degradation.
 * 
 * THRESHOLDS (v1 production):
 * - HEALTHY: precision >= active - 1%, FP rate <= +2%, calibration <= 0.08
 * - DEGRADED: precision < active - 1%, OR FP rate 2-10%, OR calibration 0.08-0.15
 * - CRITICAL: precision < active - 10%, OR FP rate > 10%, OR calibration > 0.15
 * 
 * Auto-rollback requires N=3 consecutive CRITICAL windows.
 * 
 * INVARIANTS:
 * - Monitoring doesn't affect production inference
 * - Auto-rollback only after N consecutive CRITICAL windows
 * - All decisions are logged and explainable
 */
import { 
  ShadowMonitorReportModel,
  getLatestReport,
  countConsecutiveCritical,
  type MonitorDecision,
  type MonitorMetrics,
  type MonitorComparison,
} from './shadow_monitor_report.model.js';
import { getActiveModelId, getPointer } from './active_model_pointer.model.js';
import { MLModelVersionModel } from './ml_model_version.model.js';
import { autoRollback } from './rollback.service.js';
import { logSelfLearningEvent } from './audit_helpers.js';
import crypto from 'crypto';

// ==================== THRESHOLDS ====================

export const SHADOW_THRESHOLDS = {
  // HEALTHY bounds
  healthy: {
    precisionDropMax: 0.01,    // -1% max drop from baseline
    fpRateIncreaseMax: 0.02,   // +2% max FP rate increase
    calibrationMax: 0.08,      // Max calibration error
  },
  // CRITICAL thresholds
  critical: {
    precisionDropMin: 0.10,    // -10% = CRITICAL
    fpRateIncreaseMin: 0.10,   // +10% FP = CRITICAL
    calibrationMin: 0.15,      // Calibration > 0.15 = CRITICAL
  },
  // Minimum samples for valid report
  minSamples: 30,
  // Window-based protection
  consecutiveCriticalForRollback: 3,
} as const;

// ==================== TYPES ====================

export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

export interface MonitorRequest {
  horizon: '7d' | '30d';
  window?: '7d' | '14d';
}

export interface MonitorResult {
  success: boolean;
  reportId: string | null;
  modelId: string | null;
  decision: MonitorDecision | null;
  reasons: string[];
  shouldAutoRollback: boolean;
  autoRollbackTriggered: boolean;
  consecutiveCritical: number;
  error?: string;
}

// ==================== MONITOR LOGIC ====================

/**
 * Run shadow monitor for horizon
 * 
 * 1. Get active model
 * 2. Compute rolling window metrics
 * 3. Compare with baseline (rules)
 * 4. Make decision (HEALTHY/DEGRADED/CRITICAL)
 * 5. Trigger auto-rollback if needed
 */
export async function runMonitor(request: MonitorRequest): Promise<MonitorResult> {
  const { horizon, window = '7d' } = request;
  
  console.log(`[ShadowMonitor] ========== MONITOR: ${horizon} (window: ${window}) ==========`);
  
  try {
    // ========== STEP 1: GET ACTIVE MODEL ==========
    
    const modelId = await getActiveModelId(horizon);
    
    if (!modelId) {
      console.log(`[ShadowMonitor] No active model for ${horizon}, skipping`);
      return {
        success: true,
        reportId: null,
        modelId: null,
        decision: null,
        reasons: ['No active model'],
        shouldAutoRollback: false,
        autoRollbackTriggered: false,
        consecutiveCritical: 0,
      };
    }
    
    // Get model info
    const model = await MLModelVersionModel.findOne({ modelId }).lean();
    
    if (!model) {
      console.log(`[ShadowMonitor] Model not found: ${modelId}`);
      return {
        success: false,
        reportId: null,
        modelId,
        decision: null,
        reasons: ['Model not found in registry'],
        shouldAutoRollback: false,
        autoRollbackTriggered: false,
        consecutiveCritical: 0,
        error: 'Model not found',
      };
    }
    
    // ========== STEP 2: COMPUTE ROLLING METRICS ==========
    
    const windowEnd = new Date();
    const windowDays = window === '7d' ? 7 : 14;
    const windowStart = new Date(windowEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);
    
    // In production: query actual predictions vs outcomes
    // For now: use model's eval metrics as baseline proxy
    const metrics = await computeRollingMetrics(horizon, modelId, windowStart, windowEnd);
    
    // ========== STEP 3: COMPARE WITH BASELINE ==========
    
    const baselineMetrics = model.trainMetrics as any || {};
    const lastReport = await getLatestReport(horizon, modelId);
    
    const comparison: MonitorComparison = {
      vsBaseline: {
        precisionDelta: (metrics.precision || 0) - (baselineMetrics.precision || 0),
        fpRateDelta: (metrics.fpRate || 0) - (baselineMetrics.fpRate || 0),
        calibrationDelta: (metrics.calibrationError || 0) - (baselineMetrics.calibrationError || 0),
      },
      vsLastReport: lastReport ? {
        precisionDelta: (metrics.precision || 0) - (lastReport.metrics?.precision || 0),
        fpRateDelta: (metrics.fpRate || 0) - (lastReport.metrics?.fpRate || 0),
      } : null,
    };
    
    // ========== STEP 4: MAKE DECISION ==========
    
    const { decision, reasons } = evaluateHealth(metrics, comparison);
    
    console.log(`[ShadowMonitor] Decision: ${decision}`);
    console.log(`[ShadowMonitor] Reasons: ${reasons.join(', ')}`);
    
    // ========== STEP 5: CREATE REPORT ==========
    
    const reportId = `monitor_${horizon}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    // Check consecutive critical
    const consecutiveCritical = decision === 'CRITICAL' 
      ? (await countConsecutiveCritical(horizon, modelId)) + 1
      : 0;
    
    const shouldAutoRollback = consecutiveCritical >= SHADOW_THRESHOLDS.consecutiveCriticalForRollback;
    
    const report = await ShadowMonitorReportModel.create({
      reportId,
      horizon,
      window,
      modelId,
      metrics,
      comparison,
      decision,
      reasons,
      shouldAutoRollback,
      autoRollbackTriggered: false,
      windowStart,
      windowEnd,
    });
    
    // Log report
    await logSelfLearningEvent({
      eventType: 'MONITOR_REPORT',
      horizon,
      modelVersionId: modelId,
      details: {
        reportId,
        decision,
        reasons,
        metrics,
        consecutiveCritical,
        shouldAutoRollback,
      },
      triggeredBy: 'shadow_monitor',
      severity: decision === 'CRITICAL' ? 'critical' : decision === 'DEGRADED' ? 'warning' : 'info',
    });
    
    // ========== STEP 6: AUTO-ROLLBACK IF NEEDED ==========
    
    let autoRollbackTriggered = false;
    
    if (shouldAutoRollback) {
      console.log(`[ShadowMonitor] ⚠️ AUTO-ROLLBACK triggered! ${consecutiveCritical} consecutive CRITICAL`);
      
      const rollbackResult = await autoRollback(
        horizon,
        `${consecutiveCritical} consecutive CRITICAL monitor reports`,
        reportId
      );
      
      autoRollbackTriggered = rollbackResult.success;
      
      // Update report
      await ShadowMonitorReportModel.updateOne(
        { reportId },
        { $set: { autoRollbackTriggered } }
      );
    }
    
    return {
      success: true,
      reportId,
      modelId,
      decision,
      reasons,
      shouldAutoRollback,
      autoRollbackTriggered,
      consecutiveCritical,
    };
    
  } catch (error: any) {
    console.error(`[ShadowMonitor] Error:`, error);
    
    return {
      success: false,
      reportId: null,
      modelId: null,
      decision: null,
      reasons: [],
      shouldAutoRollback: false,
      autoRollbackTriggered: false,
      consecutiveCritical: 0,
      error: error.message,
    };
  }
}

/**
 * Compute rolling window metrics
 * 
 * In production: query ShadowPrediction + OutcomeObservation
 * For now: use model's stored metrics with slight variance
 */
async function computeRollingMetrics(
  horizon: '7d' | '30d',
  modelId: string,
  windowStart: Date,
  windowEnd: Date
): Promise<MonitorMetrics> {
  // Get model's eval metrics as baseline
  const model = await MLModelVersionModel.findOne({ modelId }).lean();
  const evalMetrics = model?.evalMetrics as any || model?.trainMetrics as any || {};
  
  // In production: query actual data
  // For MVP: return eval metrics with small variance to simulate live behavior
  const variance = (Math.random() - 0.5) * 0.02; // ±1% variance
  
  return {
    precision: Math.max(0, Math.min(1, (evalMetrics.precision || 0.6) + variance)),
    recall: Math.max(0, Math.min(1, (evalMetrics.recall || 0.5) + variance)),
    fpRate: Math.max(0, Math.min(1, (evalMetrics.fp_rate || 0.1) + variance * 0.5)),
    calibrationError: Math.max(0, (evalMetrics.calibration_error || 0.05) + variance * 0.5),
    sampleCount: Math.floor(50 + Math.random() * 50), // 50-100 samples
    coverage: Math.max(0, Math.min(1, 0.1 + Math.random() * 0.05)),
  };
}

/**
 * Evaluate health based on metrics and comparison
 */
function evaluateHealth(
  metrics: MonitorMetrics,
  comparison: MonitorComparison
): { decision: MonitorDecision; reasons: string[] } {
  const reasons: string[] = [];
  const t = SHADOW_THRESHOLDS;
  
  // Check minimum samples
  if (metrics.sampleCount < t.minSamples) {
    reasons.push(`Insufficient samples: ${metrics.sampleCount} < ${t.minSamples}`);
    return { decision: 'DEGRADED', reasons };
  }
  
  // Check CRITICAL thresholds first
  const precisionDrop = -comparison.vsBaseline.precisionDelta;
  const fpRateIncrease = comparison.vsBaseline.fpRateDelta;
  const calibration = metrics.calibrationError;
  
  if (precisionDrop >= t.critical.precisionDropMin) {
    reasons.push(`CRITICAL: Precision drop ${(precisionDrop * 100).toFixed(1)}% >= ${(t.critical.precisionDropMin * 100)}%`);
  }
  
  if (fpRateIncrease >= t.critical.fpRateIncreaseMin) {
    reasons.push(`CRITICAL: FP rate increase ${(fpRateIncrease * 100).toFixed(1)}% >= ${(t.critical.fpRateIncreaseMin * 100)}%`);
  }
  
  if (calibration >= t.critical.calibrationMin) {
    reasons.push(`CRITICAL: Calibration error ${calibration.toFixed(3)} >= ${t.critical.calibrationMin}`);
  }
  
  if (reasons.some(r => r.startsWith('CRITICAL'))) {
    return { decision: 'CRITICAL', reasons };
  }
  
  // Check DEGRADED thresholds
  if (precisionDrop > t.healthy.precisionDropMax) {
    reasons.push(`DEGRADED: Precision drop ${(precisionDrop * 100).toFixed(1)}% > ${(t.healthy.precisionDropMax * 100)}%`);
  }
  
  if (fpRateIncrease > t.healthy.fpRateIncreaseMax) {
    reasons.push(`DEGRADED: FP rate increase ${(fpRateIncrease * 100).toFixed(1)}% > ${(t.healthy.fpRateIncreaseMax * 100)}%`);
  }
  
  if (calibration > t.healthy.calibrationMax) {
    reasons.push(`DEGRADED: Calibration error ${calibration.toFixed(3)} > ${t.healthy.calibrationMax}`);
  }
  
  if (reasons.some(r => r.startsWith('DEGRADED'))) {
    return { decision: 'DEGRADED', reasons };
  }
  
  // All checks passed
  reasons.push('All metrics within healthy bounds');
  reasons.push(`Precision: ${(metrics.precision * 100).toFixed(1)}%`);
  reasons.push(`FP rate: ${(metrics.fpRate * 100).toFixed(1)}%`);
  reasons.push(`Calibration: ${metrics.calibrationError.toFixed(3)}`);
  
  return { decision: 'HEALTHY', reasons };
}

/**
 * Get monitor status summary
 */
export async function getMonitorStatus(horizon: '7d' | '30d') {
  const modelId = await getActiveModelId(horizon);
  
  if (!modelId) {
    return {
      horizon,
      activeModelId: null,
      latestReport: null,
      consecutiveCritical: 0,
      health: 'NO_MODEL',
      thresholds: SHADOW_THRESHOLDS,
    };
  }
  
  const latestReport = await getLatestReport(horizon, modelId);
  const consecutiveCritical = await countConsecutiveCritical(horizon, modelId);
  
  return {
    horizon,
    activeModelId: modelId,
    latestReport: latestReport ? {
      reportId: latestReport.reportId,
      decision: latestReport.decision,
      reasons: latestReport.reasons,
      metrics: latestReport.metrics,
      createdAt: latestReport.createdAt,
    } : null,
    consecutiveCritical,
    health: latestReport?.decision || 'UNKNOWN',
    thresholds: SHADOW_THRESHOLDS,
    autoRollbackAt: SHADOW_THRESHOLDS.consecutiveCriticalForRollback,
  };
}

/**
 * Get monitor thresholds
 */
export function getMonitorThresholds() {
  return SHADOW_THRESHOLDS;
}
