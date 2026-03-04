/**
 * Graph Builder Stabilization Tests
 * 
 * Tests for MAX_NODES, MAX_EDGES limits and smart truncation
 * Verifies that highlighted path is ALWAYS preserved during truncation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GraphNode, GraphEdge, HighlightedStep, RiskSummary } from '../storage/graph_types.js';

// ============================================
// Test Constants (match production limits)
// ============================================

const STABILIZATION_LIMITS = {
  MAX_NODES: 300,
  MAX_EDGES: 500,
  MAX_HOPS: 6,
  MAX_ROUTES: 5,
};

// ============================================
// Helper Functions (extracted logic for testing)
// ============================================

/**
 * Smart truncation logic - MUST preserve highlightedPath + 1-hop neighbours
 */
function applySmartTruncation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  highlightedPath: HighlightedStep[]
): { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean } {
  const needsTruncation = 
    nodes.length > STABILIZATION_LIMITS.MAX_NODES ||
    edges.length > STABILIZATION_LIMITS.MAX_EDGES;
  
  if (!needsTruncation) {
    return { nodes, edges, truncated: false };
  }
  
  // Build set of highlighted edge IDs
  const highlightedEdgeIds = new Set(highlightedPath.map(step => step.edgeId));
  
  // Build set of nodes in highlighted path
  const highlightedNodeIds = new Set<string>();
  for (const edge of edges) {
    if (highlightedEdgeIds.has(edge.id)) {
      highlightedNodeIds.add(edge.fromNodeId);
      highlightedNodeIds.add(edge.toNodeId);
    }
  }
  
  // Build set of 1-hop neighbour nodes
  const neighbourNodeIds = new Set<string>();
  for (const edge of edges) {
    if (highlightedNodeIds.has(edge.fromNodeId)) {
      neighbourNodeIds.add(edge.toNodeId);
    }
    if (highlightedNodeIds.has(edge.toNodeId)) {
      neighbourNodeIds.add(edge.fromNodeId);
    }
  }
  
  // Merge into keep set
  const keepNodeIds = new Set([...highlightedNodeIds, ...neighbourNodeIds]);
  
  // Build set of edges to keep (highlighted + connected to kept nodes)
  const keepEdgeIds = new Set(highlightedEdgeIds);
  for (const edge of edges) {
    if (keepNodeIds.has(edge.fromNodeId) && keepNodeIds.has(edge.toNodeId)) {
      keepEdgeIds.add(edge.id);
    }
  }
  
  // Filter nodes (prioritize highlighted path nodes)
  let filteredNodes = nodes.filter(n => keepNodeIds.has(n.id));
  
  // If still too many, keep only highlighted path nodes
  if (filteredNodes.length > STABILIZATION_LIMITS.MAX_NODES) {
    filteredNodes = nodes.filter(n => highlightedNodeIds.has(n.id));
  }
  
  // Limit to MAX_NODES
  filteredNodes = filteredNodes.slice(0, STABILIZATION_LIMITS.MAX_NODES);
  
  // Build final node ID set
  const finalNodeIds = new Set(filteredNodes.map(n => n.id));
  
  // Filter edges - ALWAYS keep highlighted edges, then add others
  const highlightedEdges = edges.filter(e => highlightedEdgeIds.has(e.id));
  const otherEdges = edges.filter(e => 
    !highlightedEdgeIds.has(e.id) && 
    finalNodeIds.has(e.fromNodeId) && 
    finalNodeIds.has(e.toNodeId)
  );
  
  // Combine and limit
  const filteredEdges = [
    ...highlightedEdges,
    ...otherEdges.slice(0, STABILIZATION_LIMITS.MAX_EDGES - highlightedEdges.length)
  ].slice(0, STABILIZATION_LIMITS.MAX_EDGES);
  
  return {
    nodes: filteredNodes,
    edges: filteredEdges,
    truncated: true
  };
}

/**
 * Apply MAX_HOPS limit to segments
 */
function applyMaxHopsLimit(segments: any[]): any[] {
  return segments.slice(0, STABILIZATION_LIMITS.MAX_HOPS);
}

// ============================================
// Test Data Generators
// ============================================

function createNode(id: string, type: string = 'WALLET'): GraphNode {
  return {
    id,
    type: type as any,
    address: id.split(':')[2] || id,
    chain: id.split(':')[1] || 'eth',
    displayName: `Node ${id}`,
    labels: []
  };
}

function createEdge(id: string, fromNodeId: string, toNodeId: string): GraphEdge {
  return {
    id,
    type: 'TRANSFER',
    fromNodeId,
    toNodeId,
    chain: 'eth',
    timestamp: Date.now()
  };
}

function createHighlightedStep(edgeId: string, order: number): HighlightedStep {
  return {
    edgeId,
    reason: 'origin_of_route',
    riskContribution: 0.5,
    order
  };
}

/**
 * Generate large graph for testing truncation
 */
