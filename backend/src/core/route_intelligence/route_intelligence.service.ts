/**
 * Route Intelligence Service (P0.3)
 * 
 * High-level service for route intelligence operations.
 * Orchestrates route building, querying, and analysis.
 */

import { 
  LiquidityRouteModel, 
  ILiquidityRoute,
  ILiquidityRouteDocument,
  RouteType,
  RouteStatus 
} from './liquidity_route.model.js';
import { 
  RouteSegmentModel, 
  IRouteSegment,
  IRouteSegmentDocument 
} from './route_segment.model.js';
import { 
  buildRoutesFromEvents, 
  markStaleRoutes, 
  recomputeRouteMetrics,
  BUILDER_CONFIG 
} from './route_builder.service.js';
import { detectDumpPattern, detectAccumulationPattern, getRouteSeverity } from './route_classifier.service.js';
import { 
  UnifiedChainEventModel, 
  getEventsByWallet 
} from '../cross_chain/storage/unified_events.model.js';

// ============================================
// Types
// ============================================

export interface RouteQueryOptions {
  routeType?: RouteType | RouteType[];
  status?: RouteStatus | RouteStatus[];
  minConfidence?: number;
  chain?: string;
  wallet?: string;
  actorId?: string;
  endLabel?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  sortBy?: 'confidence' | 'amount' | 'time' | 'segments';
  sortOrder?: 'asc' | 'desc';
}

export interface RouteWithSegments {
  route: ILiquidityRoute;
  segments: IRouteSegment[];
}

export interface RouteStats {
  totalRoutes: number;
  activeRoutes: number;
  completedRoutes: number;
  staleRoutes: number;
  byType: Record<RouteType, number>;
  avgConfidence: number;
  avgSegments: number;
  totalVolumeUsd: number;
  exitRoutesToday: number;
  topExitDestinations: Array<{ label: string; count: number; volumeUsd: number }>;
}

export interface BuildRoutesResult {
  routesCreated: number;
  routesUpdated: number;
  segmentsCreated: number;
  eventsProcessed: number;
  staleMarked: number;
  duration: number;
}

// ============================================
// Query Functions
// ============================================

/**
 * Get routes with filtering
 */
export async function getRoutes(options: RouteQueryOptions = {}): Promise<ILiquidityRouteDocument[]> {
  const query: any = {};
  
  // Route type filter
  if (options.routeType) {
    query.routeType = Array.isArray(options.routeType) 
      ? { $in: options.routeType } 
      : options.routeType;
  }
  
  // Status filter
  if (options.status) {
    query.status = Array.isArray(options.status)
      ? { $in: options.status }
      : options.status;
  }
  
  // Confidence filter
  if (options.minConfidence !== undefined) {
    query.confidenceScore = { $gte: options.minConfidence };
  }
  
  // Chain filter
  if (options.chain) {
    query.chainsInvolved = options.chain;
  }
  
  // Wallet filter
  if (options.wallet) {
    query.$or = [
      { startWallet: options.wallet.toLowerCase() },
      { endWallet: options.wallet.toLowerCase() }
    ];
  }
  
  // Actor filter
  if (options.actorId) {
    query.actorId = options.actorId;
  }
  
  // End label filter (for finding routes to specific exchanges)
  if (options.endLabel) {
    query.endLabel = { $regex: options.endLabel, $options: 'i' };
  }
  
  // Date range filter
  if (options.startDate || options.endDate) {
    query.firstSeenAt = {};
    if (options.startDate) query.firstSeenAt.$gte = options.startDate;
    if (options.endDate) query.firstSeenAt.$lte = options.endDate;
  }
  
  // Sort options
  const sortField = {
    confidence: 'confidenceScore',
    amount: 'totalAmountUsd',
    time: 'lastSeenAt',
    segments: 'segmentsCount'
  }[options.sortBy || 'time'] || 'lastSeenAt';
  
  const sortOrder = options.sortOrder === 'asc' ? 1 : -1;
  
  return LiquidityRouteModel.find(query)
    .sort({ [sortField]: sortOrder })
    .skip(options.offset || 0)
    .limit(options.limit || 100)
    .lean();
}

