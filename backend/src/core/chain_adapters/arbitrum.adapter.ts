/**
 * Arbitrum Chain Adapter (P2.3.1.B)
 * 
 * Tier-1 network adapter for Arbitrum One
 */

import { EVMBaseAdapter } from './base/evm_base.adapter.js';
import type { ChainConfig, AdapterOptions } from './base/types.js';

const ARBITRUM_CONFIG: ChainConfig = {
  name: 'ARB',
  chainId: 42161,
  rpcUrls: [
    process.env.ARBITRUM_RPC_URL || 'https://arbitrum-mainnet.infura.io/v3/29976df4bb4a44b09105a34cdf31d11d',
    'https://rpc.ankr.com/arbitrum',
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum.publicnode.com'
  ],
  nativeToken: {
    symbol: 'ETH',
    decimals: 18
  },
  explorer: 'https://arbiscan.io'
};

export class ArbitrumAdapter extends EVMBaseAdapter {
  constructor(options: AdapterOptions = {}) {
    super(ARBITRUM_CONFIG, options);
  }
}

export const arbitrumAdapter = new ArbitrumAdapter();
