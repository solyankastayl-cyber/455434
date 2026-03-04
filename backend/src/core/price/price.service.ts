/**
 * P0.2a Price Service (Enhanced)
 * 
 * Production-ready price fetching with:
 * - L1 cache (in-memory, fast)
 * - L2 cache (MongoDB snapshot)
 * - In-flight request deduplication
 * - ProviderPool integration
 * - Automatic fallback
 * 
 * CRITICAL: All price reads go through here.
 * No direct external API calls from ML/Labels/Signals.
 */

import mongoose from 'mongoose';
import { getProviderPool, ProviderConfig } from '../providers/provider_pool.service.js';

// ============================================
// TYPES
// ============================================

export interface PriceSnapshot {
  asset: string;
  network: string;
  priceUsd: number;
  ts: number;
  source: string;
  fetchedAt: Date;
}

interface L1CacheEntry {
  price: number;
  ts: number;
  expiresAt: number;
}

// ============================================
// CONFIG
// ============================================

const L1_CACHE_TTL_MS = 30 * 1000; // 30 seconds in-memory
const L2_SNAPSHOT_TTL_SEC = 120; // 2 minutes in DB
const FETCH_TIMEOUT_MS = 5000;

// Asset mapping to CoinGecko IDs
const ASSET_TO_COINGECKO: Record<string, string> = {
  'ETH': 'ethereum',
  'WETH': 'ethereum',
  'BTC': 'bitcoin',
  'WBTC': 'bitcoin',
  'USDC': 'usd-coin',
  'USDT': 'tether',
  'DAI': 'dai',
  'ARB': 'arbitrum',
  'OP': 'optimism',
  'MATIC': 'matic-network',
  'POL': 'matic-network',
  'BNB': 'binancecoin',
  'LINK': 'chainlink',
  'UNI': 'uniswap',
  'AAVE': 'aave',
};

// Asset mapping to Binance symbols (USDT pairs)
const ASSET_TO_BINANCE: Record<string, string> = {
  'ETH': 'ETHUSDT',
  'WETH': 'ETHUSDT',
  'BTC': 'BTCUSDT',
  'WBTC': 'BTCUSDT',
  'BNB': 'BNBUSDT',
  'LINK': 'LINKUSDT',
  'UNI': 'UNIUSDT',
  'AAVE': 'AAVEUSDT',
  'ARB': 'ARBUSDT',
  'OP': 'OPUSDT',
  'MATIC': 'MATICUSDT',
  'POL': 'MATICUSDT',
};

// ============================================
// L1 CACHE (IN-MEMORY)
// ============================================

const l1Cache = new Map<string, L1CacheEntry>();

function getL1Key(asset: string, network: string): string {
  return `${asset.toUpperCase()}:${network}`;
}

function getFromL1(asset: string, network: string): number | null {
  const key = getL1Key(asset, network);
  const entry = l1Cache.get(key);
  
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    l1Cache.delete(key);
    return null;
  }
  
  return entry.price;
}

function setL1(asset: string, network: string, price: number): void {
  const key = getL1Key(asset, network);
  l1Cache.set(key, {
    price,
    ts: Date.now(),
    expiresAt: Date.now() + L1_CACHE_TTL_MS,
  });
}

// ============================================
// L2 CACHE (MONGODB SNAPSHOT)
// ============================================

const PriceSnapshotSchema = new mongoose.Schema<PriceSnapshot & mongoose.Document>(
  {
    asset: { type: String, required: true, index: true },
    network: { type: String, required: true, index: true },
    priceUsd: { type: Number, required: true },
    ts: { type: Number, required: true, index: true },
    source: { type: String, required: true },
    fetchedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'price_snapshot',
  }
);

PriceSnapshotSchema.index({ asset: 1, network: 1, ts: -1 });
// TTL index: keep snapshots for 7 days
PriceSnapshotSchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export const PriceSnapshotModel = mongoose.models.PriceSnapshot || 
  mongoose.model('PriceSnapshot', PriceSnapshotSchema);

async function getFromL2(asset: string, network: string): Promise<PriceSnapshot | null> {
  const minTs = Math.floor(Date.now() / 1000) - L2_SNAPSHOT_TTL_SEC;
  
  const snapshot = await PriceSnapshotModel.findOne(
    {
      asset: asset.toUpperCase(),
      network,
      ts: { $gte: minTs },
    },
    {},
    { sort: { ts: -1 } }
  ).lean() as PriceSnapshot | null;
  
  return snapshot;
}

async function setL2(
  asset: string,
  network: string,
  price: number,
  source: string
): Promise<void> {
  await PriceSnapshotModel.create({
    asset: asset.toUpperCase(),
    network,
    priceUsd: price,
    ts: Math.floor(Date.now() / 1000),
    source,
    fetchedAt: new Date(),
  });
}

// ============================================
// EXTERNAL FETCH
// ============================================

