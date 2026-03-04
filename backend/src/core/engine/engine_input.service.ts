/**
 * Engine Input Service (P0 - Sprint 4)
 * 
 * Engine НЕ анализирует рынок заново.
 * Он читает уже подготовленные слои:
 * Actors → Signals → Contexts → Graph
 * 
 * Engine = Decision Reducer, не Analyzer.
 */
import { SignalContextModel } from '../signals/signal_context.model.js';
import { ActorSignalModel } from '../signals/actor_signal.model.js';
import { ComputedGraphModel } from '../actors/computed_graph.model.js';
import { EntityModel } from '../entities/entities.model.js';
import { resolveToken } from '../resolver/token.resolver.js';
import { parseWindow, getWindowCutoff, TimeWindow } from '../common/window.service.js';

export interface EngineAsset {
  address: string;
  symbol: string;
  name: string;
  verified: boolean;
  chain: string;
}

export interface EngineSignal {
  id: string;
  type: string;
  deviation: number;
  severity: 'low' | 'medium' | 'high';
  source: string;
  metric: string;
}

export interface EngineContext {
  id: string;
  overlapScore: number;
  primarySignalType: string;
  involvedActors: string[];
  affectedAssets: string[];
  summary: string;
  window: string;
}

export interface EngineActor {
  slug: string;
  type: string;
  flowDirection: 'inflow' | 'outflow' | 'balanced';
  signalCount: number;
  contextCount: number;
}

export interface EngineGraphStats {
  totalNodes: number;
  totalEdges: number;
  topCorridors: {
    from: string;
    to: string;
    volumeUsd: number;
    pctOfTotal: number;
  }[];
}

export interface EngineCoverageSnapshot {
  contexts: number;
  actors: number;
  signals: number;
  overall: number;
}

export interface EngineInput {
  id: string;
  asset: EngineAsset;
  window: TimeWindow;
  contexts: EngineContext[];
  actors: EngineActor[];
  signals: EngineSignal[];
  graphStats: EngineGraphStats;
  coverage: EngineCoverageSnapshot;
  createdAt: Date;
}

/**
 * Build Engine Input from existing data layers
 */
