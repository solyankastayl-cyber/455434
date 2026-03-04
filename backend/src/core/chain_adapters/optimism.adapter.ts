/**
 * Optimism Chain Adapter (P2.3.1.B)
 * 
 * Tier-1 network adapter for Optimism
 */

import { EVMBaseAdapter } from './base/evm_base.adapter.js';
import type { ChainConfig, AdapterOptions } from './base/types.js';

const OPTIMISM_CONFIG: ChainConfig = {
  name: 'OP',
  chainId: 10,
  rpcUrls: [
    'https://optimism-mainnet.infura.io/v3/29976df4bb4a44b09105a34cdf31d11d',
    'https://rpc.ankr.com/optimism',
    'https://mainnet.optimism.io',
    'https://optimism.publicnode.com'
  ],
  nativeToken: {
    symbol: 'ETH',
    decimals: 18
  },
  explorer: 'https://optimistic.etherscan.io'
};

export class OptimismAdapter extends EVMBaseAdapter {
  constructor(options: AdapterOptions = {}) {
    super(OPTIMISM_CONFIG, options);
  }
}

export const optimismAdapter = new OptimismAdapter();
