/**
 * Linea Chain Adapter (P2.3.1.D)
 * 
 * ZK Rollup network adapter for Linea
 */

import { EVMBaseAdapter } from './base/evm_base.adapter.js';
import type { ChainConfig, AdapterOptions } from './base/types.js';

const LINEA_CONFIG: ChainConfig = {
  name: 'LINEA',
  chainId: 59144,
  rpcUrls: [
    'https://linea-mainnet.infura.io/v3/29976df4bb4a44b09105a34cdf31d11d',
    'https://rpc.linea.build',
    'https://linea.blockpi.network/v1/rpc/public'
  ],
  nativeToken: {
    symbol: 'ETH',
    decimals: 18
  },
  explorer: 'https://lineascan.build'
};

export class LineaAdapter extends EVMBaseAdapter {
  constructor(options: AdapterOptions = {}) {
    super(LINEA_CONFIG, options);
  }
}

export const lineaAdapter = new LineaAdapter();
