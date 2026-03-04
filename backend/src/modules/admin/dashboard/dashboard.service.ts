/**
 * Admin Dashboard Service
 * 
 * Unified aggregator for all admin dashboard data.
 * NO NEW LOGIC — only aggregation of existing services.
 * 
 * This is the SINGLE SOURCE OF TRUTH for admin UI.
 */

import { DashboardResponse, AdminScope } from './dashboard.contract.js';
import { getMongoDb } from '../../../db/mongoose.js';
import { HealthStore } from '../../health/model_health.service.js';
import { getRuntimeEngineConfig } from '../../fractal/config/runtime-config.service.js';
import { getDriftModifier } from '../../health/confidence_adjuster.util.js';

/**
 * Get lifecycle state for scope
 */
async function getLifecycleState(scope: AdminScope) {
  const db = await getMongoDb();
  return db.collection('model_lifecycle_state').findOne({ asset: scope });
}

/**
 * Get snapshot stats for scope
 * @param includeSeed - include seed_backtest data
 */
async function getSnapshotStats(scope: AdminScope, includeSeed: boolean = false) {
  const db = await getMongoDb();
  
  // Filter for origin
  const originFilter = includeSeed 
    ? {} 
    : { $or: [{ origin: 'live' }, { origin: { $exists: false } }] };
  
  const total = await db.collection('prediction_snapshots').countDocuments({ asset: scope, ...originFilter });
  const resolved = await db.collection('decision_outcomes').countDocuments({ asset: scope, ...originFilter });
  
  // Also count from fractal_signal_snapshots
  const signalSnapshots = await db.collection('fractal_signal_snapshots').countDocuments({ 
    symbol: scope, 
    ...originFilter 
  });
  
  const pending = total - resolved;
  
  return { 
    total: total + signalSnapshots, 
    resolved, 
    pending: Math.max(0, pending),
    seedIncluded: includeSeed 
  };
}

/**
 * Get recent events for scope
 */
async function getRecentEvents(scope: AdminScope, limit = 10) {
  const db = await getMongoDb();
  
  const events = await db.collection('model_lifecycle_events')
    .find({ asset: scope })
    .sort({ at: -1 })
    .limit(limit)
    .toArray();
  
  return events.map(e => ({
    type: e.type,
    ts: e.at?.toISOString() || new Date().toISOString(),
    details: {
      fromGrade: e.fromGrade,
      toGrade: e.toGrade,
      fromVersion: e.fromVersionId,
      toVersion: e.toVersionId,
    },
  }));
}

/**
 * Get drift stats for scope (from recent outcomes)
 * @param includeSeed - include seed_backtest data
 */
async function getDriftStats(scope: AdminScope, includeSeed: boolean = false) {
  const db = await getMongoDb();
  
  // Filter for origin
  const originFilter = includeSeed 
    ? {} 
    : { $or: [{ origin: 'live' }, { origin: { $exists: false } }] };
  
  // Get recent outcomes for drift calculation
  let outcomes = await db.collection('decision_outcomes')
    .find({ asset: scope, ...originFilter })
    .sort({ resolvedAt: -1 })
    .limit(50)
    .toArray();
  
  // If includeSeed and no outcomes, try to get from seed snapshots
  if (outcomes.length === 0 && includeSeed) {
    const seedSnapshots = await db.collection('fractal_signal_snapshots')
      .find({ symbol: scope, origin: 'seed_backtest', resolved: true })
      .sort({ asOf: -1 })
      .limit(50)
      .toArray();
    
    // Convert seed snapshots to outcome-like format
    outcomes = seedSnapshots.map(s => {
      const outcome7d = s.outcomes?.['7d'];
      const outcome14d = s.outcomes?.['14d'];
      const outcome30d = s.outcomes?.['30d'];
      const outcome = outcome7d || outcome14d || outcome30d;
      
      if (!outcome) return null;
      
      const error = outcome.realizedReturn - s.expectedReturn;
      return {
        asset: scope,
        error,
        directionHit: outcome.hit,
        resolvedAt: outcome.resolvedAt,
        origin: 'seed_backtest'
      };
    }).filter(Boolean);
  }
  
  if (outcomes.length === 0) {
    return { 
      avgError: null, 
      avgAbsError: null, 
      trend: 'unknown' as const,
      sampleCount: 0,
      seedIncluded: includeSeed
    };
  }
  
  // Calculate average error and abs error
  const errors = outcomes.map(o => o.error ?? 0);
  const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
  const avgAbsError = errors.map(Math.abs).reduce((a, b) => a + b, 0) / errors.length;
  
  // Determine trend (compare first half vs second half)
  const half = Math.floor(errors.length / 2);
  if (half < 5) {
    return { 
      avgError, 
      avgAbsError, 
      trend: 'unknown' as const,
      sampleCount: outcomes.length,
      seedIncluded: includeSeed
    };
  }
  
  const recentAbsError = errors.slice(0, half).map(Math.abs).reduce((a, b) => a + b, 0) / half;
  const olderAbsError = errors.slice(half).map(Math.abs).reduce((a, b) => a + b, 0) / (errors.length - half);
  
  let trend: 'improving' | 'stable' | 'worsening' | 'unknown' = 'stable';
  if (recentAbsError < olderAbsError * 0.9) trend = 'improving';
  else if (recentAbsError > olderAbsError * 1.1) trend = 'worsening';
  
  return {
    avgError: Math.round(avgError * 10000) / 10000,
    avgAbsError: Math.round(avgAbsError * 10000) / 10000,
    trend,
    sampleCount: outcomes.length,
    seedIncluded: includeSeed
  };
}