function generateLargeGraph(
  nodeCount: number, 
  edgeCount: number,
  highlightedEdgeIds: string[]
): { nodes: GraphNode[]; edges: GraphEdge[]; highlightedPath: HighlightedStep[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  
  // Create nodes
  for (let i = 0; i < nodeCount; i++) {
    nodes.push(createNode(`wallet:eth:0x${i.toString(16).padStart(40, '0')}`));
  }
  
  // Create edges (connect nodes randomly)
  for (let i = 0; i < edgeCount; i++) {
    const fromIdx = i % nodeCount;
    const toIdx = (i + 1) % nodeCount;
    edges.push(createEdge(
      `edge-${i}`,
      nodes[fromIdx].id,
      nodes[toIdx].id
    ));
  }
  
  // Create highlighted path
  const highlightedPath = highlightedEdgeIds.map((edgeId, idx) => 
    createHighlightedStep(edgeId, idx + 1)
  );
  
  return { nodes, edges, highlightedPath };
}

// ============================================
// Tests
// ============================================

describe('Graph Builder Stabilization Guards', () => {
  
  describe('MAX_NODES / MAX_EDGES Limits', () => {
    
    it('should NOT truncate graph within limits', () => {
      const { nodes, edges, highlightedPath } = generateLargeGraph(100, 200, ['edge-0', 'edge-1']);
      
      const result = applySmartTruncation(nodes, edges, highlightedPath);
      
      expect(result.truncated).toBe(false);
      expect(result.nodes.length).toBe(100);
      expect(result.edges.length).toBe(200);
    });
    
    it('should truncate when nodes exceed MAX_NODES (300)', () => {
      const { nodes, edges, highlightedPath } = generateLargeGraph(500, 200, ['edge-0', 'edge-1']);
      
      const result = applySmartTruncation(nodes, edges, highlightedPath);
      
      expect(result.truncated).toBe(true);
      expect(result.nodes.length).toBeLessThanOrEqual(STABILIZATION_LIMITS.MAX_NODES);
    });
    
    it('should truncate when edges exceed MAX_EDGES (500)', () => {
      const { nodes, edges, highlightedPath } = generateLargeGraph(100, 700, ['edge-0', 'edge-1']);
      
      const result = applySmartTruncation(nodes, edges, highlightedPath);
      
      expect(result.truncated).toBe(true);
      expect(result.edges.length).toBeLessThanOrEqual(STABILIZATION_LIMITS.MAX_EDGES);
    });
    
    it('should truncate when BOTH nodes and edges exceed limits', () => {
      const { nodes, edges, highlightedPath } = generateLargeGraph(500, 700, ['edge-0', 'edge-1']);
      
      const result = applySmartTruncation(nodes, edges, highlightedPath);
      
      expect(result.truncated).toBe(true);
      expect(result.nodes.length).toBeLessThanOrEqual(STABILIZATION_LIMITS.MAX_NODES);
      expect(result.edges.length).toBeLessThanOrEqual(STABILIZATION_LIMITS.MAX_EDGES);
    });
  });
  
  describe('Highlighted Path Preservation', () => {
    
    it('should ALWAYS preserve highlighted path edges after truncation', () => {
      const highlightedEdgeIds = ['edge-0', 'edge-1', 'edge-2', 'edge-3'];
      const { nodes, edges, highlightedPath } = generateLargeGraph(500, 700, highlightedEdgeIds);
      
      const result = applySmartTruncation(nodes, edges, highlightedPath);
      
      // All highlighted edges must be in result
      const resultEdgeIds = new Set(result.edges.map(e => e.id));
      for (const edgeId of highlightedEdgeIds) {
        expect(resultEdgeIds.has(edgeId)).toBe(true);
      }
    });
    
    it('should preserve nodes from highlighted path', () => {
      // Create specific highlighted path
      const nodes: GraphNode[] = [
        createNode('wallet:eth:0xA'),
        createNode('wallet:eth:0xB'),
        createNode('wallet:eth:0xC'),
        createNode('cex:eth:0xD'),
      ];
      
      // Add 500 more filler nodes to exceed limit
      for (let i = 0; i < 500; i++) {
        nodes.push(createNode(`wallet:eth:filler-${i}`));
      }
      
      const edges: GraphEdge[] = [
        createEdge('edge-highlighted-1', 'wallet:eth:0xA', 'wallet:eth:0xB'),
        createEdge('edge-highlighted-2', 'wallet:eth:0xB', 'wallet:eth:0xC'),
        createEdge('edge-highlighted-3', 'wallet:eth:0xC', 'cex:eth:0xD'),
      ];
      
      // Add filler edges
      for (let i = 0; i < 600; i++) {
        edges.push(createEdge(`edge-filler-${i}`, `wallet:eth:filler-${i % 500}`, `wallet:eth:filler-${(i + 1) % 500}`));
      }
      
      const highlightedPath = [
        createHighlightedStep('edge-highlighted-1', 1),
        createHighlightedStep('edge-highlighted-2', 2),
        createHighlightedStep('edge-highlighted-3', 3),
      ];
      
      const result = applySmartTruncation(nodes, edges, highlightedPath);
      
      // CRITICAL: All nodes in highlighted path MUST be preserved
      const resultNodeIds = new Set(result.nodes.map(n => n.id));
      expect(resultNodeIds.has('wallet:eth:0xA')).toBe(true);
      expect(resultNodeIds.has('wallet:eth:0xB')).toBe(true);
      expect(resultNodeIds.has('wallet:eth:0xC')).toBe(true);
      expect(resultNodeIds.has('cex:eth:0xD')).toBe(true);
      
      // All highlighted edges MUST be preserved
      const resultEdgeIds = new Set(result.edges.map(e => e.id));
      expect(resultEdgeIds.has('edge-highlighted-1')).toBe(true);
      expect(resultEdgeIds.has('edge-highlighted-2')).toBe(true);
      expect(resultEdgeIds.has('edge-highlighted-3')).toBe(true);
    });
    
    it('should preserve 1-hop neighbours when possible', () => {
      // Create graph with highlighted path + 1-hop neighbours
      const nodes: GraphNode[] = [
        createNode('wallet:eth:0xA'),      // highlighted
        createNode('wallet:eth:0xB'),      // highlighted
        createNode('wallet:eth:neighbour1'), // 1-hop from 0xA
        createNode('wallet:eth:neighbour2'), // 1-hop from 0xB
      ];
      
      // Add filler nodes (but under MAX_NODES total for neighbours test)
      for (let i = 0; i < 200; i++) {
        nodes.push(createNode(`wallet:eth:filler-${i}`));
      }
      
      const edges: GraphEdge[] = [
        createEdge('edge-highlighted', 'wallet:eth:0xA', 'wallet:eth:0xB'),
        createEdge('edge-neighbour1', 'wallet:eth:0xA', 'wallet:eth:neighbour1'),
        createEdge('edge-neighbour2', 'wallet:eth:0xB', 'wallet:eth:neighbour2'),
      ];
      
      // Add filler edges to exceed MAX_EDGES
      for (let i = 0; i < 600; i++) {
        edges.push(createEdge(`edge-filler-${i}`, `wallet:eth:filler-${i % 200}`, `wallet:eth:filler-${(i + 1) % 200}`));
      }
      
      const highlightedPath = [
        createHighlightedStep('edge-highlighted', 1),
      ];
      
      const result = applySmartTruncation(nodes, edges, highlightedPath);
      
      // Check that 1-hop neighbours are preserved
      const resultNodeIds = new Set(result.nodes.map(n => n.id));
      expect(resultNodeIds.has('wallet:eth:neighbour1')).toBe(true);
      expect(resultNodeIds.has('wallet:eth:neighbour2')).toBe(true);
    });
  });
  
  describe('MAX_HOPS Limit', () => {
    
    it('should limit segments to MAX_HOPS (6)', () => {
      const segments = [
        { index: 0 }, { index: 1 }, { index: 2 }, 
        { index: 3 }, { index: 4 }, { index: 5 },
        { index: 6 }, { index: 7 }, { index: 8 }, // these should be cut
      ];
      
      const limited = applyMaxHopsLimit(segments);
      
      expect(limited.length).toBe(STABILIZATION_LIMITS.MAX_HOPS);
      expect(limited[5].index).toBe(5);
    });
    
    it('should not modify segments under MAX_HOPS', () => {
      const segments = [{ index: 0 }, { index: 1 }, { index: 2 }];
      
      const limited = applyMaxHopsLimit(segments);
      
      expect(limited.length).toBe(3);
    });
    
    it('should handle empty segments array', () => {
      const limited = applyMaxHopsLimit([]);
      
      expect(limited.length).toBe(0);
    });
  });
  
  describe('Edge Cases', () => {
    
    it('should handle empty highlighted path during truncation', () => {
      const { nodes, edges } = generateLargeGraph(500, 700, []);
      
      const result = applySmartTruncation(nodes, edges, []);
      
      expect(result.truncated).toBe(true);
      // Should still truncate but no specific path to preserve
      expect(result.nodes.length).toBeLessThanOrEqual(STABILIZATION_LIMITS.MAX_NODES);
    });
    
    it('should handle graph exactly at limits', () => {
      const { nodes, edges, highlightedPath } = generateLargeGraph(
        STABILIZATION_LIMITS.MAX_NODES, 
        STABILIZATION_LIMITS.MAX_EDGES, 
        ['edge-0']
      );
      
      const result = applySmartTruncation(nodes, edges, highlightedPath);
      
      // Exactly at limits - should NOT truncate
      expect(result.truncated).toBe(false);
    });
    
    it('should handle graph just over node limit', () => {
      const { nodes, edges, highlightedPath } = generateLargeGraph(
        STABILIZATION_LIMITS.MAX_NODES + 1, 
        100, 
        ['edge-0']
      );
      
      const result = applySmartTruncation(nodes, edges, highlightedPath);
      
      expect(result.truncated).toBe(true);
    });
    
    it('should handle graph just over edge limit', () => {
      const { nodes, edges, highlightedPath } = generateLargeGraph(
        100,
        STABILIZATION_LIMITS.MAX_EDGES + 1, 
        ['edge-0']
      );
      
      const result = applySmartTruncation(nodes, edges, highlightedPath);
      
      expect(result.truncated).toBe(true);
    });
  });
});
