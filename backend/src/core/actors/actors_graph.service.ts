/**
 * Actors Graph Service - OPTIMIZED (v2 - DB Cache)
 * 
 * Memory-safe implementation:
 * 1. Reads pre-computed graphs from MongoDB (computed by background job)
 * 2. Falls back to live computation only if cache miss
 * 3. All aggregations done at DB level (not in-memory)
 * 4. Hard limits on nodes/edges
 * 
 * Philosophy: Structure only, no predictions.
 */
import { EntityModel } from '../entities/entities.model.js';
import { EntityAddressModel } from '../entities/entity_address.model.js';
import { TransferModel } from '../transfers/transfers.model.js';
import { ComputedGraphModel } from './computed_graph.model.js';
import { resolveTokens, formatToken } from '../resolver/token.resolver.js';

// ============ HARD LIMITS (CRITICAL) ============

const GRAPH_LIMITS = {
  MAX_NODES: 50,
  MAX_EDGES: 200,
  MIN_FLOW_USD: 10000,      // Minimum $10k to create edge
  MAX_TX_SAMPLE: 5000,      // Max transactions to sample
  CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes cache
};

// ============ TYPES ============

interface GraphNode {
  id: string;
  label: string;
  type: 'entity';
  metrics: {
    centralityScore: number;
    inDegree: number;
    outDegree: number;
    totalFlowUsd: number;
    netFlowUsd: number;
  };
  dominantPattern: string;
  category: string;
  coverage: number;
  addressCount: number;
  ui: {
    color: 'green' | 'yellow' | 'red';
    size: number;
  };
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  flow: {
    direction: 'in' | 'out' | 'bidirectional';
    netFlowUsd: number;
    volumeUsd: number;
  };
  relationship: {
    type: 'flow_correlation' | 'temporal_overlap' | 'pattern_similarity';
    strength: number;
  };
  ui: {
    color: 'green' | 'red' | 'neutral';
    width: number;
  };
  evidence: {
    txCount: number;
    firstSeen: Date | null;
    lastSeen: Date | null;
  };
}

// ============ TOKEN PRICES ============

const TOKEN_PRICES: Record<string, number> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 3200,
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 1,
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 1,
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 62000,
  '0x6b175474e89094c44da98b954eedeac495271d0f': 1,
};

// ============ PHASE 1: NODE AGGREGATION (DB-level) ============

async function aggregateEntityFlows(windowDays: number): Promise<Map<string, { 
  totalInflow: number; 
  totalOutflow: number; 
  txCount: number;
}>> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  
  // Get all entity addresses (aggregated, not individual)
  const entities = await EntityModel.find({ status: 'live' }).lean();
  const entityFlows = new Map<string, { totalInflow: number; totalOutflow: number; txCount: number }>();
  
  for (const entity of entities) {
    const e = entity as any;
    const addresses = await EntityAddressModel.find({ entityId: e._id.toString() })
      .select('address')
      .lean();
    
    const addressList = addresses.map((a: any) => a.address.toLowerCase());
    if (addressList.length === 0) {
      entityFlows.set(e.slug, { totalInflow: 0, totalOutflow: 0, txCount: 0 });
      continue;
    }
    
    // DB-level aggregation for inflows
    const inflowAgg = await TransferModel.aggregate([
      { 
        $match: { 
          to: { $in: addressList },
          timestamp: { $gte: cutoff }
        } 
      },
      { $sample: { size: GRAPH_LIMITS.MAX_TX_SAMPLE } },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: { $toDouble: '$amountNormalized' } },
          txCount: { $sum: 1 }
        }
      }
    ]);
    
    // DB-level aggregation for outflows
    const outflowAgg = await TransferModel.aggregate([
      { 
        $match: { 
          from: { $in: addressList },
          timestamp: { $gte: cutoff }
        } 
      },
      { $sample: { size: GRAPH_LIMITS.MAX_TX_SAMPLE } },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: { $toDouble: '$amountNormalized' } },
          txCount: { $sum: 1 }
        }
      }
    ]);
    
    const inflow = inflowAgg[0]?.totalAmount || 0;
    const outflow = outflowAgg[0]?.totalAmount || 0;
    const txCount = (inflowAgg[0]?.txCount || 0) + (outflowAgg[0]?.txCount || 0);
    
    entityFlows.set(e.slug, { 
      totalInflow: inflow * 1, // Simplified USD conversion
      totalOutflow: outflow * 1,
      txCount 
    });
  }
  
  return entityFlows;
}

