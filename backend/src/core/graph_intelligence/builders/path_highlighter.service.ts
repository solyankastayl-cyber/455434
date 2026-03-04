/**
 * Path Highlighter (P1.7)
 * 
 * Determines which edges to highlight and why.
 * Calculates per-edge risk contribution.
 */

import { 
  GraphEdge, 
  HighlightedStep, 
  HighlightReason,
  RiskSummary
} from '../storage/graph_types.js';
import { nodeResolver } from '../resolvers/node_resolver.service.js';

// ============================================
// Risk Weights by Edge Type
// ============================================

const EDGE_RISK_WEIGHTS: Record<string, number> = {
  'TRANSFER': 0.05,
  'SWAP': 0.15,
  'BRIDGE': 0.25,
  'DEPOSIT': 0.40,
  'WITHDRAW': 0.10,
  'CONTRACT_CALL': 0.05
};

// ============================================
// Path Highlighter Service
// ============================================

export class PathHighlighter {
  
  /**
   * Build highlighted path from edges
   */
  buildHighlightedPath(
    edges: GraphEdge[],
    riskSummary: RiskSummary
  ): HighlightedStep[] {
    if (edges.length === 0) return [];
    
    // Sort edges by timestamp
    const sortedEdges = [...edges].sort((a, b) => a.timestamp - b.timestamp);
    
    // Build highlighted steps
    const steps: HighlightedStep[] = [];
    let order = 0;
    
    for (const edge of sortedEdges) {
      const reason = this.determineReason(edge, order, sortedEdges.length);
      const contribution = this.calculateContribution(edge, riskSummary);
      
      steps.push({
        edgeId: edge.id,
        reason,
        riskContribution: contribution,
        order: order++
      });
    }
    
    // Normalize contributions to sum to 1
    const totalContribution = steps.reduce((sum, s) => sum + s.riskContribution, 0);
    if (totalContribution > 0) {
      for (const step of steps) {
        step.riskContribution = Math.round((step.riskContribution / totalContribution) * 100) / 100;
      }
    }
    
    return steps;
  }
  
  /**
   * Get per-edge risk breakdown
   */
  getEdgeRiskBreakdown(
    edges: GraphEdge[],
    highlightedPath: HighlightedStep[]
  ): Record<string, { reason: string; contribution: number }> {
    const breakdown: Record<string, { reason: string; contribution: number }> = {};
    
    for (const step of highlightedPath) {
      breakdown[step.edgeId] = {
        reason: step.reason,
        contribution: step.riskContribution
      };
    }
    
    return breakdown;
  }
  
  // ============================================
  // Private Helpers
  // ============================================
  
  /**
   * Determine why this edge is highlighted
   */
  private determineReason(
    edge: GraphEdge,
    position: number,
    totalEdges: number
  ): HighlightReason {
    // First edge = origin
    if (position === 0) {
      return 'origin_of_route';
    }
    
    // CEX deposit = exit
    if (edge.type === 'DEPOSIT') {
      // Check if to CEX
      const toAddress = edge.toNodeId.split(':')[2];
      if (toAddress && nodeResolver.isCexAddress(toAddress)) {
        return 'exit_to_cex';
      }
    }
    
    // Bridge = migration
    if (edge.type === 'BRIDGE') {
      return 'cross_chain_migration';
    }
    
    // Swap near end = pre-exit swap
    if (edge.type === 'SWAP' && position >= totalEdges - 2) {
      return 'pre_exit_swap';
    }
    
    // High value transfer
    if (edge.meta?.amountUsd && edge.meta.amountUsd > 100000) {
      return 'high_value_transfer';
    }
    
    // Default based on type
    switch (edge.type) {
      case 'SWAP': return 'pre_exit_swap';
      case 'BRIDGE': return 'cross_chain_migration';
      case 'DEPOSIT': return 'exit_to_cex';
      default: return 'origin_of_route';
    }
  }
  
  /**
   * Calculate risk contribution for edge
   */
  private calculateContribution(
    edge: GraphEdge,
    riskSummary: RiskSummary
  ): number {
    // Base weight by type
    let weight = EDGE_RISK_WEIGHTS[edge.type] || 0.05;
    
    // Amplify if going to CEX
    if (edge.type === 'DEPOSIT') {
      const toAddress = edge.toNodeId.split(':')[2];
      if (toAddress && nodeResolver.isCexAddress(toAddress)) {
        weight *= 1.5;
      }
    }
    
    // Amplify bridge if high exit probability
    if (edge.type === 'BRIDGE' && riskSummary.exitProbability > 0.6) {
      weight *= 1.3;
    }
    
    // Amplify swap before exit
    if (edge.type === 'SWAP' && riskSummary.exitProbability > 0.7) {
      weight *= 1.2;
    }
    
    // Apply market amplifier
    if (riskSummary.marketAmplifier > 1) {
      weight *= riskSummary.marketAmplifier;
    }
    
    return Math.round(weight * 100) / 100;
  }
}

// Singleton
export const pathHighlighter = new PathHighlighter();
