/**
 * EPIC D1 — Signal Engine v1 (Rules-Only)
 * 
 * Generates L1 signals from L0 Graph/Actors data.
 * Pure rules, NO ML, NO price predictions.
 * 
 * Rules implemented:
 * - NEW_CORRIDOR: New persistent transaction path
 * - DENSITY_SPIKE: Sharp increase in corridor activity
 * - DIRECTION_IMBALANCE: One-sided flow in corridor
 * - ACTOR_REGIME_CHANGE: Actor behavior pattern shift
 * - NEW_BRIDGE: New structural connection between clusters
 */
import { v4 as uuidv4 } from 'uuid';
import { D1SignalModel, D1SignalRunModel } from './d1_signal.model.js';
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
import { ActorModel } from '../actors/actor.model.js';
import { ActorScoreModel } from '../actor_scores/actor_score.model.js';
import { ComputedGraphModel } from '../actors/computed_graph.model.js';

// ==================== CONSTANTS ====================

// Thresholds for signal generation
const THRESHOLDS = {
  // NEW_CORRIDOR: edge must persist for at least 6 hours with density >= 3
  NEW_CORRIDOR_MIN_DENSITY: 3,
  NEW_CORRIDOR_MIN_HOURS: 6,
  
  // DENSITY_SPIKE: density must increase by 70%+
  DENSITY_SPIKE_DELTA_PCT: 70,
  DENSITY_SPIKE_MIN_CURRENT: 5,
  
  // DIRECTION_IMBALANCE: ratio must exceed 75%
  DIRECTION_IMBALANCE_MIN_RATIO: 0.75,
  DIRECTION_IMBALANCE_MIN_VOLUME: 50000, // $50k minimum
  
  // ACTOR_REGIME_CHANGE: score delta > 0.3
  REGIME_CHANGE_SCORE_DELTA: 0.3,
  
  // NEW_BRIDGE: new edge between previously unconnected clusters
  BRIDGE_MIN_WEIGHT: 0.5,
  
  // General
  MIN_EDGE_WEIGHT: 0.3,
  MAX_SIGNALS_PER_RUN: 50,
};

// Rule version for tracking
const RULE_VERSION = '1.0.0';

// ==================== TYPES ====================

interface GraphEdgeData {
  id: string;
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  weight: number;
  density: number;
  direction: 'in' | 'out' | 'bidirectional';
  inflowUsd: number;
  outflowUsd: number;
  txCount: number;
  firstSeen?: Date;
  lastSeen?: Date;
}

interface ActorData {
  id: string;
  name: string;
  type: string;
  sourceLevel: string;
  coverage: number;
  edgeScore: number;
  participation: number;
  flowRole: string;
}

interface EngineContext {
  window: D1Window;
  runId: string;
  edges: GraphEdgeData[];
  actors: ActorData[];
  previousEdges: GraphEdgeData[];
  previousActors: ActorData[];
  existingSignals: Map<string, D1Signal>;
}

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
  fingerprint: string; // For deduplication
}

// ==================== DATA LOADING ====================

/**
 * Load computed graph edges for a window
 */
async function loadGraphEdges(window: D1Window): Promise<GraphEdgeData[]> {
  try {
    const graph = await ComputedGraphModel.findOne({ window }).lean();
    if (!graph || !graph.edges) return [];
    
    return (graph.edges as any[]).map(edge => ({
      id: edge.id || `${edge.from}_${edge.to}`,
      from: edge.from,
      to: edge.to,
      fromLabel: edge.fromLabel || edge.from,
      toLabel: edge.toLabel || edge.to,
      weight: edge.relationship?.strength || edge.weight || 0,
      density: edge.evidence?.txCount || 0,
      direction: edge.flow?.direction || 'bidirectional',
      inflowUsd: edge.flow?.inflowUsd || 0,
      outflowUsd: edge.flow?.outflowUsd || 0,
      txCount: edge.evidence?.txCount || 0,
      firstSeen: edge.evidence?.firstSeen ? new Date(edge.evidence.firstSeen) : undefined,
      lastSeen: edge.evidence?.lastSeen ? new Date(edge.evidence.lastSeen) : undefined,
    }));
  } catch (err) {
    console.error('Failed to load graph edges:', err);
    return [];
  }
}

