/**
 * P13: Price Loader Service (asOf-safe)
 * Uses REAL data from MongoDB collections:
 * - SPX: spx_candles
 * - BTC: fractal_canonical_ohlcv
 */

import { getDb } from '../../../db/mongodb.js';
import { Db } from 'mongodb';

export interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  return1d?: number;
  return1w?: number;
}

class PriceLoaderService {
  private db: Db | null = null;
  private cache: Map<string, Map<string, PriceData>> = new Map();
  
  private async ensureDb(): Promise<Db> {
    if (!this.db) {
      this.db = await getDb();
    }
    return this.db;
  }
  
  /**
   * Load all candles for an asset into cache (faster than individual queries)
   */
  private async loadCache(asset: 'spx' | 'btc'): Promise<Map<string, PriceData>> {
    if (this.cache.has(asset)) {
      return this.cache.get(asset)!;
    }
    
    const db = await this.ensureDb();
    const collection = asset === 'spx' ? 'spx_candles' : 'fractal_canonical_ohlcv';
    
    console.log(`[PriceLoader] Loading ${asset} candles from ${collection}...`);
    
    const candles = await db.collection(collection)
      .find({})
      .sort({ date: 1 })
      .project({ _id: 0, date: 1, open: 1, high: 1, low: 1, close: 1 })
      .toArray();
    
    const priceMap = new Map<string, PriceData>();
    
    for (const c of candles) {
      // Handle various date formats
      let dateStr: string;
      if (c.date instanceof Date) {
        dateStr = c.date.toISOString().split('T')[0];
      } else if (typeof c.date === 'string') {
        dateStr = c.date.split('T')[0];
      } else {
        continue;
      }
      
      priceMap.set(dateStr, {
        date: dateStr,
        open: Number(c.open) || Number(c.close),
        high: Number(c.high) || Number(c.close),
        low: Number(c.low) || Number(c.close),
        close: Number(c.close),
      });
    }
    
    this.cache.set(asset, priceMap);
    console.log(`[PriceLoader] Loaded ${priceMap.size} ${asset.toUpperCase()} candles`);
    
    return priceMap;
  }
  
  /**
   * Get price data for asset at or before asOf date (no lookahead)
   */
  async getPrice(asset: 'spx' | 'btc' | 'cash', asOf: string): Promise<PriceData | null> {
    if (asset === 'cash') {
      return {
        date: asOf,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        return1d: 0,
        return1w: 0.0005,
      };
    }
    
    const prices = await this.loadCache(asset);
    
    // Try exact match first
    let price = prices.get(asOf);
    if (price) return price;
    
    // Find closest date before asOf
    const asOfDate = new Date(asOf);
    let closestDate = '';
    let closestPrice: PriceData | null = null;
    
    for (const [dateStr, p] of prices) {
      if (dateStr <= asOf) {
        if (!closestDate || dateStr > closestDate) {
          closestDate = dateStr;
          closestPrice = p;
        }
      }
    }
    
    return closestPrice;
  }
  
  /**
   * Get return from date1 to date2 for asset
   */
  async getReturn(asset: 'spx' | 'btc' | 'cash', fromDate: string, toDate: string): Promise<number> {
    if (asset === 'cash') {
      const days = (new Date(toDate).getTime() - new Date(fromDate).getTime()) / (24 * 60 * 60 * 1000);
      return 0.025 * (days / 365); // ~2.5% annual
    }
    
    const priceFrom = await this.getPrice(asset, fromDate);
    const priceTo = await this.getPrice(asset, toDate);
    
    if (!priceFrom || !priceTo || priceFrom.close === 0) {
      return 0;
    }
    
    return (priceTo.close - priceFrom.close) / priceFrom.close;
  }
}

let instance: PriceLoaderService | null = null;

export function getPriceLoaderService(): PriceLoaderService {
  if (!instance) {
    instance = new PriceLoaderService();
  }
  return instance;
}

export { PriceLoaderService };
