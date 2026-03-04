/**
 * P3.3 Market Topology Service
 * 
 * Computes aggregate market topology metrics from actor topology
 */

import { TOPOLOGY_CONFIG } from './topology.config.js';
import { giniCoefficient } from './utils/entropy.js';
import { TopologyActorService } from './topology_actor.service.js';
import type { 
  MarketTopologyRow, 
  MarketTopologyFeatures,
  TopologyWindow, 
  RegimeHint,
  ActorTopologyRow 
} from './topology.types.js';

/**
 * Infer market regime from centralization and entropy
 */
function inferRegimeHint(centralization: number, entropyIndex: number): RegimeHint {
  const cfg = TOPOLOGY_CONFIG.regimeThresholds;

  if (centralization > cfg.centralizedGini && entropyIndex < cfg.centralizedEntropy) {
    return 'CENTRALIZED';
  }

  if (centralization < cfg.distributedGini && entropyIndex > cfg.distributedEntropy) {
    return 'DISTRIBUTED';
  }

  return 'NEUTRAL';
}

export class TopologyMarketService {
  private actorService: TopologyActorService;

  constructor(db: any) {
    this.actorService = new TopologyActorService(db);
  }

  /**
   * Compute market-level topology metrics
   */
  async compute(
    network: string,
    window: TopologyWindow,
    tsBucket: number
  ): Promise<MarketTopologyRow> {
    // Get actor topology first
    const actors = await this.actorService.compute(network, window, tsBucket);

    if (actors.length === 0) {
      return {
        network,
        window,
        tsBucket,
        nodeCount: 0,
        edgeCount: 0,
        centralization: 0,
        corridorConcentration: 0,
        entropyIndex: 0,
        regimeHint: 'NEUTRAL',
      };
    }

    // Node and edge counts
    const nodeCount = actors.length;
    const edgeCount = actors.reduce((sum, a) => sum + a.degOut, 0);

    // Centralization: Gini coefficient of hubScore
    const hubScores = actors.map(a => a.hubScore);
    const centralization = giniCoefficient(hubScores);

    // Corridor concentration: top 10 outflow share
    const outflows = actors.map(a => a.wOutUsd).sort((a, b) => b - a);
    const totalOutflow = outflows.reduce((a, b) => a + b, 0);
    const top10Outflow = outflows.slice(0, 10).reduce((a, b) => a + b, 0);
    const corridorConcentration = totalOutflow > 0 ? top10Outflow / totalOutflow : 0;

    // Entropy index: average entropy of top hubs
    const topHubs = actors
      .sort((a, b) => b.hubScore - a.hubScore)
      .slice(0, Math.min(20, actors.length));
    
    const entropyIndex = topHubs.length > 0
      ? topHubs.reduce((sum, a) => sum + a.entropyOut, 0) / topHubs.length
      : 0;

    // Regime hint
    const regimeHint = inferRegimeHint(centralization, entropyIndex);

    return {
      network,
      window,
      tsBucket,
      nodeCount,
      edgeCount,
      centralization: Math.round(centralization * 1000) / 1000,
      corridorConcentration: Math.round(corridorConcentration * 1000) / 1000,
      entropyIndex: Math.round(entropyIndex * 1000) / 1000,
      regimeHint,
    };
  }

  /**
   * Get ML feature bundle for market topology
   */
  async getFeatures(
    network: string,
    window: TopologyWindow
  ): Promise<MarketTopologyFeatures> {
    const tsBucket = Math.floor(Date.now() / 1000);
    
    // Get base market topology
    const market = await this.compute(network, window, tsBucket);
    
    // Get actor topology for additional stats
    const actors = await this.actorService.compute(network, window, tsBucket);

    // Calculate aggregates
    const pagerankValues = actors.map(a => a.pagerank);
    const hubScoreValues = actors.map(a => a.hubScore);
    const brokerScoreValues = actors.map(a => a.brokerScore);
    const kCoreValues = actors.map(a => a.kCore);

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0;

    // Role distribution
    const roleCount = { ACCUMULATOR: 0, DISTRIBUTOR: 0, ROUTER: 0, NEUTRAL: 0 };
    for (const a of actors) {
      roleCount[a.roleHint]++;
    }
    const total = actors.length || 1;

    return {
      network,
      window,
      tsBucket,
      nodeCount: market.nodeCount,
      edgeCount: market.edgeCount,
      centralization: market.centralization,
      corridorConcentration: market.corridorConcentration,
      entropyIndex: market.entropyIndex,
      regimeHint: market.regimeHint,
      avgPagerank: Math.round(avg(pagerankValues) * 10000) / 10000,
      maxPagerank: Math.round(max(pagerankValues) * 10000) / 10000,
      avgHubScore: Math.round(avg(hubScoreValues) * 1000) / 1000,
      maxHubScore: Math.round(max(hubScoreValues) * 1000) / 1000,
      avgBrokerScore: Math.round(avg(brokerScoreValues) * 1000) / 1000,
      maxBrokerScore: Math.round(max(brokerScoreValues) * 1000) / 1000,
      avgKCore: Math.round(avg(kCoreValues) * 100) / 100,
      maxKCore: max(kCoreValues),
      pctAccumulator: Math.round((roleCount.ACCUMULATOR / total) * 1000) / 1000,
      pctDistributor: Math.round((roleCount.DISTRIBUTOR / total) * 1000) / 1000,
      pctRouter: Math.round((roleCount.ROUTER / total) * 1000) / 1000,
    };
  }
}

export default TopologyMarketService;