/**
 * Get route by ID with segments
 */
export async function getRouteWithSegments(routeId: string): Promise<RouteWithSegments | null> {
  const route = await LiquidityRouteModel.findOne({ routeId }).lean();
  if (!route) return null;
  
  const segments = await RouteSegmentModel.find({ routeId })
    .sort({ index: 1 })
    .lean();
  
  return { route, segments };
}

/**
 * Get routes by wallet
 */
export async function getRoutesByWallet(
  wallet: string,
  options: { limit?: number; includeSegments?: boolean } = {}
): Promise<Array<RouteWithSegments | ILiquidityRoute>> {
  const routes = await LiquidityRouteModel.find({
    $or: [
      { startWallet: wallet.toLowerCase() },
      { endWallet: wallet.toLowerCase() }
    ]
  })
  .sort({ lastSeenAt: -1 })
  .limit(options.limit || 50)
  .lean();
  
  if (!options.includeSegments) {
    return routes;
  }
  
  // Fetch segments for each route
  const results: RouteWithSegments[] = [];
  for (const route of routes) {
    const segments = await RouteSegmentModel.find({ routeId: route.routeId })
      .sort({ index: 1 })
      .lean();
    results.push({ route, segments });
  }
  
  return results;
}

/**
 * Get EXIT routes (potential dumps)
 */
export async function getExitRoutes(options: {
  minConfidence?: number;
  minAmountUsd?: number;
  exchange?: string;
  since?: Date;
  limit?: number;
} = {}): Promise<ILiquidityRouteDocument[]> {
  const query: any = {
    routeType: 'EXIT',
    status: { $in: ['COMPLETE', 'ACTIVE'] }
  };
  
  if (options.minConfidence) {
    query.confidenceScore = { $gte: options.minConfidence };
  }
  
  if (options.minAmountUsd) {
    query.totalAmountUsd = { $gte: options.minAmountUsd };
  }
  
  if (options.exchange) {
    query.endLabel = { $regex: options.exchange, $options: 'i' };
  }
  
  if (options.since) {
    query.firstSeenAt = { $gte: options.since };
  }
  
  return LiquidityRouteModel.find(query)
    .sort({ confidenceScore: -1, totalAmountUsd: -1 })
    .limit(options.limit || 50)
    .lean();
}

// ============================================
// Statistics
// ============================================

/**
 * Get route statistics
 */
