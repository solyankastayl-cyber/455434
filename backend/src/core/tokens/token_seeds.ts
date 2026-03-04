/**
 * Token Seeds (P0 - Known Ground Truth)
 * 
 * Confirmed EVM tokens with verified addresses.
 * These are NOT mocks - they are known contracts.
 */

export interface TokenSeed {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chain: string;
  type: 'stable' | 'native' | 'wrapped' | 'erc20';
  verified: boolean;
  logoUrl?: string;
}

/**
 * Confirmed token seeds - known ground truth
 * Same reliability as Binance entity addresses
 */
export const TOKEN_SEEDS: TokenSeed[] = [
  // Stablecoins
  {
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    chain: 'ethereum',
    type: 'stable',
    verified: true,
  },
  {
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    chain: 'ethereum',
    type: 'stable',
    verified: true,
  },
  {
    address: '0x6b175474e89094c44da98b954eedeac495271d0f',
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18,
    chain: 'ethereum',
    type: 'stable',
    verified: true,
  },
  // Native & Wrapped
  {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    chain: 'ethereum',
    type: 'native',
    verified: true,
  },
  {
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    chain: 'ethereum',
    type: 'wrapped',
    verified: true,
  },
  {
    address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    decimals: 8,
    chain: 'ethereum',
    type: 'wrapped',
    verified: true,
  },
  // DeFi tokens
  {
    address: '0x514910771af9ca656af840dff83e8264ecf986ca',
    symbol: 'LINK',
    name: 'Chainlink',
    decimals: 18,
    chain: 'ethereum',
    type: 'erc20',
    verified: true,
  },
  {
    address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
    symbol: 'UNI',
    name: 'Uniswap',
    decimals: 18,
    chain: 'ethereum',
    type: 'erc20',
    verified: true,
  },
  {
    address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    symbol: 'AAVE',
    name: 'Aave',
    decimals: 18,
    chain: 'ethereum',
    type: 'erc20',
    verified: true,
  },
];

/**
 * Get token seed by address
 */
export function getTokenSeedByAddress(address: string): TokenSeed | null {
  const normalized = address.toLowerCase();
  return TOKEN_SEEDS.find(t => t.address.toLowerCase() === normalized) || null;
}

/**
 * Get token seed by symbol
 */
export function getTokenSeedBySymbol(symbol: string): TokenSeed | null {
  const normalized = symbol.toUpperCase();
  return TOKEN_SEEDS.find(t => t.symbol === normalized) || null;
}

/**
 * Check if address is a known token
 */
export function isKnownToken(address: string): boolean {
  return getTokenSeedByAddress(address) !== null;
}

/**
 * Get all token seeds
 */
export function getAllTokenSeeds(): TokenSeed[] {
  return TOKEN_SEEDS;
}
