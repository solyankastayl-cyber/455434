/**
 * Watchlist Realtime Service (P2.1)
 * 
 * Provides delta-based updates for real-time monitoring:
 * - Event changes since timestamp
 * - Lightweight summary for polling
 * - No WebSocket, pure HTTP polling
 * 
 * Principles:
 * - Idempotent read-only
 * - Observation only (no Engine/ML impact)
 * - Multi-chain support
 */
import { WatchlistEventModel, IWatchlistEvent } from './watchlist_event.model.js';
import { WatchlistItemModel } from './watchlist.model.js';
import { SystemAlertModel } from '../system_alerts/system_alert.model.js';
import { ActorEventModel } from '../actor_intelligence/actor_event.model.js';
import { BridgeMigrationModel } from '../bridge_detection/bridge_migration.model.js';

// Cache for realtime summary (TTL 10s)
interface SummaryCache {
  data: RealtimeSummary | null;
  expiry: number;
}
let summaryCache: SummaryCache = { data: null, expiry: 0 };
const SUMMARY_CACHE_TTL = 10 * 1000; // 10 seconds

// =============================================================================
// TYPES
// =============================================================================

export interface RealtimeSummary {
  newEvents: number;
  newAlerts: number;
  newMigrations: number;
  updatedActors: number;
  lastUpdateAt: Date;
}

export interface EventChange {
  _id: string;
  eventType: string;
  severity: string;
  chain: string;
  chainFrom?: string;
  chainTo?: string;
  title: string;
  description?: string;
  metadata: any;
  isNew: boolean;
  firstSeenAt: Date;
  acknowledged: boolean;
  acknowledgedAt?: Date;
  timestamp: Date;
  // Related item
  item?: {
    _id: string;
    type: string;
    target: {
      address: string;
      chain: string;
      name?: string;
      symbol?: string;
    };
  };
  // Related alert (if any)
  relatedAlert?: {
    alertId: string;
    type: string;
    severity: string;
    status: string;
  };
}

export interface DeltaResponse {
  events: EventChange[];
  alerts: {
    alertId: string;
    type: string;
    severity: string;
    status: string;
    title: string;
    source: string;
    isNew: boolean;
    createdAt: Date;
  }[];
  actorEvents: {
    eventId: string;
    actorId: string;
    type: string;
    severity: string;
    title: string;
    isNew: boolean;
    timestamp: Date;
  }[];
  migrations: {
    migrationId: string;
    fromChain: string;
    toChain: string;
    token: string;
    amountUsd?: number;
    isNew: boolean;
    detectedAt: Date;
  }[];
  summary: {
    totalNew: number;
    byType: Record<string, number>;
  };
  serverTime: Date;
}

// =============================================================================
// DELTA ENDPOINT
// =============================================================================

/**
 * Get event changes since timestamp
 * 
 * @param since - ISO timestamp to get changes after
 * @param limit - Max number of events (default 50)
 * @returns Delta response with events, alerts, actor events, migrations
 */
