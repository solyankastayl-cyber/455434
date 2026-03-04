/**
 * P2.2 Phase 1: Confidence Calibrator Service (ORCHESTRATOR)
 * 
 * THE POINT OF TRUTH for P2.2
 * 
 * Orchestrates full calibration pipeline:
 * RawGraph → EdgeWeightResolver → NodeWeightResolver → Normalizer → CalibratedGraphSnapshot
 * 
 * This is the ONLY place where a fully calibrated graph is assembled.
 */

import {
  RawGraphSnapshot,
  CalibratedGraphSnapshot,
  CalibrationConfig,
  DEFAULT_CALIBRATION_CONFIG,
  CalibrationError,
} from './types.js';

import { resolveEdgeWeightsBatch } from './edge_weight_resolver.js';
import { resolveNodeWeights } from './node_weight_resolver.js';
import {
  normalizeEdgeWeights,
  normalizeNodeWeights,
} from './confidence_normalizer.js';
import { aggregateCorridors, Corridor } from './corridor_aggregator.js';

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calibrate a raw graph snapshot
 * 
 * LOCKED PIPELINE (cannot be changed after P2.2):
 * 1. Edge weight resolution (baseFlowWeight × confidence factors)
 * 2. Node weight resolution (sum of calibrated edges × type multiplier)
 * 3. Quantile normalization (preserves hierarchy)
 * 
 * @param rawGraph - Uncalibrated graph
 * @param config - Calibration configuration
 * @returns Fully calibrated graph snapshot
 */
export function calibrateGraph(
  rawGraph: RawGraphSnapshot,
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG
): CalibratedGraphSnapshot {
  try {
    // Step 1: Edge Calibration
    const calibratedEdges = resolveEdgeWeightsBatch(
      rawGraph.edges,
      config
    );
    
    // Step 2: Node Calibration (uses calibrated edges)
    const calibratedNodes = resolveNodeWeights(
      rawGraph.nodes,
      calibratedEdges,
      config
    );
    
    // Step 3: Normalization (quantile)
    const normalizedEdges = normalizeEdgeWeights(calibratedEdges, config);
    const normalizedNodes = normalizeNodeWeights(calibratedNodes, config);
    
    // Step 4: Corridor Aggregation
    // Collect highlightedPath edge IDs (these should NEVER be aggregated)
    const preserveEdgeIds: string[] = [];
    if (rawGraph.metadata?.highlightedPath?.edges) {
      for (const edge of rawGraph.metadata.highlightedPath.edges) {
        if (edge.id) {
          preserveEdgeIds.push(edge.id);
        }
      }
    }
    
    // Aggregate corridors
    const corridors = aggregateCorridors(
      normalizedEdges,
      normalizedNodes,
      {
        preserveEdgeIds,
        minWeight: 0.01, // Only aggregate non-dust edges
        enabled: true,
      }
    );
    
    // Step 5: Calculate statistics
    const stats = calculateStatistics(normalizedEdges, normalizedNodes);
    
    // Step 6: Assemble snapshot
    return {
      nodes: normalizedNodes,
      edges: normalizedEdges,
      corridors, // Now populated!
      calibrationMeta: {
        timestamp: Date.now(),
        version: 'P2.2-Phase2',
        parameters: {
          normalizationStrategy: config.normalizationStrategy,
          weightRange: config.weightRange,
          confidenceThreshold: config.minConfidenceThreshold,
          nodeTypeMultipliers: config.nodeTypeMultipliers,
        },
        stats: {
          ...stats,
          corridorCount: corridors.length,
          hasCorridors: corridors.length > 0,
        },
      },
    };
  } catch (error) {
    throw new CalibrationError(
      `Graph calibration failed: ${error.message}`,
      'CALIBRATION_FAILED',
      { rawGraph, error }
    );
  }
}

/**
 * Calculate statistics for calibrated graph
 * 
 * Used for validation and debugging
 */
function calculateStatistics(
  edges: any[],
  nodes: any[]
): any {
  if (edges.length === 0) {
    return {
      totalEdges: 0,
      totalNodes: nodes.length,
      avgEdgeWeight: 0,
      avgConfidence: 0,
      topPercentileWeight: 0,
    };
  }
  
  const edgeWeights = edges.map(e => e.weight);
  const edgeConfidences = edges.map(e => e.confidence);
  
  // Calculate averages
  const avgEdgeWeight = edgeWeights.reduce((a, b) => a + b, 0) / edges.length;
  const avgConfidence = edgeConfidences.reduce((a, b) => a + b, 0) / edges.length;
  
  // Top 5% weight
  const sortedWeights = [...edgeWeights].sort((a, b) => b - a);
  const top5pct = Math.ceil(edges.length * 0.05);
  const topPercentileWeight = sortedWeights[top5pct - 1] || sortedWeights[0];
  
  return {
    totalEdges: edges.length,
    totalNodes: nodes.length,
    avgEdgeWeight: Number(avgEdgeWeight.toFixed(4)),
    avgConfidence: Number(avgConfidence.toFixed(4)),
    topPercentileWeight: Number(topPercentileWeight.toFixed(4)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate raw graph before calibration
 * 
 * @param rawGraph - Raw graph to validate
 * @returns True if valid, throws otherwise
 */
export function validateRawGraph(rawGraph: RawGraphSnapshot): boolean {
  if (!rawGraph) {
    throw new CalibrationError(
      'Raw graph is null or undefined',
      'INVALID_RAW_GRAPH'
    );
  }
  
  if (!Array.isArray(rawGraph.nodes)) {
    throw new CalibrationError(
      'Raw graph nodes must be an array',
      'INVALID_RAW_GRAPH'
    );
  }
  
  if (!Array.isArray(rawGraph.edges)) {
    throw new CalibrationError(
      'Raw graph edges must be an array',
      'INVALID_RAW_GRAPH'
    );
  }
  
  // Check for duplicate node IDs
  const nodeIds = new Set(rawGraph.nodes.map(n => n.id));
  if (nodeIds.size !== rawGraph.nodes.length) {
    throw new CalibrationError(
      'Raw graph contains duplicate node IDs',
      'INVALID_RAW_GRAPH'
    );
  }
  
  return true;
}

/**
 * Get calibration summary for debugging
 * 
 * @param snapshot - Calibrated graph snapshot
 * @returns Human-readable summary
 */
export function getCalibrationSummary(
  snapshot: CalibratedGraphSnapshot
): string {
  const meta = snapshot.calibrationMeta;
  const stats = meta.stats || {};
  
  return `
Calibration Summary:
  Version: ${meta.version}
  Timestamp: ${new Date(meta.timestamp).toISOString()}
  
  Graph:
    ├─ Nodes: ${stats.totalNodes || 0}
    └─ Edges: ${stats.totalEdges || 0}
  
  Statistics:
    ├─ Avg Edge Weight: ${stats.avgEdgeWeight || 0}
    ├─ Avg Confidence: ${stats.avgConfidence || 0}
    └─ Top 5% Weight: ${stats.topPercentileWeight || 0}
  
  Configuration:
    ├─ Normalization: ${meta.parameters.normalizationStrategy}
    ├─ Weight Range: [${meta.parameters.weightRange.min}, ${meta.parameters.weightRange.max}]
    └─ Min Confidence: ${meta.parameters.confidenceThreshold || 0}
  `.trim();
}