export async function getRouteStats(): Promise<RouteStats> {
  const [
    totalRoutes,
    statusCounts,
    typeCounts,
    avgMetrics,
    exitToday,
    topDestinations
  ] = await Promise.all([
    // Total routes
    LiquidityRouteModel.countDocuments(),
    
    // Count by status
    LiquidityRouteModel.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    
    // Count by type
    LiquidityRouteModel.aggregate([
      { $group: { _id: '$routeType', count: { $sum: 1 } } }
    ]),
    
    // Average metrics
    LiquidityRouteModel.aggregate([
      {
        $group: {
          _id: null,
          avgConfidence: { $avg: '$confidenceScore' },
          avgSegments: { $avg: '$segmentsCount' },
          totalVolume: { $sum: '$totalAmountUsd' }
        }
      }
    ]),
    
    // EXIT routes today
    LiquidityRouteModel.countDocuments({
      routeType: 'EXIT',
      firstSeenAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    }),
    
    // Top exit destinations
    LiquidityRouteModel.aggregate([
      { 
        $match: { 
          routeType: 'EXIT', 
          endLabel: { $exists: true, $ne: null } 
        } 
      },
      { 
        $group: { 
          _id: '$endLabel', 
          count: { $sum: 1 },
          volumeUsd: { $sum: '$totalAmountUsd' }
        } 
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ])
  ]);
  
  // Process status counts
  const statusMap = statusCounts.reduce((acc, s) => {
    acc[s._id] = s.count;
    return acc;
  }, {} as Record<string, number>);
  
  // Process type counts
  const byType = typeCounts.reduce((acc, t) => {
    acc[t._id as RouteType] = t.count;
    return acc;
  }, {} as Record<RouteType, number>);
  
  // Process avg metrics
  const metrics = avgMetrics[0] || { avgConfidence: 0, avgSegments: 0, totalVolume: 0 };
  
  return {
    totalRoutes,
    activeRoutes: statusMap['ACTIVE'] || 0,
    completedRoutes: statusMap['COMPLETE'] || 0,
    staleRoutes: statusMap['STALE'] || 0,
    byType,
    avgConfidence: Math.round((metrics.avgConfidence || 0) * 100) / 100,
    avgSegments: Math.round((metrics.avgSegments || 0) * 10) / 10,
    totalVolumeUsd: Math.round(metrics.totalVolume || 0),
    exitRoutesToday: exitToday,
    topExitDestinations: topDestinations.map(d => ({
      label: d._id,
      count: d.count,
      volumeUsd: Math.round(d.volumeUsd || 0)
    }))
  };
}

// ============================================
// Route Building
// ============================================

/**
 * Build routes from recent chain events
 */
export async function buildRoutesFromRecentEvents(options: {
  chain?: string;
  since?: Date;
  limit?: number;
} = {}): Promise<BuildRoutesResult> {
  const startTime = Date.now();
  
  // Query unified events
  const query: any = {
    eventType: { $in: ['TRANSFER', 'BRIDGE_IN', 'BRIDGE_OUT'] }
  };
  
  if (options.chain) {
    query.chain = options.chain;
  }
  
  if (options.since) {
    query.timestamp = { $gte: Math.floor(options.since.getTime() / 1000) };
  } else {
    // Default: last 24 hours
    query.timestamp = { $gte: Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000) };
  }
  
  const events = await UnifiedChainEventModel.find(query)
    .sort({ timestamp: 1 })
    .limit(options.limit || 10000)
    .lean();
  
  // Convert to ChainEvent format
  const chainEvents = events.map(e => ({
    eventId: e.eventId,
    chain: e.chain,
    txHash: e.txHash,
    blockNumber: e.blockNumber,
    timestamp: new Date(e.timestamp * 1000),
    from: e.from,
    to: e.to,
    tokenAddress: e.tokenAddress || '',
    tokenSymbol: e.tokenSymbol,
    amount: e.amount,
    amountUsd: e.amountUsd,
    eventType: e.eventType,
    bridgeInfo: e.eventType.includes('BRIDGE') ? {
      destinationChain: e.eventType === 'BRIDGE_OUT' ? undefined : e.chain
    } : undefined
  }));
  
  // Build routes
  const buildResult = await buildRoutesFromEvents(chainEvents);
  
  // Mark stale routes
  const staleMarked = await markStaleRoutes();
  
  return {
    ...buildResult,
    staleMarked,
    duration: Date.now() - startTime
  };
}

/**
 * Rebuild routes for a specific wallet
 */
export async function rebuildWalletRoutes(wallet: string): Promise<BuildRoutesResult> {
  const startTime = Date.now();
  
  // Delete existing routes for wallet
  const existingRoutes = await LiquidityRouteModel.find({
    $or: [
      { startWallet: wallet.toLowerCase() },
      { endWallet: wallet.toLowerCase() }
    ]
  }).select('routeId');
  
  const routeIds = existingRoutes.map(r => r.routeId);
  
  await Promise.all([
    LiquidityRouteModel.deleteMany({ routeId: { $in: routeIds } }),
    RouteSegmentModel.deleteMany({ routeId: { $in: routeIds } })
  ]);
  
  // Get all events for wallet
  const events = await getEventsByWallet(wallet, { limit: 1000 });
  
  // Convert to ChainEvent format
  const chainEvents = events.map(e => ({
    eventId: e.eventId,
    chain: e.chain,
    txHash: e.txHash,
    blockNumber: e.blockNumber,
    timestamp: new Date(e.timestamp * 1000),
    from: e.from,
    to: e.to,
    tokenAddress: e.tokenAddress || '',
    tokenSymbol: e.tokenSymbol,
    amount: e.amount,
    amountUsd: e.amountUsd,
    eventType: e.eventType,
    bridgeInfo: e.eventType.includes('BRIDGE') ? {
      destinationChain: e.eventType === 'BRIDGE_OUT' ? undefined : e.chain
    } : undefined
  }));
  
  // Build routes
  const buildResult = await buildRoutesFromEvents(chainEvents);
  
  return {
    ...buildResult,
    staleMarked: 0,
    duration: Date.now() - startTime
  };
}

