/**
 * CoinGecko Price Oracle Service
 * 
 * Fetches real-time cryptocurrency prices by contract address.
 * Used for calculating Net Flow in USD for non-stablecoins.
 * 
 * Features:
 * - In-memory cache with 5-minute TTL
 * - Batch requests to minimize API calls
 * - Fallback to hardcoded stablecoin prices
 * - Rate limit handling
 */

// In-memory price cache
interface CachedPrice {
  priceUsd: number;
  timestamp: number;
}

const priceCache = new Map<string, CachedPrice>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// CoinGecko API base URL (free tier - no API key needed for basic use)
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// Known token contract addresses -> CoinGecko IDs mapping
const TOKEN_TO_COINGECKO_ID: Record<string, string> = {
  // Ethereum Mainnet
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'weth', // WETH
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'wrapped-bitcoin', // WBTC
  '0x514910771af9ca656af840dff83e8264ecf986ca': 'chainlink', // LINK
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'uniswap', // UNI
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 'aave', // AAVE
  '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2': 'sushi', // SUSHI
  '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2': 'maker', // MKR
  '0xc00e94cb662c3520282e6f5717214004a7f26888': 'compound-governance-token', // COMP
  '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e': 'yearn-finance', // YFI
  '0xd533a949740bb3306d119cc777fa900ba034cd52': 'curve-dao-token', // CRV
  '0xba100000625a3754423978a60c9317c58a424e3d': 'balancer', // BAL
  '0x111111111117dc0aa78b770fa6a738034120c302': '1inch', // 1INCH
  '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce': 'shiba-inu', // SHIB
  '0x4d224452801aced8b2f0aebe155379bb5d594381': 'apecoin', // APE
  '0x5a98fcbea516cf06857215779fd812ca3bef1b32': 'lido-dao', // LDO
  '0xae78736cd615f374d3085123a210448e74fc6393': 'rocket-pool-eth', // rETH
  '0xbe9895146f7af43049ca1c1ae358b0541ea49704': 'coinbase-wrapped-staked-eth', // cbETH
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': 'wrapped-steth', // wstETH
};

// Hardcoded stablecoin prices (always $1)
const STABLECOIN_ADDRESSES = new Set([
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  '0x4fabb145d64652a948d72533023f6e7a623c7c53', // BUSD
  '0x0000000000085d4780b73119b644ae5ecd22b376', // TUSD
  '0x8e870d67f660d95d5be530380d0ec0bd388289e1', // USDP
  '0x956f47f50a910163d8bf957cf5846d573e7f87ca', // FEI
  '0x853d955acef822db058eb8505911ed77f175b99e', // FRAX
]);

// Token decimals (for USD conversion)
const TOKEN_DECIMALS: Record<string, number> = {
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6, // USDT
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6, // USDC
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18, // WETH
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8, // WBTC
  '0x514910771af9ca656af840dff83e8264ecf986ca': 18, // LINK
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 18, // UNI
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 18, // AAVE
};

/**
 * Get price from cache if valid
 */
function getCachedPrice(address: string): number | null {
  const cached = priceCache.get(address.toLowerCase());
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.priceUsd;
  }
  return null;
}

/**
 * Set price in cache
 */
function setCachedPrice(address: string, priceUsd: number): void {
  priceCache.set(address.toLowerCase(), {
    priceUsd,
    timestamp: Date.now(),
  });
}

/**
 * Fetch price from CoinGecko by contract address
 */
async function fetchPriceFromCoinGecko(address: string): Promise<number | null> {
  const normalizedAddress = address.toLowerCase();
  
  // Check if we have a CoinGecko ID mapping
  const coinGeckoId = TOKEN_TO_COINGECKO_ID[normalizedAddress];
  
  try {
    let priceUsd: number | null = null;
    
    if (coinGeckoId) {
      // Use simple price endpoint with coin ID
      const url = `${COINGECKO_API}/simple/price?ids=${coinGeckoId}&vs_currencies=usd`;
      const response = await fetch(url);
      
      if (response.status === 429) {
        console.warn('[CoinGecko] Rate limited, using fallback');
        return null;
      }
      
      if (!response.ok) {
        console.error(`[CoinGecko] API error: ${response.status}`);
        return null;
      }
      
      const data = await response.json();
      priceUsd = data[coinGeckoId]?.usd || null;
    } else {
      // Use contract address lookup (Ethereum only)
      const url = `${COINGECKO_API}/simple/token_price/ethereum?contract_addresses=${normalizedAddress}&vs_currencies=usd`;
      const response = await fetch(url);
      
      if (response.status === 429) {
        console.warn('[CoinGecko] Rate limited, using fallback');
        return null;
      }
      
      if (!response.ok) {
        console.error(`[CoinGecko] API error: ${response.status}`);
        return null;
      }
      
      const data = await response.json();
      priceUsd = data[normalizedAddress]?.usd || null;
    }
    
    if (priceUsd !== null) {
      setCachedPrice(normalizedAddress, priceUsd);
      console.log(`[CoinGecko] Fetched price for ${normalizedAddress}: $${priceUsd}`);
    }
    
    return priceUsd;
  } catch (error) {
    console.error(`[CoinGecko] Failed to fetch price for ${address}:`, error);
    return null;
  }
}

