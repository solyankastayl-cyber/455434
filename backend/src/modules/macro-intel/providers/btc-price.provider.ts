/**
 * BTC Price Provider
 * 
 * Fetches BTC price and 24h change from CoinGecko
 */

import axios from 'axios';

const COINGECKO_BTC_URL = 'https://api.coingecko.com/api/v3/simple/price';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface BtcPriceData {
  price: number;
  change24h: number;
  timestamp: number;
}

let cachedBtcPrice: BtcPriceData | null = null;
let cacheTimestamp = 0;

export async function fetchBtcPrice(): Promise<{
  data: BtcPriceData | null;
  quality: 'LIVE' | 'CACHED' | 'NO_DATA';
}> {
  const now = Date.now();
  
  // Return cached if valid
  if (cachedBtcPrice && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return { data: cachedBtcPrice, quality: 'CACHED' };
  }

  try {
    const response = await axios.get(COINGECKO_BTC_URL, {
      timeout: 10000,
      params: {
        ids: 'bitcoin',
        vs_currencies: 'usd',
        include_24hr_change: 'true',
      },
    });

    const btcData = response.data?.bitcoin;
    if (!btcData) {
      return { data: cachedBtcPrice, quality: cachedBtcPrice ? 'CACHED' : 'NO_DATA' };
    }

    const newData: BtcPriceData = {
      price: btcData.usd || 0,
      change24h: btcData.usd_24h_change || 0,
      timestamp: now,
    };

    cachedBtcPrice = newData;
    cacheTimestamp = now;

    console.log(`[BtcPrice] Fetched: $${newData.price.toFixed(0)}, 24h: ${newData.change24h.toFixed(2)}%`);

    return { data: newData, quality: 'LIVE' };
  } catch (error: any) {
    console.error('[BtcPrice] Fetch error:', error.message);
    return { data: cachedBtcPrice, quality: cachedBtcPrice ? 'CACHED' : 'NO_DATA' };
  }
}

export function getCachedBtcPrice(): BtcPriceData | null {
  return cachedBtcPrice;
}
