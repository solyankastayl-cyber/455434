/**
 * Avalanche Chain Adapter (P2.3.1.C)
 * 
 * Tier-2 network adapter for Avalanche C-Chain
 */

import { EVMBaseAdapter } from './base/evm_base.adapter.js';
import type { ChainConfig, AdapterOptions } from './base/types.js';

const AVALANCHE_CONFIG: ChainConfig = {
  name: 'AVAX',
  chainId: 43114,
  rpcUrls: [
    'https://avalanche-mainnet.infura.io/v3/29976df4bb4a44b09105a34cdf31d11d',
    'https://rpc.ankr.com/avalanche',
    'https://api.avax.network/ext/bc/C/rpc',
    'https://avalanche.publicnode.com'
  ],
  nativeToken: {
    symbol: 'AVAX',
    decimals: 18
  },
  explorer: 'https://snowtrace.io'
};

export class AvalancheAdapter extends EVMBaseAdapter {
  constructor(options: AdapterOptions = {}) {
    super(AVALANCHE_CONFIG, options);
  }
}

export const avalancheAdapter = new AvalancheAdapter();
