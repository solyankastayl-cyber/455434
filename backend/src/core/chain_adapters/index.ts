/**
 * Chain Adapters Index (P2.3.1)
 * 
 * Exports all chain adapters
 */

// Base
export * from './base/types.js';
export * from './base/evm_base.adapter.js';

// Tier-1 (Core liquidity)
export * from './ethereum.adapter.js';
export * from './arbitrum.adapter.js';
export * from './optimism.adapter.js';
export * from './base.adapter.js';

// Tier-2 (Mass coverage)
export * from './polygon.adapter.js';
export * from './bnb.adapter.js';
export * from './avalanche.adapter.js';

// L2/ZK
export * from './zksync.adapter.js';
export * from './scroll.adapter.js';
export * from './linea.adapter.js';

// All adapters registry
import { ethereumAdapter } from './ethereum.adapter.js';
import { arbitrumAdapter } from './arbitrum.adapter.js';
import { optimismAdapter } from './optimism.adapter.js';
import { baseAdapter } from './base.adapter.js';
import { polygonAdapter } from './polygon.adapter.js';
import { bnbAdapter } from './bnb.adapter.js';
import { avalancheAdapter } from './avalanche.adapter.js';
import { zkSyncAdapter } from './zksync.adapter.js';
import { scrollAdapter } from './scroll.adapter.js';
import { lineaAdapter } from './linea.adapter.js';

export const ALL_ADAPTERS = [
  ethereumAdapter,
  arbitrumAdapter,
  optimismAdapter,
  baseAdapter,
  polygonAdapter,
  bnbAdapter,
  avalancheAdapter,
  zkSyncAdapter,
  scrollAdapter,
  lineaAdapter
];

export const ADAPTERS_MAP = new Map(
  ALL_ADAPTERS.map(adapter => [adapter.getConfig().name, adapter])
);
