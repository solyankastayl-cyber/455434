/**
 * P5.2 Timeline Service — Version Timeline
 * 
 * Aggregates lifecycle events (PROMOTE/ROLLBACK/CONFIG_UPDATE/FREEZE/UNFREEZE)
 * with config diffs, health snapshots, and artifact counts.
 */

import { getMongoDb } from '../../../db/mongoose.js';

export type EventType = 'PROMOTE' | 'ROLLBACK' | 'CONFIG_UPDATE' | 'FREEZE' | 'UNFREEZE' | 'FORCE_OVERRIDE' | 'HEALTH_TRANSITION';
export type Scope = 'BTC' | 'SPX' | 'DXY' | 'CROSS_ASSET';

export interface TimelineEvent {
  id: string;
  scope: Scope;
  type: EventType;
  at: string;
  actor?: string;
  versionId?: string;
  fromVersionId?: string;
  toVersionId?: string;
  // For HEALTH_TRANSITION events
  fromGrade?: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  toGrade?: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  config: {
    source: 'mongo' | 'fallback';
    hash?: string;
    diff?: Array<{ path: string; from: any; to: any }>;
  };
  health: {
    grade: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
    reasons: string[];
    metrics: { hitRate?: number; avgAbsError?: number; sampleCount?: number };
  };
  artifacts: {
    snapshotsCreated?: number;
    outcomesCreated?: number;
    resolvedAt?: string;
  };
}

// Keys to track in config diffs (per scope)
const DIFF_KEYS_MAP: Record<string, string[]> = {
  BTC: ['windowLen', 'topK', 'minGapDays', 'similarityMode', 'horizonWeights', 'divergencePenalty', 'consensusThreshold'],
  SPX: ['windowLen', 'topK', 'minGapDays', 'similarityMode', 'horizonWeights', 'divergencePenalty', 'consensusThreshold'],
  DXY: ['syntheticWeight', 'replayWeight', 'macroWeight', 'windowLen', 'topK'],
  CROSS_ASSET: ['minWeight', 'maxWeight', 'volPenaltyK', 'confidenceWeighting', 'clampBounds'],
};

/**
 * Compute diff between two config objects
 */
function diffConfigs(fromConfig: any, toConfig: any, scope: string): Array<{ path: string; from: any; to: any }> {
  const keys = DIFF_KEYS_MAP[scope] || DIFF_KEYS_MAP['BTC'];
  const diffs: Array<{ path: string; from: any; to: any }> = [];
  
  for (const key of keys) {
    const fromVal = fromConfig?.[key];
    const toVal = toConfig?.[key];
    
    if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
      diffs.push({ path: key, from: fromVal, to: toVal });
    }
  }
  
  return diffs;
}

async function getDb() {
  return getMongoDb();
}

/**
 * Build timeline for a scope
 */
export async function buildTimeline(scope: Scope, limit = 50): Promise<TimelineEvent[]> {
  const db = await getDb();
  
  // Get lifecycle events
  const lifecycleEvents = await db.collection('model_lifecycle_events')
    .find({ asset: scope })
    .sort({ at: -1 })
    .limit(limit)
    .toArray();
  
  const events: TimelineEvent[] = [];
  
  for (const e of lifecycleEvents) {
    // Get health state at event time (closest)
    const healthAtTime = await db.collection('model_health_state')
      .findOne({ scope });
    
    // Count artifacts created after this version
    const snapshotCount = await db.collection('prediction_snapshots')
      .countDocuments({ 
        asset: scope, 
        versionId: e.toVersionId || e.activeVersion 
      });
    
    const outcomeCount = await db.collection('decision_outcomes')
      .countDocuments({ 
        asset: scope, 
        versionId: e.toVersionId || e.activeVersion 
      });
    
    events.push({
      id: e._id.toString(),
      scope,
      type: e.type || 'PROMOTE',
      at: e.at?.toISOString() || new Date().toISOString(),
      actor: e.actor,
      versionId: e.activeVersion || e.toVersionId,
      fromVersionId: e.fromVersionId,
      toVersionId: e.toVersionId,
      // HEALTH_TRANSITION specific fields
      fromGrade: e.fromGrade,
      toGrade: e.toGrade,
      config: {
        source: e.configSource || 'mongo',
        hash: e.configHash,
        diff: diffConfigs(e.fromConfig, e.toConfig, scope),
      },
      health: {
        grade: e.toGrade || healthAtTime?.grade || 'HEALTHY',
        reasons: e.reasons || healthAtTime?.reasons || [],
        metrics: e.metrics || {
          hitRate: healthAtTime?.metrics?.hitRate,
          avgAbsError: healthAtTime?.metrics?.avgAbsError,
          sampleCount: healthAtTime?.metrics?.sampleCount,
        },
      },
      artifacts: {
        snapshotsCreated: snapshotCount,
        outcomesCreated: outcomeCount,
        resolvedAt: e.resolvedAt?.toISOString(),
      },
    });
  }
  
  // If no lifecycle events, create synthetic ones from current state
  if (events.length === 0) {
    const currentState = await db.collection('model_lifecycle_state')
      .findOne({ asset: scope });
    
    if (currentState) {
      const healthState = await db.collection('model_health_state')
        .findOne({ scope });
      
      events.push({
        id: 'current',
        scope,
        type: 'PROMOTE',
        at: currentState.updatedAt?.toISOString() || new Date().toISOString(),
        versionId: currentState.activeVersion,
        config: {
          source: 'mongo',
          diff: [],
        },
        health: {
          grade: healthState?.grade || 'HEALTHY',
          reasons: healthState?.reasons || [],
          metrics: {
            hitRate: healthState?.metrics?.hitRate,
            avgAbsError: healthState?.metrics?.avgAbsError,
            sampleCount: healthState?.metrics?.sampleCount,
          },
        },
        artifacts: {
          snapshotsCreated: 0,
          outcomesCreated: 0,
        },
      });
    }
  }
  
  return events;
}

/**
 * Get timeline summary for all scopes
 */
export async function getTimelineSummary(): Promise<Record<Scope, { eventCount: number; lastEvent?: string }>> {
  const db = await getDb();
  const scopes: Scope[] = ['BTC', 'SPX', 'DXY', 'CROSS_ASSET'];
  const summary: Record<string, { eventCount: number; lastEvent?: string }> = {};
  
  for (const scope of scopes) {
    const count = await db.collection('model_lifecycle_events')
      .countDocuments({ asset: scope });
    
    const lastEvent = await db.collection('model_lifecycle_events')
      .findOne({ asset: scope }, { sort: { at: -1 } });
    
    summary[scope] = {
      eventCount: count,
      lastEvent: lastEvent?.at?.toISOString(),
    };
  }
  
  return summary as Record<Scope, { eventCount: number; lastEvent?: string }>;
}

export default {
  buildTimeline,
  getTimelineSummary,
  diffConfigs,
};
