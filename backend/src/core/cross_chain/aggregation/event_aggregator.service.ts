/**
 * Event Aggregator Service (P2.3.2)
 * 
 * Aggregates events by wallet, token, time windows
 * Prepares data for Bridge Detection, Actor Intelligence, Watchlist
 */

import { 
  UnifiedChainEventModel,
  getEventsByWallet,
  type IUnifiedChainEventDocument
} from '../storage/unified_events.model.js';

// ============================================
// Aggregation Types
// ============================================

export interface WalletAggregation {
  wallet: string;
  chains: string[];
  totalEvents: number;
  volumeUsd: number;
  transfers: number;
  bridgeIns: number;
  bridgeOuts: number;
  firstSeenAt: number;
  lastSeenAt: number;
  tokens: string[];
}

export interface TokenAggregation {
  token: string;
  symbol?: string;
  chains: string[];
  totalEvents: number;
  volumeUsd: number;
  uniqueWallets: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface TimeWindowAggregation {
  windowStart: number;
  windowEnd: number;
  eventCount: number;
  volumeUsd: number;
  chains: string[];
  uniqueWallets: number;
}

// ============================================
// Aggregation Functions
// ============================================

/**
 * Aggregate events by wallet
 */
export async function aggregateByWallet(
  address: string,
  options?: {
    startTime?: number;
    endTime?: number;
  }
): Promise<WalletAggregation | null> {
  const events = await getEventsByWallet(address, {
    startTime: options?.startTime,
    endTime: options?.endTime,
    limit: 10000 // Large enough for most wallets
  });
  
  if (events.length === 0) return null;
  
  const chains = new Set<string>();
  const tokens = new Set<string>();
  let volumeUsd = 0;
  let transfers = 0;
  let bridgeIns = 0;
  let bridgeOuts = 0;
  let firstSeen = Infinity;
  let lastSeen = 0;
  
  for (const event of events) {
    chains.add(event.chain);
    if (event.tokenAddress) tokens.add(event.tokenAddress);
    if (event.amountUsd) volumeUsd += event.amountUsd;
    
    if (event.eventType === 'TRANSFER') transfers++;
    if (event.eventType === 'BRIDGE_IN') bridgeIns++;
    if (event.eventType === 'BRIDGE_OUT') bridgeOuts++;
    
    if (event.timestamp < firstSeen) firstSeen = event.timestamp;
    if (event.timestamp > lastSeen) lastSeen = event.timestamp;
  }
  
  return {
    wallet: address.toLowerCase(),
    chains: Array.from(chains),
    totalEvents: events.length,
    volumeUsd,
    transfers,
    bridgeIns,
    bridgeOuts,
    firstSeenAt: firstSeen,
    lastSeenAt: lastSeen,
    tokens: Array.from(tokens)
  };
}

/**
 * Aggregate events by token
 */
export async function aggregateByToken(
  tokenAddress: string,
  options?: {
    chain?: string;
    startTime?: number;
    endTime?: number;
  }
): Promise<TokenAggregation | null> {
  const query: any = {
    tokenAddress: tokenAddress.toLowerCase()
  };
  
  if (options?.chain) query.chain = options.chain;
  if (options?.startTime) query.timestamp = { $gte: options.startTime };
  if (options?.endTime) {
    query.timestamp = { ...query.timestamp, $lte: options.endTime };
  }
  
  const events = await UnifiedChainEventModel.find(query)
    .sort({ timestamp: -1 })
    .limit(10000)
    .lean();
  
  if (events.length === 0) return null;
  
  const chains = new Set<string>();
  const wallets = new Set<string>();
  let volumeUsd = 0;
  let firstSeen = Infinity;
  let lastSeen = 0;
  
  for (const event of events) {
    chains.add(event.chain);
    wallets.add(event.from);
    wallets.add(event.to);
    if (event.amountUsd) volumeUsd += event.amountUsd;
    
    if (event.timestamp < firstSeen) firstSeen = event.timestamp;
    if (event.timestamp > lastSeen) lastSeen = event.timestamp;
  }
  
  return {
    token: tokenAddress.toLowerCase(),
    symbol: events[0]?.tokenSymbol,
    chains: Array.from(chains),
    totalEvents: events.length,
    volumeUsd,
    uniqueWallets: wallets.size,
    firstSeenAt: firstSeen,
    lastSeenAt: lastSeen
  };
}

/**
 * Aggregate events by time window
 */
export async function aggregateByTimeWindow(
  windowStart: number,
  windowEnd: number,
  options?: {
    chain?: string;
    eventType?: string;
  }
): Promise<TimeWindowAggregation> {
  const query: any = {
    timestamp: {
      $gte: windowStart,
      $lte: windowEnd
    }
  };
  
  if (options?.chain) query.chain = options.chain;
  if (options?.eventType) query.eventType = options.eventType;
  
  const events = await UnifiedChainEventModel.find(query).lean();
  
  const chains = new Set<string>();
  const wallets = new Set<string>();
  let volumeUsd = 0;
  
  for (const event of events) {
    chains.add(event.chain);
    wallets.add(event.from);
    wallets.add(event.to);
    if (event.amountUsd) volumeUsd += event.amountUsd;
  }
  
  return {
    windowStart,
    windowEnd,
    eventCount: events.length,
    volumeUsd,
    chains: Array.from(chains),
    uniqueWallets: wallets.size
  };
}

/**
 * Get cross-chain activity for wallet
 * 
 * Returns pairs of chains where wallet has activity
 */
export async function getCrossChainActivity(
  address: string
): Promise<{
  chainPairs: Array<{ from: string; to: string; count: number }>;
  totalCrossChain: number;
}> {
  const events = await getEventsByWallet(address, { limit: 10000 });
  
  // Build chain activity map
  const chainActivity = new Map<string, Set<number>>();
  
  for (const event of events) {
    if (!chainActivity.has(event.chain)) {
      chainActivity.set(event.chain, new Set());
    }
    chainActivity.get(event.chain)!.add(event.timestamp);
  }
  
  // Find chains with overlapping time windows (potential bridges)
  const chainPairs: Array<{ from: string; to: string; count: number }> = [];
  const chains = Array.from(chainActivity.keys());
  
  for (let i = 0; i < chains.length; i++) {
    for (let j = i + 1; j < chains.length; j++) {
      const chain1 = chains[i];
      const chain2 = chains[j];
      
      const timestamps1 = Array.from(chainActivity.get(chain1)!);
      const timestamps2 = Array.from(chainActivity.get(chain2)!);
      
      // Count events within 1 hour window (potential bridges)
      let pairCount = 0;
      const ONE_HOUR = 3600;
      
      for (const ts1 of timestamps1) {
        for (const ts2 of timestamps2) {
          if (Math.abs(ts1 - ts2) <= ONE_HOUR) {
            pairCount++;
          }
        }
      }
      
      if (pairCount > 0) {
        chainPairs.push({
          from: chain1,
          to: chain2,
          count: pairCount
        });
      }
    }
  }
  
  const totalCrossChain = chainPairs.reduce((sum, pair) => sum + pair.count, 0);
  
  return {
    chainPairs,
    totalCrossChain
  };
}

/**
 * Get aggregation summary stats
 */
export async function getAggregationStats(): Promise<{
  uniqueWallets: number;
  uniqueTokens: number;
  activeChains: string[];
  last24h: TimeWindowAggregation;
  last7d: TimeWindowAggregation;
}> {
  const now = Math.floor(Date.now() / 1000);
  const oneDayAgo = now - 86400;
  const sevenDaysAgo = now - 86400 * 7;
  
  const [wallets, tokens, chains, last24h, last7d] = await Promise.all([
    UnifiedChainEventModel.distinct('from'),
    UnifiedChainEventModel.distinct('tokenAddress'),
    UnifiedChainEventModel.distinct('chain'),
    aggregateByTimeWindow(oneDayAgo, now),
    aggregateByTimeWindow(sevenDaysAgo, now)
  ]);
  
  return {
    uniqueWallets: wallets.length,
    uniqueTokens: tokens.filter(Boolean).length,
    activeChains: chains,
    last24h,
    last7d
  };
}