// ============ PHASE 2: EDGE AGGREGATION (DB-level) ============

async function aggregateEdges(windowDays: number): Promise<GraphEdge[]> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const entities = await EntityModel.find({ status: 'live' }).lean();
  
  // Build address-to-entity map
  const addressToEntity = new Map<string, string>();
  for (const entity of entities) {
    const e = entity as any;
    const addresses = await EntityAddressModel.find({ entityId: e._id.toString() })
      .select('address')
      .lean();
    for (const addr of addresses as any[]) {
      addressToEntity.set(addr.address.toLowerCase(), e.slug);
    }
  }
  
  // DB-level aggregation for inter-entity flows
  // Use $sample to limit memory usage
  const flowAgg = await TransferModel.aggregate([
    { $match: { timestamp: { $gte: cutoff } } },
    { $sample: { size: GRAPH_LIMITS.MAX_TX_SAMPLE } },
    {
      $project: {
        from: { $toLower: '$from' },
        to: { $toLower: '$to' },
        amount: { $toDouble: '$amountNormalized' },
        timestamp: 1
      }
    }
  ]);
  
  // Aggregate by entity pairs (in memory but with sampled data)
  const edgeMap = new Map<string, {
    volumeFromTo: number;
    volumeToFrom: number;
    txCount: number;
    firstSeen: Date | null;
    lastSeen: Date | null;
  }>();
  
  for (const tx of flowAgg) {
    const fromEntity = addressToEntity.get(tx.from);
    const toEntity = addressToEntity.get(tx.to);
    
    if (!fromEntity || !toEntity || fromEntity === toEntity) continue;
    
    // Create canonical edge key (alphabetically sorted)
    const [entityA, entityB] = [fromEntity, toEntity].sort();
    const edgeKey = `${entityA}-${entityB}`;
    
    const existing = edgeMap.get(edgeKey) || {
      volumeFromTo: 0,
      volumeToFrom: 0,
      txCount: 0,
      firstSeen: null,
      lastSeen: null,
    };
    
    const amount = tx.amount || 0;
    if (fromEntity === entityA) {
      existing.volumeFromTo += amount;
    } else {
      existing.volumeToFrom += amount;
    }
    existing.txCount++;
    
    const txTime = new Date(tx.timestamp);
    if (!existing.firstSeen || txTime < existing.firstSeen) existing.firstSeen = txTime;
    if (!existing.lastSeen || txTime > existing.lastSeen) existing.lastSeen = txTime;
    
    edgeMap.set(edgeKey, existing);
  }
  
  // Convert to edges array, filter by minimum flow
  const edges: GraphEdge[] = [];
  
  for (const [key, data] of edgeMap) {
    const [from, to] = key.split('-');
    const volume = data.volumeFromTo + data.volumeToFrom;
    
    // Skip edges below minimum threshold
    if (volume < GRAPH_LIMITS.MIN_FLOW_USD) continue;
    
    const netFlow = data.volumeFromTo - data.volumeToFrom;
    let direction: GraphEdge['flow']['direction'] = 'bidirectional';
    if (Math.abs(netFlow) > volume * 0.3) {
      direction = netFlow > 0 ? 'out' : 'in';
    }
    
    edges.push({
      id: key,
      from,
      to,
      flow: {
        direction,
        netFlowUsd: netFlow,
        volumeUsd: volume,
      },
      relationship: {
        type: 'flow_correlation',
        strength: Math.min(1, volume / 1000000), // Normalize by $1M
      },
      ui: {
        color: netFlow > 0 ? 'green' : netFlow < 0 ? 'red' : 'neutral',
        width: Math.max(1, Math.min(8, Math.log10(volume + 1) / 2)),
      },
      evidence: {
        txCount: data.txCount,
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen,
      },
    });
  }
  
  // Sort by volume and limit to MAX_EDGES
  return edges
    .sort((a, b) => b.flow.volumeUsd - a.flow.volumeUsd)
    .slice(0, GRAPH_LIMITS.MAX_EDGES);
}

