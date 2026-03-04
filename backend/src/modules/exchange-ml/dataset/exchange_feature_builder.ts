/**
 * Exchange Auto-Learning Loop - PR1: Feature Builder
 * 
 * Builds feature snapshots for ML training.
 * 
 * CRITICAL: No lookahead bias
 * - Only uses data available at snapshot time (t0)
 * - Does NOT use future price data
 */

import { Db } from 'mongodb';
import { ExchangeFeatureSnapshot } from './exchange_dataset.types.js';

// ═══════════════════════════════════════════════════════════════
// FEATURE VERSION
// ═══════════════════════════════════════════════════════════════

export const FEATURE_VERSION = 'v1.0.0';

// ═══════════════════════════════════════════════════════════════
// DATA PROVIDERS INTERFACES
// ═══════════════════════════════════════════════════════════════

export interface PriceDataProvider {
  getCurrentPrice(symbol: string): Promise<number | null>;
  getPriceChange(symbol: string, period: '24h' | '7d'): Promise<number | null>;
  getVolume24h(symbol: string): Promise<number | null>;
}

export interface TechnicalIndicatorsProvider {
  getRSI14(symbol: string): Promise<number | null>;
  getMACD(symbol: string): Promise<{ macd: number; signal: number; histogram: number } | null>;
  getBollingerBands(symbol: string): Promise<{ upper: number; middle: number; lower: number; width: number } | null>;
}

export interface FundingDataProvider {
  getFundingRate(symbol: string): Promise<number | null>;
  getOpenInterest(symbol: string): Promise<number | null>;
  getOIChange24h(symbol: string): Promise<number | null>;
}

export interface SentimentProvider {
  getSentimentScore(symbol: string): Promise<number | null>;
}

export interface RegimeProvider {
  getCurrentRegime(symbol: string): Promise<{ type: string; confidence: number } | null>;
}

export interface MarketContextProvider {
  getBTCCorrelation(symbol: string): Promise<number | null>;
  getMarketStress(): Promise<number | null>;
}

// ═══════════════════════════════════════════════════════════════
// FEATURE BUILDER CLASS
// ═══════════════════════════════════════════════════════════════

export class ExchangeFeatureBuilder {
  constructor(
    private priceProvider: PriceDataProvider,
    private technicalProvider?: TechnicalIndicatorsProvider,
    private fundingProvider?: FundingDataProvider,
    private sentimentProvider?: SentimentProvider,
    private regimeProvider?: RegimeProvider,
    private marketContextProvider?: MarketContextProvider
  ) {}
  
