/**
 * Graph State Calculator
 * 
 * Calculates node and edge states for semantic visualization
 * H3: Graph Semantics & States
 */

export type NodeState = 'NEUTRAL' | 'ACCUMULATION' | 'DISTRIBUTION' | 'ROUTER';
export type EdgeState = 'NORMAL' | 'PRESSURE' | 'DOMINANT';

export interface NodeMetrics {
  inflowUsd: number;
  outflowUsd: number;
  netFlowUsd: number;
  txCount: number;
  uniqueCounterparties: number;
}

export interface EdgeMetrics {
  volumeUsd: number;
  confidence: number;
  shareOfNodeFlow?: number;
}

/**
 * Calculate node state based on flow metrics
 */
export function calculateNodeState(metrics: NodeMetrics): NodeState {
  const { inflowUsd, outflowUsd, netFlowUsd, txCount, uniqueCounterparties } = metrics;

  // ROUTER: high throughput, balanced flow
  const totalFlow = inflowUsd + outflowUsd;
  const flowBalance = Math.abs(netFlowUsd) / Math.max(totalFlow, 1);
  
  if (txCount >= 50 && flowBalance < 0.15) {
    return 'ROUTER';
  }

  // ACCUMULATION: more inflow than outflow
  if (inflowUsd > outflowUsd * 1.3 && netFlowUsd > 10000) {
    return 'ACCUMULATION';
  }

  // DISTRIBUTION: more outflow than inflow
  if (outflowUsd > inflowUsd * 1.3 && uniqueCounterparties >= 5) {
    return 'DISTRIBUTION';
  }

  return 'NEUTRAL';
}

/**
 * Calculate edge state based on volume and confidence
 */
export function calculateEdgeState(
  metrics: EdgeMetrics,
  nodeMetrics?: NodeMetrics
): EdgeState {
  const { volumeUsd, confidence, shareOfNodeFlow } = metrics;

  // DOMINANT: represents majority of node's flow
  if (shareOfNodeFlow && shareOfNodeFlow > 0.6) {
    return 'DOMINANT';
  }

  // PRESSURE: high volume or high confidence
  if (volumeUsd > 100000 || confidence > 0.8) {
    return 'PRESSURE';
  }

  return 'NORMAL';
}

/**
 * Calculate percentile for edge pressure detection
 */
export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}