/**
 * Load actor data with scores
 */
async function loadActorData(window: D1Window): Promise<ActorData[]> {
  try {
    const [actors, scores] = await Promise.all([
      ActorModel.find().lean(),
      ActorScoreModel.find({ window }).lean()
    ]);
    
    const scoreMap = new Map((scores as any[]).map(s => [s.actorId, s]));
    
    return (actors as any[]).map(actor => {
      const score = scoreMap.get(actor.id);
      return {
        id: actor.id,
        name: actor.name || 'Unknown',
        type: actor.type || 'trader',
        sourceLevel: actor.sourceLevel || 'behavioral',
        coverage: (actor.coverage?.score || 0) / 100,
        edgeScore: score?.edgeScore || 0,
        participation: score?.participation || 0,
        flowRole: score?.flowRole || 'neutral',
      };
    });
  } catch (err) {
    console.error('Failed to load actor data:', err);
    return [];
  }
}

/**
 * Get previous window for comparison
 */
function getPreviousWindow(window: D1Window): D1Window {
  switch (window) {
    case '24h': return '7d';
    case '7d': return '30d';
    case '30d': return '30d'; // No previous for 30d, compare to itself
  }
}

/**
 * Load existing signals to avoid duplicates
 */
async function loadExistingSignals(window: D1Window): Promise<Map<string, D1Signal>> {
  const signals = await D1SignalModel.find({ 
    window, 
    status: { $in: ['new', 'active'] } 
  }).lean();
  
  const map = new Map<string, D1Signal>();
  for (const sig of signals as any[]) {
    // Create fingerprint from type + entities
    const entityIds = (sig.entities || []).map((e: D1EntityRef) => e.id).sort().join('|');
    const fingerprint = `${sig.type}:${entityIds}`;
    map.set(fingerprint, sig as D1Signal);
  }
  return map;
}

// ==================== RULE: NEW_CORRIDOR ====================

/**
 * Detect new corridors that didn't exist in previous window
 */
