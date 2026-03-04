/**
 * Snapshots Service
 * Builds and manages prebuilt UI snapshots
 */
import * as repo from './snapshots.repository.js';
import { IProfileSnapshot, SnapshotType } from './snapshots.model.js';
import { getActorProfile, buildActorProfile } from '../profiles/actor_profiles.service.js';
import { explainScore } from '../explanations/score_explain.service.js';
import { explainStrategy } from '../explanations/strategy_explain.service.js';

/**
 * Actor card snapshot (for lists, search results)
 */
export interface ActorCardSnapshot {
  address: string;
  label?: string;
  strategy?: string;
  strategyDisplayName?: string;
  confidence?: number;
  tier: string;
  compositeScore: number;
  topMetric: { name: string; value: number };
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Actor full snapshot (for profile page)
 */
export interface ActorFullSnapshot {
  address: string;
  label?: string;
  
  // Strategy
  strategy: {
    type: string;
    displayName: string;
    confidence: number;
    stability: number;
    phase: string;
  } | null;
  
  // Scores
  scores: {
    composite: number;
    tier: string;
    behavior: number;
    intensity: number;
    consistency: number;
    risk: number;
    influence: number;
  };
  
  // Summary texts
  scoreSummary: string;
  strategySummary: string;
  
  // Top data
  topBundles: Array<{ type: string; count: number; volume: number }>;
  topRelations: Array<{ address: string; volume: number; direction: string }>;
  
