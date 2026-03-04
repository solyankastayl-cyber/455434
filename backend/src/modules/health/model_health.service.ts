/**
 * P5-FINAL B: Drift Guard Service (Model Health)
 * 
 * Monitors model health and grades versions:
 * - HEALTHY: model performing normally
 * - DEGRADED: model showing signs of drift  
 * - CRITICAL: model significantly underperforming
 * 
 * Self-protecting: can trigger confidence reduction and governance freeze.
 */

import { getMongoDb } from '../../db/mongoose.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type HealthGrade = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
export type Scope = 'BTC' | 'SPX' | 'DXY' | 'CROSS_ASSET';

export interface HealthThresholds {
  minSamplesForGrading: number;      // Default: 10
  minSamplesForCritical: number;     // Default: 20
  hitRateDegraded: number;           // Default: 0.45 (45%)
  hitRateCritical: number;           // Default: 0.35 (35%)
  avgAbsErrorDegraded: number;       // Default: 5.0 (5%)
  avgAbsErrorCritical: number;       // Default: 10.0 (10%)
  consecutiveWindowsForCritical: number; // Default: 3
}

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  minSamplesForGrading: 10,
  minSamplesForCritical: 20,
  hitRateDegraded: 0.45,
  hitRateCritical: 0.35,
  avgAbsErrorDegraded: 5.0,
  avgAbsErrorCritical: 10.0,
  consecutiveWindowsForCritical: 3,
};

export interface ModelHealthState {
  scope: Scope;
  activeVersionId: string;
  grade: HealthGrade;
  reasons: string[];
  metrics: {
    hitRate: number;
    sampleCount: number;
    avgError: number;
    avgAbsError: number;
    p50AbsError: number;
    p90AbsError: number;
  };
  consecutiveDegradedWindows: number;
  computedAt: Date;
  thresholdsUsed: HealthThresholds;
}

export interface HealthCheckResult {
  ok: boolean;
  scope: Scope;
  state: ModelHealthState;
  previousGrade?: HealthGrade;
  gradeChanged: boolean;
}

// ═══════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════

async function getDb() {
  return getMongoDb();
}

export const HealthStore = {
  async getState(scope: Scope): Promise<ModelHealthState | null> {
    const db = await getDb();
    return db.collection('model_health_state').findOne(
      { scope },
      { projection: { _id: 0 } }
    ) as Promise<ModelHealthState | null>;
  },
  
  async saveState(state: ModelHealthState): Promise<void> {
    const db = await getDb();
    await db.collection('model_health_state').updateOne(
      { scope: state.scope },
      { $set: state },
      { upsert: true }
    );
  },
  
  async getThresholds(scope: Scope): Promise<HealthThresholds> {
    const db = await getDb();
    const config = await db.collection('model_config').findOne({ asset: scope });
    return {
      ...DEFAULT_THRESHOLDS,
      ...(config?.healthThresholds || {}),
    };
  },
  
  async getAllStates(): Promise<ModelHealthState[]> {
    const db = await getDb();
    return db.collection('model_health_state').find(
      {},
      { projection: { _id: 0 } }
    ).toArray() as Promise<ModelHealthState[]>;
  },
};

// ═══════════════════════════════════════════════════════════════
// DRIFT METRICS FETCHER
// ═══════════════════════════════════════════════════════════════

interface DriftMetrics {
  hitRate: number;
  sampleCount: number;
  avgError: number;
  avgAbsError: number;
  p50AbsError: number;
  p90AbsError: number;
}

