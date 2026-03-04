/**
 * Actor Pattern Detection Service
 * 
 * Analyzes cross-chain behavior patterns of actors (wallets/clusters)
 * 
 * Patterns detected:
 * - P1: REPEAT_BRIDGE_PATTERN (≥3 migrations same route)
 * - P2: ROUTE_DOMINANCE (one route >60% of all)
 * - P3: SIZE_ESCALATION (last migration ≥1.5× average)
 * - P4: MULTI_CHAIN_PRESENCE (≥3 chains in 14 days)
 * - P5: TEMPORAL_PATTERN (migrations near system events)
 * 
 * Confidence Score:
 * - <0.4 → IGNORED
 * - 0.4-0.6 → LOW
 * - 0.6-0.8 → MEDIUM
 * - >0.8 → HIGH
 */
import { v4 as uuidv4 } from 'uuid';
import {
  ActorProfileModel,
  IActorProfile,
  findOrCreateActorProfile,
  getConfidenceLevel,
  generateActorId,
  IRouteStats,
  ActivityPattern,
} from './actor_profile.model.js';
import {
  ActorEventModel,
  IActorEvent,
  ActorEventType,
  createActorEvent,
  eventExistsRecently,
} from './actor_event.model.js';
import {
  BridgeMigrationModel,
  IBridgeMigration,
} from '../bridge_detection/bridge_migration.model.js';
import {
  SystemAlertModel,
} from '../system_alerts/system_alert.model.js';
import {
  createAlertFromActorEvent,
} from './actor_alerts.service.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Pattern thresholds
const REPEAT_BRIDGE_MIN_COUNT = 3;
const ROUTE_DOMINANCE_THRESHOLD = 0.6; // 60%
const SIZE_ESCALATION_FACTOR = 1.5;   // 1.5x
const MULTI_CHAIN_MIN_COUNT = 3;
const TEMPORAL_WINDOW_MINUTES = 60;

// Score weights
const PATTERN_WEIGHTS = {
  repeatBridge: 0.3,
  routeDominance: 0.2,
  sizeEscalation: 0.2,
  multiChainPresence: 0.15,
  temporalPattern: 0.15,
};

// Time windows
const WINDOW_7D = 7 * 24 * 60 * 60 * 1000;
const WINDOW_14D = 14 * 24 * 60 * 60 * 1000;
const WINDOW_30D = 30 * 24 * 60 * 60 * 1000;

// ============================================================================
// PATTERN ANALYSIS
// ============================================================================

interface PatternAnalysisResult {
  scores: {
    repeatBridge: number;
    routeDominance: number;
    sizeEscalation: number;
    multiChainPresence: number;
    temporalPattern: number;
  };
  totalScore: number;
  detectedPatterns: {
    type: ActorEventType;
    confidence: number;
    explanation: string;
    metadata: Record<string, any>;
  }[];
  routeStats: IRouteStats[];
  chainsUsed: string[];
  activityPattern: ActivityPattern;
  avgTimeBetween: number | null;
}

/**
 * Analyze patterns for an actor based on their migrations
 */