  // Stats
  stats: {
    totalTransfers: number;
    totalVolume: number;
    uniqueCounterparties: number;
    firstSeen: string | null;
    lastSeen: string | null;
  };
}

/**
 * Graph node snapshot (for hover tooltip)
 */
export interface GraphNodeSnapshot {
  address: string;
  shortAddress: string;
  label?: string;
  tier: string;
  score: number;
  strategy?: string;
  riskLevel: string;
}

/**
 * Get or build actor card snapshot
 */
export async function getActorCardSnapshot(
  address: string,
  forceRebuild: boolean = false
): Promise<ActorCardSnapshot | null> {
  const snapshotType: SnapshotType = 'actor_card';
  
  // Check cache first
  if (!forceRebuild) {
    const cached = await repo.getSnapshot(address, snapshotType);
    if (cached) return cached.payload as ActorCardSnapshot;
  }
  
  // Build from profile
  let profile = await getActorProfile(address);
  if (!profile) {
    try {
      profile = await buildActorProfile(address);
    } catch {
      return null;
    }
  }
  
  // Build card data
  const strategyNames: Record<string, string> = {
    'accumulation_sniper': 'Accumulation Sniper',
    'distribution_whale': 'Distribution Whale',
    'rotation_trader': 'Rotation Trader',
    'wash_operator': 'Wash Operator',
    'momentum_rider': 'Momentum Rider',
    'liquidity_farmer': 'Liquidity Farmer',
    'mixed': 'Mixed',
  };
  
  // Find top metric
  const scores = [
    { name: 'Behavior', value: profile.scores.behavior },
    { name: 'Intensity', value: profile.scores.intensity },
    { name: 'Influence', value: profile.scores.influence },
  ];
  const topMetric = scores.sort((a, b) => b.value - a.value)[0];
  
  const card: ActorCardSnapshot = {
    address: profile.address,
    label: profile.label,
    strategy: profile.strategy?.strategyType,
    strategyDisplayName: profile.strategy ? strategyNames[profile.strategy.strategyType] || profile.strategy.strategyType : undefined,
    confidence: profile.strategy?.confidence,
    tier: profile.scores.tier,
    compositeScore: profile.scores.composite,
    topMetric,
    riskLevel: profile.scores.risk >= 60 ? 'high' : profile.scores.risk >= 40 ? 'medium' : 'low',
  };
  
  // Cache
  await repo.upsertSnapshot(address, 'actor', snapshotType, card as unknown as Record<string, unknown>);
  
  return card;
}

/**
 * Get or build actor full snapshot
 */
export async function getActorFullSnapshot(
  address: string,
  forceRebuild: boolean = false
): Promise<ActorFullSnapshot | null> {
  const snapshotType: SnapshotType = 'actor_full';
  
  // Check cache first
  if (!forceRebuild) {
    const cached = await repo.getSnapshot(address, snapshotType);
    if (cached) return cached.payload as ActorFullSnapshot;
  }
  
  // Build from profile and explanations
  let profile = await getActorProfile(address);
  if (!profile) {
    try {
      profile = await buildActorProfile(address);
    } catch {
      return null;
    }
  }
  
  const [scoreExplain, strategyExplain] = await Promise.all([
    explainScore(address),
    explainStrategy(address),
  ]);
  
  const strategyNames: Record<string, string> = {
    'accumulation_sniper': 'Accumulation Sniper',
    'distribution_whale': 'Distribution Whale',
    'rotation_trader': 'Rotation Trader',
    'wash_operator': 'Wash Operator',
    'momentum_rider': 'Momentum Rider',
    'liquidity_farmer': 'Liquidity Farmer',
    'mixed': 'Mixed',
  };
  
  const full: ActorFullSnapshot = {
    address: profile.address,
    label: profile.label,
    
    strategy: profile.strategy ? {
      type: profile.strategy.strategyType,
      displayName: strategyNames[profile.strategy.strategyType] || profile.strategy.strategyType,
      confidence: profile.strategy.confidence,
      stability: profile.strategy.stability,
      phase: profile.strategy.phase || 'neutral',
    } : null,
    
    scores: {
      composite: profile.scores.composite,
      tier: profile.scores.tier,
      behavior: profile.scores.behavior,
      intensity: profile.scores.intensity,
      consistency: profile.scores.consistency,
      risk: profile.scores.risk,
      influence: profile.scores.influence,
    },
    
    scoreSummary: scoreExplain?.summary || 'Score analysis not available',
    strategySummary: strategyExplain?.summary || 'Strategy analysis not available',
    
    topBundles: profile.topBundles.slice(0, 3).map(b => ({
      type: b.bundleType,
      count: b.count,
      volume: b.volumeUsd,
    })),
    
    topRelations: profile.activeRelations.slice(0, 5).map(r => ({
      address: r.counterparty,
      volume: r.volumeUsd,
      direction: r.direction,
    })),
    
    stats: {
      totalTransfers: profile.stats.totalTransfers,
      totalVolume: profile.stats.totalVolumeUsd,
      uniqueCounterparties: profile.stats.uniqueCounterparties,
      firstSeen: profile.stats.firstSeen?.toISOString() || null,
      lastSeen: profile.stats.lastSeen?.toISOString() || null,
    },
  };
  
  // Cache
  await repo.upsertSnapshot(address, 'actor', snapshotType, full as unknown as Record<string, unknown>);
  
  return full;
}

/**
 * Get or build graph node snapshot
 */
export async function getGraphNodeSnapshot(
  address: string
): Promise<GraphNodeSnapshot | null> {
  const snapshotType: SnapshotType = 'graph_node';
  
  // Check cache first
  const cached = await repo.getSnapshot(address, snapshotType);
  if (cached) return cached.payload as GraphNodeSnapshot;
  
  // Build from profile
  let profile = await getActorProfile(address);
  if (!profile) {
    try {
      profile = await buildActorProfile(address);
    } catch {
      return null;
    }
  }
  
  const node: GraphNodeSnapshot = {
    address: profile.address,
    shortAddress: `${profile.address.slice(0, 6)}...${profile.address.slice(-4)}`,
    label: profile.label,
    tier: profile.scores.tier,
    score: profile.scores.composite,
    strategy: profile.strategy?.strategyType,
    riskLevel: profile.scores.risk >= 60 ? 'high' : profile.scores.risk >= 40 ? 'medium' : 'low',
  };
  
  // Cache
  await repo.upsertSnapshot(address, 'actor', snapshotType, node as unknown as Record<string, unknown>);
  
  return node;
}

/**
 * Invalidate snapshots for an address
 */
export async function invalidateActorSnapshots(address: string): Promise<number> {
  return repo.invalidateSnapshots(address);
}

/**
 * Get snapshot stats
 */
export async function getStats() {
  return repo.getSnapshotStats();
}
