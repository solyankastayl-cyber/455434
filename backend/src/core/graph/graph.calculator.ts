/**
 * EPIC C1 v2: Graph Edge Calculator
 * 
 * Calculates individual edge weights and composite score.
 * 
 * Philosophy: Structure only, no predictions.
 * Formula: W = 0.40*flow + 0.30*temporal + 0.20*token + 0.10*coverage
 */

import {
  FlowCorrelationEdge,
  TokenOverlapEdge,
  TemporalSyncEdge,
  DirectInteractionEdge,
  GraphEdge,
  EdgeType,
  EdgeConfidence,
  SourceLevel,
  EDGE_WEIGHT_COEFFICIENTS,
  SOURCE_TRUST_FACTOR,
} from './graph.types.js';

// ============================================
// FLOW CORRELATION WEIGHT
// ============================================

/**
 * Calculate flow correlation weight
 * W_flow = log(sharedVolumeUsd + 1) × overlapRatio × sourceTrustFactor
 */
export function calculateFlowCorrelationWeight(
  edge: FlowCorrelationEdge,
  sourceTrust: number
): number {
  if (!edge.sharedVolumeUsd || edge.sharedVolumeUsd <= 0) return 0;
  
  // Log-scaled volume (normalized to 0-1 range, assuming $10M max)
  const volumeFactor = Math.min(1, Math.log10(edge.sharedVolumeUsd + 1) / 7);
  
  // Overlap ratio already 0-1
  const overlap = Math.min(1, Math.max(0, edge.overlapRatio));
  
  return volumeFactor * overlap * sourceTrust;
}

// ============================================
// TOKEN OVERLAP WEIGHT
// ============================================

/**
 * Calculate token overlap weight
 * W_token = jaccardIndex × sqrt(sharedTokenCount)
 */
export function calculateTokenOverlapWeight(edge: TokenOverlapEdge): number {
  if (!edge.sharedTokens || edge.sharedTokens.length === 0) return 0;
  
  const jaccard = Math.min(1, Math.max(0, edge.jaccardIndex));
  const tokenBonus = Math.min(1, Math.sqrt(edge.sharedTokens.length) / 5); // Normalized, max 25 tokens
  
  return jaccard * tokenBonus;
}

// ============================================
// TEMPORAL SYNC WEIGHT
// ============================================

/**
 * Calculate temporal sync weight
 * W_temporal = syncScore (directly from temporal analysis)
 */
export function calculateTemporalSyncWeight(edge: TemporalSyncEdge): number {
  return Math.min(1, Math.max(0, edge.syncScore));
}

// ============================================
// DIRECT INTERACTION WEIGHT
// ============================================

/**
 * Calculate direct interaction weight
 * W_direct = log(txCount + 1) × volumeFactor
 */
export function calculateDirectInteractionWeight(edge: DirectInteractionEdge): number {
  if (!edge.txCount || edge.txCount <= 0) return 0;
  
  // Transaction count factor
  const txFactor = Math.min(1, Math.log10(edge.txCount + 1) / 3); // Normalized, max ~1000 tx
  
  // Volume factor
  const volumeFactor = edge.volumeUsd > 0 
    ? Math.min(1, Math.log10(edge.volumeUsd + 1) / 7) 
    : 0;
  
  return (txFactor + volumeFactor) / 2;
}

// ============================================
// COMPOSITE EDGE WEIGHT
// ============================================

export interface EdgeEvidenceCalc {
  flowCorrelation?: FlowCorrelationEdge;
  tokenOverlap?: TokenOverlapEdge;
  temporalSync?: TemporalSyncEdge;
  directTransfer?: DirectInteractionEdge;
}

/**
 * Calculate composite edge weight from all evidence types
 * 
 * EDGE_WEIGHT = 0.40×W_flow + 0.30×W_temporal + 0.20×W_token + 0.10×coverage
 * Final = EDGE_WEIGHT × trustFactor
 */
