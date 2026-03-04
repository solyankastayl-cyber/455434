/**
 * Token Resolver Service (P2.5)
 * 
 * Resolves token addresses to human-readable symbols
 * 
 * Rules:
 * - LRU cache for performance (5k tokens max)
 * - Resolution at API boundary, NOT per-tx
 * - No inference, no guesses
 * - WBTC ≠ BTC (wrapped tokens are distinct)
 */
import { TokenRegistryModel } from './token_registry.model.js';

// ============ LRU CACHE ============

const MAX_CACHE_SIZE = 5000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  data: TokenInfo;
  timestamp: number;
}

const tokenCache = new Map<string, CacheEntry>();

// Simple LRU eviction
function evictIfNeeded() {
  if (tokenCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest 10%
    const entries = Array.from(tokenCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = Math.floor(MAX_CACHE_SIZE * 0.1);
    for (let i = 0; i < toRemove; i++) {
      tokenCache.delete(entries[i][0]);
    }
  }
}

// ============ TYPES ============

export interface TokenInfo {
  address: string;
  chain: string;
  symbol: string;
  name: string;
  decimals: number;
  verified: boolean;
  source: string;
  logo?: string;
}

// ============ KNOWN TOKENS (SEED DATA) ============

export const KNOWN_TOKENS: TokenInfo[] = [
  // ===== ETHEREUM MAINNET (chainId: 1) =====
  // Stablecoins
  {
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    chain: 'ethereum',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    verified: true,
    source: 'manual',
  },
  {
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    chain: 'ethereum',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    verified: true,
    source: 'manual',
  },
  {
    address: '0x6b175474e89094c44da98b954eedeac495271d0f',
    chain: 'ethereum',
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  {
    address: '0x4fabb145d64652a948d72533023f6e7a623c7c53',
    chain: 'ethereum',
    symbol: 'BUSD',
    name: 'Binance USD',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  {
    address: '0x8e870d67f660d95d5be530380d0ec0bd388289e1',
    chain: 'ethereum',
    symbol: 'USDP',
    name: 'Pax Dollar',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  
  // ===== ARBITRUM (chainId: 42161) =====
  // Multi-chain tokens for disambiguation demo
  {
    address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
    chain: 'arbitrum',
    symbol: 'USDT',
    name: 'Tether USD (Arbitrum)',
    decimals: 6,
    verified: true,
    source: 'manual',
  },
  {
    address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    chain: 'arbitrum',
    symbol: 'USDC',
    name: 'USD Coin (Arbitrum)',
    decimals: 6,
    verified: true,
    source: 'manual',
  },
  {
    address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    chain: 'arbitrum',
    symbol: 'WETH',
    name: 'Wrapped Ether (Arbitrum)',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  {
    address: '0x912ce59144191c1204e64559fe8253a0e49e6548',
    chain: 'arbitrum',
    symbol: 'ARB',
    name: 'Arbitrum',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  
  // Wrapped ETH
  {
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    chain: 'ethereum',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  
  // Wrapped BTC (NOT BTC!)
  {
    address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    chain: 'ethereum',
    symbol: 'WBTC',
    name: 'Wrapped BTC',
    decimals: 8,
    verified: true,
    source: 'manual',
  },
  
  // Major DeFi tokens
  {
    address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
    chain: 'ethereum',
    symbol: 'UNI',
    name: 'Uniswap',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  {
    address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    chain: 'ethereum',
    symbol: 'AAVE',
    name: 'Aave',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  {
    address: '0x514910771af9ca656af840dff83e8264ecf986ca',
    chain: 'ethereum',
    symbol: 'LINK',
    name: 'Chainlink',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  {
    address: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2',
    chain: 'ethereum',
    symbol: 'MKR',
    name: 'Maker',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  {
    address: '0xc00e94cb662c3520282e6f5717214004a7f26888',
    chain: 'ethereum',
    symbol: 'COMP',
    name: 'Compound',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  {
    address: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2',
    chain: 'ethereum',
    symbol: 'SUSHI',
    name: 'SushiSwap',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  {
    address: '0xd533a949740bb3306d119cc777fa900ba034cd52',
    chain: 'ethereum',
    symbol: 'CRV',
    name: 'Curve DAO Token',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  
  // LSDs
  {
    address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
    chain: 'ethereum',
    symbol: 'stETH',
    name: 'Lido Staked Ether',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  {
    address: '0xbe9895146f7af43049ca1c1ae358b0541ea49704',
    chain: 'ethereum',
    symbol: 'cbETH',
    name: 'Coinbase Wrapped Staked ETH',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  {
    address: '0xac3e018457b222d93114458476f3e3416abbe38f',
    chain: 'ethereum',
    symbol: 'sfrxETH',
    name: 'Staked Frax Ether',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  
  // Other major tokens
  {
    address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce',
    chain: 'ethereum',
    symbol: 'SHIB',
    name: 'Shiba Inu',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  {
    address: '0x4d224452801aced8b2f0aebe155379bb5d594381',
    chain: 'ethereum',
    symbol: 'APE',
    name: 'ApeCoin',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
  {
    address: '0x111111111117dc0aa78b770fa6a738034120c302',
    chain: 'ethereum',
    symbol: '1INCH',
    name: '1inch',
    decimals: 18,
    verified: true,
    source: 'manual',
  },
];

// ============ RESOLVER FUNCTIONS ============

/**
 * Resolve a single token address to symbol/name
 */
export async function resolveToken(
  address: string, 
  chain: string = 'ethereum'
): Promise<TokenInfo> {
  const normalizedAddress = address.toLowerCase();
  const cacheKey = `${chain}:${normalizedAddress}`;
  
  // Check cache first
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  
  // Check database
  try {
    const token = await TokenRegistryModel.findOne({ 
      address: normalizedAddress, 
      chain 
    }).lean();
    
    if (token) {
      const info: TokenInfo = {
        address: (token as any).address,
        chain: (token as any).chain,
        symbol: (token as any).symbol,
        name: (token as any).name,
        decimals: (token as any).decimals,
        verified: (token as any).verified,
        source: (token as any).source,
        logo: (token as any).logo,
      };
      
      // Cache it
      evictIfNeeded();
      tokenCache.set(cacheKey, { data: info, timestamp: Date.now() });
      
      return info;
    }
  } catch (err) {
    console.error('[TokenResolver] DB lookup failed:', err);
  }
  
  // Return unknown token (NO GUESSING)
  const unknown: TokenInfo = {
    address: normalizedAddress,
    chain,
    symbol: 'UNKNOWN',
    name: 'Unverified Token',
    decimals: 18,
    verified: false,
    source: 'manual',
  };
  
  // Cache unknown too (to avoid repeated lookups)
  evictIfNeeded();
  tokenCache.set(cacheKey, { data: unknown, timestamp: Date.now() });
  
  return unknown;
}

/**
 * Resolve multiple tokens at once (batch)
 */
export async function resolveTokens(
  addresses: string[], 
  chain: string = 'ethereum'
): Promise<Map<string, TokenInfo>> {
  const results = new Map<string, TokenInfo>();
  const uncached: string[] = [];
  
  // Check cache first
  for (const addr of addresses) {
    const normalizedAddress = addr.toLowerCase();
    const cacheKey = `${chain}:${normalizedAddress}`;
    const cached = tokenCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      results.set(normalizedAddress, cached.data);
    } else {
      uncached.push(normalizedAddress);
    }
  }
  
  // Batch lookup for uncached
  if (uncached.length > 0) {
    try {
      const tokens = await TokenRegistryModel.find({
        address: { $in: uncached },
        chain,
      }).lean();
      
      for (const token of tokens) {
        const t = token as any;
        const info: TokenInfo = {
          address: t.address,
          chain: t.chain,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          verified: t.verified,
          source: t.source,
          logo: t.logo,
        };
        
        results.set(t.address, info);
        
        // Cache it
        evictIfNeeded();
        tokenCache.set(`${chain}:${t.address}`, { data: info, timestamp: Date.now() });
      }
    } catch (err) {
      console.error('[TokenResolver] Batch lookup failed:', err);
    }
    
    // Mark remaining as unknown
    for (const addr of uncached) {
      if (!results.has(addr)) {
        const unknown: TokenInfo = {
          address: addr,
          chain,
          symbol: 'UNKNOWN',
          name: 'Unverified Token',
          decimals: 18,
          verified: false,
          source: 'manual',
        };
        results.set(addr, unknown);
        
        evictIfNeeded();
        tokenCache.set(`${chain}:${addr}`, { data: unknown, timestamp: Date.now() });
      }
    }
  }
  
  return results;
}

/**
 * Format token for display (address → symbol)
 */
export function formatToken(info: TokenInfo): string {
  if (info.symbol === 'UNKNOWN') {
    // Show truncated address for unknown tokens
    return `${info.address.slice(0, 6)}...${info.address.slice(-4)}`;
  }
  return info.symbol;
}

/**
 * Seed known tokens into registry
 */
export async function seedTokenRegistry(): Promise<number> {
  let seeded = 0;
  
  for (const token of KNOWN_TOKENS) {
    try {
      await TokenRegistryModel.findOneAndUpdate(
        { address: token.address, chain: token.chain },
        token,
        { upsert: true }
      );
      seeded++;
    } catch (err) {
      console.error(`[TokenRegistry] Failed to seed ${token.symbol}:`, err);
    }
  }
  
  console.log(`[TokenRegistry] Seeded ${seeded} tokens`);
  return seeded;
}

/**
 * Get token registry stats
 */
export async function getTokenRegistryStats(): Promise<{
  total: number;
  verified: number;
  byChain: Record<string, number>;
  bySource: Record<string, number>;
}> {
  const [total, verified, byChain, bySource] = await Promise.all([
    TokenRegistryModel.countDocuments(),
    TokenRegistryModel.countDocuments({ verified: true }),
    TokenRegistryModel.aggregate([
      { $group: { _id: '$chain', count: { $sum: 1 } } },
    ]),
    TokenRegistryModel.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } },
    ]),
  ]);
  
  return {
    total,
    verified,
    byChain: byChain.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {} as Record<string, number>),
    bySource: bySource.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {} as Record<string, number>),
  };
}

/**
 * Clear token cache (for testing/maintenance)
 */
export function clearTokenCache(): void {
  tokenCache.clear();
  console.log('[TokenResolver] Cache cleared');
}
