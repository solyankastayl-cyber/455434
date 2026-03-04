/**
 * Base Chain Adapter (P2.3.1.B)
 * 
 * Tier-1 network adapter for Base (Coinbase L2)
 */

import { EVMBaseAdapter } from './base/evm_base.adapter.js';
import type { ChainConfig, AdapterOptions } from './base/types.js';

const BASE_CONFIG: ChainConfig = {
  name: 'BASE',
  chainId: 8453,
  rpcUrls: [
    'https://mainnet.base.org',
    'https://rpc.ankr.com/base',
    'https://base.publicnode.com',
    'https://base-mainnet.public.blastapi.io'
  ],
  nativeToken: {
    symbol: 'ETH',
    decimals: 18
  },
  explorer: 'https://basescan.org'
};

export class BaseAdapter extends EVMBaseAdapter {
  constructor(options: AdapterOptions = {}) {
    super(BASE_CONFIG, options);
  }
}

export const baseAdapter = new BaseAdapter();