/**
 * Get token price in USD
 * 
 * Priority:
 * 1. Stablecoin (hardcoded $1)
 * 2. Cached price (if < 5 min old)
 * 3. CoinGecko API
 * 4. null (unknown)
 */
export async function getTokenPriceUsd(tokenAddress: string): Promise<number | null> {
  const normalizedAddress = tokenAddress.toLowerCase();
  
  // 1. Stablecoins are always $1
  if (STABLECOIN_ADDRESSES.has(normalizedAddress)) {
    return 1;
  }
  
  // 2. Check cache
  const cachedPrice = getCachedPrice(normalizedAddress);
  if (cachedPrice !== null) {
    return cachedPrice;
  }
  
  // 3. Fetch from CoinGecko
  const price = await fetchPriceFromCoinGecko(normalizedAddress);
  return price;
}

/**
 * Get token decimals
 */
export function getTokenDecimals(tokenAddress: string): number {
  return TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
}

/**
 * Convert raw token amount to USD
 */
export async function convertToUsd(
  tokenAddress: string,
  rawAmount: string | number | bigint
): Promise<number | null> {
  const price = await getTokenPriceUsd(tokenAddress);
  if (price === null) return null;
  
  const decimals = getTokenDecimals(tokenAddress);
  const amount = typeof rawAmount === 'bigint' 
    ? Number(rawAmount) 
    : Number(rawAmount);
  
  return (amount / Math.pow(10, decimals)) * price;
}

/**
 * Batch fetch prices for multiple tokens
 * More efficient than individual calls
 */
export async function batchGetTokenPrices(
  tokenAddresses: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const toFetch: string[] = [];
  
  // Check cache and stablecoins first
  for (const address of tokenAddresses) {
    const normalized = address.toLowerCase();
    
    if (STABLECOIN_ADDRESSES.has(normalized)) {
      result.set(normalized, 1);
      continue;
    }
    
    const cached = getCachedPrice(normalized);
    if (cached !== null) {
      result.set(normalized, cached);
      continue;
    }
    
    toFetch.push(normalized);
  }
  
  // Batch fetch remaining from CoinGecko
  if (toFetch.length > 0) {
    // Group by known CoinGecko IDs and contract addresses
    const knownIds: string[] = [];
    const contractAddresses: string[] = [];
    
    for (const addr of toFetch) {
      if (TOKEN_TO_COINGECKO_ID[addr]) {
        knownIds.push(TOKEN_TO_COINGECKO_ID[addr]);
      } else {
        contractAddresses.push(addr);
      }
    }
    
    // Fetch by IDs
    if (knownIds.length > 0) {
      try {
        const url = `${COINGECKO_API}/simple/price?ids=${knownIds.join(',')}&vs_currencies=usd`;
        const response = await fetch(url);
        
        if (response.ok) {
          const data = await response.json();
          
          for (const addr of toFetch) {
            const coinId = TOKEN_TO_COINGECKO_ID[addr];
            if (coinId && data[coinId]?.usd) {
              const price = data[coinId].usd;
              result.set(addr, price);
              setCachedPrice(addr, price);
            }
          }
        }
      } catch (error) {
        console.error('[CoinGecko] Batch fetch by IDs failed:', error);
      }
    }
    
    // Fetch by contract addresses
    if (contractAddresses.length > 0) {
      try {
        const url = `${COINGECKO_API}/simple/token_price/ethereum?contract_addresses=${contractAddresses.join(',')}&vs_currencies=usd`;
        const response = await fetch(url);
        
        if (response.ok) {
          const data = await response.json();
          
          for (const addr of contractAddresses) {
            if (data[addr]?.usd) {
              const price = data[addr].usd;
              result.set(addr, price);
              setCachedPrice(addr, price);
            }
          }
        }
      } catch (error) {
        console.error('[CoinGecko] Batch fetch by addresses failed:', error);
      }
    }
  }
  
  return result;
}

/**
 * Get cache stats (for debugging)
 */
export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: priceCache.size,
    entries: Array.from(priceCache.keys()),
  };
}

/**
 * Clear price cache (for testing)
 */
export function clearPriceCache(): void {
  priceCache.clear();
}

/**
 * Check if token is a known stablecoin
 */
export function isStablecoin(tokenAddress: string): boolean {
  return STABLECOIN_ADDRESSES.has(tokenAddress.toLowerCase());
}

/**
 * Get token metadata
 */
export function getTokenMetadata(tokenAddress: string): {
  isStablecoin: boolean;
  hasKnownPrice: boolean;
  decimals: number;
  coinGeckoId: string | null;
} {
  const normalized = tokenAddress.toLowerCase();
  return {
    isStablecoin: STABLECOIN_ADDRESSES.has(normalized),
    hasKnownPrice: STABLECOIN_ADDRESSES.has(normalized) || TOKEN_TO_COINGECKO_ID[normalized] !== undefined,
    decimals: getTokenDecimals(normalized),
    coinGeckoId: TOKEN_TO_COINGECKO_ID[normalized] || null,
  };
}
