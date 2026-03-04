/**
 * Learning Control Service (Phase 12C)
 * 
 * Manages learning stability, drift guards, and safety controls.
 */
import { LearningControlModel, ILearningControl, calculateEffectiveLearningRate } from './learning_control.model.js';
import { LegacyAccessLogModel, logLegacyAccess, getLegacyAccessStats } from './legacy_access_log.model.js';
import { AdaptiveWeightModel } from '../adaptive/adaptive_weights.model.js';
import { env, ADAPTIVE_VERSION } from '../../config/env.js';

// Re-export for convenience
export { logLegacyAccess, getLegacyAccessStats };

// ========== LEARNING CONTROL ==========

/**
 * Get or create global learning control
 */
export async function getOrCreateLearningControl(controlId: string = 'global'): Promise<ILearningControl> {
  let control = await LearningControlModel.findOne({ controlId });
  
  if (!control) {
    control = new LearningControlModel({
      controlId,
      baseLearningRate: env.ADAPTIVE_LEARNING_RATE,
      effectiveLearningRate: env.ADAPTIVE_LEARNING_RATE,
      driftThreshold: env.ADAPTIVE_WEIGHT_CORRIDOR,
      confidenceFloor: env.CONFIDENCE_FLOOR,
    });
    await control.save();
  }
  
  return control;
}

/**
 * Check drift and potentially freeze learning
 * Returns true if system is in a healthy state
 */
export async function checkDriftGuard(): Promise<{
  healthy: boolean;
  maxDrift: number;
  frozenWeights: number;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const control = await getOrCreateLearningControl();
  
  // Get current drift stats
  const driftStats = await AdaptiveWeightModel.aggregate([
    {
      $group: {
        _id: null,
        maxDrift: { $max: { $abs: '$driftFromBase' } },
        avgDrift: { $avg: { $abs: '$driftFromBase' } },
        frozen: { $sum: { $cond: ['$frozen', 1, 0] } },
        total: { $sum: 1 },
      },
    },
  ]);
  
  const stats = driftStats[0] || { maxDrift: 0, avgDrift: 0, frozen: 0, total: 0 };
  
  // Update control with current drift
  control.currentMaxDrift = stats.maxDrift;
  control.driftFreezeCount = stats.frozen;
  
  // Check if drift exceeds threshold
  if (stats.maxDrift > control.driftThreshold) {
    warnings.push(`Max drift ${stats.maxDrift.toFixed(3)} exceeds threshold ${control.driftThreshold}`);
    
    if (control.status === 'active') {
      control.status = 'degraded';
      control.statusReason = `Drift guard triggered: max drift ${stats.maxDrift.toFixed(3)}`;
      control.statusChangedAt = new Date();
    }
  }
  
  // Check frozen ratio
  if (stats.total > 0 && stats.frozen / stats.total > 0.2) {
    warnings.push(`${((stats.frozen / stats.total) * 100).toFixed(0)}% of weights are frozen`);
  }
  
  control.lastHealthCheck = new Date();
  await control.save();
  
  return {
    healthy: control.status === 'active',
    maxDrift: stats.maxDrift,
    frozenWeights: stats.frozen,
    warnings,
  };
}

/**
 * Freeze all learning
 */
export async function freezeLearning(reason: string, by?: string): Promise<ILearningControl> {
  const control = await getOrCreateLearningControl();
  
  control.status = 'frozen';
  control.statusReason = reason;
  control.statusChangedAt = new Date();
  control.totalFreezeEvents += 1;
  control.lastFreezeAt = new Date();
  control.effectiveLearningRate = 0;
  
  if (by) {
    control.manualOverrideAt = new Date();
    control.manualOverrideBy = by;
  }
  
  await control.save();
  
  console.log(`[Learning Control] FROZEN: ${reason}`);
  return control;
}

/**
 * Unfreeze learning (resume)
 */
export async function unfreezeLearning(by?: string): Promise<ILearningControl> {
  const control = await getOrCreateLearningControl();
  
  control.status = 'active';
  control.statusReason = by ? `Unfrozen by ${by}` : 'Unfrozen';
  control.statusChangedAt = new Date();
  control.effectiveLearningRate = control.baseLearningRate;
  
  if (by) {
    control.manualOverrideAt = new Date();
    control.manualOverrideBy = by;
  }
  
  await control.save();
  
  console.log(`[Learning Control] UNFROZEN`);
  return control;
}

