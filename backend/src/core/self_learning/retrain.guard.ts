/**
 * Retrain Guard
 * 
 * ETAP 5.1: Centralized guard logic for retraining decisions.
 * 
 * Retrain is ALLOWED only if ALL conditions pass:
 * - ML Ready = READY or CONDITIONAL
 * - Drift != CRITICAL
 * - New samples >= MIN_SAMPLES
 * - Cooldown passed (days since last retrain)
 * - Dataset integrity verified
 */
import { SelfLearningRuntimeModel } from './self_learning.runtime.model.js';
import { DatasetVersionModel } from './dataset_version.model.js';
import { countNewSamplesSinceDataset } from './dataset_freezer.service.js';
import { SELF_LEARNING_CONSTANTS } from './self_learning.types.js';
import type { Horizon, GuardCheckResult, GuardDecision, DriftLevel } from './self_learning.types.js';

// ==================== EXTERNAL DEPENDENCIES ====================

// Import from existing services
import { getShadowMLStatus } from '../learning/shadow_ml/shadow_ml.service.js';

/**
 * Get current drift level for horizon
 * Returns worst drift across all tokens
 */
async function getCurrentDriftLevel(horizon: Horizon): Promise<DriftLevel> {
  // Import drift service
  try {
    const { getDriftStats } = await import('../live/drift/drift.service.js');
    const stats = await getDriftStats();
    
    // Return worst drift level
    if (stats.byLevel?.CRITICAL > 0) return 'CRITICAL';
    if (stats.byLevel?.HIGH > 0) return 'HIGH';
    if (stats.byLevel?.MEDIUM > 0) return 'MEDIUM';
    return 'LOW';
  } catch {
    // If drift service not available, assume LOW
    return 'LOW';
  }
}

/**
 * Get ML Ready status
 */
async function getMLReadyStatus(): Promise<string> {
  try {
    const status = await getShadowMLStatus();
    if (status.available && status.models?.['7d']?.ready) {
      return 'READY';
    }
    return 'NOT_READY';
  } catch {
    return 'NOT_READY';
  }
}

// ==================== GUARD CHECKS ====================

/**
 * Check if ML system is ready
 */
async function checkMLReady(): Promise<{
  passed: boolean;
  value: string;
  reason?: string;
}> {
  const status = await getMLReadyStatus();
  const passed = status === 'READY' || status === 'CONDITIONAL';
  
  return {
    passed,
    value: status,
    reason: passed ? undefined : `ML not ready: ${status}`,
  };
}

/**
 * Check drift level
 */
async function checkDrift(horizon: Horizon): Promise<{
  passed: boolean;
  value: DriftLevel;
  reason?: string;
}> {
  const driftLevel = await getCurrentDriftLevel(horizon);
  const passed = driftLevel !== 'CRITICAL';
  
  return {
    passed,
    value: driftLevel,
    reason: passed ? undefined : 'Drift is CRITICAL - retrain blocked',
  };
}

/**
 * Check new samples count
 */
async function checkNewSamples(
  horizon: Horizon,
  minRequired: number
): Promise<{
  passed: boolean;
  value: number;
  required: number;
  reason?: string;
}> {
  // Get latest dataset version
  const latestDataset = await DatasetVersionModel.findLatestFrozen(horizon);
  const lastVersion = latestDataset?.datasetVersion;
  
  // Count new samples since last dataset
  const newSamples = await countNewSamplesSinceDataset(horizon, lastVersion || undefined);
  const passed = newSamples >= minRequired;
  
  return {
    passed,
    value: newSamples,
    required: minRequired,
    reason: passed ? undefined : `Insufficient new samples: ${newSamples} < ${minRequired}`,
  };
}

/**
 * Check cooldown period
 */
async function checkCooldown(cooldownDays: number): Promise<{
  passed: boolean;
  daysSinceLast: number;
  required: number;
  reason?: string;
}> {
  const config = await SelfLearningRuntimeModel.getConfig();
  const lastRetrain = config.lastRetrainAt;
  
  if (!lastRetrain) {
    // Never retrained - cooldown passed
    return {
      passed: true,
      daysSinceLast: Infinity,
      required: cooldownDays,
    };
  }
  
  const daysSinceLast = Math.floor(
    (Date.now() - lastRetrain.getTime()) / (1000 * 60 * 60 * 24)
  );
  const passed = daysSinceLast >= cooldownDays;
  
  return {
    passed,
    daysSinceLast,
    required: cooldownDays,
    reason: passed ? undefined : `Cooldown not passed: ${daysSinceLast} < ${cooldownDays} days`,
  };
}

