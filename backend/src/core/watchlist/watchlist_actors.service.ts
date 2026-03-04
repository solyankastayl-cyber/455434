/**
 * Watchlist Actors Service (P1.1)
 * 
 * Aggregates actor data from:
 * - watchlist_items (type=actor)
 * - actor_intel_profiles
 * - bridge_migrations
 * - system_alerts
 * 
 * Read-only service for observation/intelligence.
 */
import { WatchlistItemModel } from './watchlist.model.js';
import { ActorProfileModel } from '../actor_intelligence/actor_profile.model.js';
import { ActorEventModel, IActorEvent } from '../actor_intelligence/actor_event.model.js';
import { SystemAlertModel } from '../system_alerts/system_alert.model.js';
import { BridgeMigrationModel } from '../bridge_detection/bridge_migration.model.js';

// Cache for aggregated data (TTL 30s)
interface CacheEntry<T> {
  data: T;
  expiry: number;
}
const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiry) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}

// Pattern display names
export const PATTERN_DISPLAY = {
  REPEAT_BRIDGE_PATTERN: { label: 'Repeat Bridge', short: 'REPEAT' },
  ROUTE_DOMINANCE: { label: 'Route Dominance', short: 'DOMINANT' },
  LIQUIDITY_ESCALATION: { label: 'Liquidity Escalation', short: 'ESCALATION' },
  MULTI_CHAIN_PRESENCE: { label: 'Multi-Chain', short: 'MULTI' },
  STRATEGIC_TIMING: { label: 'Strategic Timing', short: 'TIMING' },
  NEW_STRATEGIC_ACTOR: { label: 'New Strategic', short: 'NEW' },
};

/**
 * Get aggregated watchlist actors
 * 
 * Returns actor data from watchlist items combined with actor intelligence
 */
export async function getWatchlistActors(userId?: string): Promise<{
  actors: WatchlistActor[];
  total: number;
}> {
  const cacheKey = `watchlist_actors_${userId || 'all'}`;
  const cached = getCached<{ actors: WatchlistActor[]; total: number }>(cacheKey);
  if (cached) return cached;
  
  // Get actor watchlist items
  const query: any = { type: 'actor' };
  if (userId) query.userId = userId;
  
  const watchlistItems = await WatchlistItemModel.find(query).lean();
  
  // Get all actor addresses from watchlist
  const actorAddresses = watchlistItems
    .map(item => item.target?.address?.toLowerCase())
    .filter(Boolean);
  
  // Get actor profiles for these addresses
  const profiles = await ActorProfileModel.find({
    primaryAddress: { $in: actorAddresses },
  }).lean();
  
  const profileMap = new Map(profiles.map(p => [p.primaryAddress, p]));
  
  // Get open alerts count per actor
  const alertCounts = await SystemAlertModel.aggregate([
    {
      $match: {
        source: 'actor_intelligence',
        status: 'OPEN',
        'metadata.actorAddress': { $in: actorAddresses },
      },
    },
    {
      $group: {
        _id: '$metadata.actorAddress',
        count: { $sum: 1 },
      },
    },
  ]);
  const alertMap = new Map(alertCounts.map(a => [a._id, a.count]));
  
  // Build aggregated actor list
  const actors: WatchlistActor[] = watchlistItems.map(item => {
    const address = item.target?.address?.toLowerCase();
    const profile = address ? profileMap.get(address) : null;
    const openAlerts = address ? (alertMap.get(address) || 0) : 0;
    
    // Extract patterns from profile
    const patterns: ActorPattern[] = [];
    if (profile?.patternScores) {
      const scores = profile.patternScores as any;
      if (scores.repeatBridge >= 0.5) patterns.push({ type: 'REPEAT_BRIDGE_PATTERN', confidence: scores.repeatBridge });
      if (scores.routeDominance >= 0.5) patterns.push({ type: 'ROUTE_DOMINANCE', confidence: scores.routeDominance });
      if (scores.sizeEscalation >= 0.5) patterns.push({ type: 'LIQUIDITY_ESCALATION', confidence: scores.sizeEscalation });
      if (scores.multiChainPresence >= 0.5) patterns.push({ type: 'MULTI_CHAIN_PRESENCE', confidence: scores.multiChainPresence });
      if (scores.temporalPattern >= 0.5) patterns.push({ type: 'STRATEGIC_TIMING', confidence: scores.temporalPattern });
    }
    
    return {
      watchlistId: item._id.toString(),
      actorId: profile?.actorId || `actor_${address?.slice(2, 10)}`,
      address: address || '',
      label: item.target?.name || item.note || undefined,
      confidence: profile?.confidenceScore || 0,
      confidenceLevel: profile?.confidenceLevel || 'LOW',
      patterns,
      chains: profile?.chainsUsed || [item.target?.chain || 'ETH'],
      bridgeCount7d: profile?.bridgeCount7d || 0,
      bridgeCount30d: profile?.bridgeCount30d || 0,
      totalVolumeUsd: profile?.totalVolumeUsd || 0,
      openAlerts,
      lastActivityAt: profile?.lastActivityAt || item.updatedAt || item.createdAt,
      addedAt: item.createdAt,
    };
  });
  
  const result = { actors, total: actors.length };
  setCache(cacheKey, result);
  return result;
}