function detectNewCorridors(ctx: EngineContext): SignalCandidate[] {
  const candidates: SignalCandidate[] = [];
  const previousEdgeSet = new Set(ctx.previousEdges.map(e => `${e.from}_${e.to}`));
  
  for (const edge of ctx.edges) {
    // Skip if edge existed before
    const edgeKey = `${edge.from}_${edge.to}`;
    if (previousEdgeSet.has(edgeKey)) continue;
    
    // Check thresholds
    if (edge.density < THRESHOLDS.NEW_CORRIDOR_MIN_DENSITY) continue;
    if (edge.weight < THRESHOLDS.MIN_EDGE_WEIGHT) continue;
    
    // Check persistence (if we have firstSeen)
    if (edge.firstSeen) {
      const hoursOld = (Date.now() - edge.firstSeen.getTime()) / (1000 * 60 * 60);
      if (hoursOld < THRESHOLDS.NEW_CORRIDOR_MIN_HOURS) continue;
    }
    
    const primary: D1EntityRef = {
      kind: 'actor',
      id: edge.from,
      label: edge.fromLabel,
      type: 'unknown',
      source: 'graph',
    };
    
    const secondary: D1EntityRef = {
      kind: 'actor',
      id: edge.to,
      label: edge.toLabel,
      type: 'unknown',
      source: 'graph',
    };
    
    const severity: D1Severity = edge.density >= 10 ? 'high' : edge.density >= 5 ? 'medium' : 'low';
    
    candidates.push({
      type: 'NEW_CORRIDOR',
      severity,
      scope: 'corridor',
      title: `New corridor detected between ${edge.fromLabel} ↔ ${edge.toLabel}`,
      subtitle: 'Persistent bidirectional flow emerged vs baseline',
      primary,
      secondary,
      entities: [primary, secondary],
      direction: 'bidirectional',
      metrics: {
        density: { current: edge.density, previous: 0, deltaPct: null },
        inflowUsd: edge.inflowUsd,
        outflowUsd: edge.outflowUsd,
        netFlowRatio: edge.inflowUsd / (edge.inflowUsd + edge.outflowUsd + 1),
        edgesCount: 1,
      },
      evidence: {
        rule: {
          name: 'NEW_CORRIDOR',
          version: RULE_VERSION,
          thresholds: {
            minDensity: THRESHOLDS.NEW_CORRIDOR_MIN_DENSITY,
            minHours: THRESHOLDS.NEW_CORRIDOR_MIN_HOURS,
          },
        },
        baseline: { density: 0, window: getPreviousWindow(ctx.window) },
        current: { density: edge.density, window: ctx.window },
        persistence: {
          hours: edge.firstSeen ? Math.round((Date.now() - edge.firstSeen.getTime()) / (1000 * 60 * 60)) : undefined,
          firstSeenAt: edge.firstSeen,
        },
        flows: {
          inflowUsd: edge.inflowUsd,
          outflowUsd: edge.outflowUsd,
          netUsd: edge.inflowUsd - edge.outflowUsd,
        },
      },
      summary: {
        what: 'A new persistent transaction corridor emerged compared to baseline.',
        whyNow: `Density crossed threshold (${edge.density} >= ${THRESHOLDS.NEW_CORRIDOR_MIN_DENSITY}) and persisted.`,
        soWhat: 'Indicates a structural connection forming; may reflect routing or operational flows.',
      },
      fingerprint: `NEW_CORRIDOR:${[edge.from, edge.to].sort().join('|')}`,
    });
  }
  
  return candidates;
}

// ==================== RULE: DENSITY_SPIKE ====================

/**
 * Detect significant density increases in existing corridors
 */
function detectDensitySpikes(ctx: EngineContext): SignalCandidate[] {
  const candidates: SignalCandidate[] = [];
  const previousEdgeMap = new Map(ctx.previousEdges.map(e => [`${e.from}_${e.to}`, e]));
  
  for (const edge of ctx.edges) {
    const edgeKey = `${edge.from}_${edge.to}`;
    const prevEdge = previousEdgeMap.get(edgeKey);
    
    // Only check existing edges
    if (!prevEdge) continue;
    if (edge.density < THRESHOLDS.DENSITY_SPIKE_MIN_CURRENT) continue;
    
    // Calculate delta
    const deltaPct = prevEdge.density > 0 
      ? ((edge.density - prevEdge.density) / prevEdge.density) * 100
      : 100;
    
    if (deltaPct < THRESHOLDS.DENSITY_SPIKE_DELTA_PCT) continue;
    
    const primary: D1EntityRef = {
      kind: 'actor',
      id: edge.from,
      label: edge.fromLabel,
      type: 'unknown',
      source: 'graph',
    };
    
    const secondary: D1EntityRef = {
      kind: 'actor',
      id: edge.to,
      label: edge.toLabel,
      type: 'unknown',
      source: 'graph',
    };
    
    const severity: D1Severity = deltaPct >= 200 ? 'high' : deltaPct >= 100 ? 'medium' : 'low';
    
    candidates.push({
      type: 'DENSITY_SPIKE',
      severity,
      scope: 'corridor',
      title: `Density spike in ${edge.fromLabel} ↔ ${edge.toLabel} corridor`,
      subtitle: 'Activity increased sharply within existing corridor',
      primary,
      secondary,
      entities: [primary, secondary],
      direction: edge.direction === 'in' ? 'inflow' : edge.direction === 'out' ? 'outflow' : 'bidirectional',
      metrics: {
        density: { current: edge.density, previous: prevEdge.density, deltaPct: Math.round(deltaPct) },
        inflowUsd: edge.inflowUsd,
        outflowUsd: edge.outflowUsd,
        netFlowRatio: edge.inflowUsd / (edge.inflowUsd + edge.outflowUsd + 1),
        edgesCount: 1,
      },
      evidence: {
        rule: {
          name: 'DENSITY_SPIKE',
          version: RULE_VERSION,
          thresholds: {
            minDeltaPct: THRESHOLDS.DENSITY_SPIKE_DELTA_PCT,
            minCurrent: THRESHOLDS.DENSITY_SPIKE_MIN_CURRENT,
          },
        },
        baseline: { density: prevEdge.density, window: getPreviousWindow(ctx.window) },
        current: { density: edge.density, window: ctx.window },
        flows: {
          inflowUsd: edge.inflowUsd,
          outflowUsd: edge.outflowUsd,
          netUsd: edge.inflowUsd - edge.outflowUsd,
        },
      },
      summary: {
        what: 'Transaction density increased significantly within an existing corridor.',
        whyNow: `Density grew ${Math.round(deltaPct)}% compared to baseline window.`,
        soWhat: 'May indicate increased operational activity or liquidity rebalancing.',
      },
      fingerprint: `DENSITY_SPIKE:${[edge.from, edge.to].sort().join('|')}`,
    });
  }
  
  return candidates;
}

