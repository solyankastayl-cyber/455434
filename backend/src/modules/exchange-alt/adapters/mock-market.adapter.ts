/**
 * MOCK MARKET DATA ADAPTER — For development/testing
 * ===================================================
 */

import type { IMarketDataPort } from '../market-data.port.js';
import type {
  UniverseAsset,
  MarketOHLCV,
  DerivativesSnapshot,
  TickerSnapshot,
  Timeframe,
} from '../types.js';
import { ALT_DEFAULT_UNIVERSE } from '../constants.js';

export class MockMarketDataAdapter implements IMarketDataPort {
  private priceCache: Map<string, number> = new Map();
  
  async getUniverse(): Promise<UniverseAsset[]> {
    return ALT_DEFAULT_UNIVERSE.map(symbol => ({
      symbol,
      base: symbol.replace('USDT', ''),
      quote: 'USDT',
      venue: 'MOCK' as const,
      enabled: true,
      tags: this.inferTags(symbol),
    }));
  }
  
  private inferTags(symbol: string): string[] {
    const base = symbol.replace('USDT', '');
    const tags: string[] = [];
    
    if (['ETH', 'SOL', 'AVAX', 'DOT', 'ATOM', 'NEAR', 'APT', 'SUI'].includes(base)) {
      tags.push('L1');
    }
    if (['MATIC', 'ARB', 'OP', 'INJ'].includes(base)) {
      tags.push('L2');
    }
    if (['LINK', 'UNI', 'AAVE', 'MKR', 'SNX'].includes(base)) {
      tags.push('DEFI');
    }
    if (['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK'].includes(base)) {
      tags.push('MEME');
    }
    if (['FET', 'RENDER', 'TAO'].includes(base)) {
      tags.push('AI');
    }
    
    return tags;
  }

  async getOHLCV({
    symbol,
    timeframe,
    limit,
  }: {
    symbol: string;
    timeframe: Timeframe;
    limit: number;
  }): Promise<MarketOHLCV[]> {
    const now = Date.now();
    const step = this.tfToMs(timeframe);
    
    // Get or create base price
    let price: number = this.priceCache.get(symbol) ?? this.getBasePrice(symbol);
    this.priceCache.set(symbol, price);
    
    const candles: MarketOHLCV[] = [];
    
    for (let i = 0; i < limit; i++) {
      const ts = now - (limit - i) * step;
      
      // Random walk with mean reversion
      const drift = (Math.random() - 0.5) * 0.03 * price;
      const reversion = (this.getBasePrice(symbol) - price) * 0.01;
      price = price + drift + reversion;
      
      const volatility = 0.01 + Math.random() * 0.02;
      const range = price * volatility;
      
      const open = price;
      const close: number = price + (Math.random() - 0.5) * range;
      
      candles.push({
        ts,
        open,
        high: Math.max(open, close) + Math.random() * range * 0.5,
        low: Math.min(open, close) - Math.random() * range * 0.5,
        close,
        volume: 1_000_000 + Math.random() * 10_000_000,
      });
      
      price = close;
    }
    
    this.priceCache.set(symbol, price);
    return candles;
  }
  
  private tfToMs(tf: Timeframe): number {
    const map: Record<Timeframe, number> = {
      '1m': 60_000,
      '5m': 5 * 60_000,
      '15m': 15 * 60_000,
      '1h': 60 * 60_000,
      '4h': 4 * 60 * 60_000,
      '1d': 24 * 60 * 60_000,
    };
    return map[tf] || 60_000;
  }
  
  private getBasePrice(symbol: string): number {
    const base = symbol.replace('USDT', '');
    const basePrices: Record<string, number> = {
      'ETH': 2500,
      'SOL': 120,
      'AVAX': 35,
      'DOT': 7,
      'ATOM': 9,
      'NEAR': 5,
      'APT': 9,
      'SUI': 1.5,
      'MATIC': 0.8,
      'ARB': 1.2,
      'OP': 2.5,
      'INJ': 25,
      'LINK': 15,
      'UNI': 7,
      'AAVE': 150,
      'MKR': 1500,
      'SNX': 3,
      'DOGE': 0.15,
      'SHIB': 0.00002,
      'PEPE': 0.00001,
      'WIF': 2,
      'BONK': 0.00002,
      'FET': 1.5,
      'RENDER': 7,
      'TAO': 400,
      'BNB': 600,
      'FTM': 0.7,
      'XRP': 0.5,
      'ADA': 0.5,
      'LTC': 80,
      'BCH': 400,
      'ETC': 25,
    };
    return basePrices[base] || 10;
  }

  async getDerivativesSnapshot(_params: {
    symbol: string;
  }): Promise<DerivativesSnapshot> {
    // Generate realistic mock derivatives data
    const fundingBias = (Math.random() - 0.5) * 2; // -1 to +1
    
    return {
      fundingRate: fundingBias * 0.0005 + (Math.random() - 0.5) * 0.0002,
      openInterest: 50_000_000 + Math.random() * 100_000_000,
      openInterestDelta1h: (Math.random() - 0.5) * 10,
      longShortRatio: 0.4 + Math.random() * 0.3,
      liquidationBuyUsd: Math.random() * 5_000_000,
      liquidationSellUsd: Math.random() * 5_000_000,
      basis: (Math.random() - 0.5) * 0.002,
    };
  }

  async getTicker(symbol: string): Promise<TickerSnapshot | null> {
    let price = this.priceCache.get(symbol);
    if (!price) {
      price = this.getBasePrice(symbol);
      this.priceCache.set(symbol, price);
    }
    
    const change24h = (Math.random() - 0.5) * 0.2 * price;
    
    return {
      symbol,
      lastPrice: price,
      priceChange24h: change24h,
      priceChangePct24h: (change24h / (price - change24h)) * 100,
      volume24h: 10_000_000 + Math.random() * 100_000_000,
      high24h: price * (1 + Math.random() * 0.1),
      low24h: price * (1 - Math.random() * 0.1),
    };
  }

  async getLastPrice(symbol: string): Promise<number | null> {
    const ticker = await this.getTicker(symbol);
    return ticker?.lastPrice ?? null;
  }

  async getTickers(symbols: string[]): Promise<TickerSnapshot[]> {
    const tickers: TickerSnapshot[] = [];
    for (const symbol of symbols) {
      const ticker = await this.getTicker(symbol);
      if (ticker) tickers.push(ticker);
    }
    return tickers;
  }
}

console.log('[ExchangeAlt] Mock adapter loaded');
