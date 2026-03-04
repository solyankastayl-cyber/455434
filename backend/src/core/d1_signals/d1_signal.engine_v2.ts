/**
 * ETAP 6.4 + 7 — Signal Engine v2 (Snapshot-Based + Confidence)
 * 
 * ⚠️ CRITICAL: Engine reads ONLY from signal_snapshots
 * ❌ NO access to: raw_transfers, aggregations, graph live API
 * ✅ ONLY reads: signal_snapshots collection
 * 
 * Rules:
 * 1. NEW_CORRIDOR - New persistent edge between actors
 * 2. DENSITY_SPIKE - Sharp increase in edge density
 * 3. DIRECTION_IMBALANCE - One-sided flow imbalance
 * 4. ACTOR_REGIME_CHANGE - Actor behavior shift
 * 5. NEW_BRIDGE - New structural connection (context-only)
 * 
 * ETAP 7: Confidence scoring added (rules-only, no ML)
 */
import { createHash } from 'crypto';
import { D1SignalModel, D1SignalRunModel } from './d1_signal.model.js';
import { getLatestSnapshot, listSnapshots } from '../snapshots/snapshot.builder.js';
import { ENGINE_THRESHOLDS, RULE_VERSION, ENGINE_LIMITS, RuleThresholds } from './engine_thresholds.js';
import { 
  calculateConfidenceWithTrace,
  calculateActorWeight,
  shouldSendToTelegram,
  isSignalVisible,
  type ConfidenceInputWithLifecycle,
  type ConfidenceResultWithTrace,
  type ActorWeightInfo,
} from '../d1_engine_confidence/index.js';
import {
  applyLifecycleTransition,
  createInitialLifecycleState,
  isSignalActive,
  type SignalLifecycleState,
} from './lifecycle.machine.js';
import type { 
  D1Signal, 
  D1SignalType, 
  D1Severity, 
  D1Status,
  D1Window,
  D1EntityRef,
  D1Evidence,
  D1SignalRun
} from './d1_signal.types.js';
import type { SignalSnapshot, SnapshotActor, SnapshotEdge, SnapshotWindow } from '../snapshots/snapshot.types.js';

// ==================== HELPERS ====================

/**
 * P1.4: Calculate average actor coverage from snapshot actors
 */
function calculateAvgActorCoverage(actors: SnapshotActor[]): number {
  if (!actors || actors.length === 0) return 50;
  const total = actors.reduce((sum, a) => sum + (a.coverage || 0), 0);
  return Math.round(total / actors.length);
}

// ==================== TYPES ====================

interface SignalCandidate {
  type: D1SignalType;
  severity: D1Severity;
  scope: D1Signal['scope'];
  title: string;
  subtitle: string;
  primary: D1EntityRef;
  secondary?: D1EntityRef;
  entities: D1EntityRef[];
  direction: D1Signal['direction'];
  metrics: D1Signal['metrics'];
  evidence: D1Evidence;
  summary: D1Signal['summary'];
  signalKey: string;  // Stable hash for deduplication
}

interface EngineContext {
  window: D1Window;
  runId: string;
  snapshotId: string;
  currentSnapshot: SignalSnapshot;
  previousSnapshot: SignalSnapshot | null;
  thresholds: RuleThresholds;
  existingSignals: Map<string, D1Signal>;
  activeSignalKeys: Set<string>;  // Track which signals were found in this run
}

interface EngineRunResult {
  runId: string;
  window: D1Window;
  snapshotId: string;
  created: number;
  updated: number;
  resolved: number;
  skippedDuplicates: number;
  status: 'completed' | 'failed';
  errors: string[];
}

// ==================== HELPERS ====================

/**
 * Generate stable signal key (hash)
 * signalKey = sha256(type + window + scope + sorted(primaryNodes) + sorted(primaryEdges))
 */
function generateSignalKey(
  type: D1SignalType,
  window: D1Window,
  scope: string,
  actorIds: string[],
  edgeIds: string[] = []
): string {
  const sortedActors = [...actorIds].sort().join('|');
  const sortedEdges = [...edgeIds].sort().join('|');
  const input = `${type}|${window}|${scope}|${sortedActors}|${sortedEdges}`;
  return createHash('sha256').update(input).digest('hex').substring(0, 16);
}

/**
 * Check confidence level meets threshold
 */
function meetsConfidence(actual: number, required: 'low' | 'medium' | 'high'): boolean {
  const levels = { low: 0.3, medium: 0.5, high: 0.7 };
  return actual >= levels[required];
}

/**
 * Map confidence number to string
 */
function confidenceToString(value: number): 'low' | 'medium' | 'high' {
  if (value >= 0.7) return 'high';
  if (value >= 0.5) return 'medium';
  return 'low';
}

// ==================== SNAPSHOT LOADING ====================

/**
 * Load current snapshot from snapshot layer
 */
async function loadCurrentSnapshot(window: SnapshotWindow): Promise<SignalSnapshot | null> {
  return getLatestSnapshot(window);
}

