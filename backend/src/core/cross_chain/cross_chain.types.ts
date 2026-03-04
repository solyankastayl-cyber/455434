/**
 * Cross-chain Types - ETAP B2
 * 
 * Types for cross-chain exit detection.
 * Exit = event where address leaves current network.
 */

import type { NetworkType } from '../../common/network.types.js';

/**
 * Detected cross-chain exit event
 */
export interface CrossChainExit {
  /** Source network (current graph context) */
  fromNetwork: NetworkType;
  
  /** Target network (where funds went) */
  toNetwork: NetworkType;
  
  /** Bridge type */
  via: 'canonical' | 'third_party';
  
  /** Bridge/protocol name */
  protocol: string;
  
  /** Transaction hash */
  txHash: string;
  
  /** Address that initiated the exit */
  address: string;
  
  /** Bridge contract address */
  bridgeAddress: string;
  
  /** Timestamp of the exit */
  timestamp?: number;
  
  /** Amount (if available) */
  amount?: number;
}

/**
 * Exit node in graph (terminal node)
 */
export interface CrossChainExitNode {
  id: string;
  type: 'CROSS_CHAIN_EXIT';
  label: string;
  targetNetwork: NetworkType;
  meta: {
    bridge: string;
    protocol: string;
    txHash?: string;
    via: 'canonical' | 'third_party';
  };
}

/**
 * Exit edge (wallet → exit node)
 */
export interface CrossChainExitEdge {
  id: string;
  type: 'EXIT';
  fromNodeId: string;
  toNodeId: string;
  meta: {
    txHash?: string;
    amount?: number;
  };
}
