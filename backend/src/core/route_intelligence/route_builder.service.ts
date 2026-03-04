/**
 * Route Builder Engine (P0.3 - Core)
 * 
 * Builds liquidity routes from unified chain events.
 * The heart of route intelligence.
 */

import { 
  LiquidityRouteModel, 
  ILiquidityRoute, 
  generateRouteId,
  RouteType 
} from './liquidity_route.model.js';
import { 
  RouteSegmentModel, 
  IRouteSegment, 
  SegmentType 
} from './route_segment.model.js';
import { calculateRouteConfidence } from './route_confidence.service.js';
import { classifyRoute } from './route_classifier.service.js';
import { resolveAddressLabel, isCEXAddress } from './route_label_resolver.js';

// ============================================
// Configuration
// ============================================

const CONFIG = {
  // Time window for connecting events
  MAX_TIME_GAP_MS: 2 * 60 * 60 * 1000,  // 2 hours
  
  // Amount similarity threshold
  AMOUNT_SIMILARITY_THRESHOLD: 0.15,  // 15%
  
  // Min segments to form a route
  MIN_SEGMENTS: 1,
  
  // Max segments in a single route
  MAX_SEGMENTS: 20,
  
  // Stale route timeout
  STALE_TIMEOUT_MS: 24 * 60 * 60 * 1000  // 24 hours
};

// ============================================
// Types
// ============================================

interface ChainEvent {
  eventId: string;
  chain: string;
  txHash: string;
  blockNumber: number;
  timestamp: Date;
  from: string;
  to: string;
  tokenAddress: string;
  tokenSymbol?: string;
  amount: string;
  amountUsd?: number;
  eventType: string;
  protocol?: string;
  bridgeInfo?: {
    destinationChain?: string;
    bridgeProtocol?: string;
  };
}

interface BuildResult {
  routesCreated: number;
  routesUpdated: number;
  segmentsCreated: number;
  eventsProcessed: number;
}

// ============================================
// Main Builder
// ============================================

/**
 * Build routes from chain events
 */
export async function buildRoutesFromEvents(
  events: ChainEvent[]
): Promise<BuildResult> {
  const result: BuildResult = {
    routesCreated: 0,
    routesUpdated: 0,
    segmentsCreated: 0,
    eventsProcessed: 0
  };
  
  if (events.length === 0) return result;
  
  // Sort by timestamp
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  // Group events by wallet
  const eventsByWallet = groupEventsByWallet(sortedEvents);
  
  // Process each wallet's events
  for (const [wallet, walletEvents] of eventsByWallet) {
    const walletResult = await processWalletEvents(wallet, walletEvents);
    result.routesCreated += walletResult.routesCreated;
    result.routesUpdated += walletResult.routesUpdated;
    result.segmentsCreated += walletResult.segmentsCreated;
    result.eventsProcessed += walletEvents.length;
  }
  
  return result;
}

/**
 * Group events by wallet (from address)
 */
function groupEventsByWallet(events: ChainEvent[]): Map<string, ChainEvent[]> {
  const groups = new Map<string, ChainEvent[]>();
  
  for (const event of events) {
    const wallet = event.from.toLowerCase();
    if (!groups.has(wallet)) {
      groups.set(wallet, []);
    }
    groups.get(wallet)!.push(event);
  }
  
  return groups;
}

/**
 * Process events for a single wallet
 */
async function processWalletEvents(
  wallet: string,
  events: ChainEvent[]
): Promise<{ routesCreated: number; routesUpdated: number; segmentsCreated: number }> {
  const result = { routesCreated: 0, routesUpdated: 0, segmentsCreated: 0 };
  
  // Find active route for this wallet
  let activeRoute = await LiquidityRouteModel.findOne({
    startWallet: wallet,
    status: 'ACTIVE'
  });
  
  // Check if active route is stale
  if (activeRoute && isRouteStale(activeRoute)) {
    await finalizeRoute(activeRoute.routeId);
    activeRoute = null;
  }
  
  for (const event of events) {
    // Convert event to segment
    const segment = await eventToSegment(event);
    
    if (!activeRoute) {
      // Start new route
      activeRoute = await createNewRoute(wallet, event, segment);
      result.routesCreated++;
    } else {
      // Check if event connects to active route
      const connects = await canConnectToRoute(activeRoute, event);
      
      if (connects) {
        // Add segment to existing route
        await addSegmentToRoute(activeRoute.routeId, segment);
        await updateRouteMetrics(activeRoute.routeId);
        result.routesUpdated++;
      } else {
        // Finalize current route, start new one
        await finalizeRoute(activeRoute.routeId);
        activeRoute = await createNewRoute(wallet, event, segment);
        result.routesCreated++;
      }
    }
    
    result.segmentsCreated++;
  }
  
  return result;
}

