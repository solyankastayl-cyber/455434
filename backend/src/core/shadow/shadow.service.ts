/**
 * Shadow Mode Service
 * 
 * Compares V1 vs V2 engine decisions and tracks metrics
 */
import { ShadowSnapshotModel, type IShadowSnapshot } from './shadow.model.js';
import { decideV2 } from '../engine_v2/engine_v2.service.js';
import type { EngineWindow } from '../engine_v2/signals_fetcher.js';
import type { ShadowMetrics, KillSwitchStatus, V1Scores, V2Scores, ShadowDiff } from './shadow.types.js';

/**
 * Simulate V1 engine decision (legacy rules-based)
 * This returns placeholder values representing what V1 would return
 */
function getV1Decision(subjectId: string, window: EngineWindow): V1Scores {
  // V1 was rules-based with hardcoded values
  // We simulate it here for comparison purposes
  return {
    decision: 'NEUTRAL',
    evidence: 0,
    risk: 75, // Legacy default high risk
    confidence: 0,
    coverage: 7, // Legacy fake coverage
  };
}

/**
 * Compare V1 and V2 decisions for a subject
 */
export async function compareV1V2(
  subjectKind: 'entity' | 'actor' | 'wallet',
  subjectId: string,
  window: EngineWindow
): Promise<IShadowSnapshot | null> {
  // Get V1 (simulated legacy)
  const v1 = getV1Decision(subjectId, window);
  
  // Get V2 (real Engine V2)
  const v2Result = await decideV2({
    actor: subjectKind === 'actor' ? subjectId : undefined,
    asset: subjectKind !== 'actor' ? subjectId : undefined,
    window,
  });
  
  const v2: V2Scores = {
    decision: v2Result.decision,
    evidence: v2Result.scores.evidence,
    direction: v2Result.scores.direction,
    risk: v2Result.scores.risk,
    confidence: v2Result.attribution.summary.clusterPassRate * 100,
    coverage: v2Result.scores.coverage,
    engineStatus: v2Result.health.engineStatus,
  };
  
  // Calculate diff
  const diff: ShadowDiff = {
    decisionChanged: v1.decision !== v2.decision,
    evidenceDelta: v2.evidence - v1.evidence,
    riskDelta: v2.risk - v1.risk,
    coverageDelta: v2.coverage - v1.coverage,
    confidenceDelta: v2.confidence - v1.confidence,
  };
  
  // Save snapshot
  const snapshot = await ShadowSnapshotModel.create({
    subject: { kind: subjectKind, id: subjectId },
    window,
    v1,
    v2,
    diff,
  });
  
  return snapshot;
}

/**
 * Get shadow metrics summary
 */
export async function getShadowMetrics(window: EngineWindow): Promise<ShadowMetrics> {
  const snapshots = await ShadowSnapshotModel.find({ window })
    .sort({ computedAt: -1 })
    .limit(500)
    .lean();
  
  if (snapshots.length === 0) {
    return {
      agreementRate: 1,
      decisionFlipRate: 0,
      avgEvidenceDelta: 0,
      avgRiskDelta: 0,
      avgCoverageDelta: 0,
      avgConfidenceDelta: 0,
      falsePositivesRate: 0,
      falseNegativesRate: 0,
      samples: 0,
      window,
      computedAt: new Date().toISOString(),
    };
  }
  
  const n = snapshots.length;
  
  // Agreement rate
  const agreements = snapshots.filter(s => !s.diff.decisionChanged).length;
  const agreementRate = agreements / n;
  
  // Flip rate
  const decisionFlipRate = 1 - agreementRate;
  
  // Average deltas
  const avgEvidenceDelta = snapshots.reduce((s, x) => s + (x.diff.evidenceDelta || 0), 0) / n;
  const avgRiskDelta = snapshots.reduce((s, x) => s + (x.diff.riskDelta || 0), 0) / n;
  const avgCoverageDelta = snapshots.reduce((s, x) => s + (x.diff.coverageDelta || 0), 0) / n;
  const avgConfidenceDelta = snapshots.reduce((s, x) => s + (x.diff.confidenceDelta || 0), 0) / n;
  
  // False positives: V2 BUY where V1 NEUTRAL
  const falsePositives = snapshots.filter(s => 
    s.v2.decision === 'BUY' && s.v1.decision === 'NEUTRAL'
  ).length;
  const falsePositivesRate = falsePositives / n;
  
  // False negatives: V2 NEUTRAL where V1 BUY
  const falseNegatives = snapshots.filter(s => 
    s.v2.decision === 'NEUTRAL' && s.v1.decision === 'BUY'
  ).length;
  const falseNegativesRate = falseNegatives / n;
  
  return {
    agreementRate: Number(agreementRate.toFixed(4)),
    decisionFlipRate: Number(decisionFlipRate.toFixed(4)),
    avgEvidenceDelta: Number(avgEvidenceDelta.toFixed(2)),
    avgRiskDelta: Number(avgRiskDelta.toFixed(2)),
    avgCoverageDelta: Number(avgCoverageDelta.toFixed(2)),
    avgConfidenceDelta: Number(avgConfidenceDelta.toFixed(2)),
    falsePositivesRate: Number(falsePositivesRate.toFixed(4)),
    falseNegativesRate: Number(falseNegativesRate.toFixed(4)),
    samples: n,
    window,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Evaluate kill switch conditions
 */
export function evaluateKillSwitch(metrics: ShadowMetrics): {
  status: KillSwitchStatus;
  reasons: string[];
} {
  const reasons: string[] = [];
  
  // Critical: Force fallback to V1
  if (metrics.agreementRate < 0.60) {
    reasons.push(`Agreement rate too low (${(metrics.agreementRate * 100).toFixed(1)}% < 60%)`);
    return { status: 'FORCE_V1', reasons };
  }
  
  // Alerts
  if (metrics.decisionFlipRate > 0.35) {
    reasons.push(`High flip rate (${(metrics.decisionFlipRate * 100).toFixed(1)}% > 35%)`);
  }
  if (metrics.falsePositivesRate > 0.15) {
    reasons.push(`High false positives (${(metrics.falsePositivesRate * 100).toFixed(1)}% > 15%)`);
  }
  if (metrics.avgRiskDelta < -25) {
    reasons.push(`Risk delta too negative (${metrics.avgRiskDelta.toFixed(1)} < -25)`);
  }
  if (metrics.avgCoverageDelta < -40) {
    reasons.push(`Coverage collapse (${metrics.avgCoverageDelta.toFixed(1)} < -40)`);
  }
  
  if (reasons.length > 0) {
    return { status: 'ALERT', reasons };
  }
  
  return { status: 'OK', reasons: [] };
}

/**
 * Get recent shadow comparisons
 */
export async function getRecentComparisons(
  window: EngineWindow,
  limit: number = 50
): Promise<IShadowSnapshot[]> {
  return ShadowSnapshotModel.find({ window })
    .sort({ computedAt: -1 })
    .limit(limit)
    .lean();
}
