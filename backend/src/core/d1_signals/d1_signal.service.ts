/**
 * EPIC D1 — Engine Signals Service
 * 
 * Provides CRUD operations for signals and seed data generation.
 */
import { v4 as uuidv4 } from 'uuid';
import { D1SignalModel, D1SignalRunModel } from './d1_signal.model.js';
import type { 
  D1Signal, 
  D1SignalQuery, 
  D1SignalListResponse, 
  D1SignalStatsResponse,
  D1SignalFacetsResponse,
  D1SignalType,
  D1Severity,
  D1Status,
  D1Window,
  D1EntityRef
} from './d1_signal.types.js';

// ==================== QUERY ====================

/**
 * Get signals list with filters
 */
export async function getSignals(query: D1SignalQuery): Promise<D1SignalListResponse> {
  const {
    window = '7d',
    status,
    type,
    scope,
    severity,
    confidence,
    q,
    actorId,
    entityId,
    sort = 'time',
    dir = 'desc',
    page = 1,
    limit = 12
  } = query;

  // Build filter
  const filter: Record<string, unknown> = { window };

  // Status filter
  if (status) {
    if (Array.isArray(status)) {
      filter.status = { $in: status };
    } else if (status !== 'all') {
      filter.status = status;
    }
  } else {
    // Default: new + active
    filter.status = { $in: ['new', 'active'] };
  }

  // Type filter
  if (type) {
    filter.type = Array.isArray(type) ? { $in: type } : type;
  }

  // Scope filter
  if (scope) {
    filter.scope = Array.isArray(scope) ? { $in: scope } : scope;
  }

  // Severity filter
  if (severity) {
    filter.severity = Array.isArray(severity) ? { $in: severity } : severity;
  }

  // Confidence filter
  if (confidence) {
    filter.confidence = Array.isArray(confidence) ? { $in: confidence } : confidence;
  }

  // Search filter
  if (q && q.trim()) {
    const searchRegex = new RegExp(q.trim(), 'i');
    filter.$or = [
      { title: searchRegex },
      { 'primary.label': searchRegex },
      { 'secondary.label': searchRegex },
      { 'entities.label': searchRegex }
    ];
  }

  // Actor/Entity filter
  if (actorId) {
    filter.$or = [
      { 'primary.id': actorId },
      { 'secondary.id': actorId },
      { 'entities.id': actorId }
    ];
  }
  if (entityId) {
    filter.$or = [
      { 'primary.id': entityId },
      { 'secondary.id': entityId },
      { 'entities.id': entityId }
    ];
  }

  // Sort
  const sortField = sort === 'time' ? 'createdAt' : sort === 'severity' ? 'severity' : 'confidence';
  const sortDir = dir === 'asc' ? 1 : -1;

  // Execute query
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    D1SignalModel.find(filter)
      .sort({ [sortField]: sortDir, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    D1SignalModel.countDocuments(filter)
  ]);

  return {
    meta: {
      window,
      status: status as D1Status || 'all',
      page,
      limit,
      total,
      hasMore: skip + items.length < total
    },
    items: items.map(formatSignal)
  };
}

/**
 * Get signal by ID
 */
export async function getSignalById(id: string): Promise<D1Signal | null> {
  const signal = await D1SignalModel.findOne({ id }).lean();
  return signal ? formatSignal(signal) : null;
}

/**
 * Get signal stats summary
 */
