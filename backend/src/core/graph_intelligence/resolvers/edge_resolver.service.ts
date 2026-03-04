/**
 * Edge Resolver (P1.7)
 * 
 * Resolves route segments to graph edges.
 */

import { GraphEdge, GraphEdgeType, createEdgeId } from '../storage/graph_types.js';
import { nodeResolver } from './node_resolver.service.js';

// ============================================
// Segment Type Mapping
// ============================================

const SEGMENT_TYPE_MAP: Record<string, GraphEdgeType> = {
  'TRANSFER': 'TRANSFER',
  'SWAP': 'SWAP',
  'BRIDGE': 'BRIDGE',
  'CEX_DEPOSIT': 'DEPOSIT',
  'CEX_WITHDRAW': 'WITHDRAW',
  'DEPOSIT': 'DEPOSIT',
  'WITHDRAW': 'WITHDRAW',
  'CONTRACT_CALL': 'CONTRACT_CALL'
};

// ============================================
// Edge Resolver Service
// ============================================

export class EdgeResolver {
  
  /**
   * Resolve route segment to GraphEdge
   */
  resolveSegment(segment: {
    type: string;
    from: string;
    to: string;
    chain: string;
    chainFrom?: string;
    chainTo?: string;
    timestamp?: number;
    txHash?: string;
    amount?: number;
    amountUsd?: number;
    token?: string;
    protocol?: string;
    routeId?: string;
    segmentIndex?: number;
  }): GraphEdge {
    const edgeType = SEGMENT_TYPE_MAP[segment.type.toUpperCase()] || 'TRANSFER';
    
    // Determine node types based on segment type
    const fromType = this.inferNodeType(segment.from, segment.type, 'from');
    const toType = this.inferNodeType(segment.to, segment.type, 'to');
    
    const fromChain = segment.chainFrom || segment.chain;
    const toChain = segment.chainTo || segment.chain;
    
    const fromNodeId = `${fromType.toLowerCase()}:${fromChain.toLowerCase()}:${segment.from.toLowerCase()}`;
    const toNodeId = `${toType.toLowerCase()}:${toChain.toLowerCase()}:${segment.to.toLowerCase()}`;
    
    return {
      id: createEdgeId(edgeType, fromNodeId, toNodeId, segment.txHash),
      type: edgeType,
      fromNodeId,
      toNodeId,
      chain: segment.chain,
      chainFrom: segment.chainFrom,
      chainTo: segment.chainTo,
      timestamp: segment.timestamp || Date.now(),
      txHash: segment.txHash,
      meta: {
        amount: segment.amount,
        amountUsd: segment.amountUsd,
        token: segment.token,
        protocol: segment.protocol,
        routeId: segment.routeId,
        segmentIndex: segment.segmentIndex
      }
    };
  }
  
  /**
   * Resolve DEX swap to GraphEdge
   */
  resolveSwap(swap: {
    sender: string;
    chain: string;
    timestamp?: number;
    txHash?: string;
    tokenIn?: string;
    tokenOut?: string;
    amountIn?: number;
    amountOut?: number;
    protocol?: string;
    routeId?: string;
  }): GraphEdge {
    const fromNodeId = `wallet:${swap.chain.toLowerCase()}:${swap.sender.toLowerCase()}`;
    const toNodeId = `wallet:${swap.chain.toLowerCase()}:${swap.sender.toLowerCase()}`; // Self swap
    
    return {
      id: createEdgeId('SWAP', fromNodeId, toNodeId, swap.txHash),
      type: 'SWAP',
      fromNodeId,
      toNodeId,
      chain: swap.chain,
      timestamp: swap.timestamp || Date.now(),
      txHash: swap.txHash,
      meta: {
        token: swap.tokenIn,
        protocol: swap.protocol,
        routeId: swap.routeId
      }
    };
  }
  
  /**
   * Resolve bridge to GraphEdge
   */
  resolveBridge(bridge: {
    sender: string;
    chainFrom: string;
    chainTo: string;
    timestamp?: number;
    txHash?: string;
    amount?: number;
    token?: string;
    protocol?: string;
    routeId?: string;
  }): GraphEdge {
    const fromNodeId = `wallet:${bridge.chainFrom.toLowerCase()}:${bridge.sender.toLowerCase()}`;
    const toNodeId = `wallet:${bridge.chainTo.toLowerCase()}:${bridge.sender.toLowerCase()}`;
    
    return {
      id: createEdgeId('BRIDGE', fromNodeId, toNodeId, bridge.txHash),
      type: 'BRIDGE',
      fromNodeId,
      toNodeId,
      chain: bridge.chainFrom,
      chainFrom: bridge.chainFrom,
      chainTo: bridge.chainTo,
      timestamp: bridge.timestamp || Date.now(),
      txHash: bridge.txHash,
      meta: {
        amount: bridge.amount,
        token: bridge.token,
        protocol: bridge.protocol,
        routeId: bridge.routeId
      }
    };
  }
  
  /**
   * Resolve CEX deposit to GraphEdge
   */
  resolveCexDeposit(deposit: {
    from: string;
    to: string;
    chain: string;
    timestamp?: number;
    txHash?: string;
    amount?: number;
    token?: string;
    routeId?: string;
  }): GraphEdge {
    const fromNodeId = `wallet:${deposit.chain.toLowerCase()}:${deposit.from.toLowerCase()}`;
    
    // Check if destination is known CEX
    const cexName = nodeResolver.getCexName(deposit.to);
    const toType = cexName ? 'cex' : 'wallet';
    const toNodeId = `${toType}:${deposit.chain.toLowerCase()}:${deposit.to.toLowerCase()}`;
    
    return {
      id: createEdgeId('DEPOSIT', fromNodeId, toNodeId, deposit.txHash),
      type: 'DEPOSIT',
      fromNodeId,
      toNodeId,
      chain: deposit.chain,
      timestamp: deposit.timestamp || Date.now(),
      txHash: deposit.txHash,
      meta: {
        amount: deposit.amount,
        token: deposit.token,
        protocol: cexName || undefined,
        routeId: deposit.routeId
      }
    };
  }
  
  // ============================================
  // Private Helpers
  // ============================================
  
  private inferNodeType(
    address: string, 
    segmentType: string, 
    position: 'from' | 'to'
  ): string {
    // ALWAYS check known addresses first (P2.2 fix)
    if (nodeResolver.isCexAddress(address)) {
      return 'CEX';
    }
    
    // Check for DEX/Bridge in known addresses
    if (nodeResolver.isDexAddress?.(address)) {
      return 'DEX';
    }
    
    if (nodeResolver.isBridgeAddress?.(address)) {
      return 'BRIDGE';
    }
    
    // Fallback to segment type hints
    if (segmentType === 'CEX_DEPOSIT' && position === 'to') {
      return 'CEX';
    }
    if (segmentType === 'CEX_WITHDRAW' && position === 'from') {
      return 'CEX';
    }
    if (segmentType === 'BRIDGE') {
      return 'BRIDGE';
    }
    if (segmentType === 'SWAP') {
      return 'DEX';
    }
    
    // Default to wallet
    return 'WALLET';
  }
}

// Singleton
export const edgeResolver = new EdgeResolver();