/**
 * Load previous snapshot for comparison
 */
async function loadPreviousSnapshot(window: SnapshotWindow): Promise<SignalSnapshot | null> {
  const snapshots = await listSnapshots(window, 2);
  if (snapshots.length < 2) return null;
  
  // Get the second-to-last snapshot
  const prevSnapshotInfo = snapshots[1];
  if (!prevSnapshotInfo) return null;
  
  // Load full snapshot
  const { getSnapshotById } = await import('../snapshots/snapshot.builder.js');
  return getSnapshotById(prevSnapshotInfo.snapshotId);
}

/**
 * Load existing signals for deduplication
 */
async function loadExistingSignals(window: D1Window): Promise<Map<string, D1Signal>> {
  const signals = await D1SignalModel.find({ 
    window, 
    status: { $in: ['new', 'active'] } 
  }).lean();
  
  const map = new Map<string, D1Signal>();
  for (const sig of signals as D1Signal[]) {
    // Use signalKey if available, else generate from fingerprint
    const key = (sig as any).signalKey || generateSignalKey(
      sig.type,
      sig.window,
      sig.scope,
      sig.entities?.map(e => e.id) || []
    );
    map.set(key, sig);
  }
  return map;
}

// ==================== RULE: NEW_CORRIDOR ====================

function detectNewCorridors(ctx: EngineContext): SignalCandidate[] {
  const candidates: SignalCandidate[] = [];
  const t = ctx.thresholds.NEW_CORRIDOR;
  
  // Build set of previous edges
  const prevEdgeSet = new Set<string>();
  if (ctx.previousSnapshot) {
    for (const edge of ctx.previousSnapshot.edges) {
      prevEdgeSet.add(`${edge.sourceId}_${edge.targetId}`);
      prevEdgeSet.add(`${edge.targetId}_${edge.sourceId}`);  // Bidirectional
    }
  }
  
  // Actor lookup
  const actorMap = new Map(ctx.currentSnapshot.actors.map(a => [a.actorId, a]));
  
  for (const edge of ctx.currentSnapshot.edges) {
    const edgeKey1 = `${edge.sourceId}_${edge.targetId}`;
    const edgeKey2 = `${edge.targetId}_${edge.sourceId}`;
    
    // Skip if edge existed before
    if (prevEdgeSet.has(edgeKey1) || prevEdgeSet.has(edgeKey2)) continue;
    
    // Check thresholds
    if (edge.evidence_count < t.minDensity) continue;
    if (edge.weight < t.minWeight) continue;
    if (!meetsConfidence(edge.confidence, t.minConfidence)) continue;
    
    // Check coverage (normalize from 0-100 to 0-1 if needed)
    const sourceActor = actorMap.get(edge.sourceId);
    const targetActor = actorMap.get(edge.targetId);
    const srcCov = (sourceActor?.coverage || 0) > 1 ? (sourceActor?.coverage || 0) / 100 : (sourceActor?.coverage || 0);
    const tgtCov = (targetActor?.coverage || 0) > 1 ? (targetActor?.coverage || 0) / 100 : (targetActor?.coverage || 0);
    const avgCoverage = (srcCov + tgtCov) / 2;
    if (avgCoverage < t.coverageRequired) continue;
    
    // Determine severity
    const confStr = confidenceToString(edge.confidence);
    let severity: D1Severity = 'low';
    if (edge.evidence_count >= t.highDensity && confStr === 'high') {
      severity = 'high';
    } else if (edge.evidence_count >= t.minDensity) {
      severity = 'medium';
    }
    
    const primary: D1EntityRef = {
      kind: 'actor',
      id: edge.sourceId,
      label: sourceActor?.name || edge.sourceId,
      type: sourceActor?.type,
      source: 'snapshot',
      coverage: sourceActor?.coverage,
    };
    
    const secondary: D1EntityRef = {
      kind: 'actor',
      id: edge.targetId,
      label: targetActor?.name || edge.targetId,
      type: targetActor?.type,
      source: 'snapshot',
      coverage: targetActor?.coverage,
    };
    
    candidates.push({
      type: 'NEW_CORRIDOR',
      severity,
      scope: 'corridor',
      title: `New corridor: ${primary.label} ↔ ${secondary.label}`,
      subtitle: 'Persistent bidirectional flow emerged',
      primary,
      secondary,
      entities: [primary, secondary],
      direction: 'bidirectional',
      metrics: {
        density: { current: edge.evidence_count, previous: 0, deltaPct: null },
        inflowUsd: sourceActor?.inflow_usd,
        outflowUsd: sourceActor?.outflow_usd,
        edgesCount: 1,
      },
      evidence: {
        rule: {
          name: 'NEW_CORRIDOR',
          version: RULE_VERSION,
          thresholds: { minDensity: t.minDensity, minWeight: t.minWeight },
        },
        baseline: { density: 0, window: ctx.window },
        current: { density: edge.evidence_count, window: ctx.window },
      },
      summary: {
        what: 'A new persistent transaction corridor emerged.',
        whyNow: `Density ${edge.evidence_count} >= ${t.minDensity}, confidence ${confStr}`,
        soWhat: 'Indicates a structural connection forming.',
      },
      signalKey: generateSignalKey('NEW_CORRIDOR', ctx.window, 'corridor', [edge.sourceId, edge.targetId]),
    });
  }
  
  return candidates;
}

