/**
 * Polygon Chain Adapter (P2.3.1.C)
 * 
 * Tier-2 network adapter for Polygon (Matic)
 */

import { EVMBaseAdapter } from './base/evm_base.adapter.js';
import type { ChainConfig, AdapterOptions } from './base/types.js';

const POLYGON_CONFIG: ChainConfig = {
  name: 'POLY',
  chainId: 137,
  rpcUrls: [
    'https://polygon-mainnet.infura.io/v3/29976df4bb4a44b09105a34cdf31d11d',
    'https://rpc.ankr.com/polygon',
    'https://polygon-rpc.com',
    'https://polygon.publicnode.com'
  ],
  nativeToken: {
    symbol: 'MATIC',
    decimals: 18
  },
  explorer: 'https://polygonscan.com'
};

export class PolygonAdapter extends EVMBaseAdapter {
  constructor(options: AdapterOptions = {}) {
    super(POLYGON_CONFIG, options);
  }
}

export const polygonAdapter = new PolygonAdapter();