// ==================== RULE: DIRECTION_IMBALANCE ====================

/**
 * Detect corridors with strongly one-sided flow
 */
function detectDirectionImbalance(ctx: EngineContext): SignalCandidate[] {
  const candidates: SignalCandidate[] = [];
  
  for (const edge of ctx.edges) {
    const totalVolume = edge.inflowUsd + edge.outflowUsd;
    if (totalVolume < THRESHOLDS.DIRECTION_IMBALANCE_MIN_VOLUME) continue;
    
    const ratio = Math.max(edge.inflowUsd, edge.outflowUsd) / totalVolume;
    if (ratio < THRESHOLDS.DIRECTION_IMBALANCE_MIN_RATIO) continue;
    
    const isInflow = edge.inflowUsd > edge.outflowUsd;
    const direction = isInflow ? 'inflow' : 'outflow';
    
    const primary: D1EntityRef = {
      kind: 'actor',
      id: isInflow ? edge.to : edge.from,
      label: isInflow ? edge.toLabel : edge.fromLabel,
      type: 'unknown',
      source: 'graph',
    };
    
    const secondary: D1EntityRef = {
      kind: 'actor',
      id: isInflow ? edge.from : edge.to,
      label: isInflow ? edge.fromLabel : edge.toLabel,
      type: 'unknown',
      source: 'graph',
    };
    
    const severity: D1Severity = ratio >= 0.9 ? 'high' : ratio >= 0.8 ? 'medium' : 'low';
    
    candidates.push({
      type: 'DIRECTION_IMBALANCE',
      severity,
      scope: 'corridor',
      title: `Flow imbalance: ${secondary.label} → ${primary.label}`,
      subtitle: 'One-sided flow detected in corridor',
      primary,
      secondary,
      entities: [primary, secondary],
      direction,
      metrics: {
        density: { current: edge.density, previous: 0, deltaPct: null },
        inflowUsd: edge.inflowUsd,
        outflowUsd: edge.outflowUsd,
        netFlowRatio: ratio,
        edgesCount: 1,
      },
      evidence: {
        rule: {
          name: 'DIRECTION_IMBALANCE',
          version: RULE_VERSION,
          thresholds: {
            minRatio: THRESHOLDS.DIRECTION_IMBALANCE_MIN_RATIO,
            minVolume: THRESHOLDS.DIRECTION_IMBALANCE_MIN_VOLUME,
          },
        },
        current: { 
          density: edge.density, 
          direction: isInflow ? 'inflow' : 'outflow',
          window: ctx.window 
        },
        flows: {
          inflowUsd: edge.inflowUsd,
          outflowUsd: edge.outflowUsd,
          netUsd: edge.inflowUsd - edge.outflowUsd,
        },
      },
      summary: {
        what: 'Flow became strongly one-sided within this corridor.',
        whyNow: `Imbalance ratio exceeded ${Math.round(ratio * 100)}% threshold.`,
        soWhat: 'May indicate accumulation, distribution, or liquidity movement.',
      },
      fingerprint: `DIRECTION_IMBALANCE:${[edge.from, edge.to].sort().join('|')}`,
    });
  }
  
  return candidates;
}

