/**
 * EPIC C1 v2: Graph Builder Types
 * 
 * Universal graph layer for L0/L1 structure:
 * - Works for Actors / Wallets / Entities
 * - Uses only facts and rules
 * - NO ML, NO signals
 * 
 * Edge types:
 * - FLOW_CORRELATION
 * - TOKEN_OVERLAP
 * - TEMPORAL_SYNC
 * - BRIDGE_ACTIVITY
 * - BEHAVIORAL_SIMILARITY
 */

// ============================================
// NODE TYPES
// ============================================

export type NodeType = 'actor' | 'wallet' | 'entity';

export type SourceLevel = 'verified' | 'attributed' | 'behavioral';

export type EdgeConfidence = 'high' | 'medium' | 'low';

// ============================================
// EDGE TYPES
// ============================================

export type EdgeType = 
  | 'FLOW_CORRELATION' 
  | 'TOKEN_OVERLAP' 
  | 'TEMPORAL_SYNC'
  | 'BRIDGE_ACTIVITY'
  | 'BEHAVIORAL_SIMILARITY';

export type FlowDirection = 'in-in' | 'out-out' | 'in-out' | 'bidirectional';

// ============================================
// EDGE STRUCTURES
// ============================================

export interface FlowCorrelationEdge {
  type: 'flow_correlation';
  direction: FlowDirection;
  sharedVolumeUsd: number;
  overlapRatio: number;  // shared / min(totalA, totalB)
  window: '24h' | '7d' | '30d';
}

export interface TokenOverlapEdge {
  type: 'token_overlap';
  sharedTokens: string[];
  jaccardIndex: number;  // |A ∩ B| / |A ∪ B|
  dominantToken?: string;
}

export interface TemporalSyncEdge {
  type: 'temporal_sync';
  syncScore: number;  // 0-1
  windowsMatched: number;
  activeHoursCorrelation: number;
}

export interface DirectInteractionEdge {
  type: 'direct_transfer';
  txCount: number;
  volumeUsd: number;
  netFlowUsd: number;
  lastInteraction: Date | null;
}

// Raw evidence union type (for rawEvidence field)
export type RawEdgeEvidence = 
  | FlowCorrelationEdge 
  | TokenOverlapEdge 
  | TemporalSyncEdge 
  | DirectInteractionEdge;

// ============================================
// GRAPH NODE (Universal)
// ============================================

export interface GraphNode {
  id: string;
  nodeType: NodeType;
  label: string;
  source: SourceLevel;
  coverage: number;  // 0-1
  metrics: {
    volumeUsd: number;
    inflowUsd?: number;
    outflowUsd?: number;
    txCount: number;
    activeDays: number;
    edgeScore?: number;  // only for actor
  };
  // Extended fields for actor
  actorType?: 'exchange' | 'fund' | 'market_maker' | 'whale' | 'trader';
  flowRole?: string;
  participation?: number;
  // UI hints
  ui: {
    color: string;
    size: number;
  };
  // Graph metrics (computed)
  graphMetrics?: {
    inDegree: number;
    outDegree: number;
    clusterMembership?: string;
  };
}

// Legacy alias for backward compatibility
export type GraphActorNode = GraphNode;

// ============================================
// GRAPH EDGE (with Confidence)
// ============================================

export interface EdgeEvidence {
  description: string;
  metrics: {
    flowOverlapPct?: number;
    tokenOverlapCount?: number;
    correlationScore?: number;
    bridgeCount?: number;
  };
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  
  // Edge classification
  edgeType: EdgeType;
  
  // Composite weight (0-1)
  weight: number;
  
  // Confidence level
  confidence: EdgeConfidence;
  
  // Explainability
  evidence: EdgeEvidence;
  
  // Raw evidence breakdown (optional, for detailed view)
  rawEvidence?: {
    flowCorrelation?: FlowCorrelationEdge;
    tokenOverlap?: TokenOverlapEdge;
    temporalSync?: TemporalSyncEdge;
    directTransfer?: DirectInteractionEdge;
  };
  
  // Trust penalty applied
  trustFactor: number;
  
  // UI hints
  ui: {
    color: string;
    width: number;
    opacity: number;
  };
  
  // Meta
  calculatedAt: Date;
}

// ============================================
// CLUSTER
// ============================================

export interface ActorCluster {
  clusterId: string;
  actors: string[];  // actorIds
  anchorActorId: string;  // verified/attributed with max EdgeScore
  dominantType: string;
  cohesionScore: number;  // avg internal edge weight
  metadata: {
    size: number;
    avgEdgeScore: number;
    dominantFlowRole: string;
  };
}

// ============================================
// FULL GRAPH
// ============================================

export interface ActorGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: ActorCluster[];
  metadata: {
    totalNodes: number;
    totalEdges: number;
    totalClusters: number;
    window: string;
    calculatedAt: Date;
    buildTimeMs: number;
  };
}

// ============================================
// WEIGHT COEFFICIENTS (EPIC C1 v2 formula)
// ============================================

// weight = 0.4×flow_overlap + 0.3×temporal_correlation + 0.2×token_overlap + 0.1×coverage_factor
export const EDGE_WEIGHT_COEFFICIENTS = {
  flowCorrelation: 0.40,
  temporalSync: 0.30,
  tokenOverlap: 0.20,
  coverageFactor: 0.10,
};

export const SOURCE_TRUST_FACTOR: Record<SourceLevel, number> = {
  verified: 1.0,
  attributed: 0.7,
  behavioral: 0.4,
};

// Confidence rules
export const CONFIDENCE_RULES = {
  HIGH: { minWeight: 0.6, requiresVerified: true, minStabilityDays: 7 },
  MEDIUM: { minWeight: 0.4, requiresVerified: false },
  LOW: { fallback: true },
};

// ============================================
// GRAPH LIMITS
// ============================================

export const GRAPH_LIMITS = {
  MAX_NODES: 100,
  MAX_EDGES: 500,
  MIN_WEIGHT: 0.1,
  MIN_CLUSTER_SIZE: 3,
  MAX_CLUSTERS: 20,
};