async function getDriftMetrics(scope: Scope, versionId?: string): Promise<DriftMetrics> {
  const db = await getDb();
  
  const match: any = { asset: scope };
  if (versionId) match.versionId = versionId;
  
  const outcomes = await db.collection('decision_outcomes').find(match).toArray();
  
  if (outcomes.length === 0) {
    return {
      hitRate: 1,
      sampleCount: 0,
      avgError: 0,
      avgAbsError: 0,
      p50AbsError: 0,
      p90AbsError: 0,
    };
  }
  
  const hits = outcomes.filter((o: any) => o.directionHit).length;
  const errors = outcomes.map((o: any) => o.errorPct || 0);
  const absErrors = outcomes.map((o: any) => o.absErrorPct || Math.abs(o.errorPct || 0)).sort((a, b) => a - b);
  
  const percentile = (arr: number[], p: number) => {
    if (arr.length === 0) return 0;
    const idx = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, Math.min(idx, arr.length - 1))];
  };
  
  return {
    hitRate: hits / outcomes.length,
    sampleCount: outcomes.length,
    avgError: errors.reduce((a, b) => a + b, 0) / errors.length,
    avgAbsError: absErrors.reduce((a, b) => a + b, 0) / absErrors.length,
    p50AbsError: percentile(absErrors, 50),
    p90AbsError: percentile(absErrors, 90),
  };
}

async function getActiveVersion(scope: Scope): Promise<string | null> {
  const db = await getDb();
  const state = await db.collection('model_lifecycle_state').findOne({ asset: scope });
  return state?.activeVersion || null;
}

// ═══════════════════════════════════════════════════════════════
// GRADE CALCULATOR
// ═══════════════════════════════════════════════════════════════

function calculateGrade(
  metrics: DriftMetrics,
  thresholds: HealthThresholds,
  previousConsecutiveDegraded: number
): { grade: HealthGrade; reasons: string[] } {
  const reasons: string[] = [];
  
  // Insufficient samples gate
  if (metrics.sampleCount < thresholds.minSamplesForGrading) {
    reasons.push(`INSUFFICIENT_SAMPLES (${metrics.sampleCount} < ${thresholds.minSamplesForGrading})`);
    return { grade: 'HEALTHY', reasons };
  }
  
  // Check for CRITICAL first
  if (metrics.sampleCount >= thresholds.minSamplesForCritical) {
    if (metrics.hitRate < thresholds.hitRateCritical) {
      reasons.push(`HIT_RATE_CRITICAL (${(metrics.hitRate * 100).toFixed(1)}% < ${thresholds.hitRateCritical * 100}%)`);
      return { grade: 'CRITICAL', reasons };
    }
    
    if (metrics.avgAbsError > thresholds.avgAbsErrorCritical) {
      reasons.push(`AVG_ABS_ERROR_CRITICAL (${metrics.avgAbsError.toFixed(2)}% > ${thresholds.avgAbsErrorCritical}%)`);
      return { grade: 'CRITICAL', reasons };
    }
    
    // Consecutive degraded windows
    if (previousConsecutiveDegraded >= thresholds.consecutiveWindowsForCritical) {
      reasons.push(`CONSECUTIVE_DEGRADED_WINDOWS (${previousConsecutiveDegraded} >= ${thresholds.consecutiveWindowsForCritical})`);
      return { grade: 'CRITICAL', reasons };
    }
  }
  
  // Check for DEGRADED
  if (metrics.hitRate < thresholds.hitRateDegraded) {
    reasons.push(`HIT_RATE_DEGRADED (${(metrics.hitRate * 100).toFixed(1)}% < ${thresholds.hitRateDegraded * 100}%)`);
    return { grade: 'DEGRADED', reasons };
  }
  
  if (metrics.avgAbsError > thresholds.avgAbsErrorDegraded) {
    reasons.push(`AVG_ABS_ERROR_DEGRADED (${metrics.avgAbsError.toFixed(2)}% > ${thresholds.avgAbsErrorDegraded}%)`);
    return { grade: 'DEGRADED', reasons };
  }
  
  // HEALTHY
  reasons.push('ALL_METRICS_WITHIN_THRESHOLDS');
  return { grade: 'HEALTHY', reasons };
}

// ═══════════════════════════════════════════════════════════════
// MAIN HEALTH CHECK
// ═══════════════════════════════════════════════════════════════

/**
 * Compute health for a specific scope
 * P5.2: Records HEALTH_TRANSITION events in timeline
 */