// ==================== RULE: ACTOR_REGIME_CHANGE ====================

/**
 * Detect significant changes in actor behavior patterns
 */
function detectActorRegimeChanges(ctx: EngineContext): SignalCandidate[] {
  const candidates: SignalCandidate[] = [];
  const previousActorMap = new Map(ctx.previousActors.map(a => [a.id, a]));
  
  for (const actor of ctx.actors) {
    const prevActor = previousActorMap.get(actor.id);
    if (!prevActor) continue;
    
    // Check edge score delta
    const scoreDelta = Math.abs(actor.edgeScore - prevActor.edgeScore);
    if (scoreDelta < THRESHOLDS.REGIME_CHANGE_SCORE_DELTA) continue;
    
    // Check flow role change
    const roleChanged = actor.flowRole !== prevActor.flowRole;
    if (!roleChanged && scoreDelta < 0.5) continue;
    
    const primary: D1EntityRef = {
      kind: 'actor',
      id: actor.id,
      label: actor.name,
      type: actor.type,
      source: actor.sourceLevel,
      coverage: actor.coverage,
    };
    
    const severity: D1Severity = scoreDelta >= 0.7 ? 'high' : scoreDelta >= 0.5 ? 'medium' : 'low';
    
    candidates.push({
      type: 'ACTOR_REGIME_CHANGE',
      severity,
      scope: 'actor',
      title: `${actor.name} behavior pattern shifted`,
      subtitle: 'Actor regime changed from previous window',
      primary,
      entities: [primary],
      direction: 'neutral',
      metrics: {
        density: { current: actor.edgeScore * 10, previous: prevActor.edgeScore * 10, deltaPct: Math.round(scoreDelta * 100) },
      },
      evidence: {
        rule: {
          name: 'ACTOR_REGIME_CHANGE',
          version: RULE_VERSION,
          thresholds: {
            minScoreDelta: THRESHOLDS.REGIME_CHANGE_SCORE_DELTA,
          },
        },
        regime: {
          previous: prevActor.flowRole,
          current: actor.flowRole,
          confidence: actor.coverage,
        },
      },
      summary: {
        what: 'Actor behavior pattern shifted from previous regime.',
        whyNow: `Flow role changed from "${prevActor.flowRole}" to "${actor.flowRole}".`,
        soWhat: 'May indicate strategic shift in actor operations.',
      },
      fingerprint: `ACTOR_REGIME_CHANGE:${actor.id}`,
    });
  }
  
  return candidates;
}

// ==================== RULE: NEW_BRIDGE ====================

/**
 * Detect new structural connections between clusters
 */
