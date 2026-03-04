/**
 * P3.3 Actor Topology Service
 * 
 * Computes topology metrics for actors (nodes) in the network graph
 */

import { TOPOLOGY_CONFIG } from './topology.config.js';
import { entropyFromWeights } from './utils/entropy.js';
import { pagerank } from './utils/pagerank.js';
import { kCoreDecomposition } from './utils/kcore.js';
import { brokerScore } from './utils/broker_score.js';
import type { ActorTopologyRow, TopologyWindow, RoleHint } from './topology.types.js';

interface RelationDoc {
  from: string;
  to: string;
  volumeUsd?: number;
  weight?: number;
}

/**
 * Infer role hint based on metrics
 */
function inferRoleHint(
  hubScore: number,
  entropyOut: number,
  netFlowUsd: number
): RoleHint {
  const cfg = TOPOLOGY_CONFIG.roleHintThresholds;

  // Router: high hub score + high entropy (distributes widely)
  if (hubScore > cfg.routerHubScore && entropyOut > cfg.routerEntropy) {
    return 'ROUTER';
  }

  // Accumulator: positive net flow + low entropy (concentrated inputs)
  if (netFlowUsd > 0 && entropyOut < cfg.accumulatorEntropy) {
    return 'ACCUMULATOR';
  }

  // Distributor: negative net flow + high entropy (wide distribution)
  if (netFlowUsd < 0 && entropyOut > cfg.distributorEntropy) {
    return 'DISTRIBUTOR';
  }

  return 'NEUTRAL';
}

export class TopologyActorService {
  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  /**
   * Compute actor topology for a network
   */
  async compute(
    network: string,
    window: TopologyWindow,
    tsBucket: number
  ): Promise<ActorTopologyRow[]> {
    // Fetch relations (use relations or relations_v2 collection)
    const relations = await this.db.collection('relations')
      .find({ 
        chain: network,
        // window filter if available
      })
      .project({ from: 1, to: 1, volumeUsd: 1, weight: 1 })
      .limit(TOPOLOGY_CONFIG.limits.maxEdgesForTopology)
      .toArray() as RelationDoc[];

    if (relations.length === 0) {
      return [];
    }

    // Build node set
    const nodesSet = new Set<string>();
    for (const r of relations) {
      nodesSet.add(r.from.toLowerCase());
      nodesSet.add(r.to.toLowerCase());
    }
    const nodes = Array.from(nodesSet).slice(0, TOPOLOGY_CONFIG.limits.maxNodesForTopology);

    // Initialize metrics maps
    const degIn = new Map<string, Set<string>>();
    const degOut = new Map<string, Set<string>>();
    const wIn = new Map<string, number>();
    const wOut = new Map<string, number>();
    const outWeights = new Map<string, number[]>();

    for (const n of nodes) {
      degIn.set(n, new Set());
      degOut.set(n, new Set());
      wIn.set(n, 0);
      wOut.set(n, 0);
      outWeights.set(n, []);
    }

    // Build edge list and compute basic metrics
    const edges: Array<{ from: string; to: string; weight: number }> = [];

    for (const r of relations) {
      const f = r.from.toLowerCase();
      const t = r.to.toLowerCase();
      const v = Number(r.volumeUsd ?? r.weight ?? 1);

      if (!nodesSet.has(f) || !nodesSet.has(t)) continue;

      edges.push({ from: f, to: t, weight: v });

      degOut.get(f)?.add(t);
      degIn.get(t)?.add(f);

      wOut.set(f, (wOut.get(f) ?? 0) + v);
      wIn.set(t, (wIn.get(t) ?? 0) + v);

      outWeights.get(f)?.push(v);
    }

    // Calculate topology metrics
    const pr = pagerank(nodes, edges, TOPOLOGY_CONFIG.pagerank);
    const broker = brokerScore(nodes, edges);

    // Build undirected edges for k-core
    const undirected = edges.map(e => ({ a: e.from, b: e.to }));
    const core = kCoreDecomposition(nodes, undirected);

    // Calculate hub score normalization factor
    const hubRaw = nodes.map(n => (wIn.get(n) ?? 0) + (wOut.get(n) ?? 0));
    const hubMax = Math.max(...hubRaw, 1);

    // Build result rows
    const rows: ActorTopologyRow[] = nodes.map(address => {
      const wi = wIn.get(address) ?? 0;
      const wo = wOut.get(address) ?? 0;
      const netFlow = wi - wo;
      const ent = entropyFromWeights(outWeights.get(address) ?? []);
      const hub = Math.min(1, (wi + wo) / hubMax);

      return {
        network,
        window,
        tsBucket,
        address,
        degIn: degIn.get(address)?.size ?? 0,
        degOut: degOut.get(address)?.size ?? 0,
        wInUsd: Math.round(wi * 100) / 100,
        wOutUsd: Math.round(wo * 100) / 100,
        netFlowUsd: Math.round(netFlow * 100) / 100,
        entropyOut: Math.round(ent * 1000) / 1000,
        hubScore: Math.round(hub * 1000) / 1000,
        pagerank: Math.round((pr[address] ?? 0) * 10000) / 10000,
        kCore: core.get(address) ?? 0,
        brokerScore: Math.round((broker[address] ?? 0) * 1000) / 1000,
        roleHint: inferRoleHint(hub, ent, netFlow),
      };
    });

    return rows;
  }

  /**
   * Get top actors by sort field
   */
  async getTop(
    network: string,
    window: TopologyWindow,
    sortBy: string,
    limit: number
  ): Promise<ActorTopologyRow[]> {
    const tsBucket = Math.floor(Date.now() / 1000);
    const rows = await this.compute(network, window, tsBucket);

    // Sort by specified field
    const sorted = rows.sort((a: any, b: any) => {
      const va = a[sortBy] ?? 0;
      const vb = b[sortBy] ?? 0;
      return vb - va; // descending
    });

    return sorted.slice(0, limit);
  }
}

export default TopologyActorService;
