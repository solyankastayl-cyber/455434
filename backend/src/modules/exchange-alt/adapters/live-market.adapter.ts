/**
 * LIVE MARKET DATA ADAPTER — Real data from Binance/Bybit
 * ========================================================
 * 
 * Uses existing exchange providers for real market data.
 * Falls back to secondary provider on failure.
 */

import type { IMarketDataPort } from '../market-data.port.js';
import type {
  UniverseAsset,
  MarketOHLCV,
  DerivativesSnapshot,
  TickerSnapshot,
  Timeframe,
  Venue,
} from '../types.js';
import { ALT_DEFAULT_UNIVERSE } from '../constants.js';

// Import existing providers
import { bybitUsdtPerpProvider } from '../../exchange/providers/bybit.usdtperp.provider.js';
import { binanceUSDMProvider } from '../../exchange/providers/binance.usdm.provider.js';
import type { IExchangeProvider } from '../../exchange/providers/exchangeProvider.types.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CACHE_TTL = 5000; // 5 seconds cache

// ═══════════════════════════════════════════════════════════════
// LIVE MARKET DATA ADAPTER
// ═══════════════════════════════════════════════════════════════

export class LiveMarketDataAdapter implements IMarketDataPort {
  private primaryProvider: IExchangeProvider;
  private secondaryProvider: IExchangeProvider;
  private venue: Venue;
  
  // Cache
  private tickerCache: Map<string, { data: TickerSnapshot; ts: number }> = new Map();
  private derivativesCache: Map<string, { data: DerivativesSnapshot; ts: number }> = new Map();
  
  constructor(
    primary: 'BYBIT' | 'BINANCE' = 'BYBIT',
    venue: Venue = 'BYBIT'
  ) {
    if (primary === 'BYBIT') {
      this.primaryProvider = bybitUsdtPerpProvider;
      this.secondaryProvider = binanceUSDMProvider;
    } else {
      this.primaryProvider = binanceUSDMProvider;
      this.secondaryProvider = bybitUsdtPerpProvider;
    }
    this.venue = venue;
    console.log(`[LiveAdapter] Initialized with primary=${primary}`);
  }

  // ─────────────────────────────────────────────────────────────
  // UNIVERSE
  // ─────────────────────────────────────────────────────────────

  async getUniverse(): Promise<UniverseAsset[]> {
    try {
      // Get available symbols from provider
      const symbols = await this.primaryProvider.getSymbols();
      const availableSet = new Set(symbols.map(s => s.symbol));
      
      // Filter our default universe to only include available symbols
      return ALT_DEFAULT_UNIVERSE
        .filter(symbol => availableSet.has(symbol))
        .map(symbol => ({
          symbol,
          base: symbol.replace('USDT', ''),
          quote: 'USDT',
          venue: this.venue,
          enabled: true,
          tags: this.inferTags(symbol),
        }));
    } catch (error) {
      console.error('[LiveAdapter] Failed to get universe, using default:', error);
      return ALT_DEFAULT_UNIVERSE.map(symbol => ({
        symbol,
        base: symbol.replace('USDT', ''),
        quote: 'USDT',
        venue: this.venue,
        enabled: true,
        tags: this.inferTags(symbol),
      }));
    }
  }

  private inferTags(symbol: string): string[] {
    const base = symbol.replace('USDT', '');
    const tags: string[] = [];
    
    // L1
    if (['ETH', 'SOL', 'AVAX', 'DOT', 'ATOM', 'NEAR', 'APT', 'SUI', 'SEI', 'INJ'].includes(base)) {
      tags.push('L1');
    }
    // L2
    if (['MATIC', 'ARB', 'OP', 'MANTA', 'METIS', 'STX'].includes(base)) {
      tags.push('L2');
    }
    // DeFi
    if (['LINK', 'UNI', 'AAVE', 'MKR', 'SNX', 'CRV', 'COMP', '1INCH'].includes(base)) {
      tags.push('DEFI');
    }
    // Meme
    if (['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI'].includes(base)) {
      tags.push('MEME');
    }
    // AI
    if (['FET', 'RENDER', 'TAO', 'AGIX', 'OCEAN'].includes(base)) {
      tags.push('AI');
    }
    // Gaming
    if (['AXS', 'SAND', 'MANA', 'GALA', 'IMX'].includes(base)) {
      tags.push('GAMING');
    }
    
    return tags;
  }

  // ─────────────────────────────────────────────────────────────
  // OHLCV
  // ─────────────────────────────────────────────────────────────

  async getOHLCV({
    symbol,
    timeframe,
    limit,
  }: {
    symbol: string;
    timeframe: Timeframe;
    limit: number;
  }): Promise<MarketOHLCV[]> {
    const interval = this.mapTimeframe(timeframe);
    
    try {
      const candles = await this.primaryProvider.getCandles(symbol, interval, limit);
      return candles.map(c => ({
        ts: c.t,
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
        volume: c.v,
      }));
    } catch (primaryError) {
      console.warn(`[LiveAdapter] Primary OHLCV failed for ${symbol}, trying secondary:`, primaryError);
      
      try {
        const candles = await this.secondaryProvider.getCandles(symbol, interval, limit);
        return candles.map(c => ({
          ts: c.t,
          open: c.o,
          high: c.h,
          low: c.l,
          close: c.c,
          volume: c.v,
        }));
      } catch (secondaryError) {
        console.error(`[LiveAdapter] Both providers failed for OHLCV ${symbol}:`, secondaryError);
        return [];
      }
    }
  }

