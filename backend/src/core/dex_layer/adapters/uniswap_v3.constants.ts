/**
 * Uniswap v3 Constants (P0.4)
 * 
 * Event signatures, factory addresses, and configuration
 * for Uniswap v3 swap event decoding.
 */

// ============================================
// Event Topics
// ============================================

/**
 * Uniswap v3 Swap event signature
 * 
 * event Swap(
 *   address indexed sender,
 *   address indexed recipient,
 *   int256 amount0,
 *   int256 amount1,
 *   uint160 sqrtPriceX96,
 *   uint128 liquidity,
 *   int24 tick
 * )
 */
export const SWAP_EVENT_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';

// ============================================
// Factory Addresses
// ============================================

export const UNISWAP_V3_FACTORY: Record<string, string> = {
  ETH: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  ARB: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  OP: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  BASE: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD'  // Different on Base
};

// ============================================
// Chain IDs
// ============================================

export const CHAIN_IDS: Record<string, number> = {
  ETH: 1,
  ARB: 42161,
  OP: 10,
  BASE: 8453
};

// ============================================
// Fee Tiers
// ============================================

export const FEE_TIERS = {
  LOWEST: 100,    // 0.01%
  LOW: 500,       // 0.05%
  MEDIUM: 3000,   // 0.30%
  HIGH: 10000     // 1.00%
};

// ============================================
// Common Token Addresses (for symbol resolution)
// ============================================

export const KNOWN_TOKENS: Record<string, Record<string, { symbol: string; decimals: number }>> = {
  ETH: {
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', decimals: 18 },
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', decimals: 6 },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', decimals: 6 },
    '0x6b175474e89094c44da98b954eedeac495271d0f': { symbol: 'DAI', decimals: 18 },
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { symbol: 'WBTC', decimals: 8 }
  },
  ARB: {
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': { symbol: 'WETH', decimals: 18 },
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { symbol: 'USDC', decimals: 6 },
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { symbol: 'USDT', decimals: 6 },
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': { symbol: 'DAI', decimals: 18 },
    '0x912ce59144191c1204e64559fe8253a0e49e6548': { symbol: 'ARB', decimals: 18 }
  },
  OP: {
    '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 },
    '0x0b2c639c533813f4aa9d7837caf62653d097ff85': { symbol: 'USDC', decimals: 6 },
    '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': { symbol: 'USDT', decimals: 6 },
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': { symbol: 'DAI', decimals: 18 },
    '0x4200000000000000000000000000000000000042': { symbol: 'OP', decimals: 18 }
  },
  BASE: {
    '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 },
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { symbol: 'DAI', decimals: 18 }
  }
};

// ============================================
// Stablecoins (for USD estimation)
// ============================================

export const STABLECOINS: Record<string, Set<string>> = {
  ETH: new Set([
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
    '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
    '0x6b175474e89094c44da98b954eedeac495271d0f'  // DAI
  ]),
  ARB: new Set([
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1'  // DAI
  ]),
  OP: new Set([
    '0x0b2c639c533813f4aa9d7837caf62653d097ff85', // USDC
    '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', // USDT
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1'  // DAI
  ]),
  BASE: new Set([
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb'  // DAI
  ])
};

// ============================================
// ABI
// ============================================

export const SWAP_EVENT_ABI = {
  anonymous: false,
  inputs: [
    { indexed: true, name: 'sender', type: 'address' },
    { indexed: true, name: 'recipient', type: 'address' },
    { indexed: false, name: 'amount0', type: 'int256' },
    { indexed: false, name: 'amount1', type: 'int256' },
    { indexed: false, name: 'sqrtPriceX96', type: 'uint160' },
    { indexed: false, name: 'liquidity', type: 'uint128' },
    { indexed: false, name: 'tick', type: 'int24' }
  ],
  name: 'Swap',
  type: 'event'
};

// Pool ABI for token0/token1 lookup
export const POOL_ABI = [
  {
    inputs: [],
    name: 'token0',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'fee',
    outputs: [{ type: 'uint24' }],
    stateMutability: 'view',
    type: 'function'
  }
];

// ============================================
// Ingestion Config
// ============================================

export const INGESTION_CONFIG = {
  // Maximum logs per RPC request
  MAX_LOGS_PER_REQUEST: 1000,
  
  // Block range per batch
  BLOCKS_PER_BATCH: 500,
  
  // Retry config
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  
  // Rate limiting
  MIN_DELAY_BETWEEN_REQUESTS_MS: 100
};
