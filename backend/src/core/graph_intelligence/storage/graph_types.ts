/**
 * Graph Types (P1.7)
 * 
 * Core types for graph intelligence layer.
 * Defines nodes, edges, and path highlighting.
 */

// ============================================
// Node Types
// ============================================

export type GraphNodeType = 
  | 'WALLET' 
  | 'TOKEN' 
  | 'BRIDGE' 
  | 'DEX' 
  | 'CEX' 
  | 'CONTRACT'
  | 'CROSS_CHAIN_EXIT';  // ETAP B2: Terminal exit node

export interface GraphNode {
  id: string;                    // Deterministic: type:chain:address
  type: GraphNodeType;
  address: string;
  chain: string;
  displayName?: string;
  label?: string;                // ETAP B2: For exit nodes
  labels?: string[];
  metadata?: {
    protocol?: string;
    isKnown?: boolean;
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
    [key: string]: any;
  };
  meta?: {                       // ETAP B2: For exit nodes
    targetNetwork?: string;
    protocol?: string;
    via?: string;
  };
}

// ============================================
// Edge Types
// ============================================

export type GraphEdgeType = 
  | 'TRANSFER' 
  | 'SWAP' 
  | 'BRIDGE' 
  | 'DEPOSIT' 
  | 'WITHDRAW' 
  | 'CONTRACT_CALL'
  | 'EXIT';  // ETAP B2: Cross-chain exit edge

export interface GraphEdge {
  id: string;                    // Deterministic: type:from:to:txHash
  type: GraphEdgeType;
  fromNodeId: string;
  toNodeId: string;
  
  chain: string;
  chainFrom?: string;            // For BRIDGE
  chainTo?: string;              // For BRIDGE
  direction?: 'IN' | 'OUT';      // ETAP B2: Direction for exits
  
  timestamp?: number;
  txHash?: string;
  
  meta?: {
    amount?: number;
    amountUsd?: number;
    token?: string;
    protocol?: string;
    confidence?: number;
    routeId?: string;
    segmentIndex?: number;
    targetNetwork?: string;      // ETAP B2: For exit edges
  };
}

// ============================================
// Highlighted Path
// ============================================

export type HighlightReason = 
  | 'origin_of_route'
  | 'cross_chain_migration'
  | 'pre_exit_swap'
  | 'exit_to_cex'
  | 'mixing_pattern'
  | 'high_value_transfer'
  | 'suspicious_timing'
  | 'known_risk_address';

export interface HighlightedStep {
  edgeId: string;
  reason: HighlightReason;
  riskContribution: number;      // 0..1
  order: number;
}

// ============================================
// Risk Summary
// ============================================

export interface RiskSummary {
  // From P0.5
  exitProbability: number;
  dumpRiskScore: number;
  pathEntropy: number;
  
  // From P1.6
  contextualRiskScore: number;
  marketAmplifier: number;
  confidenceImpact: number;
  contextTags: string[];
  
  // Market regime
  marketRegime?: 'STABLE' | 'VOLATILE' | 'STRESSED';
}

// ============================================
// Explain Block
// ============================================

export type ExplainSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ExplainReason {
  code: string;
  title: string;
  description: string;
  severity: ExplainSeverity;
  evidence?: string[];
}

export interface ExplainAmplifier {
  tag: string;
  multiplier: number;
  source: 'MARKET' | 'ROUTE' | 'ACTOR';
}

export interface ExplainBlock {
  reasons: ExplainReason[];
  amplifiers: ExplainAmplifier[];
  suppressors: ExplainAmplifier[];
}

// ============================================
// Graph Snapshot (full response)
// ============================================

export interface GraphSnapshot {
  snapshotId: string;
  kind: 'ADDRESS' | 'ROUTE';
  address?: string;
  routeId?: string;
  
  nodes: GraphNode[];
  edges: GraphEdge[];
  highlightedPath: HighlightedStep[];
  
  riskSummary: RiskSummary;
  explain: ExplainBlock;
  
  // STABILIZATION: truncation flag
  truncated?: boolean;  // True if graph was truncated due to limits
  
  generatedAt: number;
  expiresAt: number;
  buildTimeMs: number;
}

// ============================================
// Build Options
// ============================================

import type { NetworkType } from '../../../common/network.types.js';

export interface GraphBuildOptions {
  network?: NetworkType;         // ETAP B1: Required network scope
  maxRoutes?: number;            // Default 3
  maxEdges?: number;             // Default 250
  timeWindowHours?: number;      // Default 24
  includeTokens?: boolean;       // Default false
  chains?: string[];             // Filter chains (deprecated, use network)
}

// ============================================
// Utility Functions
// ============================================

export function createNodeId(type: GraphNodeType, chain: string, address: string): string {
  return `${type.toLowerCase()}:${chain.toLowerCase()}:${address.toLowerCase()}`;
}

export function createEdgeId(
  type: GraphEdgeType, 
  fromNodeId: string, 
  toNodeId: string, 
  txHash?: string
): string {
  const base = `${type.toLowerCase()}:${fromNodeId}:${toNodeId}`;
  return txHash ? `${base}:${txHash.slice(0, 10)}` : base;
}

export function parseNodeId(nodeId: string): { type: string; chain: string; address: string } | null {
  const parts = nodeId.split(':');
  if (parts.length !== 3) return null;
  return { type: parts[0], chain: parts[1], address: parts[2] };
}
