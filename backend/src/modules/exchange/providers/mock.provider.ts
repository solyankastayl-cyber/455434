/**
 * X1 — Mock Exchange Provider
 * ============================
 * 
 * Fallback provider for testing and when real providers unavailable.
 * Returns deterministic mock data.
 */

import {
  IExchangeProvider,
  ProviderId,
  ProviderHealth,
  MarketSymbol,
  Candle,
  OrderBook,
  Trade,
  OISnapshot,
  FundingSnapshot,
} from './exchangeProvider.types.js';

// Mock symbols
const MOCK_SYMBOLS: MarketSymbol[] = [
  { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', status: 'TRADING', minQty: 0.001, tickSize: 0.01 },
  { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT', status: 'TRADING', minQty: 0.01, tickSize: 0.01 },
  { symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT', status: 'TRADING', minQty: 0.1, tickSize: 0.001 },
  { symbol: 'BNBUSDT', base: 'BNB', quote: 'USDT', status: 'TRADING', minQty: 0.01, tickSize: 0.01 },
  { symbol: 'XRPUSDT', base: 'XRP', quote: 'USDT', status: 'TRADING', minQty: 1, tickSize: 0.0001 },
];

// Mock prices
const MOCK_PRICES: Record<string, number> = {
  BTCUSDT: 95000,
  ETHUSDT: 3500,
  SOLUSDT: 180,
  BNBUSDT: 650,
  XRPUSDT: 2.5,
};

/**
 * Generate deterministic seed from inputs
 */
function hashSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Generate mock candles
 */
function generateCandles(symbol: string, interval: string, limit: number): Candle[] {
  const basePrice = MOCK_PRICES[symbol] || 100;
  const now = Date.now();
  const intervalMs = interval === '1m' ? 60000 : interval === '5m' ? 300000 : 3600000;
  
  const candles: Candle[] = [];
  let price = basePrice;
  
  for (let i = limit - 1; i >= 0; i--) {
    const seed = hashSeed(`${symbol}:${i}:${interval}`);
    const change = ((seed % 200) - 100) / 10000;
    
    const open = price;
    const close = price * (1 + change);
    const high = Math.max(open, close) * (1 + Math.abs(change) * 0.5);
    const low = Math.min(open, close) * (1 - Math.abs(change) * 0.5);
    const volume = basePrice * 100 * (0.5 + (seed % 100) / 100);
    
    candles.push({
      t: now - i * intervalMs,
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume,
    });
    
    price = close;
  }
  
  return candles;
}

/**
 * Mock Exchange Provider
 */
export class MockExchangeProvider implements IExchangeProvider {
  readonly id: ProviderId = 'MOCK';
  
  async health(): Promise<ProviderHealth> {
    return {
      id: 'MOCK',
      status: 'UP',
      errorStreak: 0,
      lastOkAt: Date.now(),
      notes: ['Mock provider - always healthy'],
    };
  }
  
  async getSymbols(): Promise<MarketSymbol[]> {
    return MOCK_SYMBOLS;
  }
  
  async getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    return generateCandles(symbol, interval, limit);
  }
  
  async getOrderBook(symbol: string, depth: number): Promise<OrderBook> {
    const basePrice = MOCK_PRICES[symbol] || 100;
    const spread = basePrice * 0.0001;
    
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];
    
    for (let i = 0; i < Math.min(depth, 20); i++) {
      const bidPrice = basePrice - spread * (i + 1);
      const askPrice = basePrice + spread * (i + 1);
      const qty = 10 / (i + 1);
      
      bids.push([bidPrice, qty]);
      asks.push([askPrice, qty]);
    }
    
    return {
      t: Date.now(),
      bids,
      asks,
      mid: basePrice,
    };
  }
  
  async getTrades(symbol: string, limit: number): Promise<Trade[]> {
    const basePrice = MOCK_PRICES[symbol] || 100;
    const trades: Trade[] = [];
    
    for (let i = 0; i < limit; i++) {
      const seed = hashSeed(`${symbol}:trade:${i}`);
      trades.push({
        t: Date.now() - i * 1000,
        price: basePrice * (1 + ((seed % 100) - 50) / 10000),
        qty: 0.1 + (seed % 100) / 100,
        side: seed % 2 === 0 ? 'BUY' : 'SELL',
        isBuyerMaker: seed % 2 === 0,
      });
    }
    
    return trades;
  }
  
  async getOpenInterest(symbol: string): Promise<OISnapshot | null> {
    const basePrice = MOCK_PRICES[symbol];
    if (!basePrice) return null;
    
    return {
      t: Date.now(),
      openInterest: 50000,
      openInterestUsd: 50000 * basePrice,
    };
  }
  
  async getFunding(symbol: string): Promise<FundingSnapshot | null> {
    const seed = hashSeed(`${symbol}:funding:${Math.floor(Date.now() / 28800000)}`);
    
    return {
      t: Date.now(),
      fundingRate: ((seed % 200) - 100) / 100000,  // -0.001 to +0.001
      nextFundingTime: Date.now() + 4 * 3600000,
    };
  }
}

// Export singleton
export const mockExchangeProvider = new MockExchangeProvider();

console.log('[X1] Mock Exchange Provider loaded');
