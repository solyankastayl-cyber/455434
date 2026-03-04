/**
 * P2.B — Cluster Confirmation Types
 * 
 * Types for multi-cluster confirmation and anti-manipulation rules.
 */

// Actor info for clustering
export interface ActorForCluster {
  actorId: string;
  actorType: string;
  sourceGroup: string;
  weight: number;
  
  // Cluster resolution fields (priority order)
  entityId?: string;         // Known entity (fund, exchange, MM)
  ownerId?: string;          // Known owner/controller
  communityId?: string;      // Graph-based community cluster
  infrastructureId?: string; // Infrastructure cluster (CEX hotwallets, bridges)
  
  // Graph metrics
  graphDegree?: number;
  hubId?: string;
  fundingSource?: string;
  dominantCounterparty?: string;
}

// Resolved cluster
export interface ActorCluster {
  clusterId: string;
  clusterType: 'entity' | 'owner' | 'community' | 'infra' | 'actor';
  clusterWeight: number;
  actorIds: string[];
  actorTypes: string[];
  sourceGroups: string[];
}

// Cluster resolution trace (for explainability)
export interface ClusterResolutionTrace {
  actorId: string;
  clusterId: string;
  reason: 'entity' | 'owner' | 'community' | 'infra' | 'fallback';
}

// Cluster confirmation result
export interface ClusterConfirmationResult {
  clusters: ActorCluster[];
  clustersCount: number;
  totalClusterWeight: number;
  topClusterWeight: number;
  dominance: number;
  sourceGroups: string[];
  passed: boolean;
  failReason?: string;
  penalties: string[];
  resolutionTrace: ClusterResolutionTrace[];
}

// Penalty multipliers
export const CLUSTER_PENALTIES = {
  // Dominance penalties
  dominance_strong: 0.70,    // dominance > 0.85
  dominance_soft: 0.85,      // dominance > 0.70
  
  // Diversity penalties
  cluster_diversity: 0.85,   // avgUniqueTypes < 1.2
  
  // Confirmation cap
  confirmation_cap: 79,      // Max confidence if cluster confirmation fails
} as const;

// Thresholds for rules
export const CLUSTER_THRESHOLDS = {
  // Rule B1: Multi-Cluster Confirmation
  minClusters: 2,
  minTotalWeight: 1.2,
  maxTopClusterDominance: 0.75,
  minSourceGroups: 2,
  
  // Rule B2: Dominance thresholds
  dominanceStrongThreshold: 0.85,
  dominanceSoftThreshold: 0.70,
  
  // Rule B3: Diversity threshold
  minAvgUniqueTypes: 1.2,
} as const;