// ============================================
// Route Operations
// ============================================

/**
 * Create a new route
 */
async function createNewRoute(
  wallet: string,
  event: ChainEvent,
  firstSegment: Partial<IRouteSegment>
): Promise<ILiquidityRoute> {
  const routeId = generateRouteId(wallet, new Date(event.timestamp));
  
  // Resolve labels
  const startLabel = await resolveAddressLabel(event.chain, wallet);
  const endLabel = await resolveAddressLabel(event.chain, event.to);
  const endIsCEX = await isCEXAddress(event.chain, event.to);
  
  // Create route
  const route = await LiquidityRouteModel.create({
    routeId,
    startWallet: wallet,
    endWallet: event.to,
    startChain: event.chain,
    endChain: firstSegment.chainTo || event.chain,
    chainsInvolved: [event.chain],
    routeType: 'UNKNOWN',
    status: 'ACTIVE',
    startLabel: startLabel.name,
    endLabel: endIsCEX ? endLabel.entityName : undefined,
    segmentsCount: 1,
    bridgesCount: firstSegment.type === 'BRIDGE' ? 1 : 0,
    swapsCount: firstSegment.type === 'SWAP' ? 1 : 0,
    totalAmountUsd: event.amountUsd,
    primaryToken: event.tokenSymbol || event.tokenAddress,
    confidenceScore: 0.5,
    firstSeenAt: event.timestamp,
    lastSeenAt: event.timestamp,
    durationMs: 0
  });
  
  // Create first segment
  await RouteSegmentModel.create({
    ...firstSegment,
    routeId,
    index: 0
  });
  
  console.log(`[RouteBuilder] Created route ${routeId} for wallet ${wallet.slice(0, 10)}...`);
  
  return route;
}

/**
 * Add segment to existing route
 */
async function addSegmentToRoute(
  routeId: string,
  segment: Partial<IRouteSegment>
): Promise<void> {
  // Get current segment count
  const route = await LiquidityRouteModel.findOne({ routeId });
  if (!route) return;
  
  const newIndex = route.segmentsCount;
  
  // Add segment
  await RouteSegmentModel.create({
    ...segment,
    routeId,
    index: newIndex
  });
  
  // Update route
  const updateData: any = {
    $inc: {
      segmentsCount: 1,
      bridgesCount: segment.type === 'BRIDGE' ? 1 : 0,
      swapsCount: segment.type === 'SWAP' ? 1 : 0
    },
    $set: {
      lastSeenAt: segment.timestamp,
      endWallet: segment.walletTo
    }
  };
  
  // Add chain if new
  if (segment.chainTo && !route.chainsInvolved.includes(segment.chainTo)) {
    updateData.$push = { chainsInvolved: segment.chainTo };
    updateData.$set.endChain = segment.chainTo;
  }
  
  await LiquidityRouteModel.updateOne({ routeId }, updateData);
}

/**
 * Update route metrics after adding segments
 */
async function updateRouteMetrics(routeId: string): Promise<void> {
  const route = await LiquidityRouteModel.findOne({ routeId });
  if (!route) return;
  
  const segments = await RouteSegmentModel.find({ routeId }).sort({ index: 1 }).lean();
  if (segments.length === 0) return;
  
  // Check if ends at CEX
  const lastSegment = segments[segments.length - 1];
  const endIsCEX = await isCEXAddress(
    lastSegment.chainTo || lastSegment.chainFrom,
    lastSegment.walletTo
  );
  
  // Update end label if CEX
  if (endIsCEX) {
    const endLabel = await resolveAddressLabel(
      lastSegment.chainTo || lastSegment.chainFrom,
      lastSegment.walletTo
    );
    await LiquidityRouteModel.updateOne(
      { routeId },
      { $set: { endLabel: endLabel.entityName } }
    );
  }
  
  // Calculate confidence
  const confidence = calculateRouteConfidence(segments as IRouteSegment[], endIsCEX);
  
  // Classify route
  const classification = classifyRoute(route, segments as IRouteSegment[], endIsCEX);
  
  // Calculate duration
  const duration = new Date(route.lastSeenAt).getTime() - new Date(route.firstSeenAt).getTime();
  
  // Update route
  await LiquidityRouteModel.updateOne(
    { routeId },
    {
      $set: {
        routeType: classification.routeType,
        confidenceScore: confidence.score,
        confidenceFactors: confidence.factors,
        durationMs: duration,
        updatedAt: new Date()
      }
    }
  );
}

/**
 * Finalize a route (mark as complete)
 */
