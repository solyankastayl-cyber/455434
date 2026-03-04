/**
 * Market Dominance Provider
 * Source: CoinGecko API (public, rate limited)
 * 
 * Endpoint: https://api.coingecko.com/api/v3/global
 */

import axios from 'axios';
import { DominanceData, RSIData, DataQuality } from '../contracts/macro.types.js';

const COINGECKO_GLOBAL_URL = 'https://api.coingecko.com/api/v3/global';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CoinGeckoGlobalResponse {
  data: {
    active_cryptocurrencies: number;
    upcoming_icos: number;
    ongoing_icos: number;
    ended_icos: number;
    markets: number;
    total_market_cap: Record<string, number>;
    total_volume: Record<string, number>;
    market_cap_percentage: {
      btc: number;
      eth: number;
      usdt?: number;
      usdc?: number;
      [key: string]: number | undefined;
    };
    market_cap_change_percentage_24h_usd: number;
    updated_at: number;
  };
}

// In-memory cache
let cachedDominance: DominanceData | null = null;
let cachedRsi: RSIData = {};
let cacheTimestamp = 0;

// Historical data for RSI calculation (keep last 14 readings)
const btcDomHistory: number[] = [];
const stableDomHistory: number[] = [];
const MAX_HISTORY = 14;

function calculateRSI(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  
  let gains = 0;
  let losses = 0;
  let gainCount = 0;
  let lossCount = 0;
  
  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) {
      gains += change;
      gainCount++;
    } else if (change < 0) {
      losses += Math.abs(change);
      lossCount++;
    }
  }
  
  const avgGain = gainCount > 0 ? gains / values.length : 0;
  const avgLoss = lossCount > 0 ? losses / values.length : 0;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export async function fetchDominanceData(): Promise<{
  dominance: DominanceData | null;
  rsi: RSIData;
  quality: DataQuality;
}> {
  const now = Date.now();
  
  // Return cached if still valid
  if (cachedDominance && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return {
      dominance: cachedDominance,
      rsi: cachedRsi,
      quality: {
        mode: 'CACHED',
        ttlSec: Math.floor((CACHE_TTL_MS - (now - cacheTimestamp)) / 1000),
        missing: [],
      },
    };
  }

  try {
    const startMs = Date.now();
    const response = await axios.get<CoinGeckoGlobalResponse>(COINGECKO_GLOBAL_URL, {
      timeout: 15000,
      headers: {
        'Accept': 'application/json',
      },
    });
    const latencyMs = Date.now() - startMs;

    const globalData = response.data?.data;
    if (!globalData?.market_cap_percentage) {
      return {
        dominance: cachedDominance,
        rsi: cachedRsi,
        quality: {
          mode: cachedDominance ? 'DEGRADED' : 'NO_DATA',
          latencyMs,
          missing: ['dominance'],
        },
      };
    }

    const btcPct = globalData.market_cap_percentage.btc || 0;
    const usdtPct = globalData.market_cap_percentage.usdt || 0;
    const usdcPct = globalData.market_cap_percentage.usdc || 0;
    const stablePct = usdtPct + usdcPct;
    
    // Calculate 24h delta if we have previous data
    const btcDelta24h = cachedDominance ? btcPct - cachedDominance.btcPct : undefined;
    const stableDelta24h = cachedDominance ? stablePct - cachedDominance.stablePct : undefined;
    
    const newDominance: DominanceData = {
      btcPct,
      stablePct,
      altPct: 100 - btcPct - stablePct,
      btcDelta24h,
      stableDelta24h,
      timestamp: globalData.updated_at * 1000,
    };

    // Update history for RSI
    btcDomHistory.push(btcPct);
    stableDomHistory.push(stablePct);
    
    if (btcDomHistory.length > MAX_HISTORY) btcDomHistory.shift();
    if (stableDomHistory.length > MAX_HISTORY) stableDomHistory.shift();
    
    // Calculate RSI
    const newRsi: RSIData = {
      btcDomRsi14: calculateRSI(btcDomHistory),
      stableDomRsi14: calculateRSI(stableDomHistory),
    };

    // Update cache
    cachedDominance = newDominance;
    cachedRsi = newRsi;
    cacheTimestamp = now;

    console.log(`[Dominance] Fetched: BTC=${btcPct.toFixed(2)}%, Stable=${stablePct.toFixed(2)}%, latency=${latencyMs}ms`);

    return {
      dominance: newDominance,
      rsi: newRsi,
      quality: {
        mode: 'LIVE',
        latencyMs,
        ttlSec: Math.floor(CACHE_TTL_MS / 1000),
        missing: [],
      },
    };
  } catch (error: any) {
    // Handle rate limiting (429)
    if (error.response?.status === 429) {
      console.warn('[Dominance] Rate limited by CoinGecko, using cache');
    } else {
      console.error('[Dominance] Fetch error:', error.message);
    }
    
    return {
      dominance: cachedDominance,
      rsi: cachedRsi,
      quality: {
        mode: cachedDominance ? 'DEGRADED' : 'NO_DATA',
        latencyMs: undefined,
        missing: ['dominance'],
      },
    };
  }
}

// Get cached data without fetching
export function getCachedDominance(): { dominance: DominanceData | null; rsi: RSIData } {
  return { dominance: cachedDominance, rsi: cachedRsi };
}

// Clear cache (for testing)
export function clearDominanceCache(): void {
  cachedDominance = null;
  cachedRsi = {};
  cacheTimestamp = 0;
  btcDomHistory.length = 0;
  stableDomHistory.length = 0;
}
