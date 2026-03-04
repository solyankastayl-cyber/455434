/**
 * Fear & Greed Index Provider
 * Source: Alternative.me API (public, no key required)
 * 
 * Endpoint: https://api.alternative.me/fng/
 */

import axios from 'axios';
import { FearGreedData, FearGreedLabel, DataQuality } from '../contracts/macro.types.js';

const ALTERNATIVE_ME_URL = 'https://api.alternative.me/fng/';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface AlternativeMeResponse {
  name: string;
  data: Array<{
    value: string;
    value_classification: string;
    timestamp: string;
    time_until_update?: string;
  }>;
  metadata: {
    error: null | string;
  };
}

// In-memory cache
let cachedData: FearGreedData | null = null;
let cacheTimestamp = 0;

function classifyValue(value: number): FearGreedLabel {
  if (value <= 20) return 'EXTREME_FEAR';
  if (value <= 35) return 'FEAR';
  if (value <= 55) return 'NEUTRAL';
  if (value <= 75) return 'GREED';
  return 'EXTREME_GREED';
}

export async function fetchFearGreedIndex(): Promise<{
  data: FearGreedData | null;
  quality: DataQuality;
}> {
  const now = Date.now();
  
  // Return cached if still valid
  if (cachedData && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return {
      data: cachedData,
      quality: {
        mode: 'CACHED',
        ttlSec: Math.floor((CACHE_TTL_MS - (now - cacheTimestamp)) / 1000),
        missing: [],
      },
    };
  }

  try {
    const startMs = Date.now();
    const response = await axios.get<AlternativeMeResponse>(ALTERNATIVE_ME_URL, {
      timeout: 10000,
      params: { limit: 2 }, // Get today and yesterday for delta
    });
    const latencyMs = Date.now() - startMs;

    if (response.data?.metadata?.error) {
      console.error('[FearGreed] API error:', response.data.metadata.error);
      return {
        data: cachedData,
        quality: {
          mode: cachedData ? 'DEGRADED' : 'NO_DATA',
          latencyMs,
          missing: ['fearGreed'],
        },
      };
    }

    const entries = response.data?.data || [];
    if (entries.length === 0) {
      return {
        data: cachedData,
        quality: {
          mode: cachedData ? 'DEGRADED' : 'NO_DATA',
          latencyMs,
          missing: ['fearGreed'],
        },
      };
    }

    const today = entries[0];
    const yesterday = entries[1];
    
    const value = parseInt(today.value, 10);
    const yesterdayValue = yesterday ? parseInt(yesterday.value, 10) : undefined;
    
    const newData: FearGreedData = {
      value,
      label: classifyValue(value),
      change24h: yesterdayValue !== undefined ? value - yesterdayValue : undefined,
      timestamp: parseInt(today.timestamp, 10) * 1000, // Convert to ms
    };

    // Update cache
    cachedData = newData;
    cacheTimestamp = now;

    console.log(`[FearGreed] Fetched: ${value} (${newData.label}), latency=${latencyMs}ms`);

    return {
      data: newData,
      quality: {
        mode: 'LIVE',
        latencyMs,
        ttlSec: Math.floor(CACHE_TTL_MS / 1000),
        missing: [],
      },
    };
  } catch (error: any) {
    console.error('[FearGreed] Fetch error:', error.message);
    
    return {
      data: cachedData,
      quality: {
        mode: cachedData ? 'DEGRADED' : 'NO_DATA',
        latencyMs: undefined,
        missing: ['fearGreed'],
      },
    };
  }
}

// Get cached data without fetching
export function getCachedFearGreed(): FearGreedData | null {
  return cachedData;
}

// Clear cache (for testing)
export function clearFearGreedCache(): void {
  cachedData = null;
  cacheTimestamp = 0;
}

// Historical data types
export interface FearGreedHistoryPoint {
  value: number;
  label: FearGreedLabel;
  timestamp: number;
  date: string; // YYYY-MM-DD
}

// Cache for historical data (updates less frequently)
let cachedHistory: FearGreedHistoryPoint[] = [];
let historyCacheTimestamp = 0;
const HISTORY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch historical Fear & Greed data
 * @param days Number of days to fetch (default 7, max 30)
 */
export async function fetchFearGreedHistory(days = 7): Promise<{
  data: FearGreedHistoryPoint[];
  quality: DataQuality;
}> {
  const now = Date.now();
  const limitDays = Math.min(Math.max(days, 1), 30);
  
  // Return cached if still valid
  if (cachedHistory.length >= limitDays && (now - historyCacheTimestamp) < HISTORY_CACHE_TTL_MS) {
    return {
      data: cachedHistory.slice(0, limitDays),
      quality: {
        mode: 'CACHED',
        ttlSec: Math.floor((HISTORY_CACHE_TTL_MS - (now - historyCacheTimestamp)) / 1000),
        missing: [],
      },
    };
  }

  try {
    const startMs = Date.now();
    const response = await axios.get<AlternativeMeResponse>(ALTERNATIVE_ME_URL, {
      timeout: 15000,
      params: { limit: limitDays },
    });
    const latencyMs = Date.now() - startMs;

    if (response.data?.metadata?.error) {
      console.error('[FearGreed] History API error:', response.data.metadata.error);
      return {
        data: cachedHistory.slice(0, limitDays),
        quality: {
          mode: cachedHistory.length > 0 ? 'DEGRADED' : 'NO_DATA',
          latencyMs,
          missing: ['fearGreedHistory'],
        },
      };
    }

    const entries = response.data?.data || [];
    if (entries.length === 0) {
      return {
        data: cachedHistory.slice(0, limitDays),
        quality: {
          mode: cachedHistory.length > 0 ? 'DEGRADED' : 'NO_DATA',
          latencyMs,
          missing: ['fearGreedHistory'],
        },
      };
    }

    const historyData: FearGreedHistoryPoint[] = entries.map((entry) => {
      const value = parseInt(entry.value, 10);
      const timestamp = parseInt(entry.timestamp, 10) * 1000;
      const date = new Date(timestamp).toISOString().split('T')[0];
      return {
        value,
        label: classifyValue(value),
        timestamp,
        date,
      };
    });

    // Update cache
    cachedHistory = historyData;
    historyCacheTimestamp = now;

    console.log(`[FearGreed] History fetched: ${historyData.length} days, latency=${latencyMs}ms`);

    return {
      data: historyData,
      quality: {
        mode: 'LIVE',
        latencyMs,
        ttlSec: Math.floor(HISTORY_CACHE_TTL_MS / 1000),
        missing: [],
      },
    };
  } catch (error: any) {
    console.error('[FearGreed] History fetch error:', error.message);
    
    return {
      data: cachedHistory.slice(0, limitDays),
      quality: {
        mode: cachedHistory.length > 0 ? 'DEGRADED' : 'NO_DATA',
        latencyMs: undefined,
        missing: ['fearGreedHistory'],
      },
    };
  }
}

// Get cached history without fetching
export function getCachedFearGreedHistory(): FearGreedHistoryPoint[] {
  return cachedHistory;
}

// Clear history cache (for testing)
export function clearFearGreedHistoryCache(): void {
  cachedHistory = [];
  historyCacheTimestamp = 0;
}