export async function computeHealth(scope: Scope): Promise<HealthCheckResult> {
  const db = await getDb();
  const thresholds = await HealthStore.getThresholds(scope);
  const activeVersion = await getActiveVersion(scope);
  const previousState = await HealthStore.getState(scope);
  
  // Get metrics for active version
  const metrics = await getDriftMetrics(scope, activeVersion || undefined);
  
  // Calculate grade
  const previousConsecutive = previousState?.grade === 'DEGRADED' 
    ? (previousState.consecutiveDegradedWindows || 0) 
    : 0;
  
  const { grade, reasons } = calculateGrade(metrics, thresholds, previousConsecutive);
  
  // Update consecutive counter
  let consecutiveDegradedWindows = 0;
  if (grade === 'DEGRADED') {
    consecutiveDegradedWindows = previousConsecutive + 1;
  }
  
  // Build new state
  const newState: ModelHealthState = {
    scope,
    activeVersionId: activeVersion || 'unknown',
    grade,
    reasons,
    metrics: {
      hitRate: Math.round(metrics.hitRate * 10000) / 10000,
      sampleCount: metrics.sampleCount,
      avgError: Math.round(metrics.avgError * 100) / 100,
      avgAbsError: Math.round(metrics.avgAbsError * 100) / 100,
      p50AbsError: Math.round(metrics.p50AbsError * 100) / 100,
      p90AbsError: Math.round(metrics.p90AbsError * 100) / 100,
    },
    consecutiveDegradedWindows,
    computedAt: new Date(),
    thresholdsUsed: thresholds,
  };
  
  // Save state
  await HealthStore.saveState(newState);
  
  const gradeChanged = previousState?.grade !== grade;
  
  // P5.2: Record HEALTH_TRANSITION event in timeline if grade changed
  if (gradeChanged && previousState?.grade) {
    try {
      await db.collection('model_lifecycle_events').insertOne({
        asset: scope,
        type: 'HEALTH_TRANSITION',
        at: new Date(),
        fromGrade: previousState.grade,
        toGrade: grade,
        metrics: {
          hitRate: Math.round(metrics.hitRate * 10000) / 10000,
          avgAbsError: Math.round(metrics.avgAbsError * 100) / 100,
          sampleCount: metrics.sampleCount,
        },
        reasons,
        activeVersion: activeVersion || 'unknown',
        createdAt: new Date(),
      });
      console.log(`[DriftGuard] HEALTH_TRANSITION recorded: ${scope} ${previousState.grade} → ${grade}`);
    } catch (err) {
      console.error(`[DriftGuard] Failed to record HEALTH_TRANSITION:`, err);
    }
  }
  
  if (gradeChanged) {
    console.log(`[DriftGuard] ${scope} grade changed: ${previousState?.grade || 'NONE'} → ${grade}`);
  }
  
  return {
    ok: true,
    scope,
    state: newState,
    previousGrade: previousState?.grade,
    gradeChanged,
  };
}

/**
 * Compute health for all scopes
 */
export async function computeAllHealth(): Promise<HealthCheckResult[]> {
  const scopes: Scope[] = ['BTC', 'SPX', 'DXY', 'CROSS_ASSET'];
  const results: HealthCheckResult[] = [];
  
  for (const scope of scopes) {
    const result = await computeHealth(scope);
    results.push(result);
  }
  
  return results;
}

/**
 * Get confidence modifier based on health grade
 */
export function getConfidenceModifier(grade: HealthGrade): number {
  switch (grade) {
    case 'HEALTHY': return 1.0;
    case 'DEGRADED': return 0.6;
    case 'CRITICAL': return 0.3;
    default: return 1.0;
  }
}

/**
 * Check if governance is frozen (CRITICAL state)
 */
export async function isGovernanceFrozen(scope: Scope): Promise<{ frozen: boolean; reason?: string }> {
  const state = await HealthStore.getState(scope);
  
  if (state?.grade === 'CRITICAL') {
    return { 
      frozen: true, 
      reason: `Model health is CRITICAL: ${state.reasons.join(', ')}` 
    };
  }
  
  return { frozen: false };
}

export default {
  computeHealth,
  computeAllHealth,
  getConfidenceModifier,
  isGovernanceFrozen,
  HealthStore,
};
