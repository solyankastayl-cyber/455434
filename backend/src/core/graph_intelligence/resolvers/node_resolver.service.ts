/**
 * Node Resolver (P1.7)
 * 
 * Resolves entities to graph nodes with labels and metadata.
 */

import { GraphNode, GraphNodeType, createNodeId } from '../storage/graph_types.js';

// ============================================
// Known Protocols/Addresses
// ============================================

const KNOWN_BRIDGES: Record<string, string> = {
  'stargate': 'Stargate',
  'hop': 'Hop Protocol',
  'across': 'Across',
  'synapse': 'Synapse',
  'multichain': 'Multichain',
  'celer': 'Celer cBridge',
  'wormhole': 'Wormhole'
};

const KNOWN_DEX: Record<string, string> = {
  'uniswap': 'Uniswap',
  'sushiswap': 'SushiSwap',
  'curve': 'Curve',
  'balancer': 'Balancer',
  '1inch': '1inch',
  'paraswap': 'ParaSwap',
  'camelot': 'Camelot'
};

const KNOWN_CEX: Record<string, { name: string; labels: string[] }> = {
  // Binance
  '0x28c6c06298d514db089934071355e5743bf21d60': { name: 'Binance', labels: ['cex', 'hot-wallet'] },
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549': { name: 'Binance', labels: ['cex', 'hot-wallet'] },
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': { name: 'Binance', labels: ['cex', 'hot-wallet'] },
  // Coinbase
  '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': { name: 'Coinbase', labels: ['cex', 'hot-wallet'] },
  '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43': { name: 'Coinbase', labels: ['cex'] },
  // OKX
  '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b': { name: 'OKX', labels: ['cex', 'hot-wallet'] },
  // Kraken
  '0x2910543af39aba0cd09dbb2d50200b3e800a63d2': { name: 'Kraken', labels: ['cex', 'hot-wallet'] },
  // Bybit
  '0xf89d7b9c864f589bbf53a82105107622b35eaa40': { name: 'Bybit', labels: ['cex', 'hot-wallet'] }
};

// ============================================
// Node Resolver Service
// ============================================

export class NodeResolver {
  
  /**
   * Resolve address to GraphNode
   */
  resolveAddress(
    address: string,
    chain: string,
    hints?: {
      type?: GraphNodeType;
      protocol?: string;
      labels?: string[];
    }
  ): GraphNode {
    const addr = address.toLowerCase();
    
    // Check if known CEX
    const cexInfo = KNOWN_CEX[addr];
    if (cexInfo) {
      return {
        id: createNodeId('CEX', chain, addr),
        type: 'CEX',
        address: addr,
        chain,
        displayName: cexInfo.name,
        labels: cexInfo.labels,
        metadata: { isKnown: true, riskLevel: 'HIGH' }
      };
    }
    
    // Use provided type or default to WALLET
    const type = hints?.type || 'WALLET';
    
    // Build labels
    const labels: string[] = hints?.labels || [];
    if (hints?.protocol) {
      // Check bridges
      const bridgeName = KNOWN_BRIDGES[hints.protocol.toLowerCase()];
      if (bridgeName) {
        return {
          id: createNodeId('BRIDGE', chain, addr),
          type: 'BRIDGE',
          address: addr,
          chain,
          displayName: bridgeName,
          labels: ['bridge', hints.protocol.toLowerCase()],
          metadata: { protocol: hints.protocol, isKnown: true }
        };
      }
      
      // Check DEX
      const dexName = KNOWN_DEX[hints.protocol.toLowerCase()];
      if (dexName) {
        return {
          id: createNodeId('DEX', chain, addr),
          type: 'DEX',
          address: addr,
          chain,
          displayName: dexName,
          labels: ['dex', hints.protocol.toLowerCase()],
          metadata: { protocol: hints.protocol, isKnown: true }
        };
      }
    }
    
    // Default wallet
    return {
      id: createNodeId(type, chain, addr),
      type,
      address: addr,
      chain,
      displayName: this.shortenAddress(addr),
      labels,
      metadata: { isKnown: false }
    };
  }
  
  /**
   * Resolve token to GraphNode
   */
  resolveToken(
    address: string,
    chain: string,
    symbol?: string
  ): GraphNode {
    const addr = address.toLowerCase();
    
    return {
      id: createNodeId('TOKEN', chain, addr),
      type: 'TOKEN',
      address: addr,
      chain,
      displayName: symbol || this.shortenAddress(addr),
      labels: ['token'],
      metadata: { symbol }
    };
  }
  
  /**
   * Check if address is known CEX
   */
  isCexAddress(address: string): boolean {
    return !!KNOWN_CEX[address.toLowerCase()];
  }
  
  /**
   * Get CEX name if known
   */
  getCexName(address: string): string | null {
    const info = KNOWN_CEX[address.toLowerCase()];
    return info?.name || null;
  }
  
  // ============================================
  // Private Helpers
  // ============================================
  
  private shortenAddress(address: string): string {
    if (address.length <= 10) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
}

// Singleton
export const nodeResolver = new NodeResolver();
