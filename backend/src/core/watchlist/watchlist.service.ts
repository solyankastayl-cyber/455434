/**
 * Watchlist Service - V2
 * 
 * Main service for Watchlist operations:
 * - CRUD for watchlist items
 * - Summary statistics
 * - Event queries
 */
import { Types } from 'mongoose';
import { 
  WatchlistItemModel, 
  IWatchlistItem, 
  WatchlistItemType,
  WatchlistTarget 
} from './watchlist.model.js';
import { 
  WatchlistEventModel, 
  IWatchlistEvent,
  countItemsWithRecentEvents,
  getWatchlistEvents,
  createWatchlistEvent,
  WatchlistEventType,
  WatchlistEventSeverity
} from './watchlist_event.model.js';

/**
 * Watchlist Summary Response
 */
export interface WatchlistSummary {
  total: number;
  tokens: number;
  wallets: number;
  actors: number;
  withAlerts: number; // items with events in last 24h
}

/**
 * Get watchlist summary stats
 */
export async function getWatchlistSummary(userId?: string): Promise<WatchlistSummary> {
  const baseQuery = userId ? { userId } : {};
  
  const [total, tokens, wallets, actors, withAlerts] = await Promise.all([
    WatchlistItemModel.countDocuments(baseQuery),
    WatchlistItemModel.countDocuments({ ...baseQuery, type: 'token' }),
    WatchlistItemModel.countDocuments({ ...baseQuery, type: 'wallet' }),
    WatchlistItemModel.countDocuments({ ...baseQuery, type: 'actor' }),
    countItemsWithRecentEvents(),
  ]);
  
  return {
    total,
    tokens,
    wallets,
    actors,
    withAlerts,
  };
}

/**
 * Get watchlist items with recent event counts
 */
export async function getWatchlistWithEventCounts(
  userId?: string,
  type?: WatchlistItemType
): Promise<Array<IWatchlistItem & { eventCount: number; lastEventAt?: Date }>> {
  const query: any = {};
  if (userId) query.userId = userId;
  if (type) query.type = type;
  
  const items = await WatchlistItemModel.find(query).sort({ createdAt: -1 }).lean();
  
  // Get event counts for each item
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const enrichedItems = await Promise.all(
    items.map(async (item) => {
      const events = await WatchlistEventModel.find({
        watchlistItemId: item._id,
        timestamp: { $gte: since },
      })
        .sort({ timestamp: -1 })
        .limit(1)
        .lean();
      
      const eventCount = await WatchlistEventModel.countDocuments({
        watchlistItemId: item._id,
        timestamp: { $gte: since },
      });
      
      return {
        ...item,
        eventCount,
        lastEventAt: events[0]?.timestamp,
      };
    })
  );
  
  return enrichedItems as any;
}

/**
 * Get events with item details
 */
export async function getEventsWithItems(filters: {
  chain?: string;
  severity?: string;
  eventType?: string;
  window?: '24h' | '7d' | '30d';
  limit?: number;
}): Promise<Array<IWatchlistEvent & { item?: Partial<IWatchlistItem> }>> {
  // Calculate since date based on window
  let since: Date;
  switch (filters.window) {
    case '30d':
      since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '7d':
      since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '24h':
    default:
      since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  }
  
  const events = await getWatchlistEvents({
    chain: filters.chain,
    severity: filters.severity,
    eventType: filters.eventType,
    since,
    limit: filters.limit || 50,
  });
  
  // Get item details for each event
  const itemIds = [...new Set(events.map(e => e.watchlistItemId.toString()))];
  const items = await WatchlistItemModel.find({
    _id: { $in: itemIds.map(id => new Types.ObjectId(id)) },
  }).lean();
  
  const itemMap = new Map(items.map(i => [i._id.toString(), i]));
  
  return events.map(event => ({
    ...event.toObject(),
    item: itemMap.get(event.watchlistItemId.toString()) || undefined,
  }));
}

/**
 * Seed test watchlist data (for development)
 */