/**
 * Check dataset integrity
 */
async function checkDatasetIntegrity(horizon: Horizon): Promise<{
  passed: boolean;
  reason?: string;
}> {
  // Basic check - ensure we have training samples
  const { LearningSampleModel } = await import('../learning/dataset/learning_sample.model.js');
  
  const count = await LearningSampleModel.countDocuments({
    'quality.trainEligible': true,
    [`labels.verdicts.verdict_${horizon}`]: { $exists: true, $ne: null },
  });
  
  if (count === 0) {
    return {
      passed: false,
      reason: 'No training samples available',
    };
  }
  
  return { passed: true };
}

// ==================== MAIN GUARD ====================

/**
 * Run all guard checks
 * 
 * Returns comprehensive result with:
 * - Overall decision (ALLOW/DENY)
 * - Individual check results
 * - List of blockers
 */
export async function canRetrain(horizon: Horizon): Promise<GuardCheckResult> {
  const config = await SelfLearningRuntimeModel.getConfig();
  
  // Run all checks in parallel
  const [mlReady, drift, newSamples, cooldown, datasetIntegrity] = await Promise.all([
    checkMLReady(),
    checkDrift(horizon),
    checkNewSamples(horizon, config.minNewSamples),
    checkCooldown(config.cooldownDays),
    checkDatasetIntegrity(horizon),
  ]);
  
  // Collect blockers
  const blockedBy: string[] = [];
  if (!mlReady.passed) blockedBy.push('mlReady');
  if (!drift.passed) blockedBy.push('drift');
  if (!newSamples.passed) blockedBy.push('newSamples');
  if (!cooldown.passed) blockedBy.push('cooldown');
  if (!datasetIntegrity.passed) blockedBy.push('datasetIntegrity');
  
  // Overall decision
  const decision: GuardDecision = blockedBy.length === 0 ? 'ALLOW' : 'DENY';
  
  return {
    decision,
    checks: {
      mlReady,
      drift,
      newSamples,
      cooldown,
      datasetIntegrity,
    },
    blockedBy,
    checkedAt: new Date(),
  };
}

/**
 * Quick check - just returns ALLOW/DENY
 */
export async function canRetrainQuick(horizon: Horizon): Promise<boolean> {
  const result = await canRetrain(horizon);
  return result.decision === 'ALLOW';
}

/**
 * Format guard result for logging
 */
export function formatGuardResult(result: GuardCheckResult): string {
  const lines = [
    `Guard Decision: ${result.decision}`,
    `Checked at: ${result.checkedAt.toISOString()}`,
    '',
    'Checks:',
    `  ML Ready: ${result.checks.mlReady.passed ? '✓' : '✗'} (${result.checks.mlReady.value})`,
    `  Drift: ${result.checks.drift.passed ? '✓' : '✗'} (${result.checks.drift.value})`,
    `  New Samples: ${result.checks.newSamples.passed ? '✓' : '✗'} (${result.checks.newSamples.value}/${result.checks.newSamples.required})`,
    `  Cooldown: ${result.checks.cooldown.passed ? '✓' : '✗'} (${result.checks.cooldown.daysSinceLast}/${result.checks.cooldown.required} days)`,
    `  Dataset: ${result.checks.datasetIntegrity.passed ? '✓' : '✗'}`,
  ];
  
  if (result.blockedBy.length > 0) {
    lines.push('');
    lines.push(`Blocked by: ${result.blockedBy.join(', ')}`);
  }
  
  return lines.join('\n');
}

/**
 * Get guard status for API
 */
export async function getGuardStatus(horizon: Horizon): Promise<{
  canRetrain: boolean;
  checks: GuardCheckResult;
  formatted: string;
}> {
  const checks = await canRetrain(horizon);
  return {
    canRetrain: checks.decision === 'ALLOW',
    checks,
    formatted: formatGuardResult(checks),
  };
}
