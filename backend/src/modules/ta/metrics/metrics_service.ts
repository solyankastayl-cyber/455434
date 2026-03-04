/**
 * Phase N4: Metrics Service
 * 
 * Engine health and performance metrics
 */

import { Db } from 'mongodb';

interface MetricsState {
  cacheHits: number;
  cacheMisses: number;
  decisionRuns: number;
  mtfRuns: number;
  errors: number;
  totalLatencyMs: number;
  requestCount: number;
  startedAt: Date;
}

const state: MetricsState = {
  cacheHits: 0,
  cacheMisses: 0,
  decisionRuns: 0,
  mtfRuns: 0,
  errors: 0,
  totalLatencyMs: 0,
  requestCount: 0,
  startedAt: new Date(),
};

/**
 * Record a cache hit
 */
export function recordCacheHit(): void {
  state.cacheHits++;
}

/**
 * Record a cache miss
 */
export function recordCacheMiss(): void {
  state.cacheMisses++;
}

/**
 * Record a decision run
 */
export function recordDecisionRun(latencyMs: number): void {
  state.decisionRuns++;
  state.totalLatencyMs += latencyMs;
  state.requestCount++;
}

/**
 * Record an MTF run
 */
export function recordMTFRun(latencyMs: number): void {
  state.mtfRuns++;
  state.totalLatencyMs += latencyMs;
  state.requestCount++;
}

/**
 * Record an error
 */
export function recordError(): void {
  state.errors++;
}

/**
 * Get metrics summary
 */
export function getMetrics(): {
  cacheHitRate: number;
  avgLatencyMs: number;
  runsPerHour: number;
  errorRate: number;
  uptime: number;
  totals: {
    cacheHits: number;
    cacheMisses: number;
    decisionRuns: number;
    mtfRuns: number;
    errors: number;
    requests: number;
  };
} {
  const now = Date.now();
  const uptimeMs = now - state.startedAt.getTime();
  const uptimeHours = uptimeMs / (1000 * 60 * 60);

  const totalCacheOps = state.cacheHits + state.cacheMisses;
  const cacheHitRate = totalCacheOps > 0 ? state.cacheHits / totalCacheOps : 0;
  
  const avgLatencyMs = state.requestCount > 0 
    ? state.totalLatencyMs / state.requestCount 
    : 0;

  const totalRuns = state.decisionRuns + state.mtfRuns;
  const runsPerHour = uptimeHours > 0 ? totalRuns / uptimeHours : 0;

  const errorRate = state.requestCount > 0 
    ? state.errors / state.requestCount 
    : 0;

  return {
    cacheHitRate,
    avgLatencyMs,
    runsPerHour,
    errorRate,
    uptime: uptimeMs,
    totals: {
      cacheHits: state.cacheHits,
      cacheMisses: state.cacheMisses,
      decisionRuns: state.decisionRuns,
      mtfRuns: state.mtfRuns,
      errors: state.errors,
      requests: state.requestCount,
    },
  };
}

/**
 * Reset metrics
 */
export function resetMetrics(): void {
  state.cacheHits = 0;
  state.cacheMisses = 0;
  state.decisionRuns = 0;
  state.mtfRuns = 0;
  state.errors = 0;
  state.totalLatencyMs = 0;
  state.requestCount = 0;
  state.startedAt = new Date();
}

/**
 * Get extended health info from database
 */
export async function getExtendedHealth(db: Db): Promise<{
  engine: string;
  mlOverlayMode: string;
  datasetRows: number;
  lastMTFRun: number | null;
  scenariosCount: number;
  outcomesCount: number;
  calibratedPatterns: number;
}> {
  // Get ML overlay config
  let mlOverlayMode = 'OFF';
  try {
    const mlConfig = await db.collection('ta_config').findOne({ key: 'ml_overlay' });
    mlOverlayMode = mlConfig?.mode || 'SHADOW';
  } catch {
    mlOverlayMode = 'SHADOW';
  }

  // Get dataset rows count
  let datasetRows = 0;
  try {
    datasetRows = await db.collection('ta_ml_rows').countDocuments();
  } catch {}

  // Get last MTF run
  let lastMTFRun = null;
  try {
    const lastMtf = await db.collection('ta_mtf_runs')
      .findOne({}, { sort: { createdAt: -1 } });
    lastMTFRun = lastMtf?.createdAt?.getTime() || null;
  } catch {}

  // Get scenarios count
  let scenariosCount = 0;
  try {
    scenariosCount = await db.collection('ta_scenarios').countDocuments();
  } catch {}

  // Get outcomes count
  let outcomesCount = 0;
  try {
    outcomesCount = await db.collection('ta_outcomes').countDocuments();
  } catch {}

  // Get calibrated patterns count
  let calibratedPatterns = 0;
  try {
    calibratedPatterns = await db.collection('ta_calibration_v2').countDocuments();
  } catch {}

  return {
    engine: 'ok',
    mlOverlayMode,
    datasetRows,
    lastMTFRun,
    scenariosCount,
    outcomesCount,
    calibratedPatterns,
  };
}
