/**
 * Cross-chain Exit Detector - ETAP B2
 * 
 * Detects when an address exits the current network.
 * Does NOT continue the graph into another network.
 * 
 * PRINCIPLE:
 * - Cross-chain = exit event (terminal node)
 * - NOT a continuation of the graph
 * - UX handles network switch separately
 */

import type { NetworkType } from '../../common/network.types.js';
import type { CrossChainExit } from './cross_chain.types.js';
import { getBridgeByAddress, getBridgesFromNetwork } from './bridge_registry.js';

/**
 * Transaction input for detection
 */
export interface TransactionInput {
  hash?: string;
  from: string;
  to: string;
  network: NetworkType;
  timestamp?: number;
  amount?: number;
}

/**
 * Detect if a transaction is a cross-chain exit
 * 
 * @param tx - Transaction to check
 * @returns CrossChainExit if detected, null otherwise
 */
export function detectCrossChainExit(tx: TransactionInput): CrossChainExit | null {
  if (!tx.to) return null;
  
  const bridge = getBridgeByAddress(tx.to, tx.network);
  
  if (!bridge) return null;
  
  return {
    fromNetwork: bridge.from,
    toNetwork: bridge.to,
    via: bridge.type,
    protocol: bridge.protocol,
    txHash: tx.hash || '',
    address: tx.from.toLowerCase(),
    bridgeAddress: bridge.address,
    timestamp: tx.timestamp,
    amount: tx.amount,
  };
}

/**
 * Detect exits from a batch of transactions
 * 
 * @param transactions - Transactions to check
 * @param network - Current network context
 * @returns Array of detected exits
 */
export function detectExitsFromTransactions(
  transactions: TransactionInput[],
  network: NetworkType
): CrossChainExit[] {
  const exits: CrossChainExit[] = [];
  
  for (const tx of transactions) {
    // Ensure transaction is from the current network
    if (tx.network !== network) continue;
    
    const exit = detectCrossChainExit(tx);
    if (exit) {
      exits.push(exit);
    }
  }
  
  return exits;
}

/**
 * Check if a "to" address is a bridge (for edge detection)
 * 
 * @param toAddress - Destination address
 * @param network - Current network
 * @returns Bridge info if found
 */
export function checkIfBridgeDestination(
  toAddress: string,
  network: NetworkType
): { isBridge: true; toNetwork: NetworkType; protocol: string } | { isBridge: false } {
  const bridge = getBridgeByAddress(toAddress, network);
  
  if (!bridge) {
    return { isBridge: false };
  }
  
  return {
    isBridge: true,
    toNetwork: bridge.to,
    protocol: bridge.protocol,
  };
}

/**
 * Create exit node ID (deterministic)
 */
export function createExitNodeId(toNetwork: NetworkType): string {
  return `exit:${toNetwork}`;
}

/**
 * Create exit edge ID (deterministic)
 */
export function createExitEdgeId(fromAddress: string, toNetwork: NetworkType): string {
  return `exit-edge:${fromAddress.slice(0, 10)}:${toNetwork}`;
}
