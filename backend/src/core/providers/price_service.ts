/**
 * Price Service - Historical Price Fetching
 * 
 * Provides historical prices for ML validation.
 */

import mongoose from 'mongoose';

/**
 * Get historical price from database cache or provider
 */
export async function getHistoricalPrice(
  asset: string,
  network: string,
  timestamp: number
): Promise<number | null> {
  try {
    const db = mongoose.connection.db;
    if (!db) return null;
    
    // Try to find cached price within 5 minute window
    const windowMs = 5 * 60 * 1000;
    const minTs = new Date(timestamp - windowMs);
    const maxTs = new Date(timestamp + windowMs);
    
    // Check price_cache collection
    const cached = await db.collection('price_cache').findOne({
      asset: asset.toUpperCase(),
      network,
      timestamp: { $gte: minTs, $lte: maxTs }
    }, { sort: { timestamp: -1 } });
    
    if (cached?.price) {
      return cached.price;
    }
    
    // Check market_data collection
    const marketData = await db.collection('market_data').findOne({
      symbol: { $regex: new RegExp(asset, 'i') },
      network,
      timestamp: { $gte: minTs, $lte: maxTs }
    }, { sort: { timestamp: -1 } });
    
    if (marketData?.price) {
      return marketData.price;
    }
    
    // Check token prices
    const tokenPrice = await db.collection('token_prices').findOne({
      symbol: { $regex: new RegExp(asset, 'i') },
      timestamp: { $gte: minTs, $lte: maxTs }
    }, { sort: { timestamp: -1 } });
    
    if (tokenPrice?.price) {
      return tokenPrice.price;
    }
    
    return null;
  } catch (err) {
    console.error(`[PriceService] Error fetching price for ${asset}:`, err);
    return null;
  }
}

export default { getHistoricalPrice };