function detectNewBridges(ctx: EngineContext): SignalCandidate[] {
  const candidates: SignalCandidate[] = [];
  const previousEdgeSet = new Set(ctx.previousEdges.map(e => `${e.from}_${e.to}`));
  
  // Track actor types to find cross-type bridges
  const actorTypeMap = new Map(ctx.actors.map(a => [a.id, a.type]));
  
  for (const edge of ctx.edges) {
    const edgeKey = `${edge.from}_${edge.to}`;
    if (previousEdgeSet.has(edgeKey)) continue;
    if (edge.weight < THRESHOLDS.BRIDGE_MIN_WEIGHT) continue;
    
    // Check if connecting different actor types (cross-cluster bridge)
    const fromType = actorTypeMap.get(edge.from);
    const toType = actorTypeMap.get(edge.to);
    if (fromType === toType) continue; // Same type, not a bridge
    
    const primary: D1EntityRef = {
      kind: 'actor',
      id: edge.from,
      label: edge.fromLabel,
      type: fromType || 'unknown',
      source: 'graph',
    };
    
    const secondary: D1EntityRef = {
      kind: 'actor',
      id: edge.to,
      label: edge.toLabel,
      type: toType || 'unknown',
      source: 'graph',
    };
    
    candidates.push({
      type: 'NEW_BRIDGE',
      severity: 'low',
      scope: 'cluster',
      title: `New bridge connection via ${edge.fromLabel}`,
      subtitle: 'New structural link between clusters appeared',
      primary,
      secondary,
      entities: [primary, secondary],
      direction: 'bidirectional',
      metrics: {
        density: { current: edge.density, previous: 0, deltaPct: null },
        edgesCount: 1,
      },
      evidence: {
        rule: {
          name: 'NEW_BRIDGE',
          version: RULE_VERSION,
          thresholds: {
            minWeight: THRESHOLDS.BRIDGE_MIN_WEIGHT,
          },
        },
        baseline: { density: 0, window: getPreviousWindow(ctx.window) },
        current: { density: edge.density, window: ctx.window },
      },
      summary: {
        what: 'A new structural connection between previously unconnected clusters appeared.',
        whyNow: 'Bridge edge detected for the first time.',
        soWhat: 'May indicate new routing paths or intermediary relationships.',
      },
      fingerprint: `NEW_BRIDGE:${[edge.from, edge.to].sort().join('|')}`,
    });
  }
  
  return candidates;
}

// ==================== ENGINE RUNNER ====================

/**
 * Run the signal engine for a given window
 */
export async function runSignalEngine(window: D1Window = '7d'): Promise<D1SignalRun> {
  const runId = `run_engine_${Date.now()}`;
  const startedAt = new Date();
  
  console.log(`[Signal Engine] Starting run ${runId} for window ${window}`);
  
  // Create run document
  await D1SignalRunModel.create({
    runId,
    window,
    startedAt,
    status: 'running',
    stats: { created: 0, updated: 0, archived: 0, errors: 0 },
  });
  
  try {
    // Load data
    const previousWindow = getPreviousWindow(window);
    const [edges, actors, previousEdges, previousActors, existingSignals] = await Promise.all([
      loadGraphEdges(window),
      loadActorData(window),
      loadGraphEdges(previousWindow),
      loadActorData(previousWindow),
      loadExistingSignals(window),
    ]);
    
    console.log(`[Signal Engine] Loaded data: ${edges.length} edges, ${actors.length} actors`);
    
    const ctx: EngineContext = {
      window,
      runId,
      edges,
      actors,
      previousEdges,
      previousActors,
      existingSignals,
    };
    
    // Run all rules
    const allCandidates: SignalCandidate[] = [
      ...detectNewCorridors(ctx),
      ...detectDensitySpikes(ctx),
      ...detectDirectionImbalance(ctx),
      ...detectActorRegimeChanges(ctx),
      ...detectNewBridges(ctx),
    ];
    
    console.log(`[Signal Engine] Generated ${allCandidates.length} candidates`);
    
    // Deduplicate and limit
    const uniqueCandidates = deduplicateCandidates(allCandidates, existingSignals);
    const limitedCandidates = uniqueCandidates.slice(0, THRESHOLDS.MAX_SIGNALS_PER_RUN);
    
    console.log(`[Signal Engine] After dedup: ${limitedCandidates.length} signals`);
    
    // Create signals
    let created = 0;
    let errors = 0;
    const createdSignals: D1Signal[] = [];
    
    for (const candidate of limitedCandidates) {
      try {
        const signal = await createSignalFromCandidate(candidate, ctx);
        createdSignals.push(signal);
        created++;
      } catch (err) {
        console.error(`[Signal Engine] Error creating signal:`, err);
        errors++;
      }
    }
    
    // Update existing signals that are no longer valid
    const archived = await archiveStaleSignals(ctx);
    
    // ETAP 5: Dispatch HIGH severity signals to Telegram
    let telegramSent = 0;
    if (createdSignals.length > 0) {
      try {
        const { dispatchSignalsToTelegram } = await import('./d1_telegram.dispatcher.js');
        const dispatchResult = await dispatchSignalsToTelegram(createdSignals);
        telegramSent = dispatchResult.sent;
        console.log(`[Signal Engine] Telegram dispatch: ${telegramSent} sent`);
      } catch (err) {
        console.error(`[Signal Engine] Telegram dispatch error:`, err);
      }
    }
    
    // Update run status
    const completedAt = new Date();
    await D1SignalRunModel.updateOne(
      { runId },
      {
        completedAt,
        status: 'completed',
        stats: { created, updated: 0, archived, errors },
      }
    );
    
    console.log(`[Signal Engine] Run completed: ${created} created, ${archived} archived, ${telegramSent} telegram, ${errors} errors`);
    
    return {
      runId,
      window,
      startedAt,
      completedAt,
      status: 'completed',
      stats: { created, updated: 0, archived, errors },
    };
    
  } catch (err: any) {
    console.error(`[Signal Engine] Run failed:`, err);
    
    await D1SignalRunModel.updateOne(
      { runId },
      {
        completedAt: new Date(),
        status: 'failed',
        error: err.message,
      }
    );
    
    return {
      runId,
      window,
      startedAt,
      status: 'failed',
      stats: { created: 0, updated: 0, archived: 0, errors: 1 },
      error: err.message,
    };
  }
}

