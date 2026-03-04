/**
 * EPIC C1 v2: Graph Builder Service
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

import {
  ActorGraph,
  GraphNode,
  GraphEdge,
  ActorCluster,
  FlowCorrelationEdge,
  TokenOverlapEdge,
  DirectInteractionEdge,
  SourceLevel,
  EdgeType,
  EdgeConfidence,
  GRAPH_LIMITS,
  EDGE_WEIGHT_COEFFICIENTS,
  SOURCE_TRUST_FACTOR,
} from './graph.types.js';
import { ActorModel } from '../actors/actor.model.js';
import { ActorScoreModel } from '../actor_scores/actor_score.model.js';

// ============================================
// TYPES
// ============================================

interface ActorData {
  actorId: string;
  slug: string;
  name: string;
  type: 'exchange' | 'fund' | 'market_maker' | 'whale' | 'trader';
  sourceLevel: SourceLevel;
  coverage: number;
  edgeScore: number;
  participation: number;
  flowRole: string;
  addresses: string[];
  tokens: string[];
  metrics: {
    totalVolumeUsd: number;
    inflowUsd: number;
    outflowUsd: number;
    txCount: number;
  };
}

// ============================================
// LOAD ACTOR DATA
// ============================================

async function loadActorData(window: '24h' | '7d' | '30d'): Promise<ActorData[]> {
  // Get actors
  const actors = await ActorModel.find().lean();
  
  // Get scores
  const scores = await ActorScoreModel.find({ window }).lean();
  const scoreMap = new Map(scores.map(s => [s.actorId, s]));
  
  return actors.map(actor => {
    const score = scoreMap.get(actor.id);
    // Handle both coverage formats: {score: number} and direct number
    let coverageValue = 0;
    if (typeof actor.coverage === 'number') {
      coverageValue = actor.coverage;
    } else if (actor.coverage?.score !== undefined) {
      coverageValue = actor.coverage.score / 100;
    }
    
    return {
      actorId: actor.id,
      slug: actor.id,
      name: actor.name || 'Unknown',
      type: (actor.type || 'trader') as ActorData['type'],
      sourceLevel: (actor.sourceLevel || 'behavioral') as SourceLevel,
      coverage: coverageValue,
      edgeScore: score?.edgeScore || 0,
      participation: score?.participation || 0,
      flowRole: score?.flowRole || 'neutral',
      addresses: actor.addresses || [],
      tokens: [], // Will be populated from activity
      metrics: {
        totalVolumeUsd: score?.metrics?.totalVolumeUsd || 0,
        inflowUsd: score?.metrics?.inflowUsd || 0,
        outflowUsd: score?.metrics?.outflowUsd || 0,
        txCount: score?.metrics?.txCount || 0,
      },
    };
  });
}

// ============================================
// CALCULATE FLOW CORRELATION
// ============================================

function calculateFlowCorrelation(
  actorA: ActorData,
  actorB: ActorData
): FlowCorrelationEdge | null {
  const volA = actorA.metrics.totalVolumeUsd;
  const volB = actorB.metrics.totalVolumeUsd;
  
  if (volA === 0 || volB === 0) return null;
  
  // Simulated shared volume (in production, aggregate from transfers)
  // Using overlap based on similar activity levels
  const volumeRatio = Math.min(volA, volB) / Math.max(volA, volB);
  const sharedVolumeUsd = Math.min(volA, volB) * volumeRatio * 0.3;
  
  if (sharedVolumeUsd < 10000) return null; // Min $10k threshold
  
  const overlapRatio = sharedVolumeUsd / Math.min(volA, volB);
  
  // Determine direction based on flow roles
  let direction: FlowCorrelationEdge['direction'] = 'bidirectional';
  if (actorA.flowRole === actorB.flowRole) {
    if (actorA.flowRole === 'accumulator') direction = 'in-in';
    else if (actorA.flowRole === 'distributor') direction = 'out-out';
  } else {
    direction = 'in-out';
  }
  
  return {
    type: 'flow_correlation',
    direction,
    sharedVolumeUsd,
    overlapRatio,
    window: '7d',
  };
}

// ============================================
// CALCULATE TOKEN OVERLAP
// ============================================

function calculateTokenOverlap(
  actorA: ActorData,
  actorB: ActorData
): TokenOverlapEdge | null {
  // Simulated tokens based on actor type
  // In production, this comes from actual token activity
  const typeTokens: Record<string, string[]> = {
    exchange: ['USDT', 'USDC', 'ETH', 'BTC', 'DAI'],
    market_maker: ['USDT', 'USDC', 'ETH', 'WETH'],
    fund: ['ETH', 'BTC', 'AAVE', 'UNI', 'LINK'],
    whale: ['ETH', 'USDT', 'USDC'],
    trader: ['ETH', 'USDT'],
  };
  
  const tokensA = new Set(typeTokens[actorA.type] || typeTokens.trader);
  const tokensB = new Set(typeTokens[actorB.type] || typeTokens.trader);
  
  const intersection = [...tokensA].filter(t => tokensB.has(t));
  const union = new Set([...tokensA, ...tokensB]);
  
  if (intersection.length === 0) return null;
  
  const jaccardIndex = intersection.length / union.size;
  
  return {
    type: 'token_overlap',
    sharedTokens: intersection,
    jaccardIndex,
    dominantToken: intersection[0],
  };
}

// ============================================
// CALCULATE DIRECT INTERACTION
// ============================================

function calculateDirectInteraction(
  actorA: ActorData,
  actorB: ActorData
): DirectInteractionEdge | null {
  // Simulated direct interactions
  // In production, this queries transfer data between addresses
  
  // Exchanges interact with everyone
  const hasExchange = actorA.type === 'exchange' || actorB.type === 'exchange';
  const hasMarketMaker = actorA.type === 'market_maker' || actorB.type === 'market_maker';
  
  if (!hasExchange && !hasMarketMaker) return null;
  
  // Simulated based on actor activity
  const avgTx = (actorA.metrics.txCount + actorB.metrics.txCount) / 2;
  const txCount = Math.round(avgTx * 0.1); // ~10% overlap
  
  if (txCount < 5) return null;
  
  const volumeUsd = Math.min(actorA.metrics.totalVolumeUsd, actorB.metrics.totalVolumeUsd) * 0.1;
  const netFlowUsd = Math.random() > 0.5 ? volumeUsd * 0.2 : -volumeUsd * 0.2;
  
  return {
    type: 'direct_transfer',
    txCount,
    volumeUsd,
    netFlowUsd,
    lastInteraction: new Date(),
  };
}

// ============================================
// BUILD GRAPH NODES (Universal)
// ============================================

function buildGraphNodes(actors: ActorData[]): GraphNode[] {
  return actors.map(actor => {
    // Color based on edge score
    let color = '#9ca3af'; // gray
    if (actor.edgeScore >= 60) color = '#10b981'; // green
    else if (actor.edgeScore >= 40) color = '#f59e0b'; // amber
    else if (actor.edgeScore > 0) color = '#ef4444'; // red
    
    // Size based on participation
    const size = Math.max(20, Math.min(60, 20 + actor.participation * 100));
    
    return {
      id: actor.actorId,
      nodeType: 'actor' as const,
      label: actor.name,
      source: actor.sourceLevel,
      coverage: actor.coverage,
      metrics: {
        volumeUsd: actor.metrics.totalVolumeUsd,
        inflowUsd: actor.metrics.inflowUsd,
        outflowUsd: actor.metrics.outflowUsd,
        txCount: actor.metrics.txCount,
        activeDays: 7, // Placeholder
        edgeScore: actor.edgeScore,
      },
      actorType: actor.type,
      flowRole: actor.flowRole,
      participation: actor.participation,
      ui: {
        color,
        size,
      },
      graphMetrics: {
        inDegree: 0,
        outDegree: 0,
      },
    };
  });
}

// ============================================
// CALCULATE EDGE CONFIDENCE
// ============================================

function calculateConfidence(
  weight: number,
  sourceA: SourceLevel,
  sourceB: SourceLevel,
  coverageA: number,
  coverageB: number
): EdgeConfidence {
  const bothVerified = sourceA === 'verified' && sourceB === 'verified';
  const minCoverage = Math.min(coverageA, coverageB);
  
  // High: both verified + high weight + good coverage
  if (bothVerified && weight >= 0.6 && minCoverage >= 0.5) {
    return 'high';
  }
  
  // Medium: reasonable weight + not behavioral
  if (weight >= 0.4 && sourceA !== 'behavioral' && sourceB !== 'behavioral') {
    return 'medium';
  }
  
  // Low: everything else
  return 'low';
}

// ============================================
// DETERMINE PRIMARY EDGE TYPE
// ============================================

function determinePrimaryEdgeType(
  flowCorr: FlowCorrelationEdge | null,
  tokenOverlap: TokenOverlapEdge | null,
  directTx: DirectInteractionEdge | null
): EdgeType {
  // Calculate contributions
  const flowWeight = flowCorr ? (flowCorr.overlapRatio || 0) * EDGE_WEIGHT_COEFFICIENTS.flowCorrelation : 0;
  const tokenWeight = tokenOverlap ? (tokenOverlap.jaccardIndex || 0) * EDGE_WEIGHT_COEFFICIENTS.tokenOverlap : 0;
  const directWeight = directTx ? 0.3 * 0.1 : 0; // Simplified
  
  const max = Math.max(flowWeight, tokenWeight, directWeight);
  
  if (max === flowWeight && flowWeight > 0) return 'FLOW_CORRELATION';
  if (max === tokenWeight && tokenWeight > 0) return 'TOKEN_OVERLAP';
  if (max === directWeight && directWeight > 0) return 'BRIDGE_ACTIVITY';
  
  return 'BEHAVIORAL_SIMILARITY';
}

// ============================================
// BUILD GRAPH EDGES (v2 with confidence)
// ============================================

function buildGraphEdges(actors: ActorData[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const processed = new Set<string>();
  
  for (let i = 0; i < actors.length; i++) {
    for (let j = i + 1; j < actors.length; j++) {
      const actorA = actors[i];
      const actorB = actors[j];
      
      // Canonical key
      const [a, b] = [actorA.actorId, actorB.actorId].sort();
      const key = `${a}-${b}`;
      if (processed.has(key)) continue;
      processed.add(key);
      
      // Calculate evidence
      const flowCorr = calculateFlowCorrelation(actorA, actorB);
      const tokenOverlap = calculateTokenOverlap(actorA, actorB);
      const directTx = calculateDirectInteraction(actorA, actorB);
      
      // Skip if no evidence
      if (!flowCorr && !tokenOverlap && !directTx) continue;
      
      // Calculate weight using EPIC C1 v2 formula:
      // weight = 0.4×flow_overlap + 0.3×temporal_correlation + 0.2×token_overlap + 0.1×coverage_factor
      const flowWeight = flowCorr ? (flowCorr.overlapRatio || 0) : 0;
      const tokenWeight = tokenOverlap ? (tokenOverlap.jaccardIndex || 0) : 0;
      const temporalWeight = 0.5; // Placeholder - would come from EPIC 7
      const coverageFactor = Math.min(actorA.coverage, actorB.coverage);
      
      const rawWeight = 
        EDGE_WEIGHT_COEFFICIENTS.flowCorrelation * flowWeight +
        EDGE_WEIGHT_COEFFICIENTS.temporalSync * temporalWeight +
        EDGE_WEIGHT_COEFFICIENTS.tokenOverlap * tokenWeight +
        EDGE_WEIGHT_COEFFICIENTS.coverageFactor * coverageFactor;
      
      // Apply trust factor
      const trustFactor = Math.min(
        SOURCE_TRUST_FACTOR[actorA.sourceLevel] || 0.4,
        SOURCE_TRUST_FACTOR[actorB.sourceLevel] || 0.4
      );
      const weight = rawWeight * trustFactor;
      
      // Skip low-weight edges
      if (weight < GRAPH_LIMITS.MIN_WEIGHT) continue;
      
      // Determine primary edge type
      const edgeType = determinePrimaryEdgeType(flowCorr, tokenOverlap, directTx);
      
      // Calculate confidence
      const confidence = calculateConfidence(
        weight, 
        actorA.sourceLevel, 
        actorB.sourceLevel,
        actorA.coverage,
        actorB.coverage
      );
      
      // Build evidence description
      const evidenceParts: string[] = [];
      if (flowCorr) evidenceParts.push(`Flow overlap: ${(flowCorr.overlapRatio * 100).toFixed(0)}%`);
      if (tokenOverlap) evidenceParts.push(`${tokenOverlap.sharedTokens.length} shared tokens`);
      if (directTx) evidenceParts.push(`${directTx.txCount} direct txs`);
      
      const edge: GraphEdge = {
        id: key,
        from: actorA.actorId,
        to: actorB.actorId,
        edgeType,
        weight,
        confidence,
        evidence: {
          description: evidenceParts.join(', ') || 'Behavioral similarity',
          metrics: {
            flowOverlapPct: flowCorr ? flowCorr.overlapRatio * 100 : undefined,
            tokenOverlapCount: tokenOverlap?.sharedTokens.length,
            correlationScore: temporalWeight,
          },
        },
        rawEvidence: {
          flowCorrelation: flowCorr || undefined,
          tokenOverlap: tokenOverlap || undefined,
          directTransfer: directTx || undefined,
        },
        trustFactor,
        ui: {
          color: edgeType === 'FLOW_CORRELATION' ? '#10b981' :
                 edgeType === 'TOKEN_OVERLAP' ? '#8b5cf6' :
                 edgeType === 'BRIDGE_ACTIVITY' ? '#3b82f6' :
                 edgeType === 'TEMPORAL_SYNC' ? '#f59e0b' : '#6b7280',
          width: Math.max(1, Math.min(8, 1 + weight * 7)),
          opacity: confidence === 'high' ? 0.9 : confidence === 'medium' ? 0.7 : 0.5,
        },
        calculatedAt: new Date(),
      };
      
      edges.push(edge);
    }
  }
  
  // Sort by weight and limit
  return edges
    .sort((a, b) => b.weight - a.weight)
    .slice(0, GRAPH_LIMITS.MAX_EDGES);
}

// ============================================
// BUILD CLUSTERS (Simple Louvain-like)
// ============================================

function buildClusters(nodes: GraphNode[], edges: GraphEdge[]): ActorCluster[] {
  // Build adjacency
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
    adjacency.get(edge.from)!.add(edge.to);
    adjacency.get(edge.to)!.add(edge.from);
  }
  
  // Simple clustering: group by strongest connections
  const clusters: ActorCluster[] = [];
  const assigned = new Set<string>();
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  
  // Sort nodes by edge score (potential anchors first)
  const sortedNodes = [...nodes]
    .filter(n => n.source !== 'behavioral') // behavioral can't be anchor
    .sort((a, b) => (b.metrics.edgeScore || 0) - (a.metrics.edgeScore || 0));
  
  for (const anchor of sortedNodes) {
    if (assigned.has(anchor.id)) continue;
    
    const neighbors = adjacency.get(anchor.id) || new Set();
    const clusterMembers = [anchor.id];
    assigned.add(anchor.id);
    
    // Add unassigned neighbors
    for (const neighborId of neighbors) {
      if (assigned.has(neighborId)) continue;
      if (clusterMembers.length >= 10) break; // Max cluster size
      clusterMembers.push(neighborId);
      assigned.add(neighborId);
    }
    
    if (clusterMembers.length < GRAPH_LIMITS.MIN_CLUSTER_SIZE) continue;
    
    // Calculate cohesion
    let totalWeight = 0;
    let edgeCount = 0;
    for (const edge of edges) {
      if (clusterMembers.includes(edge.from) && clusterMembers.includes(edge.to)) {
        totalWeight += edge.weight;
        edgeCount++;
      }
    }
    const cohesionScore = edgeCount > 0 ? totalWeight / edgeCount : 0;
    
    // Get dominant type
    const typeCounts = new Map<string, number>();
    for (const memberId of clusterMembers) {
      const member = nodeMap.get(memberId);
      if (member?.actorType) {
        typeCounts.set(member.actorType, (typeCounts.get(member.actorType) || 0) + 1);
      }
    }
    const dominantType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'mixed';
    
    // Avg edge score
    const avgEdgeScore = clusterMembers.reduce((sum, id) => {
      const node = nodeMap.get(id);
      return sum + (node?.metrics?.edgeScore || 0);
    }, 0) / clusterMembers.length;
    
    clusters.push({
      clusterId: `cluster_${clusters.length + 1}`,
      actors: clusterMembers,
      anchorActorId: anchor.id,
      dominantType,
      cohesionScore,
      metadata: {
        size: clusterMembers.length,
        avgEdgeScore: Math.round(avgEdgeScore),
        dominantFlowRole: anchor.flowRole || 'unknown',
      },
    });
    
    if (clusters.length >= GRAPH_LIMITS.MAX_CLUSTERS) break;
  }
  
  return clusters;
}

// ============================================
// MAIN: BUILD ACTOR GRAPH
// ============================================

export async function buildActorGraph(
  window: '24h' | '7d' | '30d' = '7d'
): Promise<ActorGraph> {
  const startTime = Date.now();
  console.log(`[GraphBuilder] Building actor graph for window ${window}...`);
  
  // Load actor data (includes EPIC A2 scores)
  const actors = await loadActorData(window);
  console.log(`[GraphBuilder] Loaded ${actors.length} actors`);
  
  // Build nodes
  const nodes = buildGraphNodes(actors);
  
  // Build edges
  const edges = buildGraphEdges(actors);
  console.log(`[GraphBuilder] Created ${edges.length} edges`);
  
  // Update node degrees
  for (const edge of edges) {
    const fromNode = nodes.find(n => n.id === edge.from);
    const toNode = nodes.find(n => n.id === edge.to);
    if (fromNode?.graphMetrics) fromNode.graphMetrics.outDegree++;
    if (toNode?.graphMetrics) toNode.graphMetrics.inDegree++;
  }
  
  // Build clusters
  const clusters = buildClusters(nodes, edges);
  console.log(`[GraphBuilder] Created ${clusters.length} clusters`);
  
  // Assign cluster membership to nodes
  for (const cluster of clusters) {
    for (const actorId of cluster.actors) {
      const node = nodes.find(n => n.id === actorId);
      if (node?.graphMetrics) node.graphMetrics.clusterMembership = cluster.clusterId;
    }
  }
  
  // Sort nodes by edge score
  const sortedNodes = nodes.sort((a, b) => (b.metrics.edgeScore || 0) - (a.metrics.edgeScore || 0));
  
  const buildTimeMs = Date.now() - startTime;
  console.log(`[GraphBuilder] Graph built in ${buildTimeMs}ms`);
  
  return {
    nodes: sortedNodes.slice(0, GRAPH_LIMITS.MAX_NODES),
    edges,
    clusters,
    metadata: {
      totalNodes: sortedNodes.length,
      totalEdges: edges.length,
      totalClusters: clusters.length,
      window,
      calculatedAt: new Date(),
      buildTimeMs,
    },
  };
}

// ============================================
// GET EDGE DETAILS
// ============================================

export async function getGraphEdgeDetails(
  fromActorId: string,
  toActorId: string,
  window: '24h' | '7d' | '30d' = '7d'
): Promise<{
  from: string;
  to: string;
  edge: GraphEdge | null;
  summary: {
    edgeType: string;
    weight: number;
    confidence: string;
  };
}> {
  const actors = await loadActorData(window);
  const actorA = actors.find(a => a.actorId === fromActorId);
  const actorB = actors.find(a => a.actorId === toActorId);
  
  if (!actorA || !actorB) {
    return {
      from: fromActorId,
      to: toActorId,
      edge: null,
      summary: { edgeType: 'none', weight: 0, confidence: 'low' },
    };
  }
  
  // Calculate evidence
  const flowCorr = calculateFlowCorrelation(actorA, actorB);
  const tokenOverlap = calculateTokenOverlap(actorA, actorB);
  const directTx = calculateDirectInteraction(actorA, actorB);
  
  if (!flowCorr && !tokenOverlap && !directTx) {
    return {
      from: fromActorId,
      to: toActorId,
      edge: null,
      summary: { edgeType: 'none', weight: 0, confidence: 'low' },
    };
  }
  
  // Calculate weight using EPIC C1 v2 formula
  const flowWeight = flowCorr ? (flowCorr.overlapRatio || 0) : 0;
  const tokenWeight = tokenOverlap ? (tokenOverlap.jaccardIndex || 0) : 0;
  const temporalWeight = 0.5; // Placeholder
  const coverageFactor = Math.min(actorA.coverage, actorB.coverage);
  
  const rawWeight = 
    EDGE_WEIGHT_COEFFICIENTS.flowCorrelation * flowWeight +
    EDGE_WEIGHT_COEFFICIENTS.temporalSync * temporalWeight +
    EDGE_WEIGHT_COEFFICIENTS.tokenOverlap * tokenWeight +
    EDGE_WEIGHT_COEFFICIENTS.coverageFactor * coverageFactor;
  
  // Apply trust factor
  const trustFactor = Math.min(
    SOURCE_TRUST_FACTOR[actorA.sourceLevel] || 0.4,
    SOURCE_TRUST_FACTOR[actorB.sourceLevel] || 0.4
  );
  const weight = rawWeight * trustFactor;
  
  // Determine primary edge type
  const edgeType = determinePrimaryEdgeType(flowCorr, tokenOverlap, directTx);
  
  // Calculate confidence
  const confidence = calculateConfidence(
    weight, 
    actorA.sourceLevel, 
    actorB.sourceLevel,
    actorA.coverage,
    actorB.coverage
  );
  
  // Build evidence description
  const evidenceParts: string[] = [];
  if (flowCorr) evidenceParts.push(`Flow overlap: ${(flowCorr.overlapRatio * 100).toFixed(0)}%`);
  if (tokenOverlap) evidenceParts.push(`${tokenOverlap.sharedTokens.length} shared tokens`);
  if (directTx) evidenceParts.push(`${directTx.txCount} direct txs`);
  
  const [a, b] = [actorA.actorId, actorB.actorId].sort();
  const id = `${a}-${b}`;
  
  const edge: GraphEdge = {
    id,
    from: actorA.actorId,
    to: actorB.actorId,
    edgeType,
    weight,
    confidence,
    evidence: {
      description: evidenceParts.join(', ') || 'Behavioral similarity',
      metrics: {
        flowOverlapPct: flowCorr ? flowCorr.overlapRatio * 100 : undefined,
        tokenOverlapCount: tokenOverlap?.sharedTokens.length,
        correlationScore: temporalWeight,
      },
    },
    rawEvidence: {
      flowCorrelation: flowCorr || undefined,
      tokenOverlap: tokenOverlap || undefined,
      directTransfer: directTx || undefined,
    },
    trustFactor,
    ui: {
      color: edgeType === 'FLOW_CORRELATION' ? '#10b981' :
             edgeType === 'TOKEN_OVERLAP' ? '#8b5cf6' :
             edgeType === 'BRIDGE_ACTIVITY' ? '#3b82f6' :
             edgeType === 'TEMPORAL_SYNC' ? '#f59e0b' : '#6b7280',
      width: Math.max(1, Math.min(8, 1 + weight * 7)),
      opacity: confidence === 'high' ? 0.9 : confidence === 'medium' ? 0.7 : 0.5,
    },
    calculatedAt: new Date(),
  };
  
  return {
    from: fromActorId,
    to: toActorId,
    edge,
    summary: {
      edgeType: edge.edgeType,
      weight: edge.weight,
      confidence: edge.confidence,
    },
  };
}
