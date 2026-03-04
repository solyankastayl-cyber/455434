/**
 * PHASE 1 — Coinbase Spot Provider
 * ==================================
 * 
 * ROLE: Spot Confirmation Layer (DOWNGRADE ONLY)
 * 
 * This provider:
 * - Does NOT influence verdict direction
 * - Does NOT replace Binance/Bybit
 * - ONLY provides spot market context for divergence detection
 * - ONLY downgrades confidence when spot diverges from derivatives
 */

import { IExchangeProvider, ProviderHealth, ProviderCapabilities } from '../provider.types.js';
import * as rest from './coinbase.rest.client.js';
import { CoinbaseTicker, CoinbaseCandle, CoinbaseTrade, CoinbaseSpotContext } from './coinbase.spot.types.js';

// ═══════════════════════════════════════════════════════════════
// PROVIDER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

export class CoinbaseSpotProvider implements IExchangeProvider {
  readonly id = 'COINBASE_SPOT';
  readonly name = 'Coinbase Spot';
  readonly type: 'SPOT' = 'SPOT';
  
  priority = 10; // LOW priority (confirmation layer only)
  enabled = true;
  
  // ═════════════════════════════════════════════════════════════
  // CAPABILITIES
  // ═════════════════════════════════════════════════════════════
  
  capabilities(): ProviderCapabilities {
    return {
      candles: true,
      orderbook: false, // Not using orderbook for spot confirmation
      trades: true,
      ticker: true,
      openInterest: false, // Spot doesn't have OI
      fundingRate: false,  // Spot doesn't have funding
      liquidations: false, // Spot doesn't have liquidations
      websocket: false,    // Not implementing WS for spot yet
    };
  }
  
  // ═════════════════════════════════════════════════════════════
  // HEALTH
  // ═════════════════════════════════════════════════════════════
  
  async health(): Promise<ProviderHealth> {
    const result = await rest.checkHealth();
    
    return {
      status: result.ok ? 'UP' : 'DOWN',
      latencyMs: result.latencyMs,
      lastCheck: Date.now(),
      error: result.error,
    };
  }
  
  async probe(): Promise<{ ok: boolean; httpCode?: number; reason?: string; latencyMs: number }> {
    const result = await rest.checkHealth();
    
    return {
      ok: result.ok,
      latencyMs: result.latencyMs,
      reason: result.ok ? undefined : 'CONNECTION_FAILED',
    };
  }
  
  // ═════════════════════════════════════════════════════════════
  // MARKET DATA
  // ═════════════════════════════════════════════════════════════
  
  async getTicker(symbol: string): Promise<CoinbaseTicker> {
    return rest.fetchTicker(symbol);
  }
  
  async getCandles(symbol: string, interval: string, limit: number): Promise<CoinbaseCandle[]> {
    return rest.fetchCandles(symbol, interval, limit);
  }
  
  async getTrades(symbol: string, limit: number = 100): Promise<CoinbaseTrade[]> {
    return rest.fetchTrades(symbol, limit);
  }
  
  // ═════════════════════════════════════════════════════════════
  // SPOT CONTEXT (main output for confirmation layer)
  // ═════════════════════════════════════════════════════════════
  
  /**
   * Build spot context for divergence detection
   * 
   * @param symbol - Trading pair (e.g., BTCUSDT)
   * @param derivativesPrice - Current derivatives price for comparison
   * @param derivativesBias - Current derivatives verdict (BULLISH/BEARISH/NEUTRAL)
   */
  async buildSpotContext(
    symbol: string,
    derivativesPrice: number,
    derivativesBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  ): Promise<CoinbaseSpotContext> {
    try {
      // Fetch spot data
      const [ticker, trades] = await Promise.all([
        this.getTicker(symbol),
        this.getTrades(symbol, 100),
      ]);
      
      // Calculate spot bias from recent trades
      const recentTrades = trades.slice(-50);
      const buyVolume = recentTrades
        .filter(t => t.side === 'buy')
        .reduce((sum, t) => sum + (t.price * t.size), 0);
      const sellVolume = recentTrades
        .filter(t => t.side === 'sell')
        .reduce((sum, t) => sum + (t.price * t.size), 0);
      
      const totalVolume = buyVolume + sellVolume;
      const volumeDelta = totalVolume > 0 
        ? (buyVolume - sellVolume) / totalVolume 
        : 0;
      
      // Determine spot bias
      let spotBias: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
      if (volumeDelta > 0.15) spotBias = 'BUY';
      else if (volumeDelta < -0.15) spotBias = 'SELL';
      
      // Calculate price delta vs derivatives
      const priceDelta = derivativesPrice > 0 
        ? ((ticker.price - derivativesPrice) / derivativesPrice) * 100
        : 0;
      
      // Detect divergence
      // Divergence = spot bias opposite to derivatives verdict
      const divergence = this.detectDivergence(spotBias, derivativesBias, priceDelta);
      
      // Confidence based on volume and consistency
      const confidence = Math.min(0.9, Math.abs(volumeDelta) + 0.3);
      
      return {
        symbol,
        spotPrice: ticker.price,
        spotVolume24h: ticker.volume,
        spotBias,
        volumeDelta: Math.round(volumeDelta * 1000) / 1000,
        priceDelta: Math.round(priceDelta * 100) / 100,
        divergence,
        confidence: Math.round(confidence * 100) / 100,
        dataMode: 'LIVE',
        timestamp: Date.now(),
      };
      
    } catch (error: any) {
      console.error(`[Coinbase] Failed to build spot context for ${symbol}:`, error.message);
      
      return {
        symbol,
        spotPrice: 0,
        spotVolume24h: 0,
        spotBias: 'NEUTRAL',
        volumeDelta: 0,
        priceDelta: 0,
        divergence: false,
        confidence: 0,
        dataMode: 'NO_DATA',
        timestamp: Date.now(),
      };
    }
  }
  
  /**
   * Detect divergence between spot and derivatives
   */
  private detectDivergence(
    spotBias: 'BUY' | 'SELL' | 'NEUTRAL',
    derivativesBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    priceDelta: number
  ): boolean {
    // Case 1: Derivatives bullish but spot is selling
    if (derivativesBias === 'BULLISH' && spotBias === 'SELL') {
      return true;
    }
    
    // Case 2: Derivatives bearish but spot is buying
    if (derivativesBias === 'BEARISH' && spotBias === 'BUY') {
      return true;
    }
    
    // Case 3: Significant price premium/discount
    if (Math.abs(priceDelta) > 0.5) {
      return true;
    }
    
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

export const coinbaseSpotProvider = new CoinbaseSpotProvider();

console.log('[Phase 1] Coinbase Spot Provider loaded');
