/**
 * P3.3 KNG Topology Types
 * 
 * Type definitions for topology layer
 */

export type TopologyWindow = '24h' | '7d';

export type RoleHint = 'ACCUMULATOR' | 'DISTRIBUTOR' | 'ROUTER' | 'NEUTRAL';

export type RegimeHint = 'CENTRALIZED' | 'DISTRIBUTED' | 'NEUTRAL';

export type TopologySortField = 
  | 'pagerank' 
  | 'hubScore' 
  | 'brokerScore' 
  | 'kCore' 
  | 'netFlowUsd'
  | 'degIn'
  | 'degOut';

// ============================================
// ACTOR TOPOLOGY
// ============================================

export interface ActorTopologyRow {
  network: string;
  window: TopologyWindow;
  tsBucket: number;
  address: string;

  // Degree metrics
  degIn: number;
  degOut: number;

  // Flow metrics (USD)
  wInUsd: number;
  wOutUsd: number;
  netFlowUsd: number;

  // Structural metrics
  entropyOut: number;      // 0..1, output distribution entropy
  hubScore: number;        // 0..1, weighted degree normalized
  pagerank: number;        // 0..1, influence in graph
  kCore: number;           // integer, core membership
  brokerScore: number;     // 0..1, routing potential

  // Role inference (heuristic)
  roleHint: RoleHint;
}

// ============================================
// CORRIDOR TOPOLOGY
// ============================================

export interface CorridorTopologyRow {
  network: string;
  window: TopologyWindow;
  tsBucket: number;

  corridorId: string;      // from->to canonical
  from: string;
  to: string;

  // Flow metrics
  volumeUsd: number;
  txCount: number;
  persistence: number;     // 0..1, how stable over time
  dominance: number;       // 0..1, share of sender's outflow
}

// ============================================
// MARKET TOPOLOGY (aggregate)
// ============================================

export interface MarketTopologyRow {
  network: string;
  window: TopologyWindow;
  tsBucket: number;

  // Graph structure
  nodeCount: number;
  edgeCount: number;

  // Centralization metrics
  centralization: number;        // 0..1, Gini of hubScore
  corridorConcentration: number; // 0..1, top10 share
  entropyIndex: number;          // 0..1, avg entropy of top hubs

  // Regime
  regimeHint: RegimeHint;
}

// ============================================
// ML FEATURE BUNDLES (flat, no addresses)
// ============================================

export interface MarketTopologyFeatures {
  network: string;
  window: TopologyWindow;
  tsBucket: number;

  nodeCount: number;
  edgeCount: number;
  centralization: number;
  corridorConcentration: number;
  entropyIndex: number;
  regimeHint: RegimeHint;

  // Additional ML features
  avgPagerank: number;
  maxPagerank: number;
  avgHubScore: number;
  maxHubScore: number;
  avgBrokerScore: number;
  maxBrokerScore: number;
  avgKCore: number;
  maxKCore: number;

  // Role distribution
  pctAccumulator: number;
  pctDistributor: number;
  pctRouter: number;
}

export interface ActorTopologyFeatures {
  actorId: string;
  network: string;
  window: TopologyWindow;
  tsBucket: number;

  degIn: number;
  degOut: number;
  wInUsd: number;
  wOutUsd: number;
  netFlowUsd: number;
  entropyOut: number;
  hubScore: number;
  pagerank: number;
  kCore: number;
  brokerScore: number;
  roleHint: RoleHint;
}
