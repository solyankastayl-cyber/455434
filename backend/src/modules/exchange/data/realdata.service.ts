/**
 * PHASE 1.1 — Real Data Wiring Service
 * =====================================
 * 
 * Connects ProviderSelector → MarketCache → SnapshotBuilder
 * Ensures all Exchange analytics run on LIVE data.
 * 
 * Key responsibilities:
 * - Fetch real data from providers
 * - Populate MarketCache
 * - Track data source metadata
 * - Provide health status
 */

import { resolveProviderForSymbol } from '../providers/provider.selector.js';
import { marketCache } from '../cache/market.cache.js';
import { listProviders } from '../providers/provider.registry.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type DataMode = 'LIVE' | 'MIXED' | 'MOCK';

export interface SourceMeta {
  dataMode: DataMode;
  providersUsed: string[];
  latencyMs: Record<string, number>;
  missing: string[];
  timestamp: number;
}

export interface LiveSnapshot {
  symbol: string;
  price: number;
  priceChange5m: number;
  priceChange1h: number;
  volume24h: number;
  openInterest: number;
  oiChange: number;
  fundingRate: number;
  orderbook: {
    bidDepth: number;
    askDepth: number;
    imbalance: number;
    spread: number;
  };
  sourceMeta: SourceMeta;
  timestamp: number;
}

export interface DataHealth {
  symbol: string;
  liveCoverage: number;
  providersOnline: string[];
  providersOffline: string[];
  dataMode: DataMode;
  lastUpdate: number;
}

// ═══════════════════════════════════════════════════════════════
// REAL DATA FETCHING
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch live market data from real providers
 */
