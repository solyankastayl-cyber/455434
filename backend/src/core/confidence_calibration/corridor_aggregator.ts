/**
 * P2.2 Phase 2: Corridor Aggregator
 * 
 * Aggregates multiple edges into corridors for visual clarity
 * 
 * KEY INVARIANT:
 * - highlightedPath edges NEVER get aggregated
 * - They remain "physical" edges for tooltip/timeline/explain
 */

import {
  CalibratedEdge,
  CalibratedNode,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Corridor {
  /** Unique corridor key */
  key: string;
  
  /** Aggregated weight (sum of edge weights) */
  weight: number;
  
  /** Weighted average confidence */
  confidence: number;
  
  /** Direction */
  direction: 'IN' | 'OUT';
  
  /** Node type pair */
  fromType: string;
  toType: string;
  
  /** IDs of edges that were aggregated */
  edgeIds: string[];
  
  /** Count of edges */
  edgeCount: number;
}

export interface CorridorAggregationOptions {
  /** Edge IDs that should NOT be aggregated (highlightedPath) */
  preserveEdgeIds?: string[];
  
  /** Minimum weight to include in corridor */
  minWeight?: number;
  
  /** Whether to aggregate at all (disable for debugging) */
  enabled?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// CORRIDOR KEYING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate deterministic corridor key
 * 
 * Key components:
 * - direction (IN/OUT)
 * - from node type
 * - to node type
 * 
 * This creates corridors like:
 * - "OUT:Wallet→CEX"
 * - "IN:Bridge→Wallet"
 */
function generateCorridorKey(
  edge: CalibratedEdge,
  fromNode: CalibratedNode | undefined,
  toNode: CalibratedNode | undefined
): string {
  const fromType = fromNode?.type || 'Unknown';
  const toType = toNode?.type || 'Unknown';
  const dir = edge.direction;
  
  return `${dir}:${fromType}→${toType}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATION LOGIC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aggregate edges into corridors
 * 
 * @param edges - Calibrated edges
 * @param nodes - Calibrated nodes
 * @param options - Aggregation options
 * @returns Array of corridors
 */
export function aggregateCorridors(
  edges: CalibratedEdge[],
  nodes: CalibratedNode[],
  options: CorridorAggregationOptions = {}
): Corridor[] {
  const {
    preserveEdgeIds = [],
    minWeight = 0,
    enabled = true,
  } = options;
  
  // If disabled, return empty
  if (!enabled) return [];
  
  // Build node lookup
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  
  // Group edges by corridor key
  const corridorMap = new Map<string, {
    edges: CalibratedEdge[];
    fromType: string;
    toType: string;
    direction: 'IN' | 'OUT';
  }>();
  
  for (const edge of edges) {
    // Skip preserved edges (highlightedPath)
    if (preserveEdgeIds.includes(edge.id || '')) {
      continue;
    }
    
    // Skip low-weight edges
    if (edge.weight < minWeight) {
      continue;
    }
    
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    const key = generateCorridorKey(edge, fromNode, toNode);
    
    if (!corridorMap.has(key)) {
      corridorMap.set(key, {
        edges: [],
        fromType: fromNode?.type || 'Unknown',
        toType: toNode?.type || 'Unknown',
        direction: edge.direction,
      });
    }
    
    corridorMap.get(key)!.edges.push(edge);
  }
  
  // Build corridors
  const corridors: Corridor[] = [];
  
  for (const [key, group] of corridorMap.entries()) {
    // Only create corridor if multiple edges
    if (group.edges.length < 2) {
      continue;
    }
    
    // Calculate aggregated weight
    const totalWeight = group.edges.reduce((sum, e) => sum + e.weight, 0);
    
    // Calculate weighted average confidence
    const weightedConfidenceSum = group.edges.reduce(
      (sum, e) => sum + (e.confidence * e.weight),
      0
    );
    const avgConfidence = totalWeight > 0 
      ? weightedConfidenceSum / totalWeight 
      : 0;
    
    corridors.push({
      key,
      weight: totalWeight,
      confidence: avgConfidence,
      direction: group.direction,
      fromType: group.fromType,
      toType: group.toType,
      edgeIds: group.edges.map(e => e.id || ''),
      edgeCount: group.edges.length,
    });
  }
  
  // Sort by weight (descending) for consistency
  corridors.sort((a, b) => b.weight - a.weight);
  
  return corridors;
}

/**
 * Get top N corridors by weight
 * 
 * Useful for displaying only dominant corridors
 */
export function getTopCorridors(
  corridors: Corridor[],
  n: number = 5
): Corridor[] {
  return corridors.slice(0, n);
}

/**
 * Check if edge belongs to any corridor
 */
export function edgeInCorridor(
  edgeId: string,
  corridors: Corridor[]
): Corridor | undefined {
  return corridors.find(c => c.edgeIds.includes(edgeId));
}

/**
 * Get corridor statistics for debugging
 */
export function getCorridorStats(corridors: Corridor[]): {
  totalCorridors: number;
  totalEdgesAggregated: number;
  topCorridorWeight: number;
  avgCorridorWeight: number;
} {
  const totalEdgesAggregated = corridors.reduce(
    (sum, c) => sum + c.edgeCount,
    0
  );
  
  const totalWeight = corridors.reduce((sum, c) => sum + c.weight, 0);
  const avgWeight = corridors.length > 0 ? totalWeight / corridors.length : 0;
  const topWeight = corridors.length > 0 ? corridors[0].weight : 0;
  
  return {
    totalCorridors: corridors.length,
    totalEdgesAggregated,
    topCorridorWeight: topWeight,
    avgCorridorWeight: avgWeight,
  };
}
