/**
 * USD Pricer Service (P0.4)
 * 
 * Best-effort USD pricing for DEX trades.
 * - Uses stablecoin amounts directly
 * - Falls back to CoinGecko for other tokens
 * - NEVER blocks ingestion on pricing failure
 */

import { SupportedDexChain } from '../storage/dex_trade.model.js';
import { STABLECOINS, KNOWN_TOKENS } from '../adapters/uniswap_v3.constants.js';

// ============================================
// Types
// ============================================

export interface PriceResult {
  amountUsd: number | null;
  source: 'stablecoin' | 'cache' | 'api' | 'none';
  confidence: 'high' | 'medium' | 'low' | 'none';
}

export interface TokenPrice {
  address: string;
  chain: SupportedDexChain;
  priceUsd: number;
  timestamp: number;
  source: string;
}

// ============================================
// Price Cache
// ============================================

const priceCache = new Map<string, TokenPrice>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached price
 */
function getCachedPrice(chain: SupportedDexChain, tokenAddress: string): TokenPrice | null {
  const key = `${chain}:${tokenAddress.toLowerCase()}`;
  const cached = priceCache.get(key);
  
  if (!cached) return null;
  
  // Check TTL
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    priceCache.delete(key);
    return null;
  }
  
  return cached;
}

/**
 * Set cached price
 */
function setCachedPrice(chain: SupportedDexChain, tokenAddress: string, priceUsd: number, source: string): void {
  const key = `${chain}:${tokenAddress.toLowerCase()}`;
  priceCache.set(key, {
    address: tokenAddress.toLowerCase(),
    chain,
    priceUsd,
    timestamp: Date.now(),
    source
  });
}

/**
 * Clear price cache
 */
export function clearPriceCache(): void {
  priceCache.clear();
}

// ============================================
// Stablecoin Pricing
// ============================================

/**
 * Get decimals for a token
 */
function getTokenDecimals(chain: SupportedDexChain, tokenAddress: string): number {
  const chainTokens = KNOWN_TOKENS[chain];
  if (!chainTokens) return 18; // Default to 18
  
  const token = chainTokens[tokenAddress.toLowerCase()];
  return token?.decimals || 18;
}

/**
 * Check if token is stablecoin and get USD value directly
 */
export function getStablecoinValue(
  chain: SupportedDexChain,
  tokenAddress: string,
  amount: string
): PriceResult {
  const stables = STABLECOINS[chain];
  if (!stables || !stables.has(tokenAddress.toLowerCase())) {
    return { amountUsd: null, source: 'none', confidence: 'none' };
  }
  
  const decimals = getTokenDecimals(chain, tokenAddress);
  
  try {
    const amountBigInt = BigInt(amount);
    const divisor = BigInt(10 ** decimals);
    
    // Convert to USD (stablecoin = $1)
    const wholePart = amountBigInt / divisor;
    const fractionalPart = amountBigInt % divisor;
    
    // Calculate with 2 decimal precision
    const amountUsd = Number(wholePart) + Number(fractionalPart) / Number(divisor);
    
    return {
      amountUsd: Math.round(amountUsd * 100) / 100,
      source: 'stablecoin',
      confidence: 'high'
    };
  } catch {
    return { amountUsd: null, source: 'none', confidence: 'none' };
  }
}

// ============================================
// External Price Fetching
// ============================================

// CoinGecko chain IDs
const COINGECKO_CHAIN_IDS: Record<SupportedDexChain, string> = {
  ETH: 'ethereum',
  ARB: 'arbitrum-one',
  OP: 'optimistic-ethereum',
  BASE: 'base'
};

/**
 * Fetch price from CoinGecko (with rate limiting)
 */
let lastApiCall = 0;
const API_MIN_INTERVAL_MS = 1200; // CoinGecko free tier: ~50 req/min

