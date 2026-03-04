/**
 * COINBASE ADAPTER
 * ================
 * 
 * Fetches price data from Coinbase.
 */

import type { VenueObservation } from '../contracts/assets.types.js';

const COINBASE_API = 'https://api.exchange.coinbase.com';

interface CoinbaseTicker {
  trade_id: number;
  price: string;
  size: string;
  bid: string;
  ask: string;
  volume: string;
  time: string;
}

// ═══════════════════════════════════════════════════════════════
// FETCH TICKER
// ═══════════════════════════════════════════════════════════════

export async function getCoinbaseTicker(pair: string): Promise<VenueObservation | null> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(
      `${COINBASE_API}/products/${pair}/ticker`,
      { headers: { 'Accept': 'application/json' } }
    );
    
    if (!response.ok) {
      console.warn(`[Coinbase] Ticker failed for ${pair}:`, response.status);
      return null;
    }
    
    const data: CoinbaseTicker = await response.json();
    const latencyMs = Date.now() - startTime;
    
    const price = parseFloat(data.price);
    const bidPrice = parseFloat(data.bid);
    const askPrice = parseFloat(data.ask);
    const spread = bidPrice > 0 ? ((askPrice - bidPrice) / bidPrice) * 100 : 0;
    
    // BTC-USD -> BTC
    const asset = pair.split('-')[0];
    
    let trustScore = 1.0;
    if (spread > 0.1) trustScore -= 0.1;
    if (spread > 0.5) trustScore -= 0.2;
    if (latencyMs > 500) trustScore -= 0.1;
    trustScore = Math.max(0.3, trustScore);
    
    const anomalies: string[] = [];
    if (spread > 0.5) anomalies.push('HIGH_SPREAD');
    if (latencyMs > 1000) anomalies.push('HIGH_LATENCY');
    
    return {
      venue: 'COINBASE',
      asset,
      pair,
      price,
      volume24h: parseFloat(data.volume) * price, // Convert to quote volume
      spread,
      latencyMs,
      trustScore,
      observedAt: Date.now(),
      isFresh: latencyMs < 5000,
      anomalies: anomalies.length > 0 ? anomalies : undefined,
    };
  } catch (err) {
    console.error(`[Coinbase] Error fetching ${pair}:`, err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// FETCH MULTIPLE TICKERS
// ═══════════════════════════════════════════════════════════════

export async function getCoinbaseMultipleTickers(pairs: string[]): Promise<Map<string, VenueObservation>> {
  const results = new Map<string, VenueObservation>();
  
  // Coinbase doesn't have batch endpoint, fetch sequentially
  for (const pair of pairs) {
    const observation = await getCoinbaseTicker(pair);
    if (observation) {
      results.set(pair, observation);
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════

export async function checkCoinbaseHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const response = await fetch(`${COINBASE_API}/time`);
    return {
      ok: response.ok,
      latencyMs: Date.now() - start,
    };
  } catch {
    return { ok: false, latencyMs: -1 };
  }
}

console.log('[Coinbase Adapter] Loaded');
