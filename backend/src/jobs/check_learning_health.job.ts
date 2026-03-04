/**
 * Learning Health Check Job (Phase 12C)
 * 
 * Runs every 5 minutes to monitor learning system health.
 */
import { checkDriftGuard, calculateHealthScore, getEffectiveLearningRate } from '../core/learning_control/learning_control.service.js';

let lastRunAt: Date | null = null;
let lastResult = {
  healthScore: 1.0,
  maxDrift: 0,
  frozenWeights: 0,
  effectiveLearningRate: 0,
  warnings: [] as string[],
  duration: 0,
};

export async function checkLearningHealth(): Promise<typeof lastResult> {
  const start = Date.now();
  
  const [driftCheck, healthScore, lr] = await Promise.all([
    checkDriftGuard(),
    calculateHealthScore(),
    getEffectiveLearningRate(),
  ]);
  
  lastRunAt = new Date();
  lastResult = {
    healthScore,
    maxDrift: driftCheck.maxDrift,
    frozenWeights: driftCheck.frozenWeights,
    effectiveLearningRate: lr,
    warnings: driftCheck.warnings,
    duration: Date.now() - start,
  };
  
  // Log warnings
  for (const warning of driftCheck.warnings) {
    console.log(`[Learning Health] WARNING: ${warning}`);
  }
  
  return lastResult;
}

export function getLearningHealthStatus() {
  return {
    lastRunAt,
    lastResult,
  };
}
