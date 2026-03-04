/**
 * Build Actors Graph Job (P0 Memory Optimization)
 * 
 * Pre-computes actor graphs in background and stores in MongoDB.
 * API endpoints read from cache instead of computing on-demand.
 * 
 * Runs every 5 minutes, caches for 10 minutes (overlap for freshness).
 */
import { EntityModel } from '../core/entities/entities.model.js';
import { EntityAddressModel } from '../core/entities/entity_address.model.js';
import { TransferModel } from '../core/transfers/transfers.model.js';
import { ComputedGraphModel } from '../core/actors/computed_graph.model.js';

// ============ HARD LIMITS (CRITICAL) ============
const GRAPH_LIMITS = {
  MAX_NODES: 50,
  MAX_EDGES: 200,
  MIN_FLOW_USD: 10000,
  MAX_TX_SAMPLE: 5000,
  CACHE_TTL_MS: 10 * 60 * 1000, // 10 minutes cache
};

// Time windows to pre-compute
const WINDOWS = [7, 30]; // 7d and 30d

// Job status tracking
let lastBuildStatus = {
  lastRun: null as Date | null,
  duration: 0,
  windowsBuilt: 0,
  errors: [] as string[],
};

/**
 * Get node color based on net flow
 */
function getNodeColor(netFlow: number): 'green' | 'yellow' | 'red' {
  if (netFlow > 100000) return 'green';
  if (netFlow < -100000) return 'red';
  return 'yellow';
}

/**
 * Aggregate entity flows using DB-level aggregation
 */
async function aggregateEntityFlows(windowDays: number): Promise<Map<string, {
  totalInflow: number;
  totalOutflow: number;
  txCount: number;
}>> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
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
      totalInflow: inflow,
      totalOutflow: outflow,
      txCount
    });
  }

  return entityFlows;
}

/**
 * Aggregate edges using DB-level aggregation
 */
async function aggregateEdges(windowDays: number): Promise<any[]> {
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

  // DB-level aggregation with $sample
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

  // Aggregate by entity pairs
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

  // Convert to edges array
  const edges: any[] = [];
  for (const [key, data] of edgeMap) {
    const [from, to] = key.split('-');
    const volume = data.volumeFromTo + data.volumeToFrom;

    if (volume < GRAPH_LIMITS.MIN_FLOW_USD) continue;

    const netFlow = data.volumeFromTo - data.volumeToFrom;
    let direction: 'in' | 'out' | 'bidirectional' = 'bidirectional';
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
        strength: Math.min(1, volume / 1000000),
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

  return edges
    .sort((a, b) => b.flow.volumeUsd - a.flow.volumeUsd)
    .slice(0, GRAPH_LIMITS.MAX_EDGES);
}

/**
 * Build and cache graph for a specific window
 */
async function buildAndCacheGraph(windowDays: number): Promise<void> {
  console.log(`[BuildActorsGraph] Building graph for ${windowDays}d window...`);
  const startTime = Date.now();

  // Phase 1: Get entity flows
  const entityFlows = await aggregateEntityFlows(windowDays);

  // Phase 2: Get edges
  const edges = await aggregateEdges(windowDays);

  // Build node degree map
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
  const nodes: any[] = [];

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
        centralityScore: 0,
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

  // Calculate centrality
  const maxDegree = Math.max(...nodes.map(n => n.metrics.inDegree + n.metrics.outDegree), 1);
  const maxFlow = Math.max(...nodes.map(n => n.metrics.totalFlowUsd), 1);

  for (const node of nodes) {
    const degreeScore = (node.metrics.inDegree + node.metrics.outDegree) / maxDegree * 50;
    const flowScore = node.metrics.totalFlowUsd > 0
      ? Math.log10(node.metrics.totalFlowUsd + 1) / Math.log10(maxFlow + 1) * 50
      : 0;
    node.metrics.centralityScore = Math.round(degreeScore + flowScore);
  }

  // Sort and limit nodes
  const sortedNodes = nodes
    .sort((a, b) => b.metrics.centralityScore - a.metrics.centralityScore)
    .slice(0, GRAPH_LIMITS.MAX_NODES);

  // Filter edges
  const visibleNodeIds = new Set(sortedNodes.map(n => n.id));
  const filteredEdges = edges.filter(e =>
    visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to)
  );

  const buildTimeMs = Date.now() - startTime;

  // Save to database
  const windowKey = `${windowDays}d`;
  const expiresAt = new Date(Date.now() + GRAPH_LIMITS.CACHE_TTL_MS);

  await ComputedGraphModel.findOneAndUpdate(
    { window: windowKey },
    {
      window: windowKey,
      nodes: sortedNodes,
      edges: filteredEdges,
      metadata: {
        totalNodes: sortedNodes.length,
        totalEdges: filteredEdges.length,
        window: windowKey,
        calculatedAt: new Date(),
        limits: GRAPH_LIMITS,
        buildTimeMs,
      },
      expiresAt,
    },
    { upsert: true, new: true }
  );

  console.log(`[BuildActorsGraph] Cached ${windowKey}: ${sortedNodes.length} nodes, ${filteredEdges.length} edges (${buildTimeMs}ms)`);
}

/**
 * Main job function
 */
export async function buildActorsGraph(): Promise<{
  windowsBuilt: number;
  duration: number;
  errors: string[];
}> {
  const startTime = Date.now();
  const errors: string[] = [];
  let windowsBuilt = 0;

  for (const windowDays of WINDOWS) {
    try {
      await buildAndCacheGraph(windowDays);
      windowsBuilt++;
    } catch (err: any) {
      console.error(`[BuildActorsGraph] Failed for ${windowDays}d:`, err);
      errors.push(`${windowDays}d: ${err.message}`);
    }
  }

  const duration = Date.now() - startTime;

  lastBuildStatus = {
    lastRun: new Date(),
    duration,
    windowsBuilt,
    errors,
  };

  return { windowsBuilt, duration, errors };
}

/**
 * Get job status
 */
export function getBuildActorsGraphStatus() {
  return lastBuildStatus;
}