export async function seedWatchlistTestData(userId: string = 'test_user'): Promise<{
  items: number;
  events: number;
}> {
  // Create test items
  const testItems = [
    {
      userId,
      type: 'token' as WatchlistItemType,
      target: {
        address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        chain: 'ETH',
        symbol: 'USDT',
        name: 'Tether USD',
      },
    },
    {
      userId,
      type: 'token' as WatchlistItemType,
      target: {
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        chain: 'ETH',
        symbol: 'USDC',
        name: 'USD Coin',
      },
    },
    {
      userId,
      type: 'wallet' as WatchlistItemType,
      target: {
        address: '0x742d35cc6634c0532925a3b844bc454e4438f44e',
        chain: 'ETH',
        name: 'Whale Wallet #1',
      },
    },
    {
      userId,
      type: 'wallet' as WatchlistItemType,
      target: {
        address: '0x28c6c06298d514db089934071355e5743bf21d60',
        chain: 'ARB',
        name: 'Binance Hot Wallet',
      },
    },
    {
      userId,
      type: 'actor' as WatchlistItemType,
      target: {
        address: 'actor_whale_cluster_001',
        chain: 'ETH',
        name: 'Whale Cluster Alpha',
      },
    },
  ];
  
  const createdItems: IWatchlistItem[] = [];
  
  for (const itemData of testItems) {
    const existing = await WatchlistItemModel.findOne({
      userId: itemData.userId,
      type: itemData.type,
      'target.address': itemData.target.address,
      'target.chain': itemData.target.chain,
    });
    
    if (!existing) {
      const item = new WatchlistItemModel(itemData);
      await item.save();
      createdItems.push(item);
    } else {
      createdItems.push(existing);
    }
  }
  
  // Create test events
  const now = new Date();
  const testEvents = [
    {
      watchlistItemId: createdItems[0]._id,
      eventType: 'LARGE_TRANSFER' as WatchlistEventType,
      severity: 'HIGH' as WatchlistEventSeverity,
      chain: 'ETH',
      title: 'Large USDT Transfer Detected',
      description: '$5.2M USDT transferred from unknown wallet to Binance',
      metadata: {
        valueUsd: 5200000,
        txHash: '0x1234...abcd',
      },
      timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2h ago
    },
    {
      watchlistItemId: createdItems[0]._id,
      eventType: 'ACCUMULATION' as WatchlistEventType,
      severity: 'MEDIUM' as WatchlistEventSeverity,
      chain: 'ETH',
      title: 'USDT Accumulation Pattern',
      description: '+12.5% balance increase over 6 hours',
      metadata: {
        percentChange: 12.5,
      },
      timestamp: new Date(now.getTime() - 6 * 60 * 60 * 1000), // 6h ago
    },
    {
      watchlistItemId: createdItems[2]._id,
      eventType: 'BRIDGE_OUT' as WatchlistEventType,
      severity: 'HIGH' as WatchlistEventSeverity,
      chain: 'ETH',
      chainFrom: 'ETH',
      chainTo: 'ARB',
      title: 'Cross-chain Bridge Out',
      description: 'Whale wallet bridged $1.8M ETH to Arbitrum',
      metadata: {
        valueUsd: 1800000,
        bridge: 'Arbitrum Bridge',
      },
      timestamp: new Date(now.getTime() - 30 * 60 * 1000), // 30min ago
    },
    {
      watchlistItemId: createdItems[3]._id,
      eventType: 'BRIDGE_IN' as WatchlistEventType,
      severity: 'MEDIUM' as WatchlistEventSeverity,
      chain: 'ARB',
      chainFrom: 'ETH',
      chainTo: 'ARB',
      title: 'Cross-chain Bridge In',
      description: 'Binance wallet received $1.8M from Ethereum',
      metadata: {
        valueUsd: 1800000,
        bridge: 'Arbitrum Bridge',
      },
      timestamp: new Date(now.getTime() - 25 * 60 * 1000), // 25min ago
    },
    {
      watchlistItemId: createdItems[4]._id,
      eventType: 'ACTOR_ACTIVITY' as WatchlistEventType,
      severity: 'LOW' as WatchlistEventSeverity,
      chain: 'ETH',
      title: 'Actor Activity Spike',
      description: 'Whale cluster showing increased transaction frequency',
      metadata: {
        txCount: 47,
        period: '1h',
      },
      timestamp: new Date(now.getTime() - 45 * 60 * 1000), // 45min ago
    },
    {
      watchlistItemId: createdItems[1]._id,
      eventType: 'DISTRIBUTION' as WatchlistEventType,
      severity: 'MEDIUM' as WatchlistEventSeverity,
      chain: 'ETH',
      title: 'USDC Distribution Pattern',
      description: '-8.3% balance decrease, multiple outgoing transfers',
      metadata: {
        percentChange: -8.3,
        outgoingTxCount: 12,
      },
      timestamp: new Date(now.getTime() - 3 * 60 * 60 * 1000), // 3h ago
    },
  ];
  
  let eventsCreated = 0;
  for (const eventData of testEvents) {
    await createWatchlistEvent(eventData);
    eventsCreated++;
  }
  
  return {
    items: createdItems.length,
    events: eventsCreated,
  };
}
