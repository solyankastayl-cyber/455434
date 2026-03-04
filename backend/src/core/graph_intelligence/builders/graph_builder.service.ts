/**
 * Graph Builder (P1.7 + STABILIZATION + P2.3 + ETAP B1 + ETAP B2 + ETAP D1)
 * 
 * Main orchestrator for building graph snapshots.
 * Combines route data + market context into explainability graph.
 * 
 * ETAP D1: Analytical Aggregation Layer
 * - Uses aggregated relations, NOT raw transactions
 * - 1 edge = aggregated (A → B) with volume/confidence/count
 * - Graph now shows ANALYTICAL data, not routing
 * 
 * ETAP B1: Network-scoped queries
 * - All queries filter by network
 * - No cross-network data
 * 
 * ETAP B2: Cross-chain Exit Detection
 * - Detects bridge transactions
 * - Creates exit nodes (terminal)
 * - Does NOT continue graph into other networks
 * 
 * STABILIZATION GUARDS:
 * - MAX_NODES / MAX_EDGES hard limits
 * - Smart truncation (keep highlightedPath + 1-hop)
 * - MAX_HOPS traversal depth
 */

import {
  GraphNode,
  GraphEdge,
  GraphSnapshot,
  GraphBuildOptions,
  RiskSummary,
  HighlightedStep,
  createNodeId
} from '../storage/graph_types.js';
import { snapshotCache, CALIBRATION_VERSION, TTL_CONFIG } from '../cache/snapshot_cache.service.js';
import { nodeResolver } from '../resolvers/node_resolver.service.js';
import { edgeResolver } from '../resolvers/edge_resolver.service.js';
import { pathHighlighter } from './path_highlighter.service.js';
import { riskExplainService } from '../explain/risk_explain.service.js';
import { routeSourceAdapter } from '../integrations/route_source.adapter.js';
import { marketContextAdapter } from '../integrations/market_context.adapter.js';
import { calibrateGraph } from '../../confidence_calibration/confidence_calibrator.service.js';
import { NetworkType, getNetworkAliases, normalizeNetwork } from '../../../common/network.types.js';
import { 
  checkIfBridgeDestination, 
  createExitNodeId, 
  createExitEdgeId 
} from '../../cross_chain/cross_chain_detector.js';
import { aggregateRelationsForAddress, type AggregatedRelation } from '../../graph_analytics/relation_aggregator.service.js';
import { enrichNodesWithAnalytics } from '../../graph_analytics/node_analytics.service.js';

// ============================================
// STABILIZATION LIMITS (HARD CAPS)
// ============================================

const STABILIZATION_LIMITS = {
  MAX_NODES: 300,          // Hard limit for nodes
  MAX_EDGES: 500,          // Hard limit for edges
  MAX_HOPS: 6,             // Traversal depth limit
  MAX_ROUTES: 5,           // Max routes to process
};

// ============================================
// P2.3.2: Visibility Thresholds
// ============================================

const VISIBILITY_CONFIG = {
  /** Edges with weight below this are hidden (but still in snapshot) */
  MIN_EDGE_WEIGHT: 0.15,
  /** Corridors collapsed by default, expand on hover */
  CORRIDOR_DEFAULT_MODE: 'collapsed' as const,
  /** P2.3.2: Enable visibility threshold (can be disabled for debugging) */
  ENABLE_VISIBILITY_THRESHOLD: false, // Disabled for now - investigate highlightedPath matching
};

// ============================================
// Default Options
// ============================================

const DEFAULT_OPTIONS: GraphBuildOptions = {
  maxRoutes: 3,
  maxEdges: 250,
  timeWindowHours: 24,
  includeTokens: false
};

// ============================================
// Graph Builder Service
// ============================================

export class GraphBuilder {
  