export async function getEventChanges(
  since: Date,
  limit = 50
): Promise<DeltaResponse> {
  // Validate since date
  const sinceDate = new Date(since);
  if (isNaN(sinceDate.getTime())) {
    throw new Error('Invalid since timestamp');
  }
  
  // Fetch all changes in parallel
  const [
    watchlistEvents,
    systemAlerts,
    actorEvents,
    migrations,
  ] = await Promise.all([
    // Watchlist events
    WatchlistEventModel.find({
      timestamp: { $gt: sinceDate },
    })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean(),
    
    // System alerts (all sources)
    SystemAlertModel.find({
      createdAt: { $gt: sinceDate },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    
    // Actor events
    ActorEventModel.find({
      timestamp: { $gt: sinceDate },
    })
      .sort({ timestamp: -1 })
      .limit(Math.min(limit, 20))
      .lean(),
    
    // Bridge migrations
    BridgeMigrationModel.find({
      detectedAt: { $gt: sinceDate },
    })
      .sort({ detectedAt: -1 })
      .limit(Math.min(limit, 20))
      .lean(),
  ]);
  
  // Get watchlist items for events
  const itemIds = watchlistEvents.map(e => e.watchlistItemId);
  const items = await WatchlistItemModel.find({
    _id: { $in: itemIds },
  }).lean();
  const itemMap = new Map(items.map(i => [i._id.toString(), i]));
  
  // Find related alerts for events
  const eventIds = watchlistEvents.map(e => e._id.toString());
  const relatedAlerts = await SystemAlertModel.find({
    'metadata.watchlistEventId': { $in: eventIds },
  }).lean();
  const alertMap = new Map(relatedAlerts.map(a => [a.metadata?.watchlistEventId, a]));
  
  // Build event changes
  const eventChanges: EventChange[] = watchlistEvents.map(event => {
    const item = itemMap.get(event.watchlistItemId.toString());
    const alert = alertMap.get(event._id.toString());
    
    return {
      _id: event._id.toString(),
      eventType: event.eventType,
      severity: event.severity,
      chain: event.chain,
      chainFrom: event.chainFrom,
      chainTo: event.chainTo,
      title: event.title,
      description: event.description,
      metadata: event.metadata,
      isNew: !event.acknowledged,
      firstSeenAt: event.createdAt || event.timestamp,
      acknowledged: event.acknowledged,
      acknowledgedAt: event.acknowledgedAt,
      timestamp: event.timestamp,
      item: item ? {
        _id: item._id.toString(),
        type: item.type,
        target: {
          address: item.target?.address || '',
          chain: item.target?.chain || 'ETH',
          name: item.target?.name,
          symbol: item.target?.symbol,
        },
      } : undefined,
      relatedAlert: alert ? {
        alertId: alert.alertId,
        type: alert.type,
        severity: alert.severity,
        status: alert.status,
      } : undefined,
    };
  });
  
  // Build summary
  const byType: Record<string, number> = {};
  for (const e of watchlistEvents) {
    byType[e.eventType] = (byType[e.eventType] || 0) + 1;
  }
  for (const a of systemAlerts) {
    byType[`ALERT_${a.type}`] = (byType[`ALERT_${a.type}`] || 0) + 1;
  }
  
  return {
    events: eventChanges,
    alerts: systemAlerts.map(a => ({
      alertId: a.alertId,
      type: a.type,
      severity: a.severity,
      status: a.status,
      title: a.title,
      source: a.source,
      isNew: a.status === 'OPEN',
      createdAt: a.createdAt,
    })),
    actorEvents: actorEvents.map(e => ({
      eventId: e.eventId,
      actorId: e.actorId,
      type: e.type,
      severity: e.severity,
      title: e.title,
      isNew: true,
      timestamp: e.timestamp,
    })),
    migrations: migrations.map(m => ({
      migrationId: m.migrationId,
      fromChain: m.fromChain,
      toChain: m.toChain,
      token: m.token,
      amountUsd: m.amountUsd,
      isNew: true,
      detectedAt: m.detectedAt,
    })),
    summary: {
      totalNew: watchlistEvents.length + systemAlerts.length + actorEvents.length + migrations.length,
      byType,
    },
    serverTime: new Date(),
  };
}

// =============================================================================
// REALTIME SUMMARY
// =============================================================================

/**
 * Get lightweight realtime summary
 * Cached for 10 seconds to reduce load
 */
export async function getRealtimeSummary(windowMinutes = 5): Promise<RealtimeSummary> {
  // Check cache
  if (summaryCache.data && Date.now() < summaryCache.expiry) {
    return summaryCache.data;
  }
  
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  
  const [newEvents, newAlerts, newMigrations, updatedActors] = await Promise.all([
    // New watchlist events (unacknowledged)
    WatchlistEventModel.countDocuments({
      timestamp: { $gte: since },
      acknowledged: false,
    }),
    
    // New system alerts (OPEN status)
    SystemAlertModel.countDocuments({
      createdAt: { $gte: since },
      status: 'OPEN',
    }),
    
    // New bridge migrations
    BridgeMigrationModel.countDocuments({
      detectedAt: { $gte: since },
    }),
    
    // Actors with recent events
    ActorEventModel.distinct('actorId', {
      timestamp: { $gte: since },
    }).then(ids => ids.length),
  ]);
  
  const summary: RealtimeSummary = {
    newEvents,
    newAlerts,
    newMigrations,
    updatedActors,
    lastUpdateAt: new Date(),
  };
  
  // Update cache
  summaryCache = {
    data: summary,
    expiry: Date.now() + SUMMARY_CACHE_TTL,
  };
  
  return summary;
}

// =============================================================================
// MARK AS VIEWED
// =============================================================================

/**
 * Mark events as viewed (batch)
 */
export async function markEventsViewed(eventIds: string[]): Promise<number> {
  if (!eventIds.length) return 0;
  
  const result = await WatchlistEventModel.updateMany(
    { 
      _id: { $in: eventIds },
      acknowledged: false,
    },
    { 
      acknowledged: true,
      acknowledgedAt: new Date(),
    }
  );
  
  return result.modifiedCount;
}

/**
 * Get new events count for badge
 */
export async function getNewEventsCount(since?: Date): Promise<{
  watchlistEvents: number;
  alerts: number;
  total: number;
}> {
  const sinceDate = since || new Date(Date.now() - 5 * 60 * 1000); // Default 5 min
  
  const [watchlistEvents, alerts] = await Promise.all([
    WatchlistEventModel.countDocuments({
      timestamp: { $gte: sinceDate },
      acknowledged: false,
    }),
    SystemAlertModel.countDocuments({
      createdAt: { $gte: sinceDate },
      status: 'OPEN',
    }),
  ]);
  
  return {
    watchlistEvents,
    alerts,
    total: watchlistEvents + alerts,
  };
}