  /**
   * Build feature snapshot for a symbol at current time.
   */
  async buildFeatures(symbol: string): Promise<ExchangeFeatureSnapshot | null> {
    const normalizedSymbol = symbol.toUpperCase();
    console.log(`[FeatureBuilder] Building features for ${normalizedSymbol}...`);
    
    // Get current price (required)
    let price: number | null = null;
    try {
      price = await this.priceProvider.getCurrentPrice(normalizedSymbol);
      console.log(`[FeatureBuilder] Price result: ${price}`);
    } catch (err) {
      console.error(`[FeatureBuilder] Price fetch error:`, err);
    }
    
    if (price === null || price <= 0) {
      console.warn(`[FeatureBuilder] Could not get price for ${normalizedSymbol}, price=${price}`);
      return null;
    }
    
    // Get price changes
    const [priceChange24h, priceChange7d] = await Promise.all([
      this.priceProvider.getPriceChange(normalizedSymbol, '24h').catch(() => null),
      this.priceProvider.getPriceChange(normalizedSymbol, '7d').catch(() => null),
    ]);
    
    // Get volume
    const volume24h = await this.priceProvider.getVolume24h(normalizedSymbol).catch(() => null);
    
    // Build feature object
    const features: ExchangeFeatureSnapshot = {
      // Price features
      price,
      priceChange24h: priceChange24h ?? 0,
      priceChange7d: priceChange7d ?? 0,
      
      // Volume features
      volume24h: volume24h ?? 0,
      volumeRatio: 1.0, // Default, would need historical data to calculate
      
      // Technical indicators (optional)
      rsi14: null,
      macdSignal: null,
      bbWidth: null,
      
      // Funding & OI (optional)
      fundingRate: null,
      openInterest: null,
      oiChange24h: null,
      
      // Sentiment (optional)
      sentimentScore: null,
      
      // Regime (optional)
      regimeType: null,
      regimeConfidence: null,
      
      // Market context (optional)
      btcCorrelation: null,
      marketStress: null,
    };
    
    // Fetch optional data in parallel
    const optionalData = await Promise.allSettled([
      // Technical indicators
      this.technicalProvider?.getRSI14(normalizedSymbol),
      this.technicalProvider?.getMACD(normalizedSymbol),
      this.technicalProvider?.getBollingerBands(normalizedSymbol),
      
      // Funding data
      this.fundingProvider?.getFundingRate(normalizedSymbol),
      this.fundingProvider?.getOpenInterest(normalizedSymbol),
      this.fundingProvider?.getOIChange24h(normalizedSymbol),
      
      // Sentiment
      this.sentimentProvider?.getSentimentScore(normalizedSymbol),
      
      // Regime
      this.regimeProvider?.getCurrentRegime(normalizedSymbol),
      
      // Market context
      this.marketContextProvider?.getBTCCorrelation(normalizedSymbol),
      this.marketContextProvider?.getMarketStress(),
    ]);
    
    // Process optional results
    if (optionalData[0].status === 'fulfilled' && optionalData[0].value !== null && optionalData[0].value !== undefined) {
      features.rsi14 = optionalData[0].value as number;
    }
    
    if (optionalData[1].status === 'fulfilled' && optionalData[1].value !== null && optionalData[1].value !== undefined) {
      const macd = optionalData[1].value as { signal: number };
      if (macd && typeof macd.signal === 'number') {
        features.macdSignal = macd.signal;
      }
    }
    
    if (optionalData[2].status === 'fulfilled' && optionalData[2].value !== null && optionalData[2].value !== undefined) {
      const bb = optionalData[2].value as { width: number };
      if (bb && typeof bb.width === 'number') {
        features.bbWidth = bb.width;
      }
    }
    
    if (optionalData[3].status === 'fulfilled' && optionalData[3].value !== null && optionalData[3].value !== undefined) {
      features.fundingRate = optionalData[3].value as number;
    }
    
    if (optionalData[4].status === 'fulfilled' && optionalData[4].value !== null && optionalData[4].value !== undefined) {
      features.openInterest = optionalData[4].value as number;
    }
    
    if (optionalData[5].status === 'fulfilled' && optionalData[5].value !== null && optionalData[5].value !== undefined) {
      features.oiChange24h = optionalData[5].value as number;
    }
    
    if (optionalData[6].status === 'fulfilled' && optionalData[6].value !== null && optionalData[6].value !== undefined) {
      features.sentimentScore = optionalData[6].value as number;
    }
    
    if (optionalData[7].status === 'fulfilled' && optionalData[7].value !== null && optionalData[7].value !== undefined) {
      const regime = optionalData[7].value as { type: string; confidence: number };
      if (regime && regime.type && typeof regime.confidence === 'number') {
        features.regimeType = regime.type;
        features.regimeConfidence = regime.confidence;
      }
    }
    
    if (optionalData[8].status === 'fulfilled' && optionalData[8].value !== null && optionalData[8].value !== undefined) {
      features.btcCorrelation = optionalData[8].value as number;
    }
    
    if (optionalData[9].status === 'fulfilled' && optionalData[9].value !== null && optionalData[9].value !== undefined) {
      features.marketStress = optionalData[9].value as number;
    }
    
    // Build raw vector for ML
    features.rawVector = this.buildRawVector(features);
    
    return features;
  }
  
  /**
   * Build normalized feature vector for ML model.
   */
  private buildRawVector(features: ExchangeFeatureSnapshot): number[] {
    // Normalize features to [0, 1] or [-1, 1] range
    return [
      // Price momentum
      this.normalizeChange(features.priceChange24h),
      this.normalizeChange(features.priceChange7d),
      
      // Volume
      Math.min(features.volumeRatio, 3) / 3, // Cap at 3x, normalize to [0, 1]
      
      // Technical indicators
      features.rsi14 !== null ? features.rsi14 / 100 : 0.5,
      features.macdSignal !== null ? this.normalizeChange(features.macdSignal) : 0,
      features.bbWidth !== null ? Math.min(features.bbWidth, 0.2) / 0.2 : 0.5,
      
      // Funding
      features.fundingRate !== null ? this.normalizeFunding(features.fundingRate) : 0,
      features.oiChange24h !== null ? this.normalizeChange(features.oiChange24h) : 0,
      
      // Sentiment
      features.sentimentScore !== null ? (features.sentimentScore + 1) / 2 : 0.5,
      
      // Regime
      features.regimeConfidence !== null ? features.regimeConfidence : 0.5,
      
      // Market context
      features.btcCorrelation !== null ? (features.btcCorrelation + 1) / 2 : 0.5,
      features.marketStress !== null ? features.marketStress : 0.5,
    ];
  }
  