// ============ PHASE 3: BUILD GRAPH ============

function getNodeColor(netFlow: number): 'green' | 'yellow' | 'red' {
  if (netFlow > 100000) return 'green';
  if (netFlow < -100000) return 'red';
  return 'yellow';
}

export async function buildActorsGraph(windowDays: number = 7): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: any;
}> {
  const windowKey = `${windowDays}d`;
  
  // Try to read from MongoDB cache first (populated by background job)
  try {
    const cached = await ComputedGraphModel.findOne({ 
      window: windowKey,
      expiresAt: { $gt: new Date() }
    }).lean();
    
    if (cached) {
      console.log('[ActorsGraph] Returning DB-cached graph');
      return {
        nodes: cached.nodes as GraphNode[],
        edges: cached.edges as GraphEdge[],
        metadata: {
          ...cached.metadata,
          source: 'db_cache',
        },
      };
    }
  } catch (err) {
    console.warn('[ActorsGraph] Failed to read DB cache:', err);
  }
  
  console.log('[ActorsGraph] Cache miss - building graph live (window:', windowDays, 'days)');
  const startTime = Date.now();
  
  // Phase 1: Get entity flows (DB-aggregated)
  const entityFlows = await aggregateEntityFlows(windowDays);
  
  // Phase 2: Get edges (DB-aggregated)
  const edges = await aggregateEdges(windowDays);
  
  // Build node degree map from edges
  const nodeDegrees = new Map<string, { in: number; out: number }>();
  for (const edge of edges) {
    const fromDeg = nodeDegrees.get(edge.from) || { in: 0, out: 0 };
    const toDeg = nodeDegrees.get(edge.to) || { in: 0, out: 0 };
    fromDeg.out++;
    toDeg.in++;
    nodeDegrees.set(edge.from, fromDeg);
    nodeDegrees.set(edge.to, toDeg);
  }
  
  // Phase 3: Build nodes
  const entities = await EntityModel.find({ status: 'live' }).lean();
  const nodes: GraphNode[] = [];
  
  for (const entity of entities) {
    const e = entity as any;
    const flows = entityFlows.get(e.slug) || { totalInflow: 0, totalOutflow: 0, txCount: 0 };
    const degrees = nodeDegrees.get(e.slug) || { in: 0, out: 0 };
    const netFlow = flows.totalInflow - flows.totalOutflow;
    const totalFlow = flows.totalInflow + flows.totalOutflow;
    
    nodes.push({
      id: e.slug,
      label: e.name,
      type: 'entity',
      metrics: {
        centralityScore: 0, // Will calculate
        inDegree: degrees.in,
        outDegree: degrees.out,
        totalFlowUsd: totalFlow,
        netFlowUsd: netFlow,
      },
      dominantPattern: 'unknown',
      category: e.category || 'unknown',
      coverage: e.coverage || 0,
      addressCount: e.addressesCount || 0,
      ui: {
        color: getNodeColor(netFlow),
        size: Math.max(20, Math.min(60, 20 + (flows.txCount > 0 ? Math.log10(flows.txCount) * 10 : 0))),
      },
    });
  }
  
  // Calculate centrality scores
  const maxDegree = Math.max(...nodes.map(n => n.metrics.inDegree + n.metrics.outDegree), 1);
  const maxFlow = Math.max(...nodes.map(n => n.metrics.totalFlowUsd), 1);
  
  for (const node of nodes) {
    const degreeScore = (node.metrics.inDegree + node.metrics.outDegree) / maxDegree * 50;
    const flowScore = node.metrics.totalFlowUsd > 0 
      ? Math.log10(node.metrics.totalFlowUsd + 1) / Math.log10(maxFlow + 1) * 50 
      : 0;
    node.metrics.centralityScore = Math.round(degreeScore + flowScore);
  }
  
  // Sort by centrality and limit to MAX_NODES
  const sortedNodes = nodes
    .sort((a, b) => b.metrics.centralityScore - a.metrics.centralityScore)
    .slice(0, GRAPH_LIMITS.MAX_NODES);
  
  // Filter edges to only include visible nodes
  const visibleNodeIds = new Set(sortedNodes.map(n => n.id));
  const filteredEdges = edges.filter(e => 
    visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to)
  );
  
  const result = {
    nodes: sortedNodes,
    edges: filteredEdges,
    metadata: {
      totalNodes: sortedNodes.length,
      totalEdges: filteredEdges.length,
      window: `${windowDays}d`,
      calculatedAt: new Date(),
      limits: GRAPH_LIMITS,
      buildTimeMs: Date.now() - startTime,
      source: 'live_computed',
    },
  };
  
  console.log('[ActorsGraph] Graph built in', Date.now() - startTime, 'ms');
  
  return result;
}

