/**
 * Bridge Registry - ETAP B2
 * 
 * Source of truth for known bridges.
 * Registry only - no logic here.
 * 
 * IMPORTANT:
 * - Only EVM chains
 * - Canonical bridges prioritized
 * - Third-party bridges added as needed
 */

import type { NetworkType } from '../../common/network.types.js';

/**
 * Bridge information
 */
export interface BridgeInfo {
  /** Source network */
  from: NetworkType;
  
  /** Target network */
  to: NetworkType;
  
  /** Bridge contract address (lowercase) */
  address: string;
  
  /** Bridge type */
  type: 'canonical' | 'third_party';
  
  /** Protocol name */
  protocol: string;
}

/**
 * Known bridges registry
 * 
 * Sources:
 * - Arbitrum: https://developer.arbitrum.io/useful-addresses
 * - Optimism: https://docs.optimism.io/chain/addresses
 * - Base: https://docs.base.org/docs/base-contracts
 * - Polygon: https://docs.polygon.technology/pos/reference/contracts/
 */
export const BRIDGES: BridgeInfo[] = [
  // ============================================
  // Ethereum → Arbitrum (Canonical)
  // ============================================
  {
    from: 'ethereum',
    to: 'arbitrum',
    address: '0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a', // Arbitrum Bridge (Inbox)
    type: 'canonical',
    protocol: 'Arbitrum Bridge',
  },
  {
    from: 'ethereum',
    to: 'arbitrum',
    address: '0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f', // Arbitrum Delayed Inbox
    type: 'canonical',
    protocol: 'Arbitrum Bridge',
  },
  {
    from: 'ethereum',
    to: 'arbitrum',
    address: '0x72ce9c846789fdb6fc1f34ac4ad25dd9ef7031ef', // Arbitrum Gateway Router
    type: 'canonical',
    protocol: 'Arbitrum Bridge',
  },
  
  // ============================================
  // Ethereum → Optimism (Canonical)
  // ============================================
  {
    from: 'ethereum',
    to: 'optimism',
    address: '0xbeb5fc579115071764c7423a4f12edde41f106ed', // Optimism Portal
    type: 'canonical',
    protocol: 'Optimism Bridge',
  },
  {
    from: 'ethereum',
    to: 'optimism',
    address: '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1', // Optimism L1StandardBridge
    type: 'canonical',
    protocol: 'Optimism Bridge',
  },
  
  // ============================================
  // Ethereum → Base (Canonical)
  // ============================================
  {
    from: 'ethereum',
    to: 'base',
    address: '0x49048044d57e1c92a77f79988d21fa8faf74e97e', // Base Portal
    type: 'canonical',
    protocol: 'Base Bridge',
  },
  {
    from: 'ethereum',
    to: 'base',
    address: '0x3154cf16ccdb4c6d922629664174b904d80f2c35', // Base L1StandardBridge
    type: 'canonical',
    protocol: 'Base Bridge',
  },
  
  // ============================================
  // Ethereum → Polygon (Canonical)
  // ============================================
  {
    from: 'ethereum',
    to: 'polygon',
    address: '0xa0c68c638235ee32657e8f720a23cec1bfc77c77', // Polygon Bridge
    type: 'canonical',
    protocol: 'Polygon Bridge',
  },
  {
    from: 'ethereum',
    to: 'polygon',
    address: '0x401f6c983ea34274ec46f84d70b31c151321188b', // Polygon Plasma Bridge
    type: 'canonical',
    protocol: 'Polygon Plasma',
  },
  
  // ============================================
  // Third-party Bridges (Multi-chain)
  // ============================================
  {
    from: 'ethereum',
    to: 'arbitrum',
    address: '0xc30141b657f4216252dc59af2e7cdb9d8792e1b0', // Socket Gateway
    type: 'third_party',
    protocol: 'Socket',
  },
  {
    from: 'ethereum',
    to: 'optimism',
    address: '0xc30141b657f4216252dc59af2e7cdb9d8792e1b0', // Socket Gateway
    type: 'third_party',
    protocol: 'Socket',
  },
  {
    from: 'ethereum',
    to: 'arbitrum',
    address: '0x8731d54e9d02c286767d56ac03e8037c07e01e98', // Stargate Router
    type: 'third_party',
    protocol: 'Stargate',
  },
  {
    from: 'ethereum',
    to: 'optimism',
    address: '0x8731d54e9d02c286767d56ac03e8037c07e01e98', // Stargate Router
    type: 'third_party',
    protocol: 'Stargate',
  },
  {
    from: 'ethereum',
    to: 'polygon',
    address: '0x8731d54e9d02c286767d56ac03e8037c07e01e98', // Stargate Router
    type: 'third_party',
    protocol: 'Stargate',
  },
  {
    from: 'ethereum',
    to: 'base',
    address: '0x8731d54e9d02c286767d56ac03e8037c07e01e98', // Stargate Router
    type: 'third_party',
    protocol: 'Stargate',
  },
  
  // ============================================
  // Across Protocol
  // ============================================
  {
    from: 'ethereum',
    to: 'arbitrum',
    address: '0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5', // Across SpokePool
    type: 'third_party',
    protocol: 'Across',
  },
  {
    from: 'ethereum',
    to: 'optimism',
    address: '0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5', // Across SpokePool
    type: 'third_party',
    protocol: 'Across',
  },
  {
    from: 'ethereum',
    to: 'base',
    address: '0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5', // Across SpokePool
    type: 'third_party',
    protocol: 'Across',
  },
  {
    from: 'ethereum',
    to: 'polygon',
    address: '0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5', // Across SpokePool
    type: 'third_party',
    protocol: 'Across',
  },
];

/**
 * Get bridges from a specific network
 */
export function getBridgesFromNetwork(network: NetworkType): BridgeInfo[] {
  return BRIDGES.filter(b => b.from === network);
}

/**
 * Get bridge by address
 */
export function getBridgeByAddress(address: string, network: NetworkType): BridgeInfo | undefined {
  const addr = address.toLowerCase();
  return BRIDGES.find(b => b.from === network && b.address === addr);
}

/**
 * Check if address is a known bridge
 */
export function isBridgeAddress(address: string, network: NetworkType): boolean {
  return getBridgeByAddress(address, network) !== undefined;
}