export function calculateCompositeEdgeWeight(
  evidence: EdgeEvidenceCalc,
  fromSourceLevel: SourceLevel,
  toSourceLevel: SourceLevel,
  coverageFactor: number = 0.5
): { weight: number; edgeType: EdgeType; trustFactor: number; confidence: EdgeConfidence } {
  
  // Calculate trust factor (minimum of both actors)
  const trustFactor = Math.min(
    SOURCE_TRUST_FACTOR[fromSourceLevel] || 0.4,
    SOURCE_TRUST_FACTOR[toSourceLevel] || 0.4
  );
  
  // Calculate individual weights
  const flowWeight = evidence.flowCorrelation 
    ? calculateFlowCorrelationWeight(evidence.flowCorrelation, trustFactor)
    : 0;
  const tokenWeight = evidence.tokenOverlap 
    ? calculateTokenOverlapWeight(evidence.tokenOverlap)
    : 0;
  const temporalWeight = evidence.temporalSync 
    ? calculateTemporalSyncWeight(evidence.temporalSync)
    : 0.5; // Placeholder if no temporal data
  
  // Composite weight using new formula
  const compositeWeight = 
    EDGE_WEIGHT_COEFFICIENTS.flowCorrelation * flowWeight +
    EDGE_WEIGHT_COEFFICIENTS.temporalSync * temporalWeight +
    EDGE_WEIGHT_COEFFICIENTS.tokenOverlap * tokenWeight +
    EDGE_WEIGHT_COEFFICIENTS.coverageFactor * coverageFactor;
  
  // Apply trust penalty
  const finalWeight = compositeWeight * trustFactor;
  
  // Determine primary edge type (highest contributing weight)
  let edgeType: EdgeType = 'FLOW_CORRELATION';
  let maxContribution = flowWeight * EDGE_WEIGHT_COEFFICIENTS.flowCorrelation;
  
  if (temporalWeight * EDGE_WEIGHT_COEFFICIENTS.temporalSync > maxContribution) {
    edgeType = 'TEMPORAL_SYNC';
    maxContribution = temporalWeight * EDGE_WEIGHT_COEFFICIENTS.temporalSync;
  }
  if (tokenWeight * EDGE_WEIGHT_COEFFICIENTS.tokenOverlap > maxContribution) {
    edgeType = 'TOKEN_OVERLAP';
    maxContribution = tokenWeight * EDGE_WEIGHT_COEFFICIENTS.tokenOverlap;
  }
  if (evidence.directTransfer) {
    edgeType = 'BRIDGE_ACTIVITY';
  }
  
  // Calculate confidence based on weight, source level, and coverage
  const bothVerified = fromSourceLevel === 'verified' && toSourceLevel === 'verified';
  let confidence: EdgeConfidence = 'low';
  if (bothVerified && finalWeight >= 0.6 && coverageFactor >= 0.5) {
    confidence = 'high';
  } else if (finalWeight >= 0.4 && fromSourceLevel !== 'behavioral' && toSourceLevel !== 'behavioral') {
    confidence = 'medium';
  }
  
  return {
    weight: Math.min(1, Math.max(0, finalWeight)),
    edgeType,
    trustFactor,
    confidence,
  };
}

// ============================================
// EDGE UI HELPERS
// ============================================

export function getEdgeColor(edgeType: EdgeType): string {
  const baseColors: Record<EdgeType, string> = {
    FLOW_CORRELATION: '#10b981',  // Green
    TOKEN_OVERLAP: '#8b5cf6',     // Purple
    TEMPORAL_SYNC: '#f59e0b',     // Amber
    BRIDGE_ACTIVITY: '#3b82f6',   // Blue
    BEHAVIORAL_SIMILARITY: '#6b7280', // Gray
  };
  return baseColors[edgeType] || '#6b7280';
}

export function getEdgeWidth(weight: number): number {
  // 1-8 range based on weight
  return Math.max(1, Math.min(8, 1 + weight * 7));
}

export function getEdgeOpacity(confidence: EdgeConfidence, trustFactor: number): number {
  const confidenceOpacity: Record<EdgeConfidence, number> = {
    high: 0.9,
    medium: 0.7,
    low: 0.5,
  };
  return confidenceOpacity[confidence] * (0.5 + trustFactor * 0.5);
}

// ============================================
// BUILD GRAPH EDGE
// ============================================

export function buildGraphEdgeFromCalc(
  fromActorId: string,
  toActorId: string,
  evidence: EdgeEvidenceCalc,
  fromSourceLevel: SourceLevel,
  toSourceLevel: SourceLevel,
  coverageFactor: number = 0.5
): GraphEdge {
  const { weight, edgeType, trustFactor, confidence } = calculateCompositeEdgeWeight(
    evidence,
    fromSourceLevel,
    toSourceLevel,
    coverageFactor
  );
  
  // Canonical edge ID (sorted)
  const [a, b] = [fromActorId, toActorId].sort();
  const id = `${a}-${b}`;
  
  // Build evidence description
  const evidenceParts: string[] = [];
  if (evidence.flowCorrelation) {
    evidenceParts.push(`Flow overlap: ${(evidence.flowCorrelation.overlapRatio * 100).toFixed(0)}%`);
  }
  if (evidence.tokenOverlap) {
    evidenceParts.push(`${evidence.tokenOverlap.sharedTokens.length} shared tokens`);
  }
  if (evidence.directTransfer) {
    evidenceParts.push(`${evidence.directTransfer.txCount} direct txs`);
  }
  
  return {
    id,
    from: fromActorId,
    to: toActorId,
    edgeType,
    weight,
    confidence,
    evidence: {
      description: evidenceParts.join(', ') || 'Behavioral similarity',
      metrics: {
        flowOverlapPct: evidence.flowCorrelation?.overlapRatio ? evidence.flowCorrelation.overlapRatio * 100 : undefined,
        tokenOverlapCount: evidence.tokenOverlap?.sharedTokens.length,
        correlationScore: evidence.temporalSync?.syncScore,
      },
    },
    rawEvidence: {
      flowCorrelation: evidence.flowCorrelation,
      tokenOverlap: evidence.tokenOverlap,
      temporalSync: evidence.temporalSync,
      directTransfer: evidence.directTransfer,
    },
    trustFactor,
    ui: {
      color: getEdgeColor(edgeType),
      width: getEdgeWidth(weight),
      opacity: getEdgeOpacity(confidence, trustFactor),
    },
    calculatedAt: new Date(),
  };
}