  /**
   * Build graph for an address
   * 
   * ETAP B1: Network-scoped queries
   * P2.3: Uses versioned cache with TTL strategy
   * 
   * @param address - Target address
   * @param options - Build options (includes network)
   * @param mode - 'raw' (default) or 'calibrated' (P2.2)
   */
  async buildForAddress(
    address: string,
    options?: GraphBuildOptions,
    mode: 'raw' | 'calibrated' = 'raw'
  ): Promise<GraphSnapshot> {
    const startTime = Date.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const addr = address.toLowerCase();
    
    // ETAP B1: Get network from options (default to ethereum)
    const network: NetworkType = opts.network || 'ethereum';
    
    console.log(`[GraphBuilder] Building ANALYTICAL graph for ${addr} on ${network}...`);
    
    // ============================================
    // ETAP D1: Use Aggregated Relations
    // Graph builder NEVER reads raw tx anymore
    // ============================================
    
    const aggregatedRelations = await aggregateRelationsForAddress(addr, {
      network,
      limit: opts.maxEdges || 100,
      minTxCount: 1,
      minVolumeUsd: 0,
      timeWindowDays: 365,
    });
    
    console.log(`[GraphBuilder] Got ${aggregatedRelations.length} aggregated relations`);
    
    if (aggregatedRelations.length === 0) {
      return this.createEmptySnapshot('ADDRESS', addr, startTime, network);
    }
    
    // ============================================
    // ETAP D1: Build Graph from Aggregated Relations
    // ============================================
    
    let { nodes, edges } = this.buildFromAggregatedRelations(
      aggregatedRelations as any, 
      addr, 
      network,
      opts
    );
    
    console.log(`[GraphBuilder] Built ${nodes.length} nodes, ${edges.length} edges`);
    
    // ============================================
    // ETAP D2: Enrich nodes with pre-calculated analytics
    // ============================================
    
    const nodeAddresses = nodes.map(n => n.address).filter(a => a);
    const analyticsMap = await enrichNodesWithAnalytics(nodeAddresses, network);
    
    // Apply analytics to nodes
    nodes = nodes.map(node => {
      const analytics = analyticsMap.get(node.address?.toLowerCase());
      if (analytics) {
        return {
          ...node,
          // ETAP D2: Pre-calculated metrics
          influenceScore: analytics.influenceScore || 0,
          totalVolumeUsd: analytics.totalVolumeUsd || 0,
          hubScore: analytics.hubScore || 0,
          activityScore: analytics.activityScore || 0,
          // Derived sizing weight (for frontend)
          sizeWeight: analytics.influenceScore || 0.3,
        };
      }
      return { ...node, influenceScore: 0.3, sizeWeight: 0.3 };
    });
    
    console.log(`[GraphBuilder] Enriched ${analyticsMap.size} nodes with analytics`);
    
    // Calculate totals for risk summary
    const totalInflow = aggregatedRelations
      .filter(r => r.direction === 'IN')
      .reduce((sum, r) => sum + r.volumeUsd, 0);
    const totalOutflow = aggregatedRelations
      .filter(r => r.direction === 'OUT')
      .reduce((sum, r) => sum + r.volumeUsd, 0);
    
    // Build risk summary
    const riskSummary: RiskSummary = {
      exitProbability: totalOutflow / Math.max(totalInflow + totalOutflow, 1),
      dumpRiskScore: Math.min(100, (totalOutflow / 10000)),
      pathEntropy: aggregatedRelations.length / 50,
      contextualRiskScore: 0,
      marketAmplifier: 1,
      confidenceImpact: 0,
      contextTags: [],
    };
    
    // Build highlighted path from top edges
    const highlightedPath = pathHighlighter.buildHighlightedPath(edges, riskSummary);
    
    // Build explanation
    const explain = riskExplainService.generateExplanation(riskSummary, edges, false);
    
    // Create snapshot
    let snapshot: GraphSnapshot = {
      snapshotId: '',
      kind: 'ADDRESS',
      address: addr,
      network,
      nodes,
      edges,
      highlightedPath,
      riskSummary,
      explain,
      truncated: false,
      generatedAt: Date.now(),
      expiresAt: Date.now() + TTL_CONFIG.RAW,
      buildTimeMs: Date.now() - startTime,
      // ETAP D1: Add analytics metadata
      analytics: {
        totalInflow,
        totalOutflow,
        netFlow: totalInflow - totalOutflow,
        relationCount: aggregatedRelations.length,
        avgConfidence: aggregatedRelations.reduce((s, r) => s + r.confidence, 0) / aggregatedRelations.length,
      },
    } as any;
    
    // A2: Apply calibration if mode=calibrated
    if (mode === 'calibrated') {
      snapshot = this.applyCalibratedMode(snapshot);
      snapshot.expiresAt = Date.now() + TTL_CONFIG.CALIBRATED;
    }
    
    // Save to cache
    const saved = await snapshotCache.saveSnapshot(snapshot, mode);
    snapshot.snapshotId = saved.snapshotId;
    
    console.log(`[GraphBuilder] Built ${addr}:${network}:${mode} in ${Date.now() - startTime}ms`);
    
    return snapshot;
  }
  
