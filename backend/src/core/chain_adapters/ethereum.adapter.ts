/**
 * Ethereum Chain Adapter (P2.3.1.B)
 * 
 * Tier-1 network adapter for Ethereum mainnet
 */

import { EVMBaseAdapter } from './base/evm_base.adapter.js';
import type { ChainConfig, AdapterOptions } from './base/types.js';

// Ethereum configuration
const ETHEREUM_CONFIG: ChainConfig = {
  name: 'ETH',
  chainId: 1,
  rpcUrls: [
    process.env.INFURA_RPC_URL || 'https://mainnet.infura.io/v3/29976df4bb4a44b09105a34cdf31d11d',
    process.env.ANKR_RPC_URL || 'https://rpc.ankr.com/eth/e8803c7f516e167328877fd3138643dfb8d0a4560675995639108457bd3c7441',
    'https://eth.public-rpc.com',
    'https://ethereum.publicnode.com'
  ],
  nativeToken: {
    symbol: 'ETH',
    decimals: 18
  },
  explorer: 'https://etherscan.io'
};

/**
 * Ethereum Adapter
 */
export class EthereumAdapter extends EVMBaseAdapter {
  constructor(options: AdapterOptions = {}) {
    super(ETHEREUM_CONFIG, options);
  }
}

// Export singleton instance
export const ethereumAdapter = new EthereumAdapter();
