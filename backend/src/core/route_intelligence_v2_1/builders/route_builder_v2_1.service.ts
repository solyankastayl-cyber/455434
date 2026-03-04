/**
 * Route Builder v2.1 (P0.5)
 * 
 * Builds base routes from unified_chain_events.
 * Creates TRANSFER, BRIDGE, CONTRACT segments.
 */

import { 
  UnifiedChainEventModel,
  getEventsByWallet 
} from '../../cross_chain/storage/unified_events.model.js';
import { 
  ISegmentV2, 
  SegmentTypeV2,
  RouteTypeV2 
} from '../storage/route_enriched.model.js';
import { resolveAddressLabel, isCEXAddress } from '../../route_intelligence/route_label_resolver.js';

// ============================================
// Types
// ============================================

export interface BaseRoute {
  wallet: string;
  segments: ISegmentV2[];
  chains: string[];
  startChain: string;
  endChain: string;
  startWallet: string;
  endWallet: string;
  totalAmountUsd: number;
  primaryToken?: string;
}

export interface BuilderConfig {
  maxSegments: number;
  minSegments: number;
  maxTimeGapMs: number;
}

const DEFAULT_CONFIG: BuilderConfig = {
  maxSegments: 50,
  minSegments: 1,
  maxTimeGapMs: 4 * 60 * 60 * 1000  // 4 hours
};

// ============================================
// Main Builder
// ============================================

/**
 * Build base route from unified events
 */
export async function buildBaseRoute(
  wallet: string,
  windowStart: Date,
  windowEnd: Date,
  config: Partial<BuilderConfig> = {}
): Promise<BaseRoute | null> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  // Fetch events for wallet in window
  const startTimestamp = Math.floor(windowStart.getTime() / 1000);
  const endTimestamp = Math.floor(windowEnd.getTime() / 1000);
  
  const events = await UnifiedChainEventModel.find({
    $or: [
      { from: wallet.toLowerCase() },
      { to: wallet.toLowerCase() }
    ],
    timestamp: { $gte: startTimestamp, $lte: endTimestamp }
  })
  .sort({ timestamp: 1 })
  .limit(cfg.maxSegments * 2) // Buffer for filtering
  .lean();
  
  if (events.length < cfg.minSegments) {
    return null;
  }
  
  // Convert events to segments
  const segments: ISegmentV2[] = [];
  const chains = new Set<string>();
  let totalAmountUsd = 0;
  const tokenCounts = new Map<string, number>();
  
  for (let i = 0; i < Math.min(events.length, cfg.maxSegments); i++) {
    const event = events[i];
    
    const segment = await eventToSegment(event, i);
    segments.push(segment);
    
    chains.add(event.chain);
    totalAmountUsd += event.amountUsd || 0;
    
    // Track token frequency
    const token = event.tokenSymbol || event.tokenAddress;
    tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
  }
  
  if (segments.length === 0) {
    return null;
  }
  
  // Determine primary token (most frequent)
  let primaryToken: string | undefined;
  let maxCount = 0;
  for (const [token, count] of tokenCounts) {
    if (count > maxCount) {
      maxCount = count;
      primaryToken = token;
    }
  }
  
  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];
  
  return {
    wallet: wallet.toLowerCase(),
    segments,
    chains: Array.from(chains),
    startChain: firstSegment.chainFrom,
    endChain: lastSegment.chainTo || lastSegment.chainFrom,
    startWallet: firstSegment.walletFrom,
    endWallet: lastSegment.walletTo,
    totalAmountUsd: Math.round(totalAmountUsd),
    primaryToken
  };
}

/**
 * Convert unified event to segment
 */
async function eventToSegment(
  event: any,
  index: number
): Promise<ISegmentV2> {
  // Determine segment type
  let type: SegmentTypeV2 = 'TRANSFER';
  
  if (event.eventType === 'BRIDGE_IN' || event.eventType === 'BRIDGE_OUT') {
    type = 'BRIDGE';
  } else if (await isCEXAddress(event.chain, event.to)) {
    type = 'CEX_DEPOSIT';
  } else if (await isCEXAddress(event.chain, event.from)) {
    type = 'CEX_WITHDRAW';
  } else if (event.eventType === 'CONTRACT') {
    type = 'CONTRACT';
  }
  
  // Resolve labels
  const fromLabel = await resolveAddressLabel(event.chain, event.from);
  const toLabel = await resolveAddressLabel(event.chain, event.to);
  
  return {
    index,
    type,
    chainFrom: event.chain,
    chainTo: event.eventType === 'BRIDGE_OUT' ? undefined : event.chain, // Bridge destination resolved later
    txHash: event.txHash,
    blockNumber: event.blockNumber,
    timestamp: new Date(event.timestamp * 1000),
    walletFrom: event.from.toLowerCase(),
    walletTo: event.to.toLowerCase(),
    tokenAddress: event.tokenAddress || '',
    tokenSymbol: event.tokenSymbol,
    amount: event.amount || '0',
    amountUsd: event.amountUsd,
    fromLabel: fromLabel.name || undefined,
    toLabel: toLabel.name || undefined,
    protocol: event.protocol,
    confidence: 0.7 // Base confidence for unified events
  };
}

/**
 * Get events for multiple wallets (for cluster analysis)
 */
export async function getEventsForWallets(
  wallets: string[],
  windowStart: Date,
  windowEnd: Date
): Promise<Map<string, any[]>> {
  const startTimestamp = Math.floor(windowStart.getTime() / 1000);
  const endTimestamp = Math.floor(windowEnd.getTime() / 1000);
  
  const events = await UnifiedChainEventModel.find({
    $or: [
      { from: { $in: wallets.map(w => w.toLowerCase()) } },
      { to: { $in: wallets.map(w => w.toLowerCase()) } }
    ],
    timestamp: { $gte: startTimestamp, $lte: endTimestamp }
  })
  .sort({ timestamp: 1 })
  .lean();
  
  // Group by wallet
  const result = new Map<string, any[]>();
  
  for (const event of events) {
    const fromWallet = event.from.toLowerCase();
    const toWallet = event.to.toLowerCase();
    
    if (wallets.includes(fromWallet)) {
      if (!result.has(fromWallet)) result.set(fromWallet, []);
      result.get(fromWallet)!.push(event);
    }
    
    if (wallets.includes(toWallet) && fromWallet !== toWallet) {
      if (!result.has(toWallet)) result.set(toWallet, []);
      result.get(toWallet)!.push(event);
    }
  }
  
  return result;
}

export { DEFAULT_CONFIG as BUILDER_CONFIG };