// ============================================
// Analysis
// ============================================

/**
 * Analyze wallet for dump patterns
 */
export async function analyzeWalletForDumps(wallet: string): Promise<{
  hasDumpPattern: boolean;
  exitRoutes: Array<{
    route: ILiquidityRoute;
    dump: { isDump: boolean; confidence: number; signals: string[] };
    severity: string;
  }>;
  totalExitVolume: number;
  topDestinations: string[];
}> {
  const routes = await getRoutesByWallet(wallet, { includeSegments: true }) as RouteWithSegments[];
  
  const exitRoutes = routes.filter(r => r.route.routeType === 'EXIT');
  
  const analyzed = await Promise.all(exitRoutes.map(async ({ route, segments }) => {
    const dump = detectDumpPattern(route, segments);
    const severity = getRouteSeverity(route, dump.isDump);
    
    return {
      route,
      dump,
      severity
    };
  }));
  
  const hasDumpPattern = analyzed.some(a => a.dump.isDump);
  const totalExitVolume = exitRoutes.reduce((sum, r) => sum + (r.route.totalAmountUsd || 0), 0);
  
  const destinations = exitRoutes
    .map(r => r.route.endLabel)
    .filter((d): d is string => !!d);
  const topDestinations = [...new Set(destinations)];
  
  return {
    hasDumpPattern,
    exitRoutes: analyzed,
    totalExitVolume,
    topDestinations
  };
}

/**
 * Get high-risk routes (potential dumps)
 */
export async function getHighRiskRoutes(options: {
  minConfidence?: number;
  minAmountUsd?: number;
  limit?: number;
} = {}): Promise<Array<{
  route: ILiquidityRoute;
  segments: IRouteSegment[];
  dump: { isDump: boolean; confidence: number; signals: string[] };
  severity: string;
}>> {
  const exitRoutes = await getExitRoutes({
    minConfidence: options.minConfidence || 0.6,
    minAmountUsd: options.minAmountUsd || 10000,
    limit: options.limit || 20
  });
  
  const results = [];
  
  for (const route of exitRoutes) {
    const segments = await RouteSegmentModel.find({ routeId: route.routeId })
      .sort({ index: 1 })
      .lean();
    
    const dump = detectDumpPattern(route, segments);
    const severity = getRouteSeverity(route, dump.isDump);
    
    if (dump.isDump || severity === 'HIGH' || severity === 'CRITICAL') {
      results.push({ route, segments, dump, severity });
    }
  }
  
  return results.sort((a, b) => b.dump.confidence - a.dump.confidence);
}

// ============================================
// Seed Test Data
// ============================================

/**
 * Seed test routes for development
 */
