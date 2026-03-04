/**
 * Build Signal Contexts Job (P3.2)
 * 
 * Aggregates isolated signals into contextual situations
 * 
 * Rules:
 * - Context created only if: ≥2 signal types, ≥2 sources, same window
 * - Groups by: time, asset, actors
 * - overlapScore = coverage, NOT confidence
 * - NO intent, NO prediction
 * 
 * CRON: every 10-15 minutes
 */
import { ActorSignalModel } from '../core/signals/actor_signal.model.js';
import { SignalContextModel } from '../core/signals/signal_context.model.js';
import { ComputedGraphModel } from '../core/actors/computed_graph.model.js';
import { resolveTokens, formatToken } from '../core/resolver/token.resolver.js';

// Configuration
const CONFIG = {
  MIN_SIGNALS_FOR_CONTEXT: 2,
  MIN_SOURCES_FOR_CONTEXT: 2,
  CONTEXT_TTL_HOURS: 24,
  WINDOWS: ['1h', '6h', '24h'] as const,
  
  // Time cutoffs in ms
  WINDOW_MS: {
    '1h': 1 * 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
  },
};

// Job status
let lastJobStatus = {
  lastRun: null as Date | null,
  duration: 0,
  contextsCreated: 0,
  errors: [] as string[],
};

// ============ HELPERS ============

function generateSummary(
  primaryType: string,
  actorCount: number,
  tokenCount: number,
  corridorCount: number
): string {
  const parts: string[] = [];
  
  if (actorCount > 0) {
    parts.push(`${actorCount} actor deviation${actorCount > 1 ? 's' : ''}`);
  }
  if (tokenCount > 0) {
    parts.push(`${tokenCount} token signal${tokenCount > 1 ? 's' : ''}`);
  }
  if (corridorCount > 0) {
    parts.push(`${corridorCount} corridor spike${corridorCount > 1 ? 's' : ''}`);
  }
  
  if (parts.length === 0) {
    return 'Multiple signals detected within the same window';
  }
  
  return `${parts.join(', ')} detected within the same window`;
}

function getNarrativeHint(
  actorTypes: Set<string>,
  signalTypes: Set<string>
): string | undefined {
  // Rule-based narrative hints (descriptive only)
  if (actorTypes.has('exchange') && signalTypes.has('flow_deviation')) {
    return 'Exchange flow patterns showing deviation from baseline';
  }
  if (signalTypes.has('corridor_volume_spike') && signalTypes.has('flow_deviation')) {
    return 'Correlated flow changes across multiple actors';
  }
  if (signalTypes.has('behavior_regime_shift')) {
    return 'Structural behavior change detected in network';
  }
  return undefined;
}

// ============ CONTEXT BUILDING ============

