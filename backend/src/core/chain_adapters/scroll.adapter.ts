/**
 * Scroll Chain Adapter (P2.3.1.D)
 * 
 * ZK Rollup network adapter for Scroll
 */

import { EVMBaseAdapter } from './base/evm_base.adapter.js';
import type { ChainConfig, AdapterOptions } from './base/types.js';

const SCROLL_CONFIG: ChainConfig = {
  name: 'SCROLL',
  chainId: 534352,
  rpcUrls: [
    'https://rpc.scroll.io',
    'https://rpc.ankr.com/scroll',
    'https://scroll.blockpi.network/v1/rpc/public'
  ],
  nativeToken: {
    symbol: 'ETH',
    decimals: 18
  },
  explorer: 'https://scrollscan.com'
};

export class ScrollAdapter extends EVMBaseAdapter {
  constructor(options: AdapterOptions = {}) {
    super(SCROLL_CONFIG, options);
  }
}

export const scrollAdapter = new ScrollAdapter();