  /**
   * ETAP D1: Build graph from aggregated relations
   * 
   * This is the NEW core method that builds analytical graph.
   */
  private buildFromAggregatedRelations(
    relations: (AggregatedRelation & { weight?: number; counterparty?: string; entityType?: string; entityName?: string })[],
    focusAddress: string,
    network: NetworkType,
    opts: GraphBuildOptions
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodesMap = new Map<string, GraphNode>();
    const edgesMap = new Map<string, GraphEdge>();
    const exitNodesAdded = new Set<string>();
    
    // Add focus node (the queried address)
    const focusNodeId = createNodeId('wallet', network, focusAddress);
    nodesMap.set(focusNodeId, {
      id: focusNodeId,
      type: 'WALLET',
      address: focusAddress,
      chain: network,
      displayName: `${focusAddress.slice(0, 6)}...${focusAddress.slice(-4)}`,
      labels: ['FOCUS'],
      metadata: { isFocus: true },
    });
    
    for (const rel of relations) {
      const counterparty = rel.counterparty || (rel.direction === 'OUT' ? rel.to : rel.from);
      
      // ============================================
      // ETAP B2: Check for cross-chain exit
      // ============================================
      const bridgeCheck = checkIfBridgeDestination(counterparty, network);
      
      if (bridgeCheck.isBridge) {
        const exitNodeId = createExitNodeId(bridgeCheck.toNetwork);
        
        if (!exitNodesAdded.has(exitNodeId)) {
          const exitNode: GraphNode = {
            id: exitNodeId,
            type: 'CROSS_CHAIN_EXIT',
            address: '',
            chain: network,
            label: `→ ${bridgeCheck.toNetwork.toUpperCase()}`,
            displayName: `→ ${bridgeCheck.toNetwork.toUpperCase()}`,
            labels: ['BRIDGE', 'EXIT'],
            meta: {
              targetNetwork: bridgeCheck.toNetwork,
              protocol: bridgeCheck.protocol,
            },
          };
          nodesMap.set(exitNodeId, exitNode);
          exitNodesAdded.add(exitNodeId);
        }
        
        // Create exit edge
        const exitEdgeId = createExitEdgeId(focusAddress, bridgeCheck.toNetwork);
        const exitEdge: GraphEdge = {
          id: exitEdgeId,
          type: 'EXIT',
          fromNodeId: focusNodeId,
          toNodeId: exitNodeId,
          direction: 'OUT',
          chain: network,
          meta: {
            protocol: bridgeCheck.protocol,
            targetNetwork: bridgeCheck.toNetwork,
            volumeUsd: rel.volumeUsd,
            txCount: rel.txCount,
            confidence: rel.confidence,
          },
        };
        edgesMap.set(exitEdgeId, exitEdge);
        continue;
      }
      
      // ============================================
      // Normal relation (not bridge)
      // ============================================
      
      // Add counterparty node
      const counterpartyNodeId = createNodeId(
        rel.entityType?.toLowerCase() || 'wallet', 
        network, 
        counterparty
      );
      
      if (!nodesMap.has(counterpartyNodeId)) {
        const nodeType = (rel.entityType?.toUpperCase() || 'WALLET') as any;
        nodesMap.set(counterpartyNodeId, {
          id: counterpartyNodeId,
          type: nodeType,
          address: counterparty,
          chain: network,
          displayName: rel.entityName || `${counterparty.slice(0, 6)}...${counterparty.slice(-4)}`,
          labels: rel.tags || [],
          metadata: {
            protocol: rel.entityName,
            volumeUsd: rel.volumeUsd,
            txCount: rel.txCount,
          },
        });
      }
      
      // Create edge
      const edgeId = `agg:${focusAddress.slice(0, 8)}:${counterparty.slice(0, 8)}:${rel.direction}`;
      const edge: GraphEdge = {
        id: edgeId,
        type: 'TRANSFER',
        fromNodeId: rel.direction === 'OUT' ? focusNodeId : counterpartyNodeId,
        toNodeId: rel.direction === 'OUT' ? counterpartyNodeId : focusNodeId,
        direction: rel.direction,
        chain: network,
        meta: {
          volumeUsd: rel.volumeUsd,
          volumeNative: rel.volumeNative,
          txCount: rel.txCount,
          avgTxSize: rel.avgTxSize,
          confidence: rel.confidence,
          // ETAP D1: Weight for rendering
          weight: rel.weight || 0.5,
          firstSeen: rel.firstSeen,
          lastSeen: rel.lastSeen,
        },
      };
      edgesMap.set(edgeId, edge);
      
      // Limit check
      if (edgesMap.size >= (opts.maxEdges || 100)) break;
    }
    
    return {
      nodes: Array.from(nodesMap.values()),
      edges: Array.from(edgesMap.values()),
    };
  }
  