async function finalizeRoute(routeId: string): Promise<void> {
  await updateRouteMetrics(routeId);
  
  await LiquidityRouteModel.updateOne(
    { routeId },
    { $set: { status: 'COMPLETE', updatedAt: new Date() } }
  );
  
  console.log(`[RouteBuilder] Finalized route ${routeId}`);
}

// ============================================
// Helpers
// ============================================

/**
 * Convert chain event to route segment
 */
async function eventToSegment(event: ChainEvent): Promise<Partial<IRouteSegment>> {
  // Determine segment type
  let type: SegmentType = 'TRANSFER';
  
  if (event.bridgeInfo?.destinationChain) {
    type = 'BRIDGE';
  } else if (event.eventType === 'swap' || event.protocol?.toLowerCase().includes('swap')) {
    type = 'SWAP';
  } else if (await isCEXAddress(event.chain, event.to)) {
    type = 'CEX_DEPOSIT';
  }
  
  // Resolve labels
  const fromLabel = await resolveAddressLabel(event.chain, event.from);
  const toLabel = await resolveAddressLabel(event.chain, event.to);
  
  return {
    type,
    chainFrom: event.chain,
    chainTo: event.bridgeInfo?.destinationChain,
    txHash: event.txHash,
    blockNumber: event.blockNumber,
    timestamp: event.timestamp,
    walletFrom: event.from.toLowerCase(),
    walletTo: event.to.toLowerCase(),
    tokenAddress: event.tokenAddress,
    tokenSymbol: event.tokenSymbol,
    amount: event.amount,
    amountUsd: event.amountUsd,
    protocol: event.protocol || event.bridgeInfo?.bridgeProtocol,
    fromLabel: fromLabel.name,
    toLabel: toLabel.name,
    confidence: 0.5
  };
}

/**
 * Check if event can connect to existing route
 */
async function canConnectToRoute(
  route: ILiquidityRoute,
  event: ChainEvent
): Promise<boolean> {
  // Check time gap
  const gap = new Date(event.timestamp).getTime() - new Date(route.lastSeenAt).getTime();
  if (gap > CONFIG.MAX_TIME_GAP_MS) {
    return false;
  }
  
  // Check max segments
  if (route.segmentsCount >= CONFIG.MAX_SEGMENTS) {
    return false;
  }
  
  // Check amount similarity (if we have USD values)
  if (route.totalAmountUsd && event.amountUsd) {
    const diff = Math.abs(route.totalAmountUsd - event.amountUsd) / route.totalAmountUsd;
    if (diff > CONFIG.AMOUNT_SIMILARITY_THRESHOLD * route.segmentsCount) {
      // Allow more variance as route grows
      return false;
    }
  }
  
  // Check chain continuity
  const lastChain = route.endChain || route.startChain;
  if (event.chain !== lastChain && !route.chainsInvolved.includes(event.chain)) {
    // New chain must be connected via bridge
    // For now, allow if within time window
  }
  
  return true;
}

/**
 * Check if route is stale
 */
function isRouteStale(route: ILiquidityRoute): boolean {
  const age = Date.now() - new Date(route.lastSeenAt).getTime();
  return age > CONFIG.STALE_TIMEOUT_MS;
}

/**
 * Mark stale routes
 */
export async function markStaleRoutes(): Promise<number> {
  const staleTime = new Date(Date.now() - CONFIG.STALE_TIMEOUT_MS);
  
  const result = await LiquidityRouteModel.updateMany(
    { 
      status: 'ACTIVE',
      lastSeenAt: { $lt: staleTime }
    },
    { $set: { status: 'STALE' } }
  );
  
  return result.modifiedCount;
}

// ============================================
// Recompute Functions
// ============================================

/**
 * Recompute route metrics for existing routes
 */
export async function recomputeRouteMetrics(routeIds?: string[]): Promise<number> {
  const query = routeIds ? { routeId: { $in: routeIds } } : {};
  const routes = await LiquidityRouteModel.find(query);
  
  let updated = 0;
  for (const route of routes) {
    await updateRouteMetrics(route.routeId);
    updated++;
  }
  
  return updated;
}

/**
 * Get routes needing recomputation
 */
export async function getRoutesNeedingRecompute(limit: number = 100): Promise<string[]> {
  const routes = await LiquidityRouteModel.find({
    status: 'ACTIVE',
    updatedAt: { $lt: new Date(Date.now() - 60000) } // Not updated in last minute
  })
  .sort({ lastSeenAt: -1 })
  .limit(limit)
  .select('routeId');
  
  return routes.map(r => r.routeId);
}

export { CONFIG as BUILDER_CONFIG };