// ==================== RULE: DENSITY_SPIKE ====================

function detectDensitySpikes(ctx: EngineContext): SignalCandidate[] {
  const candidates: SignalCandidate[] = [];
  const t = ctx.thresholds.DENSITY_SPIKE;
  
  if (!ctx.previousSnapshot) return candidates;
  
  // Build map of previous edges
  const prevEdgeMap = new Map<string, SnapshotEdge>();
  for (const edge of ctx.previousSnapshot.edges) {
    prevEdgeMap.set(`${edge.sourceId}_${edge.targetId}`, edge);
    prevEdgeMap.set(`${edge.targetId}_${edge.sourceId}`, edge);
  }
  
  const actorMap = new Map(ctx.currentSnapshot.actors.map(a => [a.actorId, a]));
  
  for (const edge of ctx.currentSnapshot.edges) {
    const prevEdge = prevEdgeMap.get(`${edge.sourceId}_${edge.targetId}`) 
                  || prevEdgeMap.get(`${edge.targetId}_${edge.sourceId}`);
    
    // Only check existing edges
    if (!prevEdge) continue;
    if (prevEdge.evidence_count < t.minPrevDensity) continue;
    if (edge.evidence_count < t.minCurrentDensity) continue;
    
    // Calculate spike ratio
    const spikeRatio = (edge.evidence_count - prevEdge.evidence_count) / Math.max(1, prevEdge.evidence_count);
    if (spikeRatio < t.minSpikeRatio) continue;
    
    // Check coverage
    const sourceActor = actorMap.get(edge.sourceId);
    const targetActor = actorMap.get(edge.targetId);
    const srcCov = (sourceActor?.coverage || 0) > 1 ? (sourceActor?.coverage || 0) / 100 : (sourceActor?.coverage || 0); const tgtCov = (targetActor?.coverage || 0) > 1 ? (targetActor?.coverage || 0) / 100 : (targetActor?.coverage || 0); const avgCoverage = (srcCov + tgtCov) / 2;
    if (avgCoverage < t.coverageRequired) continue;
    
    // Determine severity
    let severity: D1Severity = 'medium';
    if (spikeRatio >= t.highSpikeRatio && edge.evidence_count >= t.highMinDensity) {
      severity = 'high';
    }
    
    const primary: D1EntityRef = {
      kind: 'actor',
      id: edge.sourceId,
      label: sourceActor?.name || edge.sourceId,
      type: sourceActor?.type,
      source: 'snapshot',
    };
    
    const secondary: D1EntityRef = {
      kind: 'actor',
      id: edge.targetId,
      label: targetActor?.name || edge.targetId,
      type: targetActor?.type,
      source: 'snapshot',
    };
    
    candidates.push({
      type: 'DENSITY_SPIKE',
      severity,
      scope: 'corridor',
      title: `Density spike: ${primary.label} ↔ ${secondary.label}`,
      subtitle: `+${Math.round(spikeRatio * 100)}% activity increase`,
      primary,
      secondary,
      entities: [primary, secondary],
      direction: 'bidirectional',
      metrics: {
        density: { 
          current: edge.evidence_count, 
          previous: prevEdge.evidence_count, 
          deltaPct: Math.round(spikeRatio * 100) 
        },
        edgesCount: 1,
      },
      evidence: {
        rule: {
          name: 'DENSITY_SPIKE',
          version: RULE_VERSION,
          thresholds: { minSpikeRatio: t.minSpikeRatio, minCurrentDensity: t.minCurrentDensity },
        },
        baseline: { density: prevEdge.evidence_count, window: ctx.window },
        current: { density: edge.evidence_count, window: ctx.window },
      },
      summary: {
        what: 'Transaction density increased significantly.',
        whyNow: `Spike ratio ${Math.round(spikeRatio * 100)}% >= ${Math.round(t.minSpikeRatio * 100)}%`,
        soWhat: 'May indicate increased operational activity.',
      },
      signalKey: generateSignalKey('DENSITY_SPIKE', ctx.window, 'corridor', [edge.sourceId, edge.targetId]),
    });
  }
  
  return candidates;
}

// ==================== RULE: DIRECTION_IMBALANCE ====================