async function buildContextsForWindow(
  window: '1h' | '6h' | '24h'
): Promise<number> {
  const cutoff = new Date(Date.now() - CONFIG.WINDOW_MS[window]);
  let contextsCreated = 0;
  
  // Step 1: Get all active actor signals in this window
  const actorSignals = await ActorSignalModel.find({
    status: 'active',
    detectedAt: { $gte: cutoff },
  }).lean();
  
  if (actorSignals.length < CONFIG.MIN_SIGNALS_FOR_CONTEXT) {
    return 0;
  }
  
  // Step 2: Get corridor data from graph
  const graph = await ComputedGraphModel.findOne({ window: '7d' }).lean();
  const corridorSpikes = (graph as any)?.edges?.filter((e: any) => 
    e.flow?.volumeUsd > 100000 // Significant corridors
  ) || [];
  
  // Step 3: Group signals by actor type and signal type
  const byActorType = new Map<string, any[]>();
  const bySignalType = new Map<string, any[]>();
  const actorTypes = new Set<string>();
  const signalTypes = new Set<string>();
  
  for (const signal of actorSignals) {
    const s = signal as any;
    
    // Group by actor type
    if (!byActorType.has(s.actorType)) {
      byActorType.set(s.actorType, []);
    }
    byActorType.get(s.actorType)!.push(s);
    
    // Group by signal type
    if (!bySignalType.has(s.signalType)) {
      bySignalType.set(s.signalType, []);
    }
    bySignalType.get(s.signalType)!.push(s);
    
    actorTypes.add(s.actorType);
    signalTypes.add(s.signalType);
  }
  
  // Step 4: Check if we have enough diversity for context
  if (signalTypes.size < CONFIG.MIN_SIGNALS_FOR_CONTEXT) {
    // Not enough signal type diversity
    return 0;
  }
  
  // Get unique actors
  const uniqueActors = new Set(actorSignals.map((s: any) => s.actorSlug));
  if (uniqueActors.size < CONFIG.MIN_SOURCES_FOR_CONTEXT) {
    return 0;
  }
  
  // Step 5: Find the primary signal (highest severity or most recent)
  const sortedSignals = [...actorSignals].sort((a: any, b: any) => {
    const severityOrder = { high: 3, medium: 2, low: 1 };
    const aSev = severityOrder[a.severity as keyof typeof severityOrder] || 0;
    const bSev = severityOrder[b.severity as keyof typeof severityOrder] || 0;
    if (aSev !== bSev) return bSev - aSev;
    return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
  });
  
  const primarySignal = sortedSignals[0] as any;
  
  // Step 6: Check if similar context already exists
  const existingContext = await SignalContextModel.findOne({
    window,
    'primarySignal.sourceId': primarySignal.actorSlug,
    'primarySignal.type': primarySignal.signalType,
    status: 'active',
    detectedAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) }, // Within 6h
  });
  
  if (existingContext) {
    return 0; // Don't duplicate
  }
  
  // Step 7: Build related signals
  const relatedActors = actorSignals
    .filter((s: any) => s.actorSlug !== primarySignal.actorSlug)
    .slice(0, 10)
    .map((s: any) => ({
      actorId: s.actorId,
      slug: s.actorSlug,
      signalType: s.signalType,
      deviation: s.deviation,
    }));
  
  const relatedCorridors = corridorSpikes
    .filter((c: any) => 
      uniqueActors.has(c.from) || uniqueActors.has(c.to)
    )
    .slice(0, 5)
    .map((c: any) => ({
      from: c.from,
      to: c.to,
      signalType: 'corridor_volume_spike',
      volumeUsd: c.flow?.volumeUsd || 0,
    }));
  
  // Step 8: Calculate overlap score
  const overlapScore = signalTypes.size + uniqueActors.size + (relatedCorridors.length > 0 ? 1 : 0);
  
  // Step 9: Get affected assets (from evidence if available)
  const affectedAssets = new Set<string>();
  for (const signal of actorSignals) {
    const s = signal as any;
    if (s.evidence?.tokens) {
      for (const token of s.evidence.tokens) {
        affectedAssets.add(token);
      }
    }
  }
  
  // Resolve token symbols
  if (affectedAssets.size > 0) {
    const tokenMap = await resolveTokens(Array.from(affectedAssets));
    const resolvedAssets = new Set<string>();
    for (const [addr, info] of tokenMap) {
      resolvedAssets.add(formatToken(info));
    }
    affectedAssets.clear();
    for (const asset of resolvedAssets) {
      affectedAssets.add(asset);
    }
  }
  
  // Step 10: Create context
  const contextExpiry = new Date(Date.now() + CONFIG.CONTEXT_TTL_HOURS * 60 * 60 * 1000);
  
  await SignalContextModel.create({
    window,
    primarySignal: {
      type: primarySignal.signalType,
      sourceType: 'actor',
      sourceId: primarySignal.actorSlug,
      deviation: primarySignal.deviation,
      severity: primarySignal.severity,
    },
    relatedSignals: {
      tokens: [],
      actors: relatedActors,
      corridors: relatedCorridors,
    },
    overlapScore,
    affectedAssets: Array.from(affectedAssets),
    involvedActors: Array.from(uniqueActors),
    summary: generateSummary(
      primarySignal.signalType,
      relatedActors.length + 1,
      0,
      relatedCorridors.length
    ),
    narrativeHint: getNarrativeHint(actorTypes, signalTypes),
    detectedAt: new Date(),
    expiresAt: contextExpiry,
    status: 'active',
  });
  
  contextsCreated++;
  
  return contextsCreated;
}

// ============ CLEANUP ============

async function cleanupExpiredContexts(): Promise<number> {
  const result = await SignalContextModel.updateMany(
    { status: 'active', expiresAt: { $lt: new Date() } },
    { $set: { status: 'expired' } }
  );
  return result.modifiedCount;
}

// ============ MAIN JOB ============

export async function buildSignalContexts(): Promise<{
  contextsCreated: number;
  expiredCleaned: number;
  duration: number;
  errors: string[];
}> {
  const startTime = Date.now();
  const errors: string[] = [];
  let totalContextsCreated = 0;
  let expiredCleaned = 0;
  
  try {
    // Build contexts for each window
    for (const window of CONFIG.WINDOWS) {
      try {
        const created = await buildContextsForWindow(window);
        totalContextsCreated += created;
      } catch (err: any) {
        errors.push(`${window}: ${err.message}`);
      }
    }
    
    // Cleanup expired
    expiredCleaned = await cleanupExpiredContexts();
    
  } catch (err: any) {
    errors.push(err.message);
    console.error('[BuildSignalContexts] Job failed:', err);
  }
  
  const duration = Date.now() - startTime;
  
  lastJobStatus = {
    lastRun: new Date(),
    duration,
    contextsCreated: totalContextsCreated,
    errors,
  };
  
  if (totalContextsCreated > 0) {
    console.log(`[BuildSignalContexts] Created ${totalContextsCreated} contexts, cleaned ${expiredCleaned} (${duration}ms)`);
  }
  
  return { contextsCreated: totalContextsCreated, expiredCleaned, duration, errors };
}

export function getBuildSignalContextsStatus() {
  return lastJobStatus;
}
