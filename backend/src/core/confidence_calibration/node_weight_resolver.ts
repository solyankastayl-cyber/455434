/**
 * P2.2 Phase 1: Node Weight Resolver
 * 
 * Node weight is derived ONLY from calibrated edges (post edge_weight_resolver).
 * This ensures: no UI hacks, no manual scaling.
 *
 * Core idea:
 * - baseActivity = sum(inWeights) + sum(outWeights)
 * - nodeWeight   = baseActivity × typeMultiplier
 * - sizeWeight   = log1p(nodeWeight)  (stable for whales)
 * - confidence   = weighted avg of incident edge confidences (weights = edge.weight)
 */

import {
  RawNodeSignal,
  CalibratedEdge,
  CalibratedNode,
  NodeWeightCalculation,
  CalibrationConfig,
  DEFAULT_CALIBRATION_CONFIG,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// CORE LOGIC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate node weight from calibrated edges
 * 
 * Formula:
 * nodeWeight = (Σ incomingWeights + Σ outgoingWeights) × typeMultiplier
 * 
 * Where typeMultiplier:
 * - CEX: 1.5 (structurally important)
 * - DEX: 1.2 (significant)
 * - Bridge: 1.1 (notable)
 * - Wallet: 1.0 (base case)
 */
function calculateNodeWeight(
  nodeId: string,
  nodeType: string,
  incomingEdges: CalibratedEdge[],
  outgoingEdges: CalibratedEdge[],
  config: CalibrationConfig
): NodeWeightCalculation {
  // Sum incoming edge weights
  const incomingWeight = incomingEdges.reduce((sum, e) => sum + e.weight, 0);
  
  // Sum outgoing edge weights
  const outgoingWeight = outgoingEdges.reduce((sum, e) => sum + e.weight, 0);
  
  // Get type multiplier
  const typeMultiplier = config.nodeTypeMultipliers[nodeType] || 1.0;
  
  // Calculate raw weight
  const rawWeight = (incomingWeight + outgoingWeight) * typeMultiplier;
  
  // Calculate average confidence (weighted by edge weight)
  const totalEdgeWeight = incomingWeight + outgoingWeight;
  let avgConfidence = 0;
  
  if (totalEdgeWeight > 0) {
    const weightedConfidenceSum = 
      [...incomingEdges, ...outgoingEdges].reduce(
        (sum, e) => sum + (e.confidence * e.weight),
        0
      );
    avgConfidence = weightedConfidenceSum / totalEdgeWeight;
  }
  
  return {
    nodeId,
    incomingWeight,
    outgoingWeight,
    typeMultiplier,
    rawWeight,
    avgConfidence,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve node weights from raw nodes and calibrated edges
 * 
 * @param rawNodes - Raw node signals
 * @param calibratedEdges - CALIBRATED edges (after edge_weight_resolver)
 * @param config - Calibration configuration
 * @returns Array of calibrated nodes
 */
export function resolveNodeWeights(
  rawNodes: RawNodeSignal[],
  calibratedEdges: CalibratedEdge[],
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG
): CalibratedNode[] {
  // Build adjacency maps
  const incomingByNode = new Map<string, CalibratedEdge[]>();
  const outgoingByNode = new Map<string, CalibratedEdge[]>();
  
  // Initialize maps
  for (const node of rawNodes) {
    incomingByNode.set(node.id, []);
    outgoingByNode.set(node.id, []);
  }
  
  // Populate maps
  for (const edge of calibratedEdges) {
    const incoming = incomingByNode.get(edge.to) || [];
    incoming.push(edge);
    incomingByNode.set(edge.to, incoming);
    
    const outgoing = outgoingByNode.get(edge.from) || [];
    outgoing.push(edge);
    outgoingByNode.set(edge.from, outgoing);
  }
  
  // Calculate weights for all nodes
  const calibratedNodes: CalibratedNode[] = [];
  
  for (const rawNode of rawNodes) {
    const incoming = incomingByNode.get(rawNode.id) || [];
    const outgoing = outgoingByNode.get(rawNode.id) || [];
    
    const calc = calculateNodeWeight(
      rawNode.id,
      rawNode.type,
      incoming,
      outgoing,
      config
    );
    
    // sizeWeight is a stable visual proxy using log1p
    const sizeWeight = Math.log1p(calc.rawWeight);
    
    calibratedNodes.push({
      id: rawNode.id,
      type: rawNode.type,
      label: rawNode.label,
      sizeWeight,
      confidence: calc.avgConfidence,
      roleScore: 1.0, // TODO: Implement role clarity scoring
      metadata: {
        totalVolumeUsd: rawNode.totalIncomingVolumeUsd + rawNode.totalOutgoingVolumeUsd,
        connectionCount: rawNode.connectionCount,
      },
    });
  }
  
  return calibratedNodes;
}

/**
 * Get node weight breakdown for debugging
 */
export function getNodeWeightBreakdown(
  nodeId: string,
  rawNodes: RawNodeSignal[],
  calibratedEdges: CalibratedEdge[],
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG
): string {
  const node = rawNodes.find(n => n.id === nodeId);
  if (!node) return `Node ${nodeId} not found`;
  
  const incoming = calibratedEdges.filter(e => e.to === nodeId);
  const outgoing = calibratedEdges.filter(e => e.from === nodeId);
  
  const calc = calculateNodeWeight(nodeId, node.type, incoming, outgoing, config);
  
  return `
Node Weight Breakdown:
  Node ID: ${nodeId}
  Type: ${node.type}
  
  Incoming:
    ├─ Edge Count: ${incoming.length}
    └─ Total Weight: ${calc.incomingWeight.toFixed(4)}
  
  Outgoing:
    ├─ Edge Count: ${outgoing.length}
    └─ Total Weight: ${calc.outgoingWeight.toFixed(4)}
  
  Type Multiplier: ${calc.typeMultiplier}x
  Raw Node Weight: ${calc.rawWeight.toFixed(4)}
  Size Weight (log1p): ${Math.log1p(calc.rawWeight).toFixed(4)}
  Avg Confidence: ${calc.avgConfidence.toFixed(3)}
  `.trim();
}