  /**
   * Build graph for a specific route
   * 
   * P2.3: Uses versioned cache
   */
  async buildForRoute(
    routeId: string,
    options?: GraphBuildOptions,
    mode: 'raw' | 'calibrated' = 'raw'
  ): Promise<GraphSnapshot> {
    const startTime = Date.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    // P2.3.1: Check versioned cache
    const cached = await snapshotCache.getSnapshot('ROUTE', routeId, mode);
    if (cached) {
      console.log(`[GraphBuilder] Cache HIT for route:${routeId}:${mode}`);
      return cached;
    }
    
    console.log(`[GraphBuilder] Cache MISS for route:${routeId}:${mode} - building...`);
    
    // Get specific route
    const route = await routeSourceAdapter.getEnrichedRouteById(routeId);
    
    if (!route) {
      return this.createEmptySnapshot('ROUTE', routeId, startTime);
    }
    
    // Build graph from single route
    let { nodes, edges } = this.buildFromRoutes([route], route.from, opts);
    
    // Get market context
    const marketContext = await marketContextAdapter.getContextForRoute(routeId);
    
    // Build risk summary
    const riskSummary = this.buildRiskSummary(route, marketContext);
    
    // Build highlighted path (all edges in this case)
    const highlightedPath = pathHighlighter.buildHighlightedPath(edges, riskSummary);
    
    // === STABILIZATION: Apply smart truncation ===
    const truncationResult = this.applySmartTruncation(nodes, edges, highlightedPath);
    nodes = truncationResult.nodes;
    edges = truncationResult.edges;
    const truncated = truncationResult.truncated;
    
    // Build explanation (summary-only if truncated)
    const explain = riskExplainService.generateExplanation(riskSummary, edges, truncated);
    
    // Create snapshot
    let snapshot: GraphSnapshot = {
      snapshotId: '',
      kind: 'ROUTE',
      routeId,
      nodes,
      edges,
      highlightedPath,
      riskSummary,
      explain,
      truncated,
      generatedAt: Date.now(),
      expiresAt: Date.now() + TTL_CONFIG.RAW,
      buildTimeMs: Date.now() - startTime
    };
    
    // Apply calibration if mode=calibrated
    if (mode === 'calibrated') {
      snapshot = this.applyCalibratedMode(snapshot);
      snapshot.expiresAt = Date.now() + TTL_CONFIG.CALIBRATED;
    }
    
    // P2.3.1: Save to versioned cache
    const saved = await snapshotCache.saveSnapshot(snapshot, mode);
    snapshot.snapshotId = saved.snapshotId;
    
    return snapshot;
  }
  
  // ============================================
  // STABILIZATION: Smart Truncation
  // ============================================
  
  /**
   * Apply smart truncation - KEEP highlightedPath + 1-hop neighbours
   * DROP everything else when limits exceeded
   */
  private applySmartTruncation(
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
    
    console.log(`[GraphBuilder] Truncating graph: ${nodes.length} nodes, ${edges.length} edges`);
    
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
    
    console.log(`[GraphBuilder] After truncation: ${filteredNodes.length} nodes, ${filteredEdges.length} edges`);
    
    return {
      nodes: filteredNodes,
      edges: filteredEdges,
      truncated: true
    };
  }
  
  // ============================================
  // Private Methods
  // ============================================
  