export async function buildEngineInput(
  assetAddress: string,
  window: TimeWindow = '24h'
): Promise<EngineInput> {
  const inputId = `input_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cutoff = getWindowCutoff(window);
  
  // 1. Resolve asset
  const tokenInfo = await resolveToken(assetAddress);
  const asset: EngineAsset = {
    address: tokenInfo.address,
    symbol: tokenInfo.symbol,
    name: tokenInfo.name,
    verified: tokenInfo.verified,
    chain: tokenInfo.chain,
  };
  
  // 2. Get relevant contexts (TOP by overlapScore)
  const contexts = await SignalContextModel.find({
    status: 'active',
    $or: [
      { affectedAssets: { $regex: asset.symbol, $options: 'i' } },
      { 'primarySignal.sourceId': { $exists: true } },
    ],
  })
    .sort({ overlapScore: -1 })
    .limit(5)
    .lean();
  
  const engineContexts: EngineContext[] = contexts.map((c: any) => ({
    id: c._id.toString(),
    overlapScore: c.overlapScore,
    primarySignalType: c.primarySignal?.type || 'unknown',
    involvedActors: c.involvedActors || [],
    affectedAssets: c.affectedAssets || [],
    summary: c.summary,
    window: c.window,
  }));
  
  // 3. Get actors from contexts
  const actorSlugs = new Set<string>();
  for (const ctx of engineContexts) {
    for (const actor of ctx.involvedActors) {
      actorSlugs.add(actor);
    }
  }
  
  // 4. Get signals for these actors
  const signals = await ActorSignalModel.find({
    status: 'active',
    actorSlug: { $in: Array.from(actorSlugs) },
    detectedAt: { $gte: cutoff },
  })
    .sort({ severity: -1 })
    .limit(20)
    .lean();
  
  const engineSignals: EngineSignal[] = signals.map((s: any) => ({
    id: s._id.toString(),
    type: s.signalType,
    deviation: s.deviation,
    severity: s.severity,
    source: s.actorSlug,
    metric: s.metric,
  }));
  
  // 5. Build actor stats
  const actorStats = new Map<string, { signals: number; contexts: number; flowDir: string }>();
  
  for (const slug of actorSlugs) {
    const sigCount = signals.filter((s: any) => s.actorSlug === slug).length;
    const ctxCount = engineContexts.filter(c => c.involvedActors.includes(slug)).length;
    
    // Determine flow direction from signals
    const actorSignals = signals.filter((s: any) => s.actorSlug === slug);
    let inflowCount = 0;
    let outflowCount = 0;
    
    for (const sig of actorSignals) {
      const s = sig as any;
      if (s.metric === 'inflow') inflowCount++;
      if (s.metric === 'outflow') outflowCount++;
    }
    
    let flowDir = 'balanced';
    if (inflowCount > outflowCount * 1.5) flowDir = 'inflow';
    if (outflowCount > inflowCount * 1.5) flowDir = 'outflow';
    
    actorStats.set(slug, { signals: sigCount, contexts: ctxCount, flowDir });
  }
  
  // Get actor types from entities
  const entities = await EntityModel.find({
    slug: { $in: Array.from(actorSlugs) },
  }).lean();
  
  const entityTypeMap = new Map<string, string>();
  for (const e of entities) {
    const entity = e as any;
    entityTypeMap.set(entity.slug, entity.category || 'unknown');
  }
  
  const engineActors: EngineActor[] = Array.from(actorSlugs).map(slug => {
    const stats = actorStats.get(slug) || { signals: 0, contexts: 0, flowDir: 'balanced' };
    return {
      slug,
      type: entityTypeMap.get(slug) || 'unknown',
      flowDirection: stats.flowDir as 'inflow' | 'outflow' | 'balanced',
      signalCount: stats.signals,
      contextCount: stats.contexts,
    };
  });
  
  // 6. Get graph stats
  const graph = await ComputedGraphModel.findOne({ window: '7d' }).lean();
  
  let graphStats: EngineGraphStats = {
    totalNodes: 0,
    totalEdges: 0,
    topCorridors: [],
  };
  
  if (graph) {
    const g = graph as any;
    const edges = g.edges || [];
    const totalVolume = edges.reduce((sum: number, e: any) => sum + (e.flow?.volumeUsd || 0), 0);
    
    graphStats = {
      totalNodes: g.nodes?.length || 0,
      totalEdges: edges.length,
      topCorridors: edges
        .sort((a: any, b: any) => (b.flow?.volumeUsd || 0) - (a.flow?.volumeUsd || 0))
        .slice(0, 3)
        .map((e: any) => ({
          from: e.from,
          to: e.to,
          volumeUsd: e.flow?.volumeUsd || 0,
          pctOfTotal: totalVolume > 0 ? Math.round((e.flow?.volumeUsd || 0) / totalVolume * 100) : 0,
        })),
    };
  }
  
  // 7. Calculate coverage
  const contextCoverage = engineContexts.length > 0 ? Math.min(100, engineContexts.length * 25) : 0;
  const actorCoverage = engineActors.length > 0 ? Math.min(100, engineActors.length * 20) : 0;
  const signalCoverage = engineSignals.length > 0 ? Math.min(100, engineSignals.length * 10) : 0;
  const overallCoverage = Math.round((contextCoverage + actorCoverage + signalCoverage) / 3);
  
  const coverage: EngineCoverageSnapshot = {
    contexts: contextCoverage,
    actors: actorCoverage,
    signals: signalCoverage,
    overall: overallCoverage,
  };
  
  return {
    id: inputId,
    asset,
    window,
    contexts: engineContexts,
    actors: engineActors,
    signals: engineSignals,
    graphStats,
    coverage,
    createdAt: new Date(),
  };
}

/**
 * Build Engine Input for an actor (not token)
 */
export async function buildEngineInputForActor(
  actorSlug: string,
  window: TimeWindow = '24h'
): Promise<EngineInput> {
  const inputId = `input_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cutoff = getWindowCutoff(window);
  
  // Get entity info
  const entity = await EntityModel.findOne({ slug: actorSlug }).lean();
  const e = entity as any;
  
  const asset: EngineAsset = {
    address: actorSlug,
    symbol: e?.name || actorSlug,
    name: e?.name || actorSlug,
    verified: !!entity,
    chain: 'ethereum',
  };
  
  // Get contexts for this actor
  const contexts = await SignalContextModel.find({
    status: 'active',
    involvedActors: actorSlug,
  })
    .sort({ overlapScore: -1 })
    .limit(5)
    .lean();
  
  const engineContexts: EngineContext[] = contexts.map((c: any) => ({
    id: c._id.toString(),
    overlapScore: c.overlapScore,
    primarySignalType: c.primarySignal?.type || 'unknown',
    involvedActors: c.involvedActors || [],
    affectedAssets: c.affectedAssets || [],
    summary: c.summary,
    window: c.window,
  }));
  
  // Get all actors from these contexts
  const actorSlugs = new Set<string>([actorSlug]);
  for (const ctx of engineContexts) {
    for (const actor of ctx.involvedActors) {
      actorSlugs.add(actor);
    }
  }
  
  // Get signals
  const signals = await ActorSignalModel.find({
    status: 'active',
    actorSlug: { $in: Array.from(actorSlugs) },
    detectedAt: { $gte: cutoff },
  })
    .sort({ severity: -1 })
    .limit(20)
    .lean();
  
  const engineSignals: EngineSignal[] = signals.map((s: any) => ({
    id: s._id.toString(),
    type: s.signalType,
    deviation: s.deviation,
    severity: s.severity,
    source: s.actorSlug,
    metric: s.metric,
  }));
  
  // Build actor stats
  const entities = await EntityModel.find({
    slug: { $in: Array.from(actorSlugs) },
  }).lean();
  
  const entityTypeMap = new Map<string, string>();
  for (const ent of entities) {
    const en = ent as any;
    entityTypeMap.set(en.slug, en.category || 'unknown');
  }
  
  const engineActors: EngineActor[] = Array.from(actorSlugs).map(slug => {
    const actorSignals = signals.filter((s: any) => s.actorSlug === slug);
    let inflowCount = 0;
    let outflowCount = 0;
    
    for (const sig of actorSignals) {
      const s = sig as any;
      if (s.metric === 'inflow') inflowCount++;
      if (s.metric === 'outflow') outflowCount++;
    }
    
    let flowDir: 'inflow' | 'outflow' | 'balanced' = 'balanced';
    if (inflowCount > outflowCount * 1.5) flowDir = 'inflow';
    if (outflowCount > inflowCount * 1.5) flowDir = 'outflow';
    
    return {
      slug,
      type: entityTypeMap.get(slug) || 'unknown',
      flowDirection: flowDir,
      signalCount: actorSignals.length,
      contextCount: engineContexts.filter(c => c.involvedActors.includes(slug)).length,
    };
  });
  
  // Graph stats
  const graph = await ComputedGraphModel.findOne({ window: '7d' }).lean();
  let graphStats: EngineGraphStats = { totalNodes: 0, totalEdges: 0, topCorridors: [] };
  
  if (graph) {
    const g = graph as any;
    const relevantEdges = (g.edges || []).filter((e: any) => 
      e.from === actorSlug || e.to === actorSlug
    );
    const totalVolume = relevantEdges.reduce((sum: number, e: any) => sum + (e.flow?.volumeUsd || 0), 0);
    
    graphStats = {
      totalNodes: g.nodes?.length || 0,
      totalEdges: relevantEdges.length,
      topCorridors: relevantEdges
        .sort((a: any, b: any) => (b.flow?.volumeUsd || 0) - (a.flow?.volumeUsd || 0))
        .slice(0, 3)
        .map((e: any) => ({
          from: e.from,
          to: e.to,
          volumeUsd: e.flow?.volumeUsd || 0,
          pctOfTotal: totalVolume > 0 ? Math.round((e.flow?.volumeUsd || 0) / totalVolume * 100) : 0,
        })),
    };
  }
  
  // Coverage
  const contextCoverage = engineContexts.length > 0 ? Math.min(100, engineContexts.length * 25) : 0;
  const actorCoverage = engineActors.length > 0 ? Math.min(100, engineActors.length * 20) : 0;
  const signalCoverage = engineSignals.length > 0 ? Math.min(100, engineSignals.length * 10) : 0;
  
  return {
    id: inputId,
    asset,
    window,
    contexts: engineContexts,
    actors: engineActors,
    signals: engineSignals,
    graphStats,
    coverage: {
      contexts: contextCoverage,
      actors: actorCoverage,
      signals: signalCoverage,
      overall: Math.round((contextCoverage + actorCoverage + signalCoverage) / 3),
    },
    createdAt: new Date(),
  };
}
