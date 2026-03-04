/**
 * Price Service
 * 
 * Fetches prices for tokens (uses CoinGecko as primary source)
 */
import axios from 'axios';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// Simple in-memory cache (5 min TTL)
const priceCache = new Map<string, { price: number; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// Common token ID mappings
const TOKEN_ID_MAP: Record<string, string> = {
  'ETH': 'ethereum',
  'BTC': 'bitcoin',
  'USDT': 'tether',
  'USDC': 'usd-coin',
  'BNB': 'binancecoin',
  'XRP': 'ripple',
  'ADA': 'cardano',
  'SOL': 'solana',
  'DOGE': 'dogecoin',
  'DOT': 'polkadot',
  'MATIC': 'matic-network',
  'SHIB': 'shiba-inu',
  'LINK': 'chainlink',
  'UNI': 'uniswap',
  'AAVE': 'aave',
};

/**
 * Get CoinGecko ID for a token
 */
function getCoinGeckoId(tokenId: string): string {
  const normalized = tokenId.toUpperCase();
  return TOKEN_ID_MAP[normalized] || tokenId.toLowerCase();
}

/**
 * Get latest price for a token
 */
export async function getLatestPrice(
  tokenId: string,
  currency: string = 'usd'
): Promise<{ price: number; source: string } | null> {
  const cacheKey = `${tokenId}-${currency}`;
  
  // Check cache
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { price: cached.price, source: 'cache' };
  }
  
  try {
    const coinId = getCoinGeckoId(tokenId);
    const response = await axios.get(
      `${COINGECKO_BASE}/simple/price`,
      {
        params: {
          ids: coinId,
          vs_currencies: currency,
        },
        timeout: 10000,
      }
    );
    
    const price = response.data?.[coinId]?.[currency];
    if (typeof price === 'number' && price > 0) {
      priceCache.set(cacheKey, { price, ts: Date.now() });
      return { price, source: 'coingecko' };
    }
    
    return null;
  } catch (error) {
    console.error(`[PriceService] Error fetching price for ${tokenId}:`, error);
    return null;
  }
}

/**
 * Get historical price at a specific time
 * (CoinGecko requires pro plan for precise historical, so we use market_chart)
 */
export async function getHistoricalPrice(
  tokenId: string,
  timestamp: Date,
  currency: string = 'usd'
): Promise<{ price: number; source: string } | null> {
  try {
    const coinId = getCoinGeckoId(tokenId);
    const targetTs = timestamp.getTime();
    const now = Date.now();
    
    // Determine days range
    const daysAgo = Math.ceil((now - targetTs) / (24 * 60 * 60 * 1000)) + 1;
    
    if (daysAgo > 365) {
      return null; // Too far back
    }
    
    const response = await axios.get(
      `${COINGECKO_BASE}/coins/${coinId}/market_chart`,
      {
        params: {
          vs_currency: currency,
          days: Math.min(daysAgo + 1, 90), // Limit to 90 days
        },
        timeout: 15000,
      }
    );
    
    const prices = response.data?.prices;
    if (!Array.isArray(prices) || prices.length === 0) {
      return null;
    }
    
    // Find closest price to target timestamp
    let closest = prices[0];
    let minDiff = Math.abs(prices[0][0] - targetTs);
    
    for (const [ts, price] of prices) {
      const diff = Math.abs(ts - targetTs);
      if (diff < minDiff) {
        minDiff = diff;
        closest = [ts, price];
      }
    }
    
    return { price: closest[1], source: 'coingecko-historical' };
  } catch (error) {
    console.error(`[PriceService] Error fetching historical price for ${tokenId}:`, error);
    return null;
  }
}

/**
 * Get prices for multiple tokens
 */
export async function getLatestPrices(
  tokenIds: string[],
  currency: string = 'usd'
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  
  // Check cache first
  const uncached: string[] = [];
  for (const id of tokenIds) {
    const cacheKey = `${id}-${currency}`;
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      result.set(id, cached.price);
    } else {
      uncached.push(id);
    }
  }
  
  if (uncached.length === 0) {
    return result;
  }
  
  try {
    const coinIds = uncached.map(getCoinGeckoId).join(',');
    const response = await axios.get(
      `${COINGECKO_BASE}/simple/price`,
      {
        params: {
          ids: coinIds,
          vs_currencies: currency,
        },
        timeout: 15000,
      }
    );
    
    for (const id of uncached) {
      const coinId = getCoinGeckoId(id);
      const price = response.data?.[coinId]?.[currency];
      if (typeof price === 'number' && price > 0) {
        result.set(id, price);
        priceCache.set(`${id}-${currency}`, { price, ts: Date.now() });
      }
    }
  } catch (error) {
    console.error('[PriceService] Error fetching bulk prices:', error);
  }
  
  return result;
}