async function fetchFromProvider(
  provider: ProviderConfig,
  coinId: string,
  asset?: string
): Promise<number | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  
  try {
    let url: string;
    
    if (provider.type === 'coingecko') {
      url = `${provider.baseUrl}/simple/price?ids=${coinId}&vs_currencies=usd`;
    } else if (provider.type === 'binance') {
      // Binance uses symbol pairs like ETHUSDT
      const symbol = asset ? ASSET_TO_BINANCE[asset.toUpperCase()] : null;
      if (!symbol) {
        console.log(`[PriceService] No Binance mapping for asset: ${asset}`);
        return null;
      }
      url = `${provider.baseUrl}/ticker/price?symbol=${symbol}`;
    } else {
      throw new Error(`Provider type ${provider.type} not implemented`);
    }
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        ...(provider.type === 'coingecko' && provider.apiKey ? { 'x-cg-demo-api-key': provider.apiKey } : {}),
        ...(provider.type === 'binance' && provider.apiKey ? { 'X-MBX-APIKEY': provider.apiKey } : {}),
      },
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.log(`[PriceService] Provider ${provider.id} returned ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    // Handle CoinGecko response
    if (provider.type === 'coingecko') {
      // Check for rate limit error in body
      if (data.status?.error_code === 429) {
        console.log(`[PriceService] Provider ${provider.id} rate limited`);
        return null;
      }
      
      const price = data[coinId]?.usd;
      
      if (typeof price !== 'number') {
        console.log(`[PriceService] No price data for ${coinId}`);
        return null;
      }
      
      return price;
    }
    
    // Handle Binance response
    if (provider.type === 'binance') {
      const price = parseFloat(data.price);
      
      if (isNaN(price)) {
        console.log(`[PriceService] Invalid Binance price for ${asset}`);
        return null;
      }
      
      return price;
    }
    
    return null;
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.log(`[PriceService] Fetch error: ${err.message}`);
    return null;
  }
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Get latest price for asset
 * Flow: L1 cache → L2 snapshot → External fetch
 * Returns null if unavailable (label should be SKIPPED)
 */
export async function getLatestPrice(
  asset: string,
  network: string = 'ethereum'
): Promise<PriceSnapshot | null> {
  const assetUpper = asset.toUpperCase();
  
  // 1️⃣ Check L1 cache (fastest)
  const l1Price = getFromL1(assetUpper, network);
  if (l1Price !== null) {
    return {
      asset: assetUpper,
      network,
      priceUsd: l1Price,
      ts: Math.floor(Date.now() / 1000),
      source: 'l1_cache',
      fetchedAt: new Date(),
    };
  }
  
  // 2️⃣ Check L2 snapshot (DB)
  const l2Snapshot = await getFromL2(assetUpper, network);
  if (l2Snapshot) {
    // Populate L1 cache
    setL1(assetUpper, network, l2Snapshot.priceUsd);
    return l2Snapshot;
  }
  
  // 3️⃣ Fetch from external provider
  return refreshPrice(assetUpper, network);
}

/**
 * Force refresh price from external provider
 * Uses ProviderPool with deduplication
 */
export async function refreshPrice(
  asset: string,
  network: string = 'ethereum'
): Promise<PriceSnapshot | null> {
  const assetUpper = asset.toUpperCase();
  const pool = getProviderPool();
  
  // Map to CoinGecko ID
  const coinId = ASSET_TO_COINGECKO[assetUpper];
  if (!coinId) {
    console.log(`[PriceService] Unknown asset: ${asset}`);
    return null;
  }
  
  // Check for in-flight request (deduplication)
  const inflightKey = `price:${coinId}`;
  const inflight = pool.getInFlight<PriceSnapshot | null>(inflightKey);
  if (inflight) {
    return inflight;
  }
  
  // Get available provider
  const provider = pool.getAvailableProvider();
  if (!provider) {
    console.log('[PriceService] No available providers');
    return null;
  }
  
  // Create fetch promise with dedup registration
  const fetchPromise = (async (): Promise<PriceSnapshot | null> => {
    const price = await fetchFromProvider(provider, coinId, assetUpper);
    
    if (price === null) {
      pool.markFailure(provider.id);
      return null;
    }
    
    pool.markSuccess(provider.id);
    
    // Save to L1 and L2
    setL1(assetUpper, network, price);
    await setL2(assetUpper, network, price, provider.id);
    
    return {
      asset: assetUpper,
      network,
      priceUsd: price,
      ts: Math.floor(Date.now() / 1000),
      source: provider.id,
      fetchedAt: new Date(),
    };
  })();
  
  pool.setInFlight(inflightKey, fetchPromise);
  
  return fetchPromise;
}

/**
 * Legacy getPrice function (compatibility)
 */
export async function getPrice(asset: string): Promise<number | null> {
  const snapshot = await getLatestPrice(asset);
  return snapshot?.priceUsd ?? null;
}

/**
 * Get price at specific timestamp
 * Uses L2 snapshot history if available
 */
export async function getPriceAt(
  asset: string,
  ts: number,
  network: string = 'ethereum'
): Promise<number | null> {
  const assetUpper = asset.toUpperCase();
  
  // Find closest snapshot before or at ts
  const snapshot = await PriceSnapshotModel.findOne(
    {
      asset: assetUpper,
      network,
      ts: { $lte: ts },
    },
    {},
    { sort: { ts: -1 } }
  ).lean() as PriceSnapshot | null;
  
  return snapshot?.priceUsd ?? null;
}

/**
 * Get multiple prices at once (batched)
 */
export async function getPrices(
  assets: string[],
  network: string = 'ethereum'
): Promise<Record<string, number | null>> {
  const results: Record<string, number | null> = {};
  
  for (const asset of assets) {
    const snapshot = await getLatestPrice(asset, network);
    results[asset] = snapshot?.priceUsd ?? null;
  }
  
  return results;
}

/**
 * Clear all caches
 */
export function clearCache(): void {
  l1Cache.clear();
  console.log('[PriceService] L1 cache cleared');
}

/**
 * Get cache stats
 */
export function getCacheStats(): {
  l1Size: number;
  l1Entries: string[];
} {
  return {
    l1Size: l1Cache.size,
    l1Entries: Array.from(l1Cache.keys()),
  };
}

export default {
  getLatestPrice,
  refreshPrice,
  getPrice,
  getPriceAt,
  getPrices,
  clearCache,
  getCacheStats,
  PriceSnapshotModel,
};