/**
 * Get detailed actor profile
 */
export async function getActorProfile(actorIdOrAddress: string): Promise<ActorProfileDetail | null> {
  const cacheKey = `actor_profile_${actorIdOrAddress.toLowerCase()}`;
  const cached = getCached<ActorProfileDetail>(cacheKey);
  if (cached) return cached;
  
  // Try to find by actorId or address
  const isAddress = actorIdOrAddress.startsWith('0x');
  const query = isAddress
    ? { primaryAddress: actorIdOrAddress.toLowerCase() }
    : { actorId: actorIdOrAddress };
  
  const profile = await ActorProfileModel.findOne(query).lean();
  
  if (!profile) {
    return null;
  }
  
  const address = profile.primaryAddress;
  
  // Get recent actor events
  const recentEvents = await ActorEventModel.find({
    actorId: profile.actorId,
  })
    .sort({ timestamp: -1 })
    .limit(20)
    .lean();
  
  // Get related alerts
  const relatedAlerts = await SystemAlertModel.find({
    source: 'actor_intelligence',
    'metadata.actorAddress': address,
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
  
  // Get recent bridge migrations
  const recentMigrations = await BridgeMigrationModel.find({
    wallet: { $regex: new RegExp(address.slice(2), 'i') },
  })
    .sort({ detectedAt: -1 })
    .limit(10)
    .lean();
  
  // Extract patterns
  const patterns: ActorPattern[] = [];
  const scores = profile.patternScores as any;
  if (scores) {
    if (scores.repeatBridge >= 0.3) patterns.push({ type: 'REPEAT_BRIDGE_PATTERN', confidence: scores.repeatBridge });
    if (scores.routeDominance >= 0.3) patterns.push({ type: 'ROUTE_DOMINANCE', confidence: scores.routeDominance });
    if (scores.sizeEscalation >= 0.3) patterns.push({ type: 'LIQUIDITY_ESCALATION', confidence: scores.sizeEscalation });
    if (scores.multiChainPresence >= 0.3) patterns.push({ type: 'MULTI_CHAIN_PRESENCE', confidence: scores.multiChainPresence });
    if (scores.temporalPattern >= 0.3) patterns.push({ type: 'STRATEGIC_TIMING', confidence: scores.temporalPattern });
  }
  
  const result: ActorProfileDetail = {
    actor: {
      id: profile.actorId,
      address: profile.primaryAddress,
      label: undefined, // Will be enriched from watchlist
      confidence: profile.confidenceScore,
      confidenceLevel: profile.confidenceLevel,
      createdAt: profile.createdAt,
    },
    summary: {
      chains: profile.chainsUsed || [],
      dominantRoutes: (profile.dominantRoutes || []).slice(0, 5),
      totalMigrations: profile.totalMigrations || 0,
      totalVolumeUsd: profile.totalVolumeUsd || 0,
      avgMigrationSizeUsd: profile.avgMigrationSizeUsd || 0,
      patterns,
    },
    recentEvents: recentEvents.map(e => ({
      eventId: e.eventId,
      type: e.type,
      severity: e.severity,
      title: e.title,
      explanation: e.explanation,
      confidence: e.confidence,
      timestamp: e.timestamp,
    })),
    relatedAlerts: relatedAlerts.map(a => ({
      alertId: a.alertId,
      type: a.type,
      severity: a.severity,
      title: a.title,
      status: a.status,
      createdAt: a.createdAt,
    })),
    recentMigrations: recentMigrations.map(m => ({
      migrationId: m.migrationId,
      fromChain: m.fromChain,
      toChain: m.toChain,
      token: m.token,
      amountUsd: m.amountUsd,
      confidence: m.confidence,
      detectedAt: m.detectedAt,
    })),
  };
  
  // Enrich label from watchlist
  const watchlistItem = await WatchlistItemModel.findOne({
    type: 'actor',
    'target.address': { $regex: new RegExp(address.slice(2), 'i') },
  }).lean();
  
  if (watchlistItem) {
    result.actor.label = watchlistItem.target?.name || watchlistItem.note;
    result.watchlistId = watchlistItem._id.toString();
  }
  
  setCache(cacheKey, result);
  return result;
}

/**
 * Get actors not in watchlist but with significant activity
 */
export async function getSuggestedActors(limit = 5): Promise<WatchlistActor[]> {
  // Get addresses already in watchlist
  const watchlistItems = await WatchlistItemModel.find({ type: 'actor' }).lean();
  const watchlistAddresses = new Set(
    watchlistItems.map(i => i.target?.address?.toLowerCase())
  );
  
  // Find high-confidence actors not in watchlist
  const suggestedProfiles = await ActorProfileModel.find({
    confidenceLevel: { $in: ['MEDIUM', 'HIGH'] },
  })
    .sort({ confidenceScore: -1, lastActivityAt: -1 })
    .limit(limit * 2)
    .lean();
  
  const suggested: WatchlistActor[] = [];
  
  for (const profile of suggestedProfiles) {
    if (watchlistAddresses.has(profile.primaryAddress)) continue;
    if (suggested.length >= limit) break;
    
    const scores = profile.patternScores as any;
    const patterns: ActorPattern[] = [];
    if (scores) {
      if (scores.repeatBridge >= 0.5) patterns.push({ type: 'REPEAT_BRIDGE_PATTERN', confidence: scores.repeatBridge });
      if (scores.routeDominance >= 0.5) patterns.push({ type: 'ROUTE_DOMINANCE', confidence: scores.routeDominance });
      if (scores.sizeEscalation >= 0.5) patterns.push({ type: 'LIQUIDITY_ESCALATION', confidence: scores.sizeEscalation });
    }
    
    suggested.push({
      watchlistId: '',
      actorId: profile.actorId,
      address: profile.primaryAddress,
      label: undefined,
      confidence: profile.confidenceScore,
      confidenceLevel: profile.confidenceLevel,
      patterns,
      chains: profile.chainsUsed || [],
      bridgeCount7d: profile.bridgeCount7d || 0,
      bridgeCount30d: profile.bridgeCount30d || 0,
      totalVolumeUsd: profile.totalVolumeUsd || 0,
      openAlerts: 0,
      lastActivityAt: profile.lastActivityAt,
      addedAt: profile.createdAt,
    });
  }
  
  return suggested;
}

// =============================================================================
// TYPES
// =============================================================================

export interface ActorPattern {
  type: string;
  confidence: number;
}

export interface WatchlistActor {
  watchlistId: string;
  actorId: string;
  address: string;
  label?: string;
  confidence: number;
  confidenceLevel: string;
  patterns: ActorPattern[];
  chains: string[];
  bridgeCount7d: number;
  bridgeCount30d: number;
  totalVolumeUsd: number;
  openAlerts: number;
  lastActivityAt: Date | null;
  addedAt: Date | null;
}

export interface ActorProfileDetail {
  watchlistId?: string;
  actor: {
    id: string;
    address: string;
    label?: string;
    confidence: number;
    confidenceLevel: string;
    createdAt: Date;
  };
  summary: {
    chains: string[];
    dominantRoutes: { from: string; to: string; count: number }[];
    totalMigrations: number;
    totalVolumeUsd: number;
    avgMigrationSizeUsd: number;
    patterns: ActorPattern[];
  };
  recentEvents: {
    eventId: string;
    type: string;
    severity: string;
    title: string;
    explanation: string;
    confidence: number;
    timestamp: Date;
  }[];
  relatedAlerts: {
    alertId: string;
    type: string;
    severity: string;
    title: string;
    status: string;
    createdAt: Date;
  }[];
  recentMigrations: {
    migrationId: string;
    fromChain: string;
    toChain: string;
    token: string;
    amountUsd: number;
    confidence: number;
    detectedAt: Date;
  }[];
}