// ============ EDGE DETAILS ============

export async function getEdgeDetails(
  fromSlug: string, 
  toSlug: string, 
  windowDays: number = 7
): Promise<{
  from: string;
  to: string;
  transactions: any[];
  summary: any;
}> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  
  // Get addresses for both entities
  const [fromEntity, toEntity] = await Promise.all([
    EntityModel.findOne({ slug: fromSlug }).lean(),
    EntityModel.findOne({ slug: toSlug }).lean(),
  ]);
  
  if (!fromEntity || !toEntity) {
    return { from: fromSlug, to: toSlug, transactions: [], summary: { totalTx: 0 } };
  }
  
  const [fromAddresses, toAddresses] = await Promise.all([
    EntityAddressModel.find({ entityId: (fromEntity as any)._id.toString() }).select('address').lean(),
    EntityAddressModel.find({ entityId: (toEntity as any)._id.toString() }).select('address').lean(),
  ]);
  
  const fromList = (fromAddresses as any[]).map(a => a.address.toLowerCase());
  const toList = (toAddresses as any[]).map(a => a.address.toLowerCase());
  
  // DB-level aggregation with limit
  const transfers = await TransferModel.aggregate([
    {
      $match: {
        $or: [
          { from: { $in: fromList }, to: { $in: toList } },
          { from: { $in: toList }, to: { $in: fromList } },
        ],
        timestamp: { $gte: cutoff },
      }
    },
    { $sort: { timestamp: -1 } },
    { $limit: 50 }, // Hard limit
    {
      $project: {
        txHash: 1,
        from: 1,
        to: 1,
        assetAddress: 1,
        amountNormalized: 1,
        timestamp: 1,
      }
    }
  ]);
  
  const transactions = transfers.map((t: any) => {
    const isFromTo = fromList.includes(t.from.toLowerCase());
    return {
      txHash: t.txHash,
      token: t.assetAddress,
      amount: t.amountNormalized || 0,
      direction: isFromTo ? 'from→to' : 'to→from',
      timestamp: t.timestamp,
    };
  });
  
  // Resolve token symbols (P2.5)
  const tokenAddresses = [...new Set(transactions.map(t => t.token).filter(Boolean))];
  const tokenMap = await resolveTokens(tokenAddresses);
  
  // Enrich transactions with token symbols
  const enrichedTransactions = transactions.map(t => {
    const tokenInfo = t.token ? tokenMap.get(t.token.toLowerCase()) : null;
    return {
      ...t,
      tokenSymbol: tokenInfo ? formatToken(tokenInfo) : 'UNKNOWN',
      tokenName: tokenInfo?.name || 'Unknown Token',
      tokenVerified: tokenInfo?.verified || false,
    };
  });
  
  return {
    from: fromSlug,
    to: toSlug,
    transactions: enrichedTransactions,
    summary: {
      totalTx: enrichedTransactions.length,
      volumeFromTo: enrichedTransactions.filter(t => t.direction === 'from→to').reduce((s, t) => s + t.amount, 0),
      volumeToFrom: enrichedTransactions.filter(t => t.direction === 'to→from').reduce((s, t) => s + t.amount, 0),
    },
  };
}