  /**
   * Build nodes and edges from routes
   * STABILIZATION: MAX_HOPS depth control
   */
  private buildFromRoutes(
    routes: any[],
    focusAddress: string,
    opts: GraphBuildOptions
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodesMap = new Map<string, GraphNode>();
    const edgesMap = new Map<string, GraphEdge>();
    const exitNodesAdded = new Set<string>(); // ETAP B2: Track exit nodes
    
    // ETAP B1: Get network from options
    const network = opts.network || 'ethereum';
    
    for (const route of routes) {
      // Add route origin node
      const fromNode = nodeResolver.resolveAddress(route.from, route.chain || 'eth');
      nodesMap.set(fromNode.id, fromNode);
      
      // Process segments with MAX_HOPS limit
      if (route.segments) {
        const maxSegments = Math.min(
          route.segments.length, 
          STABILIZATION_LIMITS.MAX_HOPS
        );
        
        for (let i = 0; i < maxSegments; i++) {
          const segment = route.segments[i];
          
          // ====================================================
          // ETAP B2: Check for cross-chain exit BEFORE processing
          // ====================================================
          const bridgeCheck = checkIfBridgeDestination(segment.to, network);
          
          if (bridgeCheck.isBridge) {
            // Create exit node (terminal)
            const exitNodeId = createExitNodeId(bridgeCheck.toNetwork);
            
            if (!exitNodesAdded.has(exitNodeId)) {
              const exitNode: GraphNode = {
                id: exitNodeId,
                type: 'CROSS_CHAIN_EXIT',
                address: '', // Not an address - it's an event
                chain: network,
                label: `→ ${bridgeCheck.toNetwork.toUpperCase()}`,
                meta: {
                  targetNetwork: bridgeCheck.toNetwork,
                  protocol: bridgeCheck.protocol,
                  via: 'canonical',
                },
              };
              nodesMap.set(exitNodeId, exitNode);
              exitNodesAdded.add(exitNodeId);
            }
            
            // Create exit edge (wallet → exit node)
            const exitEdgeId = createExitEdgeId(segment.from, bridgeCheck.toNetwork);
            const exitEdge: GraphEdge = {
              id: exitEdgeId,
              type: 'EXIT',
              fromNodeId: createNodeId('wallet', network, segment.from),
              toNodeId: exitNodeId,
              direction: 'OUT',
              chain: network,
              meta: {
                protocol: bridgeCheck.protocol,
                targetNetwork: bridgeCheck.toNetwork,
                txHash: segment.txHash,
              },
            };
            edgesMap.set(exitEdgeId, exitEdge);
            
            console.log(`[GraphBuilder] ETAP B2: Detected exit to ${bridgeCheck.toNetwork} via ${bridgeCheck.protocol}`);
            
            // ⛔️ IMPORTANT: Do NOT continue processing this route
            // The graph terminates at the exit node
            break;
          }
          
          // ====================================================
          // Normal segment processing (no bridge detected)
          // ====================================================
          
          // Resolve edge
          const edge = edgeResolver.resolveSegment({
            ...segment,
            routeId: route.routeId,
            segmentIndex: i
          });
          
          // Add nodes from edge
          const fromParsed = edge.fromNodeId.split(':');
          const toParsed = edge.toNodeId.split(':');
          
          if (fromParsed.length === 3) {
            const node = nodeResolver.resolveAddress(fromParsed[2], fromParsed[1], {
              type: fromParsed[0].toUpperCase() as any
            });
            nodesMap.set(node.id, node);
          }
          
          if (toParsed.length === 3) {
            const node = nodeResolver.resolveAddress(toParsed[2], toParsed[1], {
              type: toParsed[0].toUpperCase() as any
            });
            nodesMap.set(node.id, node);
          }
          
          edgesMap.set(edge.id, edge);
          
          // Check edge limit (pre-truncation soft limit)
          if (edgesMap.size >= (opts.maxEdges || 250)) {
            break;
          }
        }
      }
      
      // Check edge limit
      if (edgesMap.size >= (opts.maxEdges || 250)) {
        break;
      }
    }
    
    return {
      nodes: Array.from(nodesMap.values()),
      edges: Array.from(edgesMap.values())
    };
  }
  
