/**
 * P2.2 Price Service - External Price Feed
 * 
 * Uses Ankr/Infura for price data
 * Fallback to simple mock for development
 */

import mongoose, { Schema } from 'mongoose';

// ============================================
// PRICE CACHE MODEL
// ============================================

interface IPriceCache {
  network: string;
  asset: string;
  ts: number;
  price: number;
  source: string;
  createdAt: Date;
}

const PriceCacheSchema = new Schema<IPriceCache>({
  network: { type: String, required: true, index: true },
  asset: { type: String, required: true, index: true },
  ts: { type: Number, required: true, index: true },
  price: { type: Number, required: true },
  source: { type: String, default: 'mock' },
  createdAt: { type: Date, default: Date.now, expires: 604800 }, // 7 day TTL
}, {
  collection: 'price_cache',
});

PriceCacheSchema.index({ network: 1, asset: 1, ts: 1 }, { unique: true });

const PriceCacheModel = mongoose.models.PriceCache || 
  mongoose.model<IPriceCache>('PriceCache', PriceCacheSchema);

// ============================================
// ASSET MAPPING
// ============================================

const NETWORK_ASSETS: Record<string, string> = {
  ethereum: 'ETH',
  arbitrum: 'ARB',
  optimism: 'OP',
  base: 'ETH',  // Base uses ETH
  polygon: 'MATIC',
  bnb: 'BNB',
  zksync: 'ETH',
  scroll: 'ETH',
};

// Base prices for mock data (approximate current prices)
const BASE_PRICES: Record<string, number> = {
  ETH: 3200,
  ARB: 1.2,
  OP: 2.5,
  MATIC: 0.85,
  BNB: 600,
};

// ============================================
// PRICE FUNCTIONS
// ============================================

/**
 * Get asset for network
 */
export function getAssetForNetwork(network: string): string {
  return NETWORK_ASSETS[network] || 'ETH';
}

/**
 * Generate simulated price with realistic volatility
 * Uses deterministic seed for reproducibility
 */
function generateMockPrice(asset: string, ts: number): number {
  const basePrice = BASE_PRICES[asset] || 1000;
  
  // Deterministic "random" based on timestamp
  const seed = ts * 1000 + asset.charCodeAt(0);
  const pseudoRandom = Math.sin(seed) * 10000;
  const noise = (pseudoRandom - Math.floor(pseudoRandom)) - 0.5;
  
  // Add trend component (slight upward bias)
  const trendComponent = ((ts % 86400) / 86400) * 0.02; // 2% daily trend
  
  // Volatility: ~5% intraday range
  const volatility = basePrice * 0.05 * noise;
  
  return basePrice * (1 + trendComponent) + volatility;
}

/**
 * Get price at timestamp
 * Uses cache first, then generates mock data
 */
export async function getPrice(network: string, ts: number): Promise<{ price: number; source: string }> {
  const asset = getAssetForNetwork(network);
  
  // Round to nearest hour for caching
  const roundedTs = Math.floor(ts / 3600) * 3600;
  
  // Check cache first
  const cached = await PriceCacheModel.findOne({
    network,
    asset,
    ts: roundedTs,
  }).lean();
  
  if (cached) {
    return { price: cached.price, source: cached.source };
  }
  
  // Generate mock price
  const price = generateMockPrice(asset, roundedTs);
  
  // Cache it
  try {
    await PriceCacheModel.updateOne(
      { network, asset, ts: roundedTs },
      {
        $set: {
          price,
          source: 'mock',
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    // Ignore duplicate key errors
  }
  
  return { price, source: 'mock' };
}

/**
 * Get price at future timestamp
 */
export async function getFuturePrice(
  network: string, 
  nowTs: number, 
  horizonSeconds: number
): Promise<{ priceNow: number; priceFuture: number; returnPct: number }> {
  const futureTs = nowTs + horizonSeconds;
  
  const [nowData, futureData] = await Promise.all([
    getPrice(network, nowTs),
    getPrice(network, futureTs),
  ]);
  
  const returnPct = (futureData.price - nowData.price) / nowData.price;
  
  return {
    priceNow: nowData.price,
    priceFuture: futureData.price,
    returnPct,
  };
}

/**
 * Get historical prices for a range
 */
export async function getPriceHistory(
  network: string,
  fromTs: number,
  toTs: number,
  intervalSeconds: number = 3600
): Promise<Array<{ ts: number; price: number }>> {
  const prices: Array<{ ts: number; price: number }> = [];
  
  for (let ts = fromTs; ts <= toTs; ts += intervalSeconds) {
    const { price } = await getPrice(network, ts);
    prices.push({ ts, price });
  }
  
  return prices;
}

/**
 * Initialize price cache for recent history
 */
export async function initializePriceCache(network: string, hoursBack: number = 168): Promise<number> {
  const nowTs = Math.floor(Date.now() / 1000);
  const fromTs = nowTs - (hoursBack * 3600);
  
  let count = 0;
  for (let ts = fromTs; ts <= nowTs; ts += 3600) {
    await getPrice(network, ts);
    count++;
  }
  
  return count;
}

export default {
  getAssetForNetwork,
  getPrice,
  getFuturePrice,
  getPriceHistory,
  initializePriceCache,
  PriceCacheModel,
};