async function fetchCoinGeckoPrice(
  chain: SupportedDexChain,
  tokenAddress: string
): Promise<number | null> {
  // Rate limiting
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCall;
  if (timeSinceLastCall < API_MIN_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, API_MIN_INTERVAL_MS - timeSinceLastCall));
  }
  lastApiCall = Date.now();
  
  const platform = COINGECKO_CHAIN_IDS[chain];
  const url = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${tokenAddress}&vs_currencies=usd`;
  
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    const tokenData = data[tokenAddress.toLowerCase()];
    
    if (tokenData && typeof tokenData.usd === 'number') {
      return tokenData.usd;
    }
    
    return null;
  } catch (error) {
    console.error('[UsdPricer] CoinGecko API error:', error);
    return null;
  }
}

// ============================================
// Main Pricing Function
// ============================================

/**
 * Get USD value for a token amount
 * 
 * Priority:
 * 1. Stablecoin (direct conversion)
 * 2. Cache
 * 3. CoinGecko API
 * 4. null (no price available)
 */
export async function getTokenUsdValue(
  chain: SupportedDexChain,
  tokenAddress: string,
  amount: string,
  options?: {
    skipApi?: boolean;  // Skip external API call
  }
): Promise<PriceResult> {
  // 1. Check if stablecoin
  const stableResult = getStablecoinValue(chain, tokenAddress, amount);
  if (stableResult.amountUsd !== null) {
    return stableResult;
  }
  
  // 2. Check cache
  const cached = getCachedPrice(chain, tokenAddress);
  if (cached) {
    const decimals = getTokenDecimals(chain, tokenAddress);
    const amountUsd = calculateUsdFromPrice(amount, cached.priceUsd, decimals);
    return {
      amountUsd,
      source: 'cache',
      confidence: 'medium'
    };
  }
  
  // 3. Fetch from API (if not skipped)
  if (!options?.skipApi) {
    const priceUsd = await fetchCoinGeckoPrice(chain, tokenAddress);
    if (priceUsd !== null) {
      setCachedPrice(chain, tokenAddress, priceUsd, 'coingecko');
      const decimals = getTokenDecimals(chain, tokenAddress);
      const amountUsd = calculateUsdFromPrice(amount, priceUsd, decimals);
      return {
        amountUsd,
        source: 'api',
        confidence: 'medium'
      };
    }
  }
  
  // 4. No price available
  return { amountUsd: null, source: 'none', confidence: 'none' };
}

/**
 * Calculate USD value from price and amount
 */
function calculateUsdFromPrice(amount: string, priceUsd: number, decimals: number): number {
  try {
    const amountBigInt = BigInt(amount);
    const divisor = BigInt(10 ** decimals);
    
    const wholePart = amountBigInt / divisor;
    const fractionalPart = amountBigInt % divisor;
    
    const tokenAmount = Number(wholePart) + Number(fractionalPart) / Number(divisor);
    const usdValue = tokenAmount * priceUsd;
    
    return Math.round(usdValue * 100) / 100;
  } catch {
    return 0;
  }
}

// ============================================
// Batch Pricing
// ============================================

/**
 * Price multiple trades (best-effort)
 */
export async function priceTrades(
  trades: Array<{
    chain: SupportedDexChain;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
  }>
): Promise<Array<{
  amountInUsd: number | null;
  amountOutUsd: number | null;
}>> {
  const results: Array<{ amountInUsd: number | null; amountOutUsd: number | null }> = [];
  
  for (const trade of trades) {
    // Try to price tokenOut first (usually more relevant for USD value)
    const outPrice = await getTokenUsdValue(trade.chain, trade.tokenOut, trade.amountOut, { skipApi: true });
    const inPrice = await getTokenUsdValue(trade.chain, trade.tokenIn, trade.amountIn, { skipApi: true });
    
    results.push({
      amountInUsd: inPrice.amountUsd,
      amountOutUsd: outPrice.amountUsd
    });
  }
  
  return results;
}

// ============================================
// Trade Value Estimation
// ============================================

/**
 * Estimate trade value (use whichever side has a price)
 */
export function estimateTradeValue(
  amountInUsd: number | null,
  amountOutUsd: number | null
): number | null {
  // Prefer outUsd (what user received)
  if (amountOutUsd !== null) return amountOutUsd;
  if (amountInUsd !== null) return amountInUsd;
  return null;
}

// ============================================
// Known Token Prices (fallback)
// ============================================

// Hardcoded approximate prices for major tokens (fallback only)
const FALLBACK_PRICES: Record<string, number> = {
  'WETH': 2500,
  'ETH': 2500,
  'WBTC': 65000,
  'BTC': 65000,
  'ARB': 1.0,
  'OP': 2.0
};

/**
 * Get fallback price for known symbols
 */
export function getFallbackPrice(symbol: string | undefined): number | null {
  if (!symbol) return null;
  return FALLBACK_PRICES[symbol.toUpperCase()] || null;
}
