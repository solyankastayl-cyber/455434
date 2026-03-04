/**
 * BYBIT ADAPTER
 * =============
 * 
 * Fetches price data from Bybit.
 */

import type { VenueObservation } from '../contracts/assets.types.js';

const BYBIT_API = 'https://api.bybit.com';

interface BybitTicker {
  symbol: string;
  lastPrice: string;
  bid1Price: string;
  ask1Price: string;
  volume24h: string;
  turnover24h: string;
  price24hPcnt: string;
}

interface BybitResponse {
  retCode: number;
  retMsg: string;
  result: {
    list: BybitTicker[];
  };
}

// ═══════════════════════════════════════════════════════════════
// FETCH TICKER
// ═══════════════════════════════════════════════════════════════

export async function getBybitTicker(pair: string): Promise<VenueObservation | null> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(
      `${BYBIT_API}/v5/market/tickers?category=spot&symbol=${pair}`,
      { headers: { 'Accept': 'application/json' } }
    );
    
    if (!response.ok) {
      console.warn(`[Bybit] Ticker failed for ${pair}:`, response.status);
      return null;
    }
    
    const data: BybitResponse = await response.json();
    const latencyMs = Date.now() - startTime;
    
    if (data.retCode !== 0 || !data.result.list.length) {
      return null;
    }
    
    const ticker = data.result.list[0];
    const price = parseFloat(ticker.lastPrice);
    const bidPrice = parseFloat(ticker.bid1Price);
    const askPrice = parseFloat(ticker.ask1Price);
    const spread = bidPrice > 0 ? ((askPrice - bidPrice) / bidPrice) * 100 : 0;
    
    const asset = pair.replace(/USDT$|USD$|USDC$/i, '');
    
    let trustScore = 1.0;
    if (spread > 0.1) trustScore -= 0.1;
    if (spread > 0.5) trustScore -= 0.2;
    if (latencyMs > 500) trustScore -= 0.1;
    trustScore = Math.max(0.3, trustScore);
    
    const anomalies: string[] = [];
    if (spread > 0.5) anomalies.push('HIGH_SPREAD');
    if (latencyMs > 1000) anomalies.push('HIGH_LATENCY');
    
    return {
      venue: 'BYBIT',
      asset,
      pair,
      price,
      volume24h: parseFloat(ticker.turnover24h),
      spread,
      latencyMs,
      trustScore,
      observedAt: Date.now(),
      isFresh: latencyMs < 5000,
      anomalies: anomalies.length > 0 ? anomalies : undefined,
    };
  } catch (err) {
    console.error(`[Bybit] Error fetching ${pair}:`, err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// FETCH MULTIPLE TICKERS
// ═══════════════════════════════════════════════════════════════

export async function getBybitMultipleTickers(pairs: string[]): Promise<Map<string, VenueObservation>> {
  const results = new Map<string, VenueObservation>();
  
  try {
    const response = await fetch(`${BYBIT_API}/v5/market/tickers?category=spot`);
    if (!response.ok) return results;
    
    const data: BybitResponse = await response.json();
    const pairSet = new Set(pairs.map(p => p.toUpperCase()));
    
    for (const ticker of data.result.list) {
      if (!pairSet.has(ticker.symbol)) continue;
      
      const price = parseFloat(ticker.lastPrice);
      const bidPrice = parseFloat(ticker.bid1Price);
      const askPrice = parseFloat(ticker.ask1Price);
      const spread = bidPrice > 0 ? ((askPrice - bidPrice) / bidPrice) * 100 : 0;
      
      const asset = ticker.symbol.replace(/USDT$|USD$|USDC$/i, '');
      
      results.set(ticker.symbol, {
        venue: 'BYBIT',
        asset,
        pair: ticker.symbol,
        price,
        volume24h: parseFloat(ticker.turnover24h),
        spread,
        latencyMs: 0,
        trustScore: spread < 0.5 ? 0.9 : 0.75,
        observedAt: Date.now(),
        isFresh: true,
      });
    }
  } catch (err) {
    console.error('[Bybit] Batch ticker error:', err);
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════

export async function checkBybitHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const response = await fetch(`${BYBIT_API}/v5/market/time`);
    return {
      ok: response.ok,
      latencyMs: Date.now() - start,
    };
  } catch {
    return { ok: false, latencyMs: -1 };
  }
}

console.log('[Bybit Adapter] Loaded');