function detectDirectionImbalance(ctx: EngineContext): SignalCandidate[] {
  const candidates: SignalCandidate[] = [];
  const t = ctx.thresholds.DIRECTION_IMBALANCE;
  
  for (const actor of ctx.currentSnapshot.actors) {
    const totalFlow = actor.inflow_usd + actor.outflow_usd;
    if (totalFlow < t.minTotalFlowUsd) continue;
    
    const netFlow = Math.abs(actor.net_flow_usd);
    if (netFlow < t.minNetFlowUsd) continue;
    
    const imbalanceRatio = netFlow / totalFlow;
    if (imbalanceRatio < t.minImbalanceRatio) continue;
    
    // Check coverage
    if (((actor.coverage || 0) > 1 ? (actor.coverage || 0) / 100 : (actor.coverage || 0)) < t.coverageRequired) continue;
    
    // Determine direction
    const direction = actor.net_flow_usd > 0 ? 'inflow' : 'outflow';
    
    // Determine severity
    let severity: D1Severity = 'medium';
    if (netFlow >= t.highNetFlowUsd && imbalanceRatio >= t.highImbalanceRatio) {
      severity = 'high';
    }
    
    const primary: D1EntityRef = {
      kind: 'actor',
      id: actor.actorId,
      label: actor.name || actor.actorId,
      type: actor.type,
      source: 'snapshot',
      coverage: actor.coverage,
    };
    
    candidates.push({
      type: 'DIRECTION_IMBALANCE',
      severity,
      scope: 'actor',
      title: `Flow imbalance: ${primary.label}`,
      subtitle: `${direction === 'inflow' ? 'Net accumulation' : 'Net distribution'} detected`,
      primary,
      entities: [primary],
      direction,
      metrics: {
        inflowUsd: actor.inflow_usd,
        outflowUsd: actor.outflow_usd,
        netFlowRatio: imbalanceRatio,
      },
      evidence: {
        rule: {
          name: 'DIRECTION_IMBALANCE',
          version: RULE_VERSION,
          thresholds: { minNetFlowUsd: t.minNetFlowUsd, minImbalanceRatio: t.minImbalanceRatio },
        },
        current: { direction, window: ctx.window },
        flows: {
          inflowUsd: actor.inflow_usd,
          outflowUsd: actor.outflow_usd,
          netUsd: actor.net_flow_usd,
        },
      },
      summary: {
        what: `Flow became strongly ${direction === 'inflow' ? 'one-sided inflow' : 'one-sided outflow'}.`,
        whyNow: `Imbalance ratio ${Math.round(imbalanceRatio * 100)}% >= ${Math.round(t.minImbalanceRatio * 100)}%`,
        soWhat: 'May indicate accumulation or distribution activity.',
      },
      signalKey: generateSignalKey('DIRECTION_IMBALANCE', ctx.window, 'actor', [actor.actorId]),
    });
  }
  
  return candidates;
}

// ==================== RULE: ACTOR_REGIME_CHANGE ====================

function detectActorRegimeChanges(ctx: EngineContext): SignalCandidate[] {
  const candidates: SignalCandidate[] = [];
  const t = ctx.thresholds.ACTOR_REGIME_CHANGE;
  
  if (!ctx.previousSnapshot) return candidates;
  
  // Build map of previous actors
  const prevActorMap = new Map(ctx.previousSnapshot.actors.map(a => [a.actorId, a]));
  
  for (const actor of ctx.currentSnapshot.actors) {
    const prevActor = prevActorMap.get(actor.actorId);
    if (!prevActor) continue;
    
    // Check coverage
    if (((actor.coverage || 0) > 1 ? (actor.coverage || 0) / 100 : (actor.coverage || 0)) < t.coverageRequired) continue;
    
    // Check trend change
    const trendChanged = actor.participation_trend !== prevActor.participation_trend;
    if (!trendChanged) continue;
    
    // Only significant changes
    const isSignificantChange = 
      (prevActor.participation_trend === 'stable' && actor.participation_trend === 'increasing') ||
      (prevActor.participation_trend === 'increasing' && actor.participation_trend === 'decreasing') ||
      (prevActor.participation_trend === 'stable' && actor.participation_trend === 'decreasing');
    
    if (!isSignificantChange) continue;
    
    // Determine severity
    let severity: D1Severity = 'medium';
    if (prevActor.participation_trend === 'increasing' && actor.participation_trend === 'decreasing') {
      severity = 'high';  // UP → DOWN is most significant
    }
    
    const primary: D1EntityRef = {
      kind: 'actor',
      id: actor.actorId,
      label: actor.name || actor.actorId,
      type: actor.type,
      source: 'snapshot',
      coverage: actor.coverage,
    };
    
    candidates.push({
      type: 'ACTOR_REGIME_CHANGE',
      severity,
      scope: 'actor',
      title: `Regime change: ${primary.label}`,
      subtitle: `${prevActor.participation_trend} → ${actor.participation_trend}`,
      primary,
      entities: [primary],
      direction: 'neutral',
      metrics: {
        density: { 
          current: actor.tx_count, 
          previous: prevActor.tx_count,
          deltaPct: prevActor.tx_count > 0 
            ? Math.round(((actor.tx_count - prevActor.tx_count) / prevActor.tx_count) * 100) 
            : null
        },
      },
      evidence: {
        rule: {
          name: 'ACTOR_REGIME_CHANGE',
          version: RULE_VERSION,
          thresholds: { minTxDeltaPct: t.minTxDeltaPct },
        },
        regime: {
          previous: prevActor.participation_trend,
          current: actor.participation_trend,
          confidence: actor.coverage || 0,
        },
      },
      summary: {
        what: 'Actor behavior pattern shifted.',
        whyNow: `Trend changed from "${prevActor.participation_trend}" to "${actor.participation_trend}"`,
        soWhat: 'May indicate strategic shift in operations.',
      },
      signalKey: generateSignalKey('ACTOR_REGIME_CHANGE', ctx.window, 'actor', [actor.actorId]),
    });
  }
  
  return candidates;
}