  /**
   * Build risk summary from route + market context
   */
  private buildRiskSummary(route: any, marketContext: any): RiskSummary {
    return {
      // From route (P0.5)
      exitProbability: route.exitProbability ?? 0.5,
      dumpRiskScore: route.dumpRiskScore ?? 50,
      pathEntropy: route.pathEntropy ?? 0.5,
      
      // From market context (P1.6)
      contextualRiskScore: marketContext?.contextualRisk?.contextualDumpRiskScore ?? route.dumpRiskScore ?? 50,
      marketAmplifier: marketContext?.contextualRisk?.marketAmplifier ?? 1.0,
      confidenceImpact: marketContext?.contextualRisk?.confidenceImpact ?? 0,
      contextTags: marketContext?.contextualRisk?.contextTags ?? [],
      
      // Market regime
      marketRegime: marketContext?.marketSnapshot?.isStressed 
        ? 'STRESSED' 
        : marketContext?.marketSnapshot?.volatilityRegime === 'HIGH'
          ? 'VOLATILE'
          : 'STABLE'
    };
  }
  
  /**
   * Create empty snapshot when no data available
   * ETAP B1: Include network in empty snapshot
   */
  private createEmptySnapshot(
    kind: 'ADDRESS' | 'ROUTE',
    key: string,
    startTime: number,
    network: NetworkType = 'ethereum'
  ): GraphSnapshot {
    return {
      snapshotId: `empty-${Date.now()}`,
      kind,
      address: kind === 'ADDRESS' ? key : undefined,
      routeId: kind === 'ROUTE' ? key : undefined,
      network, // ETAP B1
      nodes: [],
      edges: [],
      highlightedPath: [],
      riskSummary: {
        exitProbability: 0,
        dumpRiskScore: 0,
        pathEntropy: 0,
        contextualRiskScore: 0,
        marketAmplifier: 1,
        confidenceImpact: 0,
        contextTags: []
      },
      explain: {
        reasons: [],
        amplifiers: [],
        suppressors: []
      },
      truncated: false,
      generatedAt: Date.now(),
      expiresAt: Date.now() + TTL_CONFIG.RAW,
      buildTimeMs: Date.now() - startTime
    } as any;
  }
  
  /**
   * Convert document to snapshot
   */
  private documentToSnapshot(doc: any): GraphSnapshot {
    return {
      snapshotId: doc.snapshotId,
      kind: doc.kind,
      address: doc.address,
      routeId: doc.routeId,
      nodes: doc.nodes,
      edges: doc.edges,
      highlightedPath: doc.highlightedPath,
      riskSummary: doc.riskSummary,
      explain: doc.explain,
      generatedAt: doc.generatedAt,
      expiresAt: doc.expiresAt,
      buildTimeMs: doc.buildTimeMs
    };
  }
  