export async function getSignalStats(window: D1Window = '7d'): Promise<D1SignalStatsResponse> {
  const [statusCounts, typeCounts, severityCounts] = await Promise.all([
    D1SignalModel.aggregate([
      { $match: { window } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    D1SignalModel.aggregate([
      { $match: { window, status: { $in: ['new', 'active'] } } },
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]),
    D1SignalModel.aggregate([
      { $match: { window, status: { $in: ['new', 'active'] } } },
      { $group: { _id: '$severity', count: { $sum: 1 } } }
    ])
  ]);

  const counts = {
    active: 0,
    new: 0,
    cooling: 0,
    archived: 0,
    total: 0
  };
  statusCounts.forEach(s => {
    counts[s._id as keyof typeof counts] = s.count;
    counts.total += s.count;
  });

  const byType: Record<string, number> = {};
  typeCounts.forEach(t => { byType[t._id] = t.count; });

  const bySeverity: Record<string, number> = { low: 0, medium: 0, high: 0 };
  severityCounts.forEach(s => { bySeverity[s._id] = s.count; });

  return { window, counts, byType, bySeverity };
}

/**
 * Get facets for filters
 */
export async function getSignalFacets(window: D1Window = '7d'): Promise<D1SignalFacetsResponse> {
  return {
    window,
    types: ['NEW_CORRIDOR', 'DENSITY_SPIKE', 'DIRECTION_IMBALANCE', 'ACTOR_REGIME_CHANGE', 'NEW_BRIDGE'],
    statuses: ['new', 'active', 'cooling', 'archived'],
    scopes: ['actor', 'entity', 'wallet', 'cluster', 'corridor'],
    severity: ['low', 'medium', 'high'],
    confidence: ['low', 'medium', 'high']
  };
}

/**
 * Get signal history (lifecycle events)
 */
export async function getSignalHistory(id: string) {
  const signal = await D1SignalModel.findOne({ id }).lean();
  if (!signal) return null;

  // Simple history based on timestamps
  const events = [
    { ts: signal.createdAt, status: 'new', note: 'First seen' }
  ];
  
  if (signal.status !== 'new') {
    events.push({ ts: signal.updatedAt, status: signal.status, note: `Status changed to ${signal.status}` });
  }

  return { id, events };
}

/**
 * Get graph context for signal
 */
export async function getSignalGraphContext(id: string) {
  const signal = await D1SignalModel.findOne({ id }).lean();
  if (!signal) return null;

  const nodes: string[] = [];
  const edges: string[] = [];

  // Collect node IDs
  if (signal.primary?.id) nodes.push(signal.primary.id);
  if (signal.secondary?.id) nodes.push(signal.secondary.id);
  signal.entities?.forEach(e => nodes.push(e.id));

  // Collect edge IDs from evidence
  signal.evidence?.topEdges?.forEach(e => {
    if (e.edgeId) edges.push(e.edgeId);
  });

  return {
    id,
    window: signal.window,
    focus: { nodes: [...new Set(nodes)], edges: [...new Set(edges)] },
    hint: {
      zoom: 1.3,
      centerOn: signal.primary?.id || nodes[0]
    }
  };
}

// ==================== MUTATIONS ====================

/**
 * Create a new signal
 */
export async function createSignal(data: Partial<D1Signal>): Promise<D1Signal> {
  const signal = new D1SignalModel({
    ...data,
    id: data.id || `sig_${uuidv4().slice(0, 12)}`,
    status: data.status || 'new',
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await signal.save();
  return formatSignal(signal.toObject());
}

/**
 * Update signal status
 */
export async function updateSignalStatus(id: string, status: D1Status): Promise<D1Signal | null> {
  const signal = await D1SignalModel.findOneAndUpdate(
    { id },
    { status, updatedAt: new Date() },
    { new: true }
  ).lean();
  return signal ? formatSignal(signal) : null;
}

/**
 * Archive signal
 */
export async function archiveSignal(id: string): Promise<D1Signal | null> {
  return updateSignalStatus(id, 'archived');
}

// ==================== SEED DATA ====================

const SEED_ACTORS: D1EntityRef[] = [
  { kind: 'actor', id: 'actor_binance', label: 'Binance', type: 'exchange', source: 'verified', coverage: 0.85 },
  { kind: 'actor', id: 'actor_coinbase', label: 'Coinbase', type: 'exchange', source: 'verified', coverage: 0.78 },
  { kind: 'actor', id: 'actor_a16z', label: 'a16z', type: 'fund', source: 'verified', coverage: 0.72 },
  { kind: 'actor', id: 'actor_paradigm', label: 'Paradigm', type: 'fund', source: 'verified', coverage: 0.68 },
  { kind: 'actor', id: 'actor_jump', label: 'Jump Trading', type: 'market_maker', source: 'attributed', coverage: 0.65 },
  { kind: 'actor', id: 'actor_wintermute', label: 'Wintermute', type: 'market_maker', source: 'attributed', coverage: 0.62 },
  { kind: 'entity', id: 'ent_circle', label: 'Circle', type: 'issuer', source: 'verified', coverage: 0.58 },
  { kind: 'entity', id: 'ent_tether', label: 'Tether', type: 'issuer', source: 'verified', coverage: 0.55 }
];

const SEED_SIGNAL_TEMPLATES = [
  {
    type: 'NEW_CORRIDOR' as D1SignalType,
    scope: 'corridor' as const,
    severity: 'medium' as D1Severity,
    titleTemplate: (p: D1EntityRef, s: D1EntityRef) => `New corridor detected between ${p.label} ↔ ${s.label}`,
    subtitleTemplate: () => 'Persistent bidirectional flow emerged vs baseline',
    what: 'A new persistent transaction corridor emerged compared to baseline.',
    whyNow: 'Density crossed threshold and persisted for 6+ hours.',
    soWhat: 'Indicates a structural connection forming; may reflect routing or operational flows.'
  },
  {
    type: 'DENSITY_SPIKE' as D1SignalType,
    scope: 'corridor' as const,
    severity: 'high' as D1Severity,
    titleTemplate: (p: D1EntityRef, s: D1EntityRef) => `Density spike in ${p.label} ↔ ${s.label} corridor`,
    subtitleTemplate: () => 'Activity increased sharply within existing corridor',
    what: 'Transaction density increased significantly within an existing corridor.',
    whyNow: 'Density grew over 70% compared to baseline window.',
    soWhat: 'May indicate increased operational activity or liquidity rebalancing.'
  },
  {
    type: 'DIRECTION_IMBALANCE' as D1SignalType,
    scope: 'corridor' as const,
    severity: 'medium' as D1Severity,
    titleTemplate: (p: D1EntityRef, s: D1EntityRef) => `Flow imbalance: ${p.label} → ${s.label}`,
    subtitleTemplate: () => 'One-sided flow detected in corridor',
    what: 'Flow became strongly one-sided within this corridor.',
    whyNow: 'Imbalance ratio exceeded 75% threshold.',
    soWhat: 'May indicate accumulation, distribution, or liquidity movement.'
  },
  {
    type: 'ACTOR_REGIME_CHANGE' as D1SignalType,
    scope: 'actor' as const,
    severity: 'high' as D1Severity,
    titleTemplate: (p: D1EntityRef) => `${p.label} behavior pattern shifted`,
    subtitleTemplate: () => 'Actor regime changed from previous window',
    what: 'Actor behavior pattern shifted from previous regime.',
    whyNow: 'Regime change detected with high confidence.',
    soWhat: 'May indicate strategic shift in actor operations.'
  },
  {
    type: 'NEW_BRIDGE' as D1SignalType,
    scope: 'cluster' as const,
    severity: 'low' as D1Severity,
    titleTemplate: (p: D1EntityRef) => `New bridge connection via ${p.label}`,
    subtitleTemplate: () => 'New structural link between clusters appeared',
    what: 'A new structural connection between previously unconnected clusters appeared.',
    whyNow: 'Bridge edge detected for the first time.',
    soWhat: 'May indicate new routing paths or intermediary relationships.'
  }
];

/**
 * Seed sample signals for development
 */
export async function seedSignals(count: number = 15, window: D1Window = '7d'): Promise<{ created: number; runId: string }> {
  const runId = `run_seed_${Date.now()}`;
  const signals: Partial<D1Signal>[] = [];
  
  for (let i = 0; i < count; i++) {
    const template = SEED_SIGNAL_TEMPLATES[i % SEED_SIGNAL_TEMPLATES.length];
    const primary = SEED_ACTORS[i % SEED_ACTORS.length];
    const secondary = SEED_ACTORS[(i + 3) % SEED_ACTORS.length];
    
    const hoursAgo = Math.floor(Math.random() * 72) + 1;
    const createdAt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    
    const densityCurrent = Math.floor(Math.random() * 20) + 3;
    const densityPrevious = template.type === 'NEW_CORRIDOR' ? 0 : Math.floor(Math.random() * 10) + 1;
    const deltaPct = densityPrevious > 0 ? Math.round((densityCurrent - densityPrevious) / densityPrevious * 100) : null;
    
    const inflowUsd = Math.floor(Math.random() * 5000000) + 100000;
    const outflowUsd = Math.floor(Math.random() * 5000000) + 100000;
    
    const statuses: D1Status[] = ['new', 'active', 'cooling'];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    
    signals.push({
      id: `sig_${uuidv4().slice(0, 12)}`,
      type: template.type,
      scope: template.scope,
      status,
      severity: template.severity,
      confidence: 'high',
      window,
      title: template.scope === 'actor' ? template.titleTemplate(primary, primary) : template.titleTemplate(primary, secondary),
      subtitle: template.subtitleTemplate(),
      primary,
      secondary: template.scope !== 'actor' ? secondary : undefined,
      entities: template.scope === 'actor' ? [primary] : [primary, secondary],
      direction: template.type === 'DIRECTION_IMBALANCE' ? 'outflow' : 'bidirectional',
      metrics: {
        density: { current: densityCurrent, previous: densityPrevious, deltaPct },
        inflowUsd,
        outflowUsd,
        netFlowRatio: Math.round(inflowUsd / (inflowUsd + outflowUsd) * 100) / 100,
        edgesCount: Math.floor(Math.random() * 15) + 2
      },
      tags: ['Flow', template.scope.charAt(0).toUpperCase() + template.scope.slice(1)],
      evidence: {
        rule: {
          name: template.type,
          version: '1.0',
          thresholds: { newDensityMin: 3, persistenceHours: 6 }
        },
        baseline: { density: densityPrevious, window: 'prev_7d' },
        current: { density: densityCurrent, window },
        persistence: { hours: Math.round(Math.random() * 20) + 5, firstSeenAt: createdAt },
        flows: { inflowUsd, outflowUsd, netUsd: inflowUsd - outflowUsd }
      },
      summary: {
        what: template.what,
        whyNow: template.whyNow,
        soWhat: template.soWhat
      },
      links: {
        graph: `/actors/correlation?focus=sig_${i}&window=${window}`,
        primary: `/actors/${primary.id}`,
        secondary: secondary ? `/actors/${secondary.id}` : undefined
      },
      createdAt,
      updatedAt: createdAt,
      runId
    });
  }
  
  // Insert signals
  await D1SignalModel.insertMany(signals);
  
  // Log run
  await D1SignalRunModel.create({
    runId,
    window,
    startedAt: new Date(),
    completedAt: new Date(),
    status: 'completed',
    stats: { created: count, updated: 0, archived: 0, errors: 0 }
  });
  
  return { created: count, runId };
}

/**
 * Clear all seed signals
 */
export async function clearSignals(): Promise<{ deleted: number }> {
  const result = await D1SignalModel.deleteMany({});
  return { deleted: result.deletedCount || 0 };
}

// ==================== HELPERS ====================

function formatSignal(doc: Record<string, unknown>): D1Signal {
  const { _id, __v, ...rest } = doc;
  return rest as D1Signal;
}