/**
 * Main dashboard aggregator
 * 
 * Aggregates ALL admin data into single response.
 * UI should call ONLY this endpoint.
 * 
 * @param includeSeed - if true, includes seed_backtest data in metrics
 */
export async function getDashboard(scope: AdminScope, includeSeed: boolean = false): Promise<DashboardResponse> {
  const startTime = Date.now();
  
  // Parallel fetch all data
  const [
    lifecycleState,
    healthState,
    runtimeConfig,
    snapshotStats,
    driftStats,
    recentEvents,
  ] = await Promise.all([
    getLifecycleState(scope),
    HealthStore.getState(scope),
    getRuntimeEngineConfig(scope as any).catch(() => null),
    getSnapshotStats(scope, includeSeed),
    getDriftStats(scope, includeSeed),
    getRecentEvents(scope, 10),
  ]);
  
  // Calculate confidence modifier from health grade
  const grade = healthState?.grade || 'HEALTHY';
  const modifier = getDriftModifier(grade as any);
  
  // Build unified response
  const response: DashboardResponse = {
    scope,
    
    version: {
      activeVersion: lifecycleState?.activeVersion || null,
      configHash: lifecycleState?.configHash || null,
      createdAt: lifecycleState?.updatedAt?.toISOString() || null,
      configSource: runtimeConfig?.source || 'static',
    },
    
    health: {
      grade: (healthState?.grade || 'UNKNOWN') as any,
      hitRate: healthState?.metrics?.hitRate ?? null,
      avgAbsError: healthState?.metrics?.avgAbsError ?? null,
      sampleCount: healthState?.metrics?.sampleCount || 0,
      modifier,
      frozen: healthState?.frozen || false,
      consecutiveDegraded: healthState?.consecutiveDegradedWindows || 0,
      reasons: healthState?.reasons || [],
    },
    
    governance: {
      windowLen: runtimeConfig?.windowLen ?? null,
      topK: runtimeConfig?.topK ?? null,
      consensusThreshold: runtimeConfig?.consensusThreshold ?? null,
      minGapDays: runtimeConfig?.minGapDays ?? null,
      configSource: runtimeConfig?.source || 'static',
    },
    
    drift: driftStats,
    
    snapshots: snapshotStats,
    
    confidenceMeta: {
      base: healthState?.metrics?.hitRate ?? null,
      modifier,
      final: healthState?.metrics?.hitRate 
        ? Math.round((healthState.metrics.hitRate * modifier) * 10000) / 10000
        : null,
    },
    
    lastEvents: recentEvents,
    
    meta: {
      computedAt: new Date().toISOString(),
      latencyMs: Date.now() - startTime,
    },
  };
  
  return response;
}

/**
 * Get dashboard for all scopes (for Overview page)
 */
export async function getAllDashboards(): Promise<Record<AdminScope, DashboardResponse>> {
  const scopes: AdminScope[] = ['BTC', 'SPX', 'DXY', 'CROSS_ASSET'];
  
  const results = await Promise.all(
    scopes.map(scope => getDashboard(scope))
  );
  
  return {
    BTC: results[0],
    SPX: results[1],
    DXY: results[2],
    CROSS_ASSET: results[3],
  };
}

export default {
  getDashboard,
  getAllDashboards,
};
