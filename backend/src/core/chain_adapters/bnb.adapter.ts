/**
 * BNB Chain Adapter (P2.3.1.C)
 * 
 * Tier-2 network adapter for BNB Smart Chain
 */

import { EVMBaseAdapter } from './base/evm_base.adapter.js';
import type { ChainConfig, AdapterOptions } from './base/types.js';

const BNB_CONFIG: ChainConfig = {
  name: 'BNB',
  chainId: 56,
  rpcUrls: [
    'https://rpc.ankr.com/bsc',
    'https://bsc-dataseed1.binance.org',
    'https://bsc-dataseed2.binance.org',
    'https://bsc.publicnode.com'
  ],
  nativeToken: {
    symbol: 'BNB',
    decimals: 18
  },
  explorer: 'https://bscscan.com'
};

export class BNBAdapter extends EVMBaseAdapter {
  constructor(options: AdapterOptions = {}) {
    super(BNB_CONFIG, options);
  }
}

export const bnbAdapter = new BNBAdapter();