/**
 * Deduplicate candidates against existing signals
 */
function deduplicateCandidates(
  candidates: SignalCandidate[], 
  existing: Map<string, D1Signal>
): SignalCandidate[] {
  const seen = new Set<string>();
  const unique: SignalCandidate[] = [];
  
  for (const candidate of candidates) {
    // Skip if already exists
    if (existing.has(candidate.fingerprint)) continue;
    
    // Skip if duplicate in this batch
    if (seen.has(candidate.fingerprint)) continue;
    
    seen.add(candidate.fingerprint);
    unique.push(candidate);
  }
  
  // Sort by severity (high first)
  const severityOrder = { high: 0, medium: 1, low: 2 };
  unique.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  
  return unique;
}

/**
 * Create a signal document from a candidate
 */
async function createSignalFromCandidate(
  candidate: SignalCandidate, 
  ctx: EngineContext
): Promise<D1Signal> {
  const signal = new D1SignalModel({
    id: `sig_${uuidv4().slice(0, 12)}`,
    type: candidate.type,
    scope: candidate.scope,
    status: 'new' as D1Status,
    severity: candidate.severity,
    confidence: 'high',
    window: ctx.window,
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
    createdAt: new Date(),
    updatedAt: new Date(),
    runId: ctx.runId,
  });
  
  await signal.save();
  return signal.toObject();
}

/**
 * Archive signals that are no longer valid
 */
async function archiveStaleSignals(ctx: EngineContext): Promise<number> {
  // For now, mark signals older than 7 days as cooling
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const result = await D1SignalModel.updateMany(
    {
      window: ctx.window,
      status: 'new',
      createdAt: { $lt: cutoff },
    },
    {
      status: 'cooling',
      updatedAt: new Date(),
    }
  );
  
  return result.modifiedCount || 0;
}

/**
 * Get last run info
 */
export async function getLastRun(window: D1Window = '7d'): Promise<D1SignalRun | null> {
  const run = await D1SignalRunModel.findOne({ window }).sort({ startedAt: -1 }).lean();
  return run as D1SignalRun | null;
}