async function analyzePatterns(
  migrations: IBridgeMigration[],
  actorId: string
): Promise<PatternAnalysisResult> {
  const scores = {
    repeatBridge: 0,
    routeDominance: 0,
    sizeEscalation: 0,
    multiChainPresence: 0,
    temporalPattern: 0,
  };
  
  const detectedPatterns: PatternAnalysisResult['detectedPatterns'] = [];
  
  if (migrations.length === 0) {
    return {
      scores,
      totalScore: 0,
      detectedPatterns,
      routeStats: [],
      chainsUsed: [],
      activityPattern: 'unknown',
      avgTimeBetween: null,
    };
  }
  
  // Calculate route statistics
  const routeMap = new Map<string, { count: number; totalVolume: number; migrations: IBridgeMigration[] }>();
  const chainsSet = new Set<string>();
  
  for (const m of migrations) {
    const routeKey = `${m.fromChain}->${m.toChain}`;
    chainsSet.add(m.fromChain);
    chainsSet.add(m.toChain);
    
    if (!routeMap.has(routeKey)) {
      routeMap.set(routeKey, { count: 0, totalVolume: 0, migrations: [] });
    }
    const route = routeMap.get(routeKey)!;
    route.count++;
    route.totalVolume += m.amountFrom;
    route.migrations.push(m);
  }
  
  const routeStats: IRouteStats[] = Array.from(routeMap.entries())
    .map(([key, stats]) => {
      const [from, to] = key.split('->');
      return {
        from,
        to,
        count: stats.count,
        totalVolumeUsd: stats.totalVolume,
        avgSizeUsd: stats.totalVolume / stats.count,
      };
    })
    .sort((a, b) => b.count - a.count);
  
  const chainsUsed = Array.from(chainsSet);
  const totalMigrations = migrations.length;
  
  // -------------------------------------------------------------------------
  // P1: REPEAT_BRIDGE_PATTERN
  // -------------------------------------------------------------------------
  const maxRouteCount = routeStats[0]?.count || 0;
  
  if (maxRouteCount >= REPEAT_BRIDGE_MIN_COUNT) {
    scores.repeatBridge = Math.min(1, maxRouteCount / 5); // Normalize: 5 = max score
    
    detectedPatterns.push({
      type: 'REPEAT_BRIDGE_PATTERN',
      confidence: scores.repeatBridge,
      explanation: `Actor has ${maxRouteCount} migrations on ${routeStats[0].from}→${routeStats[0].to} route`,
      metadata: {
        routeFrom: routeStats[0].from,
        routeTo: routeStats[0].to,
        count: maxRouteCount,
      },
    });
  }
  
  // -------------------------------------------------------------------------
  // P2: ROUTE_DOMINANCE
  // -------------------------------------------------------------------------
  if (totalMigrations > 0 && maxRouteCount / totalMigrations >= ROUTE_DOMINANCE_THRESHOLD) {
    const dominance = maxRouteCount / totalMigrations;
    scores.routeDominance = dominance;
    
    detectedPatterns.push({
      type: 'ROUTE_DOMINANCE',
      confidence: dominance,
      explanation: `${(dominance * 100).toFixed(0)}% of migrations use ${routeStats[0].from}→${routeStats[0].to}`,
      metadata: {
        routeFrom: routeStats[0].from,
        routeTo: routeStats[0].to,
        dominancePercent: dominance * 100,
      },
    });
  }
  
  // -------------------------------------------------------------------------
  // P3: SIZE_ESCALATION
  // -------------------------------------------------------------------------
  if (migrations.length >= 2) {
    const sortedByTime = [...migrations].sort(
      (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
    );
    
    const latestMigration = sortedByTime[0];
    const previousMigrations = sortedByTime.slice(1);
    const avgPreviousAmount = previousMigrations.reduce((sum, m) => sum + m.amountFrom, 0) / previousMigrations.length;
    
    if (latestMigration.amountFrom >= avgPreviousAmount * SIZE_ESCALATION_FACTOR) {
      const escalationRatio = latestMigration.amountFrom / avgPreviousAmount;
      scores.sizeEscalation = Math.min(1, (escalationRatio - 1) / 2); // 3x = max score
      
      detectedPatterns.push({
        type: 'LIQUIDITY_ESCALATION',
        confidence: scores.sizeEscalation,
        explanation: `Latest migration $${(latestMigration.amountFrom / 1000).toFixed(0)}K is ${escalationRatio.toFixed(1)}x the average`,
        metadata: {
          latestAmount: latestMigration.amountFrom,
          avgAmount: avgPreviousAmount,
          escalationRatio,
        },
      });
    }
  }
  
  // -------------------------------------------------------------------------
  // P4: MULTI_CHAIN_PRESENCE
  // -------------------------------------------------------------------------
  if (chainsUsed.length >= MULTI_CHAIN_MIN_COUNT) {
    scores.multiChainPresence = Math.min(1, chainsUsed.length / 5); // 5 chains = max score
    
    detectedPatterns.push({
      type: 'MULTI_CHAIN_PRESENCE',
      confidence: scores.multiChainPresence,
      explanation: `Active on ${chainsUsed.length} chains: ${chainsUsed.join(', ')}`,
      metadata: {
        chains: chainsUsed,
        chainCount: chainsUsed.length,
      },
    });
  }
  
  // -------------------------------------------------------------------------
  // P5: TEMPORAL_PATTERN (check proximity to system events)
  // -------------------------------------------------------------------------
  // Get recent system alerts to check timing correlation
  const recentAlerts = await SystemAlertModel.find({
    category: { $in: ['MARKET', 'ML'] },
    createdAt: { $gte: new Date(Date.now() - WINDOW_7D) },
  }).sort({ createdAt: -1 }).limit(20);
  
  let temporalMatches = 0;
  
  for (const migration of migrations.slice(0, 10)) {
    const migrationTime = new Date(migration.completedAt).getTime();
    
    for (const alert of recentAlerts) {
      const alertTime = new Date(alert.createdAt).getTime();
      const timeDiff = Math.abs(migrationTime - alertTime) / (60 * 1000); // minutes
      
      if (timeDiff <= TEMPORAL_WINDOW_MINUTES) {
        temporalMatches++;
        break;
      }
    }
  }
  
  if (temporalMatches >= 2) {
    scores.temporalPattern = Math.min(1, temporalMatches / 4);
    
    detectedPatterns.push({
      type: 'STRATEGIC_TIMING',
      confidence: scores.temporalPattern,
      explanation: `${temporalMatches} migrations occurred within 1 hour of market events`,
      metadata: {
        matches: temporalMatches,
        windowMinutes: TEMPORAL_WINDOW_MINUTES,
      },
    });
  }
  
  // -------------------------------------------------------------------------
  // Calculate activity pattern
  // -------------------------------------------------------------------------
  let activityPattern: ActivityPattern = 'unknown';
  let avgTimeBetween: number | null = null;
  
  if (migrations.length >= 2) {
    const sortedByTime = [...migrations].sort(
      (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
    );
    
    const intervals: number[] = [];
    for (let i = 1; i < sortedByTime.length; i++) {
      const interval = new Date(sortedByTime[i].completedAt).getTime() - 
                      new Date(sortedByTime[i-1].completedAt).getTime();
      intervals.push(interval / 1000); // seconds
    }
    
    avgTimeBetween = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const stdDev = Math.sqrt(
      intervals.reduce((sum, val) => sum + Math.pow(val - avgTimeBetween, 2), 0) / intervals.length
    );
    
    const cv = stdDev / avgTimeBetween; // Coefficient of variation
    
    if (cv < 0.5) {
      activityPattern = 'steady';
    } else if (cv > 1.5) {
      activityPattern = 'burst';
    } else {
      activityPattern = 'event-driven';
    }
  }
  
  // -------------------------------------------------------------------------
  // Calculate total score
  // -------------------------------------------------------------------------
  const totalScore = Math.min(1,
    scores.repeatBridge * PATTERN_WEIGHTS.repeatBridge +
    scores.routeDominance * PATTERN_WEIGHTS.routeDominance +
    scores.sizeEscalation * PATTERN_WEIGHTS.sizeEscalation +
    scores.multiChainPresence * PATTERN_WEIGHTS.multiChainPresence +
    scores.temporalPattern * PATTERN_WEIGHTS.temporalPattern
  );
  
  return {
    scores,
    totalScore,
    detectedPatterns,
    routeStats,
    chainsUsed,
    activityPattern,
    avgTimeBetween,
  };
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Analyze and update actor profile
 */
export async function analyzeActor(
  address: string,
  emitEvents = true
): Promise<{ profile: IActorProfile; events: IActorEvent[] }> {
  const actorId = generateActorId(address);
  const now = new Date();
  
  // Get migrations for this wallet
  const since30d = new Date(now.getTime() - WINDOW_30D);
  const since7d = new Date(now.getTime() - WINDOW_7D);
  
  const migrations30d = await BridgeMigrationModel.find({
    wallet: address.toLowerCase(),
    createdAt: { $gte: since30d },
  }).sort({ completedAt: -1 });
  
  const migrations7d = migrations30d.filter(
    m => new Date(m.createdAt).getTime() >= since7d.getTime()
  );
  
  // Analyze patterns
  const analysis = await analyzePatterns(migrations30d, actorId);
  
  // Calculate aggregate stats
  const totalVolumeUsd = migrations30d.reduce((sum, m) => sum + m.amountFrom, 0);
  const avgMigrationSizeUsd = migrations30d.length > 0 ? totalVolumeUsd / migrations30d.length : 0;
  const maxMigrationSizeUsd = migrations30d.length > 0 
    ? Math.max(...migrations30d.map(m => m.amountFrom)) 
    : 0;
  
  // Find preferred chains
  const preferredFromChain = analysis.routeStats[0]?.from;
  const preferredToChain = analysis.routeStats[0]?.to;
  
  // Update or create profile
  const profile = await ActorProfileModel.findOneAndUpdate(
    { actorId },
    {
      $set: {
        primaryAddress: address.toLowerCase(),
        chainsUsed: analysis.chainsUsed,
        chainCount: analysis.chainsUsed.length,
        bridgeCount7d: migrations7d.length,
        bridgeCount30d: migrations30d.length,
        totalMigrations: migrations30d.length,
        avgMigrationSizeUsd,
        maxMigrationSizeUsd,
        totalVolumeUsd,
        dominantRoutes: analysis.routeStats.slice(0, 5),
        preferredFromChain,
        preferredToChain,
        activityPattern: analysis.activityPattern,
        avgTimeBetweenMigrations: analysis.avgTimeBetween,
        patternScores: analysis.scores,
        confidenceScore: Math.round(analysis.totalScore * 100) / 100,
        confidenceLevel: getConfidenceLevel(analysis.totalScore),
        lastActivityAt: migrations30d[0]?.completedAt || now,
        lastUpdatedAt: now,
      },
      $setOnInsert: {
        actorId,
        firstSeenAt: now,
      },
    },
    { upsert: true, new: true }
  );
  
  // Emit events for detected patterns
  const events: IActorEvent[] = [];
  
  if (emitEvents && analysis.totalScore >= 0.4) {
    for (const pattern of analysis.detectedPatterns) {
      // Check if similar event exists recently (avoid spam)
      const exists = await eventExistsRecently(actorId, pattern.type, 24);
      if (exists) continue;
      
      // Determine severity
      let severity: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
      if (pattern.confidence >= 0.7) severity = 'HIGH';
      else if (pattern.confidence >= 0.5) severity = 'MEDIUM';
      
      const event = await createActorEvent({
        eventId: `ae_${uuidv4()}`,
        actorId,
        actorAddress: address.toLowerCase(),
        type: pattern.type,
        severity,
        title: getEventTitle(pattern.type, profile!),
        description: pattern.explanation,
        explanation: pattern.explanation,
        confidence: pattern.confidence,
        relatedMigrations: migrations30d.slice(0, 5).map(m => m.migrationId),
        relatedChains: analysis.chainsUsed,
        metadata: pattern.metadata,
        timestamp: now,
      });
      
      events.push(event);
      console.log(`[ActorIntelligence] Created event ${pattern.type} for ${actorId} (confidence: ${pattern.confidence})`);
      
      // Create system alert for this event
      await createAlertFromActorEvent(event);
    }
    
    // Emit NEW_STRATEGIC_ACTOR for high confidence first-time detection
    if (analysis.totalScore >= 0.6 && !profile.firstSeenAt) {
      const exists = await eventExistsRecently(actorId, 'NEW_STRATEGIC_ACTOR', 168); // 7 days
      if (!exists) {
        const event = await createActorEvent({
          eventId: `ae_${uuidv4()}`,
          actorId,
          actorAddress: address.toLowerCase(),
          type: 'NEW_STRATEGIC_ACTOR',
          severity: analysis.totalScore >= 0.8 ? 'HIGH' : 'MEDIUM',
          title: `Strategic Actor Detected: ${address.slice(0, 6)}...${address.slice(-4)}`,
          description: `New actor with ${analysis.chainsUsed.length} chains and ${migrations30d.length} migrations detected`,
          explanation: `Actor shows ${analysis.detectedPatterns.length} patterns with overall confidence ${(analysis.totalScore * 100).toFixed(0)}%`,
          confidence: analysis.totalScore,
          relatedMigrations: migrations30d.slice(0, 5).map(m => m.migrationId),
          relatedChains: analysis.chainsUsed,
          metadata: {
            patterns: analysis.detectedPatterns.map(p => p.type),
            scores: analysis.scores,
          },
          timestamp: now,
        });
        events.push(event);
        
        // Create system alert for new strategic actor
        await createAlertFromActorEvent(event);
      }
    }
  }
  
  return { profile: profile!, events };
}

function getEventTitle(type: ActorEventType, profile: IActorProfile): string {
  const shortAddr = `${profile.primaryAddress.slice(0, 6)}...${profile.primaryAddress.slice(-4)}`;
  
  switch (type) {
    case 'REPEAT_BRIDGE_PATTERN':
      return `Repeat Bridge Pattern: ${shortAddr}`;
    case 'ROUTE_DOMINANCE':
      return `Route Dominance: ${shortAddr} (${profile.preferredFromChain}→${profile.preferredToChain})`;
    case 'LIQUIDITY_ESCALATION':
      return `Liquidity Escalation: ${shortAddr}`;
    case 'MULTI_CHAIN_PRESENCE':
      return `Multi-Chain Actor: ${shortAddr} (${profile.chainCount} chains)`;
    case 'STRATEGIC_TIMING':
      return `Strategic Timing: ${shortAddr}`;
    case 'NEW_STRATEGIC_ACTOR':
      return `New Strategic Actor: ${shortAddr}`;
    default:
      return `Actor Event: ${shortAddr}`;
  }
}

/**
 * Scan all actors with bridge migrations
 */
export async function scanActors(
  windowDays = 7,
  limit = 100
): Promise<{ scanned: number; updated: number; events: number }> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  
  // Get unique wallets from recent migrations
  const wallets = await BridgeMigrationModel.distinct('wallet', {
    createdAt: { $gte: since },
  });
  
  console.log(`[ActorIntelligence] Scanning ${Math.min(wallets.length, limit)} actors...`);
  
  let updated = 0;
  let totalEvents = 0;
  
  for (const wallet of wallets.slice(0, limit)) {
    try {
      const result = await analyzeActor(wallet);
      if (result.profile.confidenceScore >= 0.4) {
        updated++;
      }
      totalEvents += result.events.length;
    } catch (err) {
      console.error(`[ActorIntelligence] Failed to analyze ${wallet}:`, err);
    }
  }
  
  console.log(`[ActorIntelligence] Scan complete: ${wallets.length} wallets, ${updated} strategic actors, ${totalEvents} events`);
  
  return {
    scanned: Math.min(wallets.length, limit),
    updated,
    events: totalEvents,
  };
}

/**
 * Get actor statistics
 */
export async function getActorStats(): Promise<{
  total: number;
  byLevel: Record<string, number>;
  topActors: Array<{
    actorId: string;
    address: string;
    confidence: number;
    chains: string[];
    migrations: number;
  }>;
}> {
  const [total, byLevelAgg, topActors] = await Promise.all([
    ActorProfileModel.countDocuments({ confidenceScore: { $gte: 0.4 } }),
    ActorProfileModel.aggregate([
      { $match: { confidenceScore: { $gte: 0.4 } } },
      { $group: { _id: '$confidenceLevel', count: { $sum: 1 } } },
    ]),
    ActorProfileModel.find({ confidenceScore: { $gte: 0.4 } })
      .sort({ confidenceScore: -1 })
      .limit(10)
      .lean(),
  ]);
  
  const byLevel: Record<string, number> = {};
  for (const item of byLevelAgg) {
    byLevel[item._id] = item.count;
  }
  
  return {
    total,
    byLevel,
    topActors: topActors.map(a => ({
      actorId: a.actorId,
      address: a.primaryAddress,
      confidence: a.confidenceScore,
      chains: a.chainsUsed,
      migrations: a.totalMigrations,
    })),
  };
}

/**
 * Seed test actor data
 */
export async function seedTestActorData(): Promise<{ profiles: number; events: number }> {
  // Get wallets from existing migrations
  const migrations = await BridgeMigrationModel.find().limit(5);
  
  if (migrations.length === 0) {
    console.log('[ActorIntelligence] No migrations to seed from');
    return { profiles: 0, events: 0 };
  }
  
  let profilesCreated = 0;
  let eventsCreated = 0;
  
  for (const migration of migrations) {
    const result = await analyzeActor(migration.wallet);
    if (result.profile.confidenceScore >= 0.4) {
      profilesCreated++;
    }
    eventsCreated += result.events.length;
  }
  
  console.log(`[ActorIntelligence] Seeded ${profilesCreated} profiles, ${eventsCreated} events`);
  return { profiles: profilesCreated, events: eventsCreated };
}