/**
 * Reset all adaptive weights to base values
 */
export async function resetAdaptiveWeights(): Promise<{ reset: number; unfrozen: number }> {
  const result = await AdaptiveWeightModel.updateMany(
    {},
    [
      {
        $set: {
          currentWeight: '$baseWeight',
          driftFromBase: 0,
          cumulativeDrift: 1,
          driftDirection: 'stable',
          frozen: false,
          frozenAt: null,
          frozenReason: null,
          hitBoundaryCount: 0,
          adjustmentHistory: [],
        },
      },
    ]
  );
  
  // Reset control status
  const control = await getOrCreateLearningControl();
  control.status = 'active';
  control.statusReason = 'Weights reset';
  control.statusChangedAt = new Date();
  control.currentMaxDrift = 0;
  control.driftFreezeCount = 0;
  await control.save();
  
  console.log(`[Learning Control] RESET: ${result.modifiedCount} weights reset`);
  
  return {
    reset: result.modifiedCount,
    unfrozen: result.modifiedCount,
  };
}

/**
 * Calculate system health score
 */
export async function calculateHealthScore(): Promise<number> {
  const control = await getOrCreateLearningControl();
  
  // Base health
  let health = 1.0;
  
  // Penalize for frozen status
  if (control.status === 'frozen') health *= 0.5;
  if (control.status === 'degraded') health *= 0.7;
  
  // Penalize for high drift
  if (control.currentMaxDrift > 0) {
    const driftPenalty = Math.min(1, control.currentMaxDrift / control.driftThreshold);
    health *= (1 - driftPenalty * 0.3);
  }
  
  // Penalize for frozen weights
  if (control.driftFreezeCount > 0) {
    const totalWeights = await AdaptiveWeightModel.countDocuments();
    if (totalWeights > 0) {
      const frozenRatio = control.driftFreezeCount / totalWeights;
      health *= (1 - frozenRatio * 0.5);
    }
  }
  
  // Update
  control.healthScore = Math.max(0, Math.min(1, health));
  control.lastHealthCheck = new Date();
  await control.save();
  
  return control.healthScore;
}

/**
 * Get effective learning rate considering all factors
 */
export async function getEffectiveLearningRate(): Promise<number> {
  const control = await getOrCreateLearningControl();
  
  if (control.status === 'frozen') return 0;
  
  // Calculate age-based decay
  const createdAt = control.createdAt || new Date();
  const ageInDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  
  const decayedLR = calculateEffectiveLearningRate(
    control.baseLearningRate,
    ageInDays,
    control.learningRateHalfLife
  );
  
  // Apply min/max bounds
  const bounded = Math.max(
    env.ADAPTIVE_LEARNING_RATE_MIN,
    Math.min(env.ADAPTIVE_LEARNING_RATE_MAX, decayedLR)
  );
  
  // Apply health factor
  const finalLR = bounded * control.healthScore;
  
  // Update stored value
  control.effectiveLearningRate = finalLR;
  await control.save();
  
  return finalLR;
}

// ========== STATS ==========

/**
 * Get learning control stats
 */
export async function getLearningControlStats() {
  const control = await getOrCreateLearningControl();
  const legacyStats = await getLegacyAccessStats();
  
  return {
    status: control.status,
    statusReason: control.statusReason,
    healthScore: control.healthScore,
    learningRate: {
      base: control.baseLearningRate,
      effective: control.effectiveLearningRate,
      decayFactor: control.learningRateDecayFactor,
      halfLife: control.learningRateHalfLife,
    },
    driftGuard: {
      threshold: control.driftThreshold,
      currentMaxDrift: control.currentMaxDrift,
      frozenWeights: control.driftFreezeCount,
    },
    safety: {
      confidenceFloor: control.confidenceFloor,
      totalFreezeEvents: control.totalFreezeEvents,
      lastFreezeAt: control.lastFreezeAt,
    },
    legacyAccess: legacyStats,
    adaptiveVersion: ADAPTIVE_VERSION,
  };
}