// ==================== RULE: NEW_BRIDGE ====================

function detectNewBridges(ctx: EngineContext): SignalCandidate[] {
  const candidates: SignalCandidate[] = [];
  const t = ctx.thresholds.NEW_BRIDGE;
  
  // Build set of previous edges
  const prevEdgeSet = new Set<string>();
  if (ctx.previousSnapshot) {
    for (const edge of ctx.previousSnapshot.edges) {
      prevEdgeSet.add(`${edge.sourceId}_${edge.targetId}`);
      prevEdgeSet.add(`${edge.targetId}_${edge.sourceId}`);
    }
  }
  
  const actorMap = new Map(ctx.currentSnapshot.actors.map(a => [a.actorId, a]));
  
  for (const edge of ctx.currentSnapshot.edges) {
    // Skip existing edges
    if (prevEdgeSet.has(`${edge.sourceId}_${edge.targetId}`)) continue;
    if (prevEdgeSet.has(`${edge.targetId}_${edge.sourceId}`)) continue;
    
    // Only bridge type edges
    if (edge.edgeType !== 'bridge') continue;
    
    // Check thresholds
    if (!meetsConfidence(edge.confidence, t.minConfidence)) continue;
    
    // Check temporal sync (if available)
    const temporalSync = (edge as any).temporal_sync || edge.confidence;
    if (temporalSync < t.minTemporalSync) continue;
    
    // Check coverage
    const sourceActor = actorMap.get(edge.sourceId);
    const targetActor = actorMap.get(edge.targetId);
    const srcCov = (sourceActor?.coverage || 0) > 1 ? (sourceActor?.coverage || 0) / 100 : (sourceActor?.coverage || 0); const tgtCov = (targetActor?.coverage || 0) > 1 ? (targetActor?.coverage || 0) / 100 : (targetActor?.coverage || 0); const avgCoverage = (srcCov + tgtCov) / 2;
    if (avgCoverage < t.coverageRequired) continue;
    
    // NEW_BRIDGE is always MEDIUM (never HIGH per EPIC 5)
    const severity: D1Severity = 'medium';
    
    const primary: D1EntityRef = {
      kind: 'actor',
      id: edge.sourceId,
      label: sourceActor?.name || edge.sourceId,
      type: sourceActor?.type,
      source: 'snapshot',
    };
    
    const secondary: D1EntityRef = {
      kind: 'actor',
      id: edge.targetId,
      label: targetActor?.name || edge.targetId,
      type: targetActor?.type,
      source: 'snapshot',
    };
    
    candidates.push({
      type: 'NEW_BRIDGE',
      severity,
      scope: 'cluster',
      title: `New bridge: ${primary.label} ↔ ${secondary.label}`,
      subtitle: 'New structural connection appeared',
      primary,
      secondary,
      entities: [primary, secondary],
      direction: 'bidirectional',
      metrics: {
        density: { current: edge.evidence_count, previous: 0, deltaPct: null },
        edgesCount: 1,
      },
      evidence: {
        rule: {
          name: 'NEW_BRIDGE',
          version: RULE_VERSION,
          thresholds: { minConfidence: t.minConfidence, minTemporalSync: t.minTemporalSync },
        },
        baseline: { density: 0, window: ctx.window },
        current: { density: edge.evidence_count, window: ctx.window },
      },
      summary: {
        what: 'A new structural connection appeared (context only).',
        whyNow: 'Bridge-type edge detected for the first time.',
        soWhat: 'May indicate new intermediary relationships.',
      },
      signalKey: generateSignalKey('NEW_BRIDGE', ctx.window, 'cluster', [edge.sourceId, edge.targetId]),
    });
  }
  
  return candidates;
}

// ==================== ENGINE RUNNER ====================

/**
 * Run signal engine for a window
 * Reads ONLY from snapshot layer
 */
