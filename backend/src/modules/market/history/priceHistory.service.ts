/**
 * PHASE 1.4 — Price History Service
 * ===================================
 * 
 * Service for storing and retrieving historical price data.
 */

import { PriceBarModel } from './priceBar.model.js';
import { PriceBar, Timeframe, DataSource } from './history.types.js';
import { resolveProviderForSymbol } from '../../exchange/providers/provider.selector.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

export function getTimeframeMs(tf: Timeframe): number {
  return TIMEFRAME_MS[tf] || 3600000;
}

// ═══════════════════════════════════════════════════════════════
// PRICE STORAGE
// ═══════════════════════════════════════════════════════════════

/**
 * Upsert price bars into database
 */
export async function upsertPriceBars(bars: PriceBar[]): Promise<number> {
  if (!bars.length) return 0;
  
  const ops = bars.map(bar => ({
    updateOne: {
      filter: { symbol: bar.symbol, tf: bar.tf, ts: bar.ts },
      update: { $set: bar },
      upsert: true,
    },
  }));
  
  const result = await PriceBarModel.bulkWrite(ops, { ordered: false });
  return (result.upsertedCount || 0) + (result.modifiedCount || 0);
}

/**
 * Get price bars from database
 */
export async function getPriceBars(params: {
  symbol: string;
  tf: Timeframe;
  from: number;
  to: number;
}): Promise<PriceBar[]> {
  const { symbol, tf, from, to } = params;
  
  const bars = await PriceBarModel.find({
    symbol: symbol.toUpperCase(),
    tf,
    ts: { $gte: from, $lte: to },
  })
  .sort({ ts: 1 })
  .lean();
  
  return bars as PriceBar[];
}

/**
 * Get price bar at specific timestamp
 */
export async function getPriceBarAt(params: {
  symbol: string;
  tf: Timeframe;
  ts: number;
}): Promise<PriceBar | null> {
  const { symbol, tf, ts } = params;
  
  // Find closest bar at or after timestamp
  const bar = await PriceBarModel.findOne({
    symbol: symbol.toUpperCase(),
    tf,
    ts: { $gte: ts },
  })
  .sort({ ts: 1 })
  .lean();
  
  return bar as PriceBar | null;
}

/**
 * Count price bars in database
 */
export async function countPriceBars(params: {
  symbol: string;
  tf: Timeframe;
  from?: number;
  to?: number;
}): Promise<number> {
  const { symbol, tf, from, to } = params;
  
  const query: any = { symbol: symbol.toUpperCase(), tf };
  if (from !== undefined) query.ts = { ...query.ts, $gte: from };
  if (to !== undefined) query.ts = { ...query.ts, $lte: to };
  
  return PriceBarModel.countDocuments(query);
}

// ═══════════════════════════════════════════════════════════════
// FETCH FROM PROVIDER
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch price bars from provider and store
 */
export async function fetchAndStorePriceBars(params: {
  symbol: string;
  tf: Timeframe;
  from: number;
  to: number;
  limit?: number;
}): Promise<{ fetched: number; stored: number; source: DataSource }> {
  const { symbol, tf, from, to, limit = 500 } = params;
  
  try {
    // Resolve provider
    const provider = await resolveProviderForSymbol(symbol);
    const source = provider.id as DataSource;
    
    // Fetch candles
    const candles = await provider.getCandles(symbol, tf, limit);
    
    // Filter by time range
    const filtered = candles.filter((c: any) => c.t >= from && c.t <= to);
    
    // Map to PriceBar format
    const bars: PriceBar[] = filtered.map((c: any) => ({
      symbol: symbol.toUpperCase(),
      tf,
      ts: c.t,
      o: c.o,
      h: c.h,
      l: c.l,
      c: c.c,
      v: c.v,
      source,
    }));
    
    // Store
    const stored = await upsertPriceBars(bars);
    
    return { fetched: bars.length, stored, source };
  } catch (error) {
    console.error(`[PriceHistory] Error fetching prices for ${symbol}:`, error);
    throw error;
  }
}

console.log('[Phase 1.4] PriceHistory Service loaded');
