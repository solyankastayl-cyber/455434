/**
 * Binance Adapter Tests (P2.1)
 * 
 * Unit tests for candle normalization and capability routing.
 * Does NOT make real HTTP calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================
// Test Constants
// ============================================

const BINANCE_SYMBOL_MAP = {
  'ETH': 'ETHUSDT',
  'BTC': 'BTCUSDT',
  'ARB': 'ARBUSDT',
  'SOL': 'SOLUSDT',
};

const MAX_CANDLES_PER_REQUEST = 500;
const MAX_LOOKBACK_1M = 24 * 60 * 60 * 1000;
const MAX_LOOKBACK_1H = 30 * 24 * 60 * 60 * 1000;

// ============================================
// Kline Parsing Tests
// ============================================

describe('Binance Kline Parsing', () => {
  
  function parseKlines(data: any[], symbol: string, interval: string) {
    return data.map(kline => ({
      source: 'binance' as const,
      symbol: symbol.toUpperCase(),
      interval,
      ts: kline[0],
      o: parseFloat(kline[1]),
      h: parseFloat(kline[2]),
      l: parseFloat(kline[3]),
      c: parseFloat(kline[4]),
      v: parseFloat(kline[5]),
      quoteVolume: parseFloat(kline[7]),
      trades: kline[8],
      createdAt: new Date()
    }));
  }
  
  it('should parse Binance kline array correctly', () => {
    const rawKline = [
      1704067200000,   // Open time
      "2300.50",       // Open
      "2350.00",       // High
      "2290.00",       // Low
      "2340.00",       // Close
      "1000.5",        // Volume
      1704070799999,   // Close time
      "2340500.25",    // Quote asset volume
      1500,            // Number of trades
      "500.25",        // Taker buy base
      "1170250.12",    // Taker buy quote
      "0"              // Ignore
    ];
    
    const candles = parseKlines([rawKline], 'ETH', '1h');
    
    expect(candles).toHaveLength(1);
    expect(candles[0].symbol).toBe('ETH');
    expect(candles[0].source).toBe('binance');
    expect(candles[0].ts).toBe(1704067200000);
    expect(candles[0].o).toBe(2300.50);
    expect(candles[0].h).toBe(2350.00);
    expect(candles[0].l).toBe(2290.00);
    expect(candles[0].c).toBe(2340.00);
    expect(candles[0].v).toBe(1000.5);
    expect(candles[0].quoteVolume).toBe(2340500.25);
    expect(candles[0].trades).toBe(1500);
  });
  
  it('should parse multiple klines', () => {
    const rawKlines = [
      [1704067200000, "2300", "2350", "2290", "2340", "1000", 0, "2340000", 100, "0", "0", "0"],
      [1704070800000, "2340", "2360", "2330", "2355", "1200", 0, "2826000", 120, "0", "0", "0"],
      [1704074400000, "2355", "2380", "2350", "2375", "1500", 0, "3562500", 150, "0", "0", "0"],
    ];
    
    const candles = parseKlines(rawKlines, 'BTC', '1h');
    
    expect(candles).toHaveLength(3);
    expect(candles[0].ts).toBe(1704067200000);
    expect(candles[1].ts).toBe(1704070800000);
    expect(candles[2].ts).toBe(1704074400000);
  });
  
  it('should handle zero volume', () => {
    const rawKline = [
      1704067200000, "100", "100", "100", "100", "0", 0, "0", 0, "0", "0", "0"
    ];
    
    const candles = parseKlines([rawKline], 'DOGE', '1m');
    
    expect(candles[0].v).toBe(0);
    expect(candles[0].trades).toBe(0);
  });
});

// ============================================
// Symbol Mapping Tests
// ============================================

describe('Binance Symbol Mapping', () => {
  
  it('should map common symbols to USDT pairs', () => {
    expect(BINANCE_SYMBOL_MAP['ETH']).toBe('ETHUSDT');
    expect(BINANCE_SYMBOL_MAP['BTC']).toBe('BTCUSDT');
    expect(BINANCE_SYMBOL_MAP['ARB']).toBe('ARBUSDT');
    expect(BINANCE_SYMBOL_MAP['SOL']).toBe('SOLUSDT');
  });
  
  it('should return undefined for unsupported symbols', () => {
    expect(BINANCE_SYMBOL_MAP['UNKNOWN']).toBeUndefined();
    expect(BINANCE_SYMBOL_MAP['XYZ']).toBeUndefined();
  });
});

// ============================================
// Request Guards Tests
// ============================================

describe('Binance Request Guards', () => {
  
  function applyRequestGuards(
    interval: string,
    fromTs: number,
    toTs: number,
    limit: number
  ) {
    const now = Date.now();
    const maxLookback = interval === '1m' ? MAX_LOOKBACK_1M : MAX_LOOKBACK_1H;
    
    // Guard: max lookback
    const actualFromTs = Math.max(fromTs, now - maxLookback);
    
    // Guard: max candles
    const actualLimit = Math.min(limit, MAX_CANDLES_PER_REQUEST);
    
    return { actualFromTs, actualLimit };
  }
  
  it('should limit lookback for 1m interval', () => {
    const now = Date.now();
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
    
    const { actualFromTs } = applyRequestGuards('1m', twoDaysAgo, now, 100);
    
    // Should be capped to 24 hours ago
    expect(actualFromTs).toBeGreaterThan(twoDaysAgo);
    expect(actualFromTs).toBeGreaterThanOrEqual(now - MAX_LOOKBACK_1M);
  });
  
  it('should allow longer lookback for 1h interval', () => {
    const now = Date.now();
    const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;
    
    const { actualFromTs } = applyRequestGuards('1h', tenDaysAgo, now, 100);
    
    // 10 days is within 30 day limit
    expect(actualFromTs).toBe(tenDaysAgo);
  });
  
  it('should cap candle limit to MAX_CANDLES_PER_REQUEST', () => {
    const now = Date.now();
    
    const { actualLimit } = applyRequestGuards('1h', now - 3600000, now, 1000);
    
    expect(actualLimit).toBe(MAX_CANDLES_PER_REQUEST);
  });
  
  it('should not modify limit if under max', () => {
    const now = Date.now();
    
    const { actualLimit } = applyRequestGuards('1h', now - 3600000, now, 200);
    
    expect(actualLimit).toBe(200);
  });
});

// ============================================
// Rate Limit Handling Tests
// ============================================

describe('Binance Rate Limit Handling', () => {
  
  function isRateLimitError(err: any): boolean {
    return err.status === 429 || 
           err.message?.includes('429') ||
           err.message?.toLowerCase().includes('rate limit') ||
           err.code === -1015;
  }
  
  it('should detect 429 status as rate limit', () => {
    const err = { status: 429, message: 'Too many requests' };
    expect(isRateLimitError(err)).toBe(true);
  });
  
  it('should detect Binance rate limit error code', () => {
    const err = { code: -1015, message: 'Too many requests' };
    expect(isRateLimitError(err)).toBe(true);
  });
  
  it('should detect rate limit in message', () => {
    const err = { message: 'Rate limit exceeded' };
    expect(isRateLimitError(err)).toBe(true);
  });
  
  it('should not flag normal errors as rate limit', () => {
    const err = { status: 500, message: 'Internal error' };
    expect(isRateLimitError(err)).toBe(false);
  });
});

// ============================================
// Time Range Filtering Tests
// ============================================

describe('Binance Time Range Filtering', () => {
  
  function filterByTimeRange(candles: any[], fromTs?: number, toTs?: number) {
    let filtered = candles;
    if (fromTs) filtered = filtered.filter(c => c.ts >= fromTs);
    if (toTs) filtered = filtered.filter(c => c.ts <= toTs);
    return filtered;
  }
  
  it('should filter candles by fromTs', () => {
    const candles = [
      { ts: 1000 }, { ts: 2000 }, { ts: 3000 }, { ts: 4000 }
    ];
    
    const filtered = filterByTimeRange(candles, 2500);
    
    expect(filtered).toHaveLength(2);
    expect(filtered[0].ts).toBe(3000);
    expect(filtered[1].ts).toBe(4000);
  });
  
  it('should filter candles by toTs', () => {
    const candles = [
      { ts: 1000 }, { ts: 2000 }, { ts: 3000 }, { ts: 4000 }
    ];
    
    const filtered = filterByTimeRange(candles, undefined, 2500);
    
    expect(filtered).toHaveLength(2);
    expect(filtered[0].ts).toBe(1000);
    expect(filtered[1].ts).toBe(2000);
  });
  
  it('should filter by both fromTs and toTs', () => {
    const candles = [
      { ts: 1000 }, { ts: 2000 }, { ts: 3000 }, { ts: 4000 }
    ];
    
    const filtered = filterByTimeRange(candles, 1500, 3500);
    
    expect(filtered).toHaveLength(2);
    expect(filtered[0].ts).toBe(2000);
    expect(filtered[1].ts).toBe(3000);
  });
});