  private mapTimeframe(tf: Timeframe): string {
    const map: Record<Timeframe, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '1h': '1h',
      '4h': '4h',
      '1d': '1d',
    };
    return map[tf] || '1h';
  }

  // ─────────────────────────────────────────────────────────────
  // DERIVATIVES
  // ─────────────────────────────────────────────────────────────

  async getDerivativesSnapshot({ symbol }: { symbol: string }): Promise<DerivativesSnapshot> {
    // Check cache
    const cached = this.derivativesCache.get(symbol);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return cached.data;
    }

    const [funding, oi] = await Promise.all([
      this.getFundingSafe(symbol),
      this.getOpenInterestSafe(symbol),
    ]);

    // Get previous OI for delta calculation
    const prevOi = oi ? oi.openInterest : 0;

    const snapshot: DerivativesSnapshot = {
      fundingRate: funding?.fundingRate ?? 0,
      openInterest: oi?.openInterest ?? 0,
      openInterestDelta1h: 0, // Would need historical data
      longShortRatio: 0.5, // Not available from basic API
      liquidationBuyUsd: 0, // Would need separate endpoint
      liquidationSellUsd: 0,
      basis: 0, // Would need spot price comparison
    };

    // Cache
    this.derivativesCache.set(symbol, { data: snapshot, ts: Date.now() });
    
    return snapshot;
  }

  private async getFundingSafe(symbol: string) {
    try {
      return await this.primaryProvider.getFunding(symbol);
    } catch {
      try {
        return await this.secondaryProvider.getFunding(symbol);
      } catch {
        return null;
      }
    }
  }

  private async getOpenInterestSafe(symbol: string) {
    try {
      return await this.primaryProvider.getOpenInterest(symbol);
    } catch {
      try {
        return await this.secondaryProvider.getOpenInterest(symbol);
      } catch {
        return null;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // TICKER
  // ─────────────────────────────────────────────────────────────

  async getTicker(symbol: string): Promise<TickerSnapshot | null> {
    // Check cache
    const cached = this.tickerCache.get(symbol);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return cached.data;
    }

    try {
      const candles = await this.primaryProvider.getCandles(symbol, '1d', 2);
      
      if (candles.length < 2) return null;
      
      const current = candles[candles.length - 1];
      const prev = candles[candles.length - 2];
      
      const ticker: TickerSnapshot = {
        symbol,
        lastPrice: current.c,
        priceChange24h: current.c - prev.c,
        priceChangePct24h: ((current.c - prev.c) / prev.c) * 100,
        volume24h: current.v,
        high24h: current.h,
        low24h: current.l,
      };
      
      this.tickerCache.set(symbol, { data: ticker, ts: Date.now() });
      return ticker;
    } catch (primaryError) {
      try {
        const candles = await this.secondaryProvider.getCandles(symbol, '1d', 2);
        
        if (candles.length < 2) return null;
        
        const current = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        
        const ticker: TickerSnapshot = {
          symbol,
          lastPrice: current.c,
          priceChange24h: current.c - prev.c,
          priceChangePct24h: ((current.c - prev.c) / prev.c) * 100,
          volume24h: current.v,
          high24h: current.h,
          low24h: current.l,
        };
        
        this.tickerCache.set(symbol, { data: ticker, ts: Date.now() });
        return ticker;
      } catch {
        return null;
      }
    }
  }

  async getLastPrice(symbol: string): Promise<number | null> {
    const ticker = await this.getTicker(symbol);
    return ticker?.lastPrice ?? null;
  }

  async getTickers(symbols: string[]): Promise<TickerSnapshot[]> {
    // Batch fetch with concurrency limit
    const batchSize = 10;
    const tickers: TickerSnapshot[] = [];
    
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(s => this.getTicker(s).catch(() => null))
      );
      
      for (const ticker of results) {
        if (ticker) tickers.push(ticker);
      }
    }
    
    return tickers;
  }

  // ─────────────────────────────────────────────────────────────
  // HEALTH
  // ─────────────────────────────────────────────────────────────

  async checkHealth(): Promise<{ primary: boolean; secondary: boolean }> {
    const [primaryHealth, secondaryHealth] = await Promise.all([
      this.primaryProvider.health(),
      this.secondaryProvider.health(),
    ]);
    
    return {
      primary: primaryHealth.status === 'UP',
      secondary: secondaryHealth.status === 'UP',
    };
  }

  getVenue(): Venue {
    return this.venue;
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

export const liveMarketDataAdapter = new LiveMarketDataAdapter('BYBIT', 'BYBIT');

console.log('[ExchangeAlt] Live Market Data Adapter loaded');