export async function seedTestRoutes(): Promise<{ routes: number; segments: number }> {
  // Clean existing test data
  await LiquidityRouteModel.deleteMany({ routeId: { $regex: /^ROUTE:TEST/ } });
  await RouteSegmentModel.deleteMany({ routeId: { $regex: /^ROUTE:TEST/ } });
  
  const testWallets = [
    '0x742d35cc6634c0532925a3b844bc454e4438f44e',
    '0x8ba1f109551bd432803012645ac136ddd64dba72',
    '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
  ];
  
  const testRoutes = [
    {
      routeId: 'ROUTE:TEST:EXIT:001',
      startWallet: testWallets[0],
      endWallet: '0x28c6c06298d514db089934071355e5743bf21d60', // Binance hot wallet
      startChain: 'ETH',
      endChain: 'ETH',
      chainsInvolved: ['ETH'],
      routeType: 'EXIT' as RouteType,
      status: 'COMPLETE' as RouteStatus,
      startLabel: undefined,
      endLabel: 'Binance',
      segmentsCount: 2,
      bridgesCount: 0,
      swapsCount: 0,
      totalAmountUsd: 250000,
      primaryToken: 'USDC',
      confidenceScore: 0.85,
      confidenceFactors: {
        amountSimilarity: 0.95,
        timeProximity: 0.85,
        bridgeMatch: 0,
        protocolKnown: 0.7,
        cexMatch: 1.0
      },
      firstSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      lastSeenAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
      durationMs: 60 * 60 * 1000
    },
    {
      routeId: 'ROUTE:TEST:MIGRATION:001',
      startWallet: testWallets[1],
      endWallet: testWallets[1],
      startChain: 'ETH',
      endChain: 'ARB',
      chainsInvolved: ['ETH', 'ARB'],
      routeType: 'MIGRATION' as RouteType,
      status: 'COMPLETE' as RouteStatus,
      startLabel: undefined,
      endLabel: undefined,
      segmentsCount: 3,
      bridgesCount: 1,
      swapsCount: 0,
      totalAmountUsd: 150000,
      primaryToken: 'ETH',
      confidenceScore: 0.78,
      confidenceFactors: {
        amountSimilarity: 0.88,
        timeProximity: 0.75,
        bridgeMatch: 0.9,
        protocolKnown: 0.8,
        cexMatch: 0
      },
      firstSeenAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      lastSeenAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
      durationMs: 60 * 60 * 1000
    },
    {
      routeId: 'ROUTE:TEST:EXIT:002',
      startWallet: testWallets[2],
      endWallet: '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43', // Coinbase
      startChain: 'ARB',
      endChain: 'ETH',
      chainsInvolved: ['ARB', 'ETH'],
      routeType: 'EXIT' as RouteType,
      status: 'ACTIVE' as RouteStatus,
      startLabel: undefined,
      endLabel: 'Coinbase',
      segmentsCount: 4,
      bridgesCount: 1,
      swapsCount: 1,
      totalAmountUsd: 520000,
      primaryToken: 'WETH',
      confidenceScore: 0.92,
      confidenceFactors: {
        amountSimilarity: 0.92,
        timeProximity: 0.9,
        bridgeMatch: 0.95,
        protocolKnown: 0.85,
        cexMatch: 1.0
      },
      firstSeenAt: new Date(Date.now() - 30 * 60 * 1000),
      lastSeenAt: new Date(Date.now() - 5 * 60 * 1000),
      durationMs: 25 * 60 * 1000
    }
  ];
  
  const testSegments = [
    // Route EXIT:001 segments
    {
      routeId: 'ROUTE:TEST:EXIT:001',
      index: 0,
      type: 'TRANSFER',
      chainFrom: 'ETH',
      txHash: '0xabc123...segment1',
      blockNumber: 18500000,
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
      walletFrom: testWallets[0],
      walletTo: '0x1234...intermediate',
      tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      tokenSymbol: 'USDC',
      amount: '250000000000',
      amountUsd: 250000,
      confidence: 0.8
    },
    {
      routeId: 'ROUTE:TEST:EXIT:001',
      index: 1,
      type: 'CEX_DEPOSIT',
      chainFrom: 'ETH',
      txHash: '0xabc123...segment2',
      blockNumber: 18500100,
      timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000),
      walletFrom: '0x1234...intermediate',
      walletTo: '0x28c6c06298d514db089934071355e5743bf21d60',
      tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      tokenSymbol: 'USDC',
      amount: '249500000000',
      amountUsd: 249500,
      toLabel: 'Binance Hot Wallet',
      confidence: 0.95
    },
    // Route MIGRATION:001 segments
    {
      routeId: 'ROUTE:TEST:MIGRATION:001',
      index: 0,
      type: 'TRANSFER',
      chainFrom: 'ETH',
      txHash: '0xdef456...segment1',
      blockNumber: 18499000,
      timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000),
      walletFrom: testWallets[1],
      walletTo: '0xstargate...router',
      tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      tokenSymbol: 'WETH',
      amount: '100000000000000000000',
      amountUsd: 150000,
      protocol: 'Stargate',
      confidence: 0.85
    },
    {
      routeId: 'ROUTE:TEST:MIGRATION:001',
      index: 1,
      type: 'BRIDGE',
      chainFrom: 'ETH',
      chainTo: 'ARB',
      txHash: '0xdef456...segment2',
      blockNumber: 18499100,
      timestamp: new Date(Date.now() - 5.5 * 60 * 60 * 1000),
      walletFrom: '0xstargate...router',
      walletTo: testWallets[1],
      tokenAddress: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
      tokenSymbol: 'WETH',
      amount: '99800000000000000000',
      amountUsd: 149700,
      protocol: 'Stargate',
      protocolType: 'BRIDGE',
      confidence: 0.9
    },
    // Route EXIT:002 segments
    {
      routeId: 'ROUTE:TEST:EXIT:002',
      index: 0,
      type: 'SWAP',
      chainFrom: 'ARB',
      txHash: '0xghi789...segment1',
      blockNumber: 150000000,
      timestamp: new Date(Date.now() - 30 * 60 * 1000),
      walletFrom: testWallets[2],
      walletTo: '0xuniswap...router',
      tokenAddress: '0x912ce59144191c1204e64559fe8253a0e49e6548',
      tokenSymbol: 'ARB',
      amount: '500000000000000000000000',
      amountUsd: 520000,
      protocol: 'Uniswap V3',
      protocolType: 'DEX',
      confidence: 0.88
    },
    {
      routeId: 'ROUTE:TEST:EXIT:002',
      index: 1,
      type: 'TRANSFER',
      chainFrom: 'ARB',
      txHash: '0xghi789...segment2',
      blockNumber: 150000050,
      timestamp: new Date(Date.now() - 25 * 60 * 1000),
      walletFrom: '0xuniswap...router',
      walletTo: testWallets[2],
      tokenAddress: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
      tokenSymbol: 'WETH',
      amount: '300000000000000000000',
      amountUsd: 518000,
      confidence: 0.9
    },
    {
      routeId: 'ROUTE:TEST:EXIT:002',
      index: 2,
      type: 'BRIDGE',
      chainFrom: 'ARB',
      chainTo: 'ETH',
      txHash: '0xghi789...segment3',
      blockNumber: 150000100,
      timestamp: new Date(Date.now() - 15 * 60 * 1000),
      walletFrom: testWallets[2],
      walletTo: testWallets[2],
      tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      tokenSymbol: 'WETH',
      amount: '299500000000000000000',
      amountUsd: 517000,
      protocol: 'Across',
      protocolType: 'BRIDGE',
      confidence: 0.92
    },
    {
      routeId: 'ROUTE:TEST:EXIT:002',
      index: 3,
      type: 'CEX_DEPOSIT',
      chainFrom: 'ETH',
      txHash: '0xghi789...segment4',
      blockNumber: 18500500,
      timestamp: new Date(Date.now() - 5 * 60 * 1000),
      walletFrom: testWallets[2],
      walletTo: '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43',
      tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      tokenSymbol: 'WETH',
      amount: '299000000000000000000',
      amountUsd: 516000,
      toLabel: 'Coinbase',
      confidence: 0.95
    }
  ];
  
  await LiquidityRouteModel.insertMany(testRoutes);
  await RouteSegmentModel.insertMany(testSegments);
  
  console.log(`[RouteIntelligence] Seeded ${testRoutes.length} test routes and ${testSegments.length} segments`);
  
  return {
    routes: testRoutes.length,
    segments: testSegments.length
  };
}

export { BUILDER_CONFIG };
