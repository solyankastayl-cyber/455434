/**
 * zkSync Era Chain Adapter (P2.3.1.D)
 * 
 * ZK Rollup network adapter for zkSync Era
 */

import { EVMBaseAdapter } from './base/evm_base.adapter.js';
import type { ChainConfig, AdapterOptions } from './base/types.js';

const ZKSYNC_CONFIG: ChainConfig = {
  name: 'ZKSYNC',
  chainId: 324,
  rpcUrls: [
    'https://mainnet.era.zksync.io',
    'https://zksync.meowrpc.com',
    'https://zksync-era.blockpi.network/v1/rpc/public'
  ],
  nativeToken: {
    symbol: 'ETH',
    decimals: 18
  },
  explorer: 'https://explorer.zksync.io'
};

export class ZkSyncAdapter extends EVMBaseAdapter {
  constructor(options: AdapterOptions = {}) {
    super(ZKSYNC_CONFIG, options);
  }
}

export const zkSyncAdapter = new ZkSyncAdapter();