export async function fetchLiveData(symbol: string): Promise<LiveSnapshot | null> {
  const providersUsed: string[] = [];
  const latencyMs: Record<string, number> = {};
  const missing: string[] = [];
  
  // Get best provider for this symbol
  let provider: any;
  try {
    provider = await resolveProviderForSymbol(symbol);
  } catch (e) {
    console.warn(`[RealData] No provider available for ${symbol}`);
    return null;
  }
  
  if (!provider) {
    console.warn(`[RealData] No provider available for ${symbol}`);
    return null;
  }
  
  try {
    const providerStart = Date.now();
    
    // Fetch candles
    let candles: any[] = [];
    try {
      candles = await provider.getCandles(symbol, '1m', 100);
      providersUsed.push(provider.id);
    } catch (e: any) {
      console.error(`[RealData] Candles fetch failed for ${symbol}:`, e.message);
      missing.push('candles');
    }
    
    // Fetch orderbook
    let orderbook: any = null;
    try {
      console.log(`[RealData] Fetching orderbook for ${symbol} from ${provider.id}`);
      orderbook = await provider.getOrderBook(symbol, 20);
      console.log(`[RealData] Orderbook received: ${orderbook?.bids?.length || 0} bids`);
    } catch (e: any) {
      console.error(`[RealData] Orderbook fetch failed for ${symbol}:`, e.message, e.stack?.substring(0, 200));
      missing.push('orderbook');
    }
    
    // Fetch OI and funding (if available)
    let oi = 0, oiChange = 0, fundingRate = 0;
    try {
      if (provider.getOpenInterest) {
        const oiData = await provider.getOpenInterest(symbol);
        oi = oiData?.openInterest ?? 0;
        oiChange = 0; // OI change requires previous value
      }
      if (provider.getFunding) {
        const fundingData = await provider.getFunding(symbol);
        fundingRate = fundingData?.fundingRate ?? 0;
      }
    } catch (e: any) {
      missing.push('derivatives');
    }
    
    latencyMs[provider.id] = Date.now() - providerStart;
    
    // Calculate price and changes from candles
    const price = candles.length > 0 ? candles[candles.length - 1].c : 0;
    const price5m = candles.length >= 5 ? candles[candles.length - 5].c : price;
    const price1h = candles.length >= 60 ? candles[candles.length - 60].c : price;
    
    const priceChange5m = price5m > 0 ? ((price - price5m) / price5m) * 100 : 0;
    const priceChange1h = price1h > 0 ? ((price - price1h) / price1h) * 100 : 0;
    
    // Calculate volume
    const volume24h = candles.slice(-Math.min(candles.length, 1440)).reduce((sum, c) => sum + (c.v || 0), 0);
    
    // Calculate orderbook metrics
    let bidDepth = 0, askDepth = 0, imbalance = 0, spread = 0;
    if (orderbook && orderbook.bids && orderbook.asks) {
      // Orderbook format: { bids: [[price, qty], ...], asks: [[price, qty], ...] }
      bidDepth = orderbook.bids.reduce((sum: number, b: [number, number]) => sum + (b[1] || 0), 0);
      askDepth = orderbook.asks.reduce((sum: number, a: [number, number]) => sum + (a[1] || 0), 0);
      imbalance = bidDepth + askDepth > 0 ? (bidDepth - askDepth) / (bidDepth + askDepth) : 0;
      
      const bestBid = orderbook.bids[0]?.[0] || 0;
      const bestAsk = orderbook.asks[0]?.[0] || 0;
      spread = bestAsk > 0 && bestBid > 0 ? ((bestAsk - bestBid) / bestAsk) * 100 : 0;
    }
    
    // Update MarketCache
    if (candles.length > 0) {
      marketCache.setCandles(symbol, '1m', candles);
      marketCache.setProvider(symbol, provider.id);
    }
    
    if (orderbook) {
      // Store simplified orderbook
      const orderbookData: any = {
        bids: orderbook.bids?.slice(0, 20) || [],
        asks: orderbook.asks?.slice(0, 20) || [],
        ts: Date.now(),
      };
      marketCache.setOrderbook(symbol, orderbookData);
    }
    
    if (oi > 0 || fundingRate !== 0) {
      marketCache.setDerivatives(symbol, {
        symbol,
        openInterest: oi,
        openInterestValue: oi,
        fundingRate,
        nextFundingTime: Date.now() + 8 * 3600 * 1000, // ~8 hours
        ts: Date.now(),
      });
    }
    
    // Determine data mode
    let dataMode: DataMode = 'LIVE';
    if (missing.length > 0 && missing.length < 3) {
      dataMode = 'MIXED';
    } else if (missing.length >= 3 || providersUsed.length === 0) {
      dataMode = 'MOCK';
    }
    
    return {
      symbol,
      price,
      priceChange5m,
      priceChange1h,
      volume24h,
      openInterest: oi,
      oiChange,
      fundingRate,
      orderbook: {
        bidDepth,
        askDepth,
        imbalance,
        spread,
      },
      sourceMeta: {
        dataMode,
        providersUsed,
        latencyMs,
        missing,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    };
    
  } catch (error: any) {
    console.error(`[RealData] Failed to fetch data for ${symbol}:`, error.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// DATA HEALTH CHECK
// ═══════════════════════════════════════════════════════════════

/**
 * Get health status for a symbol's data pipeline
 */
export async function getDataHealth(symbol: string): Promise<DataHealth> {
  const providers = listProviders();
  const providersOnline: string[] = [];
  const providersOffline: string[] = [];
  
  for (const entry of providers) {
    const providerId = entry.provider?.id || (entry as any).id;
    const config = entry.config;
    const health = entry.health;
    
    if (!config?.enabled) {
      providersOffline.push(providerId);
      continue;
    }
    
    if (health?.status === 'UP') {
      providersOnline.push(providerId);
    } else {
      providersOffline.push(providerId);
    }
  }
  
  const cacheStatus = marketCache.getStatus(symbol);
  
  // Calculate live coverage
  const totalEnabled = providers.filter((p: any) => p.config?.enabled).length;
  const liveCoverage = totalEnabled > 0 ? providersOnline.length / totalEnabled : 0;
  
  // Map cache dataMode to our DataMode
  let dataMode: DataMode = 'MOCK';
  if (cacheStatus.dataMode === 'LIVE') dataMode = 'LIVE';
  else if (cacheStatus.dataMode === 'STALE') dataMode = 'MIXED';
  
  return {
    symbol,
    liveCoverage,
    providersOnline,
    providersOffline,
    dataMode,
    lastUpdate: cacheStatus.candlesLastTs || 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// BATCH FETCH
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch live data for multiple symbols
 */
export async function fetchLiveDataBatch(symbols: string[]): Promise<Map<string, LiveSnapshot>> {
  const results = new Map<string, LiveSnapshot>();
  
  // Fetch in parallel
  const promises = symbols.map(async (symbol) => {
    const data = await fetchLiveData(symbol);
    if (data) {
      results.set(symbol, data);
    }
  });
  
  await Promise.all(promises);
  
  return results;
}

// ═══════════════════════════════════════════════════════════════
// HEALTH GATE
// ═══════════════════════════════════════════════════════════════

/**
 * Check if data quality is sufficient for verdict
 */
export function isDataSufficient(sourceMeta: SourceMeta): {
  sufficient: boolean;
  degraded: boolean;
  reason?: string;
} {
  // At least one real provider must be used
  if (sourceMeta.providersUsed.length === 0) {
    return {
      sufficient: false,
      degraded: true,
      reason: 'NO_PROVIDERS',
    };
  }
  
  // MOCK mode is not sufficient
  if (sourceMeta.dataMode === 'MOCK') {
    return {
      sufficient: false,
      degraded: true,
      reason: 'MOCK_DATA_ONLY',
    };
  }
  
  // MIXED mode is degraded but sufficient
  if (sourceMeta.dataMode === 'MIXED') {
    return {
      sufficient: true,
      degraded: true,
      reason: 'PARTIAL_DATA',
    };
  }
  
  // LIVE mode is fully sufficient
  return {
    sufficient: true,
    degraded: false,
  };
}

// ═══════════════════════════════════════════════════════════════
// CONVERT TO OBSERVATION INPUT
// ═══════════════════════════════════════════════════════════════

import { CreateObservationInput, RegimeType } from '../observation/observation.types.js';

/**
 * Convert LiveSnapshot to CreateObservationInput format
 * Used to integrate real data into the observation pipeline
 */
export function liveSnapshotToObservationInput(snapshot: LiveSnapshot): CreateObservationInput {
  // Determine aggressor bias from orderbook imbalance
  let aggressorBias: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  if (snapshot.orderbook.imbalance > 0.15) aggressorBias = 'BUY';
  else if (snapshot.orderbook.imbalance < -0.15) aggressorBias = 'SELL';
  
  // Determine regime from funding and OI
  let regimeType: RegimeType = 'NEUTRAL';
  const fundingBps = snapshot.fundingRate * 10000;
  
  if (fundingBps > 5 && snapshot.oiChange > 0) {
    regimeType = 'EXPANSION';
  } else if (fundingBps < -5 && snapshot.oiChange < 0) {
    regimeType = 'DISTRIBUTION';
  } else if (fundingBps > 10) {
    regimeType = 'LONG_SQUEEZE';
  } else if (fundingBps < -10) {
    regimeType = 'SHORT_SQUEEZE';
  } else if (Math.abs(snapshot.priceChange1h) < 0.5 && snapshot.oiChange > 0) {
    regimeType = 'ACCUMULATION';
  } else if (Math.abs(snapshot.priceChange5m) > 2 && Math.abs(snapshot.priceChange1h) < 1) {
    regimeType = 'EXHAUSTION';
  }
  
  // Calculate confidence based on data completeness
  const missingCount = snapshot.sourceMeta.missing.length;
  let confidence = 0.8;
  if (missingCount === 1) confidence = 0.6;
  if (missingCount >= 2) confidence = 0.4;
  if (snapshot.sourceMeta.dataMode === 'MOCK') confidence = 0.2;
  
  return {
    symbol: snapshot.symbol,
    
    market: {
      price: snapshot.price,
      priceChange5m: snapshot.priceChange5m,
      priceChange15m: snapshot.priceChange5m * 2, // Approximate
      volatility: Math.abs(snapshot.priceChange1h) / 100,
    },
    
    volume: {
      total: snapshot.volume24h,
      delta: snapshot.orderbook.imbalance * 20, // Approximation
      ratio: 1 + snapshot.orderbook.imbalance,
    },
    
    openInterest: {
      value: snapshot.openInterest,
      delta: snapshot.oiChange,
      deltaPct: snapshot.openInterest > 0 ? (snapshot.oiChange / snapshot.openInterest) * 100 : 0,
    },
    
    orderFlow: {
      aggressorBias,
      dominance: Math.abs(snapshot.orderbook.imbalance) * 0.5 + 0.5,
      absorption: Math.abs(snapshot.orderbook.imbalance) > 0.3,
      absorptionSide: snapshot.orderbook.imbalance > 0 ? 'BID' : 'ASK',
      imbalance: snapshot.orderbook.imbalance,
    },
    
    liquidations: {
      longVolume: 0, // Not available from basic snapshot
      shortVolume: 0,
      cascadeActive: false,
      cascadeDirection: 'LONG',
      cascadePhase: null,
    },
    
    regime: {
      type: regimeType,
      confidence,
    },
    
    patterns: [],
    
    // Include source metadata
    sourceMeta: snapshot.sourceMeta,
  };
}

console.log('[Phase 1.1] Real Data Wiring Service loaded');
