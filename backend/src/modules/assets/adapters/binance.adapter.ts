/**
 * BINANCE ADAPTER
 * ===============
 * 
 * Fetches price data from Binance.
 * Returns VenueObservation format.
 */

import type { VenueObservation } from '../contracts/assets.types.js';

const BINANCE_API = 'https://api.binance.com';

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  volume: string;
  quoteVolume: string;
  bidPrice: string;
  askPrice: string;
}

// ═══════════════════════════════════════════════════════════════
// FETCH TICKER
// ═══════════════════════════════════════════════════════════════

export async function getBinanceTicker(pair: string): Promise<VenueObservation | null> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${BINANCE_API}/api/v3/ticker/24hr?symbol=${pair}`, {
      headers: { 'Accept': 'application/json' },
    });
    
    if (!response.ok) {
      console.warn(`[Binance] Ticker failed for ${pair}:`, response.status);
      return null;
    }
    
    const data: BinanceTicker = await response.json();
    const latencyMs = Date.now() - startTime;
    
    const price = parseFloat(data.lastPrice);
    const bidPrice = parseFloat(data.bidPrice);
    const askPrice = parseFloat(data.askPrice);
    const spread = bidPrice > 0 ? ((askPrice - bidPrice) / bidPrice) * 100 : 0;
    
    // Extract asset from pair (BTCUSDT -> BTC)
    const asset = pair.replace(/USDT$|USD$|USDC$|BUSD$/i, '');
    
    // Calculate trust score based on spread and latency
    let trustScore = 1.0;
    if (spread > 0.1) trustScore -= 0.1;
    if (spread > 0.5) trustScore -= 0.2;
    if (latencyMs > 500) trustScore -= 0.1;
    if (latencyMs > 1000) trustScore -= 0.2;
    trustScore = Math.max(0.3, trustScore);
    
    const anomalies: string[] = [];
    if (spread > 0.5) anomalies.push('HIGH_SPREAD');
    if (latencyMs > 1000) anomalies.push('HIGH_LATENCY');
    
    return {
      venue: 'BINANCE',
      asset,
      pair,
      price,
      volume24h: parseFloat(data.quoteVolume),
      spread,
      latencyMs,
      trustScore,
      observedAt: Date.now(),
      isFresh: latencyMs < 5000,
      anomalies: anomalies.length > 0 ? anomalies : undefined,
    };
  } catch (err) {
    console.error(`[Binance] Error fetching ${pair}:`, err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// FETCH MULTIPLE TICKERS
// ═══════════════════════════════════════════════════════════════

export async function getBinanceMultipleTickers(pairs: string[]): Promise<Map<string, VenueObservation>> {
  const results = new Map<string, VenueObservation>();
  
  // Binance allows batch ticker request
  try {
    const response = await fetch(`${BINANCE_API}/api/v3/ticker/24hr`);
    if (!response.ok) return results;
    
    const data: BinanceTicker[] = await response.json();
    const pairSet = new Set(pairs.map(p => p.toUpperCase()));
    
    for (const ticker of data) {
      if (!pairSet.has(ticker.symbol)) continue;
      
      const price = parseFloat(ticker.lastPrice);
      const bidPrice = parseFloat(ticker.bidPrice);
      const askPrice = parseFloat(ticker.askPrice);
      const spread = bidPrice > 0 ? ((askPrice - bidPrice) / bidPrice) * 100 : 0;
      
      const asset = ticker.symbol.replace(/USDT$|USD$|USDC$|BUSD$/i, '');
      
      results.set(ticker.symbol, {
        venue: 'BINANCE',
        asset,
        pair: ticker.symbol,
        price,
        volume24h: parseFloat(ticker.quoteVolume),
        spread,
        latencyMs: 0,
        trustScore: spread < 0.5 ? 0.95 : 0.8,
        observedAt: Date.now(),
        isFresh: true,
      });
    }
  } catch (err) {
    console.error('[Binance] Batch ticker error:', err);
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════

export async function checkBinanceHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const response = await fetch(`${BINANCE_API}/api/v3/ping`);
    return {
      ok: response.ok,
      latencyMs: Date.now() - start,
    };
  } catch {
    return { ok: false, latencyMs: -1 };
  }
}

console.log('[Binance Adapter] Loaded');