export async function runSignalEngineV2(
  window: D1Window = '7d',
  providedSnapshotId?: string
): Promise<EngineRunResult> {
  const runId = `run_v2_${Date.now()}`;
  const errors: string[] = [];
  
  console.log(`[Engine v2] Starting run ${runId} for window ${window}`);
  
  // Create run record
  await D1SignalRunModel.create({
    runId,
    window,
    startedAt: new Date(),
    status: 'running',
    stats: { created: 0, updated: 0, archived: 0, errors: 0 },
  });
  
  try {
    // Load current snapshot
    const currentSnapshot = await loadCurrentSnapshot(window as SnapshotWindow);
    if (!currentSnapshot) {
      throw new Error(`No snapshot found for window ${window}`);
    }
    
    const snapshotId = currentSnapshot.snapshotId;
    console.log(`[Engine v2] Using snapshot ${snapshotId} with ${currentSnapshot.actors.length} actors, ${currentSnapshot.edges.length} edges`);
    
    // Load previous snapshot for comparison
    const previousSnapshot = await loadPreviousSnapshot(window as SnapshotWindow);
    
    // Load existing signals
    const existingSignals = await loadExistingSignals(window);
    
    // Get thresholds for window
    const thresholds = ENGINE_THRESHOLDS[window as SnapshotWindow];
    
    // Build context
    const ctx: EngineContext = {
      window,
      runId,
      snapshotId,
      currentSnapshot,
      previousSnapshot,
      thresholds,
      existingSignals,
      activeSignalKeys: new Set(),
    };
    
    // Run all rules in order
    const allCandidates: SignalCandidate[] = [
      ...detectNewCorridors(ctx),
      ...detectDensitySpikes(ctx),
      ...detectDirectionImbalance(ctx),
      ...detectActorRegimeChanges(ctx),
      ...detectNewBridges(ctx),
    ];
    
    console.log(`[Engine v2] Generated ${allCandidates.length} candidates`);
    
    // Process candidates
    let created = 0;
    let updated = 0;
    let skippedDuplicates = 0;
    const createdSignals: D1Signal[] = [];
    
    for (const candidate of allCandidates.slice(0, ENGINE_LIMITS.MAX_SIGNALS_PER_RUN)) {
      ctx.activeSignalKeys.add(candidate.signalKey);
      
      const existingSignal = existingSignals.get(candidate.signalKey);
      
      console.log(`[Engine v2] Processing candidate ${candidate.type}: key=${candidate.signalKey}, exists=${!!existingSignal}`);
      
      if (existingSignal) {
        // Update lastSeenAt
        await D1SignalModel.updateOne(
          { id: existingSignal.id },
          { 
            $set: { 
              updatedAt: new Date(),
              snapshotId,
              'evidence.current': candidate.evidence.current,
            }
          }
        );
        updated++;
        skippedDuplicates++;
      } else {
        // Create new signal
        try {
          console.log(`[Engine v2] Creating new signal ${candidate.type}`);
          const signal = await createSignal(candidate, ctx);
          createdSignals.push(signal);
          created++;
          console.log(`[Engine v2] Created signal ${signal.id}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Engine v2] Create error: ${msg}`);
          errors.push(msg);
        }
      }
    }
    
    // Auto-resolve signals that didn't appear in this run
    const resolved = await autoResolveSignals(ctx);
    
    // Dispatch HIGH signals to Telegram
    let telegramSent = 0;
    if (createdSignals.length > 0) {
      try {
        const { dispatchSignalsToTelegram } = await import('./d1_telegram.dispatcher.js');
        const dispatchResult = await dispatchSignalsToTelegram(createdSignals);
        telegramSent = dispatchResult.sent;
        console.log(`[Engine v2] Telegram: ${telegramSent} sent`);
      } catch (err) {
        console.error(`[Engine v2] Telegram error:`, err);
      }
    }
    
    // Update run record
    await D1SignalRunModel.updateOne(
      { runId },
      {
        completedAt: new Date(),
        status: 'completed',
        snapshotId,
        stats: { created, updated, archived: resolved, errors: errors.length },
      }
    );
    
    console.log(`[Engine v2] Completed: created=${created}, updated=${updated}, resolved=${resolved}, skipped=${skippedDuplicates}`);
    
    return {
      runId,
      window,
      snapshotId,
      created,
      updated,
      resolved,
      skippedDuplicates,
      status: 'completed',
      errors,
    };
    
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Engine v2] Failed:`, msg);
    
    await D1SignalRunModel.updateOne(
      { runId },
      {
        completedAt: new Date(),
        status: 'failed',
        error: msg,
      }
    );
    
    return {
      runId,
      window,
      snapshotId: '',
      created: 0,
      updated: 0,
      resolved: 0,
      skippedDuplicates: 0,
      status: 'failed',
      errors: [msg],
    };
  }
}

/**
 * Create signal document
 */
async function createSignal(candidate: SignalCandidate, ctx: EngineContext): Promise<D1Signal> {
  // Build confidence input from candidate and context
  const primaryActor = ctx.currentSnapshot.actors.find(a => a.actorId === candidate.primary.id);
  const secondaryActor = candidate.secondary 
    ? ctx.currentSnapshot.actors.find(a => a.actorId === candidate.secondary?.id)
    : undefined;
  
  // Collect actor sources from real data
  const actorSources: Array<'verified' | 'attributed' | 'behavioral'> = [];
  
  // Get source from snapshot actor data or default to verified for known types
  const getActorSource = (actor: SnapshotActor | undefined): 'verified' | 'attributed' | 'behavioral' => {
    if (!actor) return 'attributed';
    // Exchange, protocol, market_maker, infra are typically verified
    const verifiedTypes = ['exchange', 'protocol', 'market_maker', 'infra'];
    if (verifiedTypes.includes(actor.type || '')) return 'verified';
    return 'attributed';
  };
  
  if (primaryActor) {
    actorSources.push(getActorSource(primaryActor));
  }
  if (secondaryActor) {
    actorSources.push(getActorSource(secondaryActor));
  }
  
  // P0: Add more actor sources from entities for better score
  // Each entity contributes to actor quality
  for (const entity of candidate.entities.slice(0, 4)) { // Max 4 for scoring
    const entityActor = ctx.currentSnapshot.actors.find(a => a.actorId === entity.id);
    if (entityActor && !actorSources.includes(getActorSource(entityActor))) {
      actorSources.push(getActorSource(entityActor));
    }
  }
  
  // Ensure at least 2 sources for better scoring
  if (actorSources.length < 2 && primaryActor) {
    actorSources.push('attributed'); // Add secondary as attributed if missing
  }
  
  // P0.1: Build actor weights for structural scoring
  const actorWeights: ActorWeightInfo[] = [];
  const verifiedTypes = ['exchange', 'protocol', 'market_maker', 'infra'];
  
  // Add primary actor weight
  if (primaryActor) {
    const isExchangeOrMM = verifiedTypes.includes(primaryActor.type || '');
    const flowShare = primaryActor.flow_share ?? 0;
    const weight: ActorWeightInfo = {
      actorId: primaryActor.actorId,
      actorType: primaryActor.type || 'trader',
      sourceLevel: getActorSource(primaryActor),
      isExchangeOrMM,
      flowSharePct: Math.min(1, flowShare),
      connectivityDegree: Math.min(1, (primaryActor.counterparty_count ?? 10) / 100),
      historicalActivity: Math.min(1, (primaryActor.tx_count ?? 20) / 200),
      weight: 0,
    };
    weight.weight = calculateActorWeight(weight);
    // P2.B: Add entity info for cluster resolution
    (weight as any).entityId = primaryActor.entityId || primaryActor.entity_id;
    (weight as any).ownerId = primaryActor.ownerId || primaryActor.owner_id;
    (weight as any).communityId = primaryActor.communityId || primaryActor.community_id;
    actorWeights.push(weight);
  }
  
  // Add secondary actor weight
  if (secondaryActor) {
    const isExchangeOrMM = verifiedTypes.includes(secondaryActor.type || '');
    const flowShare = secondaryActor.flow_share ?? 0;
    const weight: ActorWeightInfo = {
      actorId: secondaryActor.actorId,
      actorType: secondaryActor.type || 'trader',
      sourceLevel: getActorSource(secondaryActor),
      isExchangeOrMM,
      flowSharePct: Math.min(1, flowShare),
      connectivityDegree: Math.min(1, (secondaryActor.counterparty_count ?? 10) / 100),
      historicalActivity: Math.min(1, (secondaryActor.tx_count ?? 20) / 200),
      weight: 0,
    };
    weight.weight = calculateActorWeight(weight);
    // P2.B: Add entity info for cluster resolution
    (weight as any).entityId = secondaryActor.entityId || secondaryActor.entity_id;
    (weight as any).ownerId = secondaryActor.ownerId || secondaryActor.owner_id;
    (weight as any).communityId = secondaryActor.communityId || secondaryActor.community_id;
    actorWeights.push(weight);
  }
  
  // Build confidence input
  const confidenceInput: ConfidenceInput = {
    signalType: candidate.type,
    severity: candidate.severity,
    window: ctx.window,
    primaryActorId: candidate.primary.id,
    secondaryActorId: candidate.secondary?.id,
    entityIds: candidate.entities.map(e => e.id),
    evidenceMetrics: candidate.evidence.current || {},
    // P1.4: Use real snapshot coverage if available, otherwise calculate from actors
    snapshotCoverage: (ctx.currentSnapshot as any).coverage?.actorsCoveragePct 
      || calculateAvgActorCoverage(ctx.currentSnapshot.actors),
    actorSources,
    actorCoverages: [
      primaryActor?.coverage || 0,
      secondaryActor?.coverage || 0,
    ].filter(c => c > 0),
    // P0.1: Actor weights for structural scoring
    actorWeights,
    netFlowUsd: candidate.metrics.netFlowRatio 
      ? (primaryActor?.net_flow_usd || 0) 
      : (candidate.metrics.density?.current || 0) * 1000,
    inflowUsd: primaryActor?.inflow_usd || 0,
    outflowUsd: primaryActor?.outflow_usd || 0,
    density: candidate.metrics.density?.current,
    has7dSupport: ctx.window === '7d',
    // P1.3: No lastTriggeredAt for new signals (full confidence)
    lastTriggeredAt: undefined,
  };
  
  // Calculate confidence with trace (ETAP 7 + P1)
  const confidence = calculateConfidenceWithTrace(confidenceInput);
  
  // Map confidenceLabel to legacy confidence field (low/medium/high)
  const legacyConfidence = confidence.label === 'HIDDEN' ? 'low' : confidence.label.toLowerCase();
  
  // P1: Initialize lifecycle state
  const now = new Date();
  const lifecycle = createInitialLifecycleState(now);
  
  // P1: Apply lifecycle transition (NEW → ACTIVE if confidence meets threshold)
  const updatedLifecycle = applyLifecycleTransition(lifecycle, {
    triggered: true,
    confidence: confidence.score,
    now,
  });
  
  const signal = new D1SignalModel({
    id: `sig_${candidate.signalKey}`,
    signalKey: candidate.signalKey,
    type: candidate.type,
    scope: candidate.scope,
    status: 'new' as D1Status,
    severity: candidate.severity,
    confidence: legacyConfidence, // Legacy field (low/medium/high)
    window: ctx.window,
    snapshotId: ctx.snapshotId,
    title: candidate.title,
    subtitle: candidate.subtitle,
    disclaimer: 'Structural alert based on observed on-chain activity. Not predictive. Not trading advice.',
    primary: candidate.primary,
    secondary: candidate.secondary,
    entities: candidate.entities,
    direction: candidate.direction,
    metrics: candidate.metrics,
    tags: ['Flow', candidate.scope.charAt(0).toUpperCase() + candidate.scope.slice(1)],
    evidence: candidate.evidence,
    summary: candidate.summary,
    links: {
      graph: `/actors/correlation?focus=${candidate.primary.id}&window=${ctx.window}`,
      primary: `/actors/${candidate.primary.id}`,
      secondary: candidate.secondary ? `/actors/${candidate.secondary.id}` : undefined,
    },
    runId: ctx.runId,
    
    // ETAP 7: Confidence fields
    confidenceScore: confidence.score,
    confidenceLabel: confidence.label,
    confidenceBreakdown: confidence.breakdown,
    confidenceReasons: confidence.reasons,
    
    // P1: Lifecycle fields
    lifecycleStatus: updatedLifecycle.status,
    firstTriggeredAt: updatedLifecycle.firstTriggeredAt,
    lastTriggeredAt: updatedLifecycle.lastTriggeredAt,
    snapshotsWithoutTrigger: updatedLifecycle.snapshotsWithoutTrigger,
    
    // P1.5: Confidence trace
    confidenceTrace: confidence.trace,
  });
  
  await signal.save();
  return signal.toObject();
}

/**
 * Auto-resolve signals not seen in this run
 * P1: Uses lifecycle state machine for proper transitions
 */
async function autoResolveSignals(ctx: EngineContext): Promise<number> {
  const now = new Date();
  let resolvedCount = 0;
  
  // Process each existing signal not re-triggered
  for (const [key, signal] of ctx.existingSignals) {
    if (!ctx.activeSignalKeys.has(key)) {
      // P1: Build current lifecycle state from signal
      const currentLifecycle: SignalLifecycleState = {
        status: (signal.lifecycleStatus as any) || 'ACTIVE',
        firstTriggeredAt: signal.firstTriggeredAt || signal.createdAt,
        lastTriggeredAt: signal.lastTriggeredAt || signal.createdAt,
        snapshotsWithoutTrigger: signal.snapshotsWithoutTrigger || 0,
        resolveReason: signal.resolveReason as any,
      };
      
      // Apply transition (not triggered this run)
      const updatedLifecycle = applyLifecycleTransition(currentLifecycle, {
        triggered: false,
        confidence: signal.confidenceScore || 50,
        now,
      });
      
      // Update signal with new lifecycle state
      await D1SignalModel.updateOne(
        { id: signal.id },
        {
          $set: {
            lifecycleStatus: updatedLifecycle.status,
            snapshotsWithoutTrigger: updatedLifecycle.snapshotsWithoutTrigger,
            resolveReason: updatedLifecycle.resolveReason,
            // Also update legacy status field
            status: updatedLifecycle.status === 'RESOLVED' ? 'archived' : 
                   updatedLifecycle.status === 'COOLDOWN' ? 'cooling' : 'active',
            updatedAt: now,
          }
        }
      );
      
      if (updatedLifecycle.status === 'RESOLVED') {
        resolvedCount++;
      }
    }
  }
  
  if (resolvedCount > 0) {
    console.log(`[Engine v2] P1 Lifecycle: Resolved ${resolvedCount} signals (inactivity)`);
  }
  
  return resolvedCount;
}

/**
 * Get last run info
 */
export async function getLastRunV2(window: D1Window = '7d'): Promise<D1SignalRun | null> {
  const run = await D1SignalRunModel.findOne({ window }).sort({ startedAt: -1 }).lean();
  return run as D1SignalRun | null;
}
