/**
 * Network Types - ETAP B1
 * 
 * First-class network parameter for all graph operations.
 * Network scopes ALL data: relations, transfers, actors, tokens.
 */

// ============================================
// Supported Networks
// ============================================

export const SUPPORTED_NETWORKS = [
  'ethereum',
  'arbitrum', 
  'optimism',
  'base',
  'polygon',
  'bnb',
  'zksync',
  'scroll',
] as const;

export type NetworkType = typeof SUPPORTED_NETWORKS[number];

// ============================================
// Network Config
// ============================================

export interface NetworkConfig {
  id: NetworkType;
  chainId: number;
  name: string;
  shortName: string;
  rpcUrl?: string;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

export const NETWORK_CONFIGS: Record<NetworkType, NetworkConfig> = {
  ethereum: {
    id: 'ethereum',
    chainId: 1,
    name: 'Ethereum Mainnet',
    shortName: 'ETH',
    explorerUrl: 'https://etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  arbitrum: {
    id: 'arbitrum',
    chainId: 42161,
    name: 'Arbitrum One',
    shortName: 'ARB',
    explorerUrl: 'https://arbiscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  optimism: {
    id: 'optimism',
    chainId: 10,
    name: 'Optimism',
    shortName: 'OP',
    explorerUrl: 'https://optimistic.etherscan.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  base: {
    id: 'base',
    chainId: 8453,
    name: 'Base',
    shortName: 'BASE',
    explorerUrl: 'https://basescan.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  polygon: {
    id: 'polygon',
    chainId: 137,
    name: 'Polygon',
    shortName: 'MATIC',
    explorerUrl: 'https://polygonscan.com',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
  },
  bnb: {
    id: 'bnb',
    chainId: 56,
    name: 'BNB Chain',
    shortName: 'BNB',
    explorerUrl: 'https://bscscan.com',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  },
  zksync: {
    id: 'zksync',
    chainId: 324,
    name: 'zkSync Era',
    shortName: 'zkSync',
    explorerUrl: 'https://explorer.zksync.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  scroll: {
    id: 'scroll',
    chainId: 534352,
    name: 'Scroll',
    shortName: 'Scroll',
    explorerUrl: 'https://scrollscan.com',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
};

// ============================================
// Helpers
// ============================================

/**
 * Validate network parameter
 */
export function isValidNetwork(network: string): network is NetworkType {
  return SUPPORTED_NETWORKS.includes(network as NetworkType);
}

/**
 * Get network config or throw
 */
export function getNetworkConfig(network: NetworkType): NetworkConfig {
  const config = NETWORK_CONFIGS[network];
  if (!config) {
    throw new Error(`Unknown network: ${network}`);
  }
  return config;
}

/**
 * Normalize chain name to NetworkType
 * Handles legacy names like 'eth', 'arb', etc.
 * 
 * ВАЖНО: Не делаем default fallback! Если сеть неизвестна — бросаем ошибку.
 */
export function normalizeNetwork(chain: string): NetworkType {
  const lower = chain.toLowerCase();
  
  // Direct match
  if (isValidNetwork(lower)) {
    return lower;
  }
  
  // Legacy aliases
  const aliases: Record<string, NetworkType> = {
    'eth': 'ethereum',
    'mainnet': 'ethereum',
    'arb': 'arbitrum',
    'arbitrum-one': 'arbitrum',
    'op': 'optimism',
    'optimism-mainnet': 'optimism',
    'matic': 'polygon',
    'poly': 'polygon',
    'bsc': 'bnb',
    'binance': 'bnb',
  };
  
  if (aliases[lower]) {
    return aliases[lower];
  }
  
  // NO DEFAULT! Бросаем ошибку
  throw new Error(`NETWORK_INVALID: Unknown network "${chain}". Supported: ${SUPPORTED_NETWORKS.join(', ')}`);
}

/**
 * Get chain aliases for database queries
 * Returns all possible names for a network
 */
export function getNetworkAliases(network: NetworkType): string[] {
  const aliases: Record<NetworkType, string[]> = {
    ethereum: ['ethereum', 'eth', 'mainnet', '1'],
    arbitrum: ['arbitrum', 'arb', 'arbitrum-one', '42161'],
    optimism: ['optimism', 'op', 'optimism-mainnet', '10'],
    base: ['base', '8453'],
    polygon: ['polygon', 'matic', 'poly', '137'],
    bnb: ['bnb', 'bsc', 'binance', '56'],
    zksync: ['zksync', 'zksync-era', '324'],
    scroll: ['scroll', '534352'],
  };
  
  return aliases[network] || [network];
}