  /**
   * Apply P2.2 calibrated mode
   * 
   * Converts raw snapshot to calibrated snapshot with:
   * - Edge weights (calibrated)
   * - Node size weights (calibrated)
   * - Corridors (aggregated)
   */
  private applyCalibratedMode(snapshot: GraphSnapshot): GraphSnapshot {
    // Extract highlightedPath edge IDs for preservation
    // Note: highlightedPath is array of HighlightedStep { edgeId, reason, ... }
    const highlightedPathEdgeIds = new Set(
      (snapshot.highlightedPath || [])
        .map((step: HighlightedStep) => step.edgeId)
        .filter(Boolean)
    );
    
    // Calculate node volumes from edges
    const nodeVolumes = new Map<string, { incoming: number; outgoing: number; connections: number }>();
    
    for (const edge of snapshot.edges) {
      const volume = edge.meta?.amountUsd || 1000;
      
      // From node (outgoing)
      if (!nodeVolumes.has(edge.fromNodeId)) {
        nodeVolumes.set(edge.fromNodeId, { incoming: 0, outgoing: 0, connections: 0 });
      }
      const fromStats = nodeVolumes.get(edge.fromNodeId)!;
      fromStats.outgoing += volume;
      fromStats.connections += 1;
      
      // To node (incoming)
      if (!nodeVolumes.has(edge.toNodeId)) {
        nodeVolumes.set(edge.toNodeId, { incoming: 0, outgoing: 0, connections: 0 });
      }
      const toStats = nodeVolumes.get(edge.toNodeId)!;
      toStats.incoming += volume;
      toStats.connections += 1;
    }
    
    // Convert to RawGraphSnapshot format for calibration
    const rawGraphForCalibration = {
      nodes: snapshot.nodes.map(n => {
        const stats = nodeVolumes.get(n.id) || { incoming: 0, outgoing: 0, connections: 0 };
        return {
          id: n.id,
          type: (n.type as 'CEX' | 'DEX' | 'Bridge' | 'Wallet') || 'Wallet',
          label: n.label || n.displayName,
          totalIncomingVolumeUsd: stats.incoming,
          totalOutgoingVolumeUsd: stats.outgoing,
          connectionCount: stats.connections,
          reliability: 1.0,
        };
      }),
      edges: snapshot.edges.map(e => ({
        from: e.fromNodeId,
        to: e.toNodeId,
        direction: 'OUT' as const, // Default to OUT, will be calculated by corridor logic
        txCount: 1,
        volumeUsd: e.meta?.amountUsd || 1000,
        routeConfidence: e.meta?.confidence || 0.8,
        marketModifier: 1.0,
        dataQuality: 0.9,
        actorReliability: 0.85,
      })),
      metadata: {
        highlightedPath: {
          edges: Array.from(highlightedPathEdgeIds).map(id => ({ id })),
        },
      },
    };
    
    // Apply calibration
    const calibrated = calibrateGraph(rawGraphForCalibration as any);
    
    // Create edge lookup by from-to (using original node IDs)
    const calibratedEdgeMap = new Map<string, any>();
    for (const ce of calibrated.edges) {
      calibratedEdgeMap.set(`${ce.from}-${ce.to}`, ce);
    }
    
    // Create node lookup by id
    const calibratedNodeMap = new Map<string, any>();
    for (const cn of calibrated.nodes) {
      calibratedNodeMap.set(cn.id, cn);
    }
    
    // Determine direction based on target address
    const targetAddress = snapshot.address?.toLowerCase();
    
    // Merge calibrated data back into snapshot
    return {
      ...snapshot,
      nodes: snapshot.nodes.map(n => {
        const cn = calibratedNodeMap.get(n.id);
        return {
          ...n,
          sizeWeight: cn?.sizeWeight || 1,
          confidence: cn?.confidence || 0.5,
        };
      }),
      edges: snapshot.edges.map(e => {
        const ce = calibratedEdgeMap.get(`${e.fromNodeId}-${e.toNodeId}`);
        const weight = ce?.weight || 0.5;
        
        // P2.2: Determine direction based on target address
        // If 'from' is target address = outgoing (OUT)
        // If 'to' is target address = incoming (IN)
        const fromAddress = e.fromNodeId?.toLowerCase() || '';
        const toAddress = e.toNodeId?.toLowerCase() || '';
        let direction: 'IN' | 'OUT' = 'OUT';
        
        if (targetAddress) {
          if (fromAddress.includes(targetAddress)) {
            direction = 'OUT';
          } else if (toAddress.includes(targetAddress)) {
            direction = 'IN';
          }
        }
        
        // P2.3.2: Check if this edge is in highlighted path
        const isHighlighted = highlightedPathEdgeIds.has(e.id);
        
        // P2.3.2: Visibility threshold disabled for now
        // TODO: Enable when highlightedPath matching is fixed
        // const hidden = VISIBILITY_CONFIG.ENABLE_VISIBILITY_THRESHOLD 
        //   ? (!isHighlighted && weight < VISIBILITY_CONFIG.MIN_EDGE_WEIGHT)
        //   : false;
        
        return {
          ...e,
          weight,
          confidence: ce?.confidence || 0.5,
          direction, // P2.2: Add direction for color mapping
          // hidden removed - not working correctly
        };
      }),
      // P2.3.2: Add corridor collapse mode
      corridors: (calibrated.corridors || []).map((c: any) => ({
        ...c,
        renderMode: VISIBILITY_CONFIG.CORRIDOR_DEFAULT_MODE,
        // highlightedPath edges in corridor = always expanded
        expanded: (c.edgeIds || []).some((id: string) => highlightedPathEdgeIds.has(id)),
      })),
      calibrationMeta: {
        ...calibrated.calibrationMeta,
        version: CALIBRATION_VERSION, // P2.3.1: Track version for cache invalidation
      },
    };
  }
}

// Singleton
export const graphBuilder = new GraphBuilder();
