/**
 * PHASE 1.3 — Price Service
 * ==========================
 * 
 * Fetches historical price data from providers.
 */

import { MarketPriceBar } from './chart.types.js';
import { resolveProviderForSymbol } from '../../exchange/providers/provider.selector.js';
import { getProvider } from '../../exchange/providers/provider.registry.js';

// ═══════════════════════════════════════════════════════════════
// TIMEFRAME MAPPING
// ═══════════════════════════════════════════════════════════════

const TIMEFRAME_MS: Record<string, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

export function getTimeframeMs(tf: string): number {
  return TIMEFRAME_MS[tf] || 60 * 60 * 1000;
}

// ═══════════════════════════════════════════════════════════════
// PRICE FETCHING
// ═══════════════════════════════════════════════════════════════

export interface PriceHistoryParams {
  symbol: string;
  timeframe: string;
  from?: number;      // unix ms
  to?: number;        // unix ms
  limit?: number;     // max bars
}

/**
 * Fetch price history from provider
 */
export async function getPriceHistory(params: PriceHistoryParams): Promise<{
  bars: MarketPriceBar[];
  provider: string;
  dataMode: 'LIVE' | 'MOCK';
}> {
  const { symbol, timeframe, limit = 200 } = params;
  
  // Calculate time window
  const to = params.to || Date.now();
  const tfMs = getTimeframeMs(timeframe);
  const from = params.from || (to - tfMs * limit);
  
  try {
    // Resolve provider
    const provider = await resolveProviderForSymbol(symbol);
    const providerId = provider.id;
    
    // Fetch candles
    const candles = await provider.getCandles(symbol, timeframe, limit);
    
    // Map to our format
    const bars: MarketPriceBar[] = candles.map((c: any) => ({
      ts: c.t,
      o: c.o,
      h: c.h,
      l: c.l,
      c: c.c,
      v: c.v,
    }));
    
    // Filter by time window
    const filteredBars = bars.filter(b => b.ts >= from && b.ts <= to);
    
    // Sort by time ascending
    filteredBars.sort((a, b) => a.ts - b.ts);
    
    const dataMode = providerId === 'MOCK' ? 'MOCK' : 'LIVE';
    
    return {
      bars: filteredBars,
      provider: providerId,
      dataMode,
    };
  } catch (error) {
    console.error(`[Price Service] Error fetching prices for ${symbol}:`, error);
    return {
      bars: [],
      provider: 'ERROR',
      dataMode: 'MOCK',
    };
  }
}

/**
 * Generate mock price history for testing
 */
export function generateMockPriceHistory(params: {
  symbol: string;
  timeframe: string;
  from: number;
  to: number;
}): MarketPriceBar[] {
  const { symbol, timeframe, from, to } = params;
  const tfMs = getTimeframeMs(timeframe);
  
  // Deterministic seed based on symbol
  const seed = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  
  // Base price based on symbol
  let basePrice = 50000;
  if (symbol.includes('ETH')) basePrice = 3000;
  else if (symbol.includes('SOL')) basePrice = 100;
  else if (symbol.includes('BNB')) basePrice = 400;
  else if (symbol.includes('XRP')) basePrice = 0.5;
  
  const bars: MarketPriceBar[] = [];
  let price = basePrice;
  
  for (let ts = from; ts <= to; ts += tfMs) {
    // Pseudo-random walk
    const hourSeed = Math.floor(ts / 3600000);
    const rand = ((hourSeed * seed) % 1000) / 1000;
    const change = (rand - 0.5) * 0.01; // ±0.5%
    
    price = price * (1 + change);
    
    const volatility = 0.005;
    const h = price * (1 + volatility * rand);
    const l = price * (1 - volatility * rand);
    const o = (h + l) / 2;
    const c = price;
    
    bars.push({
      ts,
      o,
      h,
      l,
      c,
      v: Math.floor(1000000 * rand),
    });
  }
  
  return bars;
}

console.log('[Phase 1.3] Price Service loaded');