  /**
   * Normalize percentage change to [-1, 1].
   */
  private normalizeChange(change: number): number {
    // Clip to [-50%, +50%] range and normalize
    const clipped = Math.max(-0.5, Math.min(0.5, change));
    return clipped * 2; // Now in [-1, 1]
  }
  
  /**
   * Normalize funding rate to [-1, 1].
   */
  private normalizeFunding(rate: number): number {
    // Typical funding range: -0.1% to +0.1% (8h)
    // Extreme: -0.5% to +0.5%
    const clipped = Math.max(-0.005, Math.min(0.005, rate));
    return clipped / 0.005; // Now in [-1, 1]
  }
}

// ═══════════════════════════════════════════════════════════════
// SIMPLE PRICE PROVIDER (Uses internal API calls)
// ═══════════════════════════════════════════════════════════════

export class SimplePriceProvider implements PriceDataProvider {
  private cache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly cacheTTL = 60 * 1000; // 60 seconds
  
  constructor(private db: Db) {}
  
  async getCurrentPrice(symbol: string): Promise<number | null> {
    console.log(`[SimplePriceProvider] Getting price for ${symbol}`);
    
    // Check cache
    const cached = this.cache.get(symbol);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log(`[SimplePriceProvider] Cache hit: ${cached.price}`);
      return cached.price;
    }
    
    // Use internal market/candles API (this works with proxy!)
    try {
      // Normalize symbol: BTCUSDT -> BTC for internal API
      let apiSymbol = symbol;
      if (symbol.endsWith('USDT')) {
        apiSymbol = symbol.replace('USDT', '');
      }
      
      const url = `http://localhost:8003/api/market/candles?symbol=${apiSymbol}&range=24h`;
      console.log(`[SimplePriceProvider] Fetching from ${url}`);
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.ok && data.candles && data.candles.length > 0) {
        const lastCandle = data.candles[data.candles.length - 1];
        const price = lastCandle.close;
        if (price > 0) {
          this.cache.set(symbol, { price, timestamp: Date.now() });
          console.log(`[SimplePriceProvider] Got price from internal API: ${symbol} = ${price}`);
          return price;
        }
      }
    } catch (err) {
      console.warn(`[SimplePriceProvider] Internal API error for ${symbol}:`, (err as Error).message);
    }
    
    // Fallback: try verdict cache
    try {
      const verdictCache = this.db.collection('verdict_cache');
      const doc = await verdictCache.findOne(
        { symbol: symbol.toUpperCase() },
        { sort: { updatedAt: -1 } }
      );
      
      if (doc && doc.layers?.snapshot?.price) {
        const price = doc.layers.snapshot.price;
        this.cache.set(symbol, { price, timestamp: Date.now() });
        console.log(`[SimplePriceProvider] Got price from verdict cache: ${symbol} = ${price}`);
        return price;
      }
    } catch (err) {
      console.warn(`[SimplePriceProvider] Could not get price from verdict cache for ${symbol}`);
    }
    
    console.log(`[SimplePriceProvider] All methods failed for ${symbol}`);
    return null;
  }
  
  async getPriceChange(symbol: string, period: '24h' | '7d'): Promise<number | null> {
    try {
      let apiSymbol = symbol;
      if (symbol.endsWith('USDT')) {
        apiSymbol = symbol.replace('USDT', '');
      }
      
      const range = period === '24h' ? '24h' : '7d';
      const url = `http://localhost:8003/api/market/candles?symbol=${apiSymbol}&range=${range}`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.ok && data.candles && data.candles.length >= 2) {
        const first = data.candles[0].close;
        const last = data.candles[data.candles.length - 1].close;
        if (first > 0) {
          return (last - first) / first;
        }
      }
    } catch (err) {
      // Ignore
    }
    
    return null;
  }
  
  async getVolume24h(symbol: string): Promise<number | null> {
    try {
      let apiSymbol = symbol;
      if (symbol.endsWith('USDT')) {
        apiSymbol = symbol.replace('USDT', '');
      }
      
      const url = `http://localhost:8003/api/market/candles?symbol=${apiSymbol}&range=24h`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.ok && data.candles && data.candles.length > 0) {
        let totalVolume = 0;
        for (const c of data.candles) {
          totalVolume += c.volume || 0;
        }
        return totalVolume;
      }
    } catch (err) {
      // Ignore
    }
    
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════

let builderInstance: ExchangeFeatureBuilder | null = null;

export function getExchangeFeatureBuilder(db: Db): ExchangeFeatureBuilder {
  if (!builderInstance) {
    const priceProvider = new SimplePriceProvider(db);
    builderInstance = new ExchangeFeatureBuilder(priceProvider);
  }
  return builderInstance;
}

console.log('[Exchange ML] Feature builder loaded');
