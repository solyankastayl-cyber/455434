/**
 * Node Analytics Service - ETAP D2
 * 
 * Service for calculating and caching node analytics.
 * Called by cron job or on-demand.
 * 
 * PRINCIPLE:
 * - Node analytics are PRE-CALCULATED
 * - Graph builder ONLY READS, never calculates
 * - This ensures consistent, fast graph rendering
 * 
 * NOTE: Uses streaming approach to avoid 16MB BSON limit
 */

import { mongoose } from '../../db/mongoose.js';
import type { NetworkType } from '../../common/network.types.js';
import { 
  NodeAnalyticsModel, 
  upsertNodeAnalytics, 
  getNodeAnalytics,
  getNodeAnalyticsBatch,
} from './node_analytics.model.js';
import { 
  buildAddressAnalyticsPipeline,
} from './node_analytics.pipeline.js';
import { deriveNodeAnalytics } from './influence_score.js';

// Known entities for tagging
const KNOWN_ENTITIES: Record<string, { type: string; name: string }> = {
  '0x28c6c06298d514db089934071355e5743bf21d60': { type: 'CEX', name: 'Binance' },
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549': { type: 'CEX', name: 'Binance' },
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': { type: 'CEX', name: 'Binance' },
  '0x56eddb7aa87536c09ccc2793473599fd21a8b17f': { type: 'CEX', name: 'Binance' },
  '0xf977814e90da44bfa03b6295a0616a897441acec': { type: 'CEX', name: 'Binance' },
  '0x2f47a1c2db4a3b78cda44eade915c3b19107ddcc': { type: 'CEX', name: 'Coinbase' },
  '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43': { type: 'CEX', name: 'Coinbase' },
  '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': { type: 'CEX', name: 'Coinbase' },
  '0x503828976d22510aad0201ac7ec88293211d23da': { type: 'CEX', name: 'Coinbase' },
  '0xeb2629a2734e272bcc07bda959863f316f4bd4cf': { type: 'CEX', name: 'Kraken' },
  '0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0': { type: 'CEX', name: 'Kraken' },
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': { type: 'DEX', name: 'Uniswap V2' },
  '0xe592427a0aece92de3edee1f18e0157c05861564': { type: 'DEX', name: 'Uniswap V3' },
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': { type: 'DEX', name: 'Uniswap Router' },
  '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f': { type: 'DEX', name: 'SushiSwap' },
  '0x1111111254fb6c44bac0bed2854e76f90643097d': { type: 'DEX', name: '1inch' },
  '0x1111111254eeb25477b68fb85ed929f73a960582': { type: 'DEX', name: '1inch V5' },
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff': { type: 'DEX', name: '0x' },
};

/**
 * Calculate node analytics for entire network
 * 
 * Uses streaming approach to avoid 16MB BSON limit.
 * Processes unique addresses one by one.
 */
export async function calculateNetworkNodeAnalytics(
  network: NetworkType,
  options?: { batchSize?: number; maxNodes?: number }
): Promise<{ processed: number; errors: number }> {
  const maxNodes = options?.maxNodes ?? 10000;
  
  console.log(`[NodeAnalytics] Starting calculation for network: ${network}`);
  const startTime = Date.now();
  
  try {
    const db = mongoose.connection?.db;
    if (!db) {
      console.error('[NodeAnalytics] No database connection');
      return { processed: 0, errors: 1 };
    }
    
    // Step 1: Get unique addresses (both from and to)
    // Using two separate aggregations to avoid $facet size issues
    const uniqueFromAddresses = await db.collection('transfers').aggregate([
      { $match: { chain: network.toLowerCase() } },
      { $group: { _id: { $toLower: '$from' } } },
      { $limit: maxNodes },
    ]).toArray();
    
    const uniqueToAddresses = await db.collection('transfers').aggregate([
      { $match: { chain: network.toLowerCase() } },
      { $group: { _id: { $toLower: '$to' } } },
      { $limit: maxNodes },
    ]).toArray();
    
    // Merge unique addresses
    const addressSet = new Set<string>();
    uniqueFromAddresses.forEach(a => addressSet.add(a._id));
    uniqueToAddresses.forEach(a => addressSet.add(a._id));
    
    const addresses = Array.from(addressSet).slice(0, maxNodes);
    console.log(`[NodeAnalytics] Found ${addresses.length} unique addresses for ${network}`);
    
    if (addresses.length === 0) {
      return { processed: 0, errors: 0 };
    }
    
    // Step 2: Calculate analytics for each address
    let processed = 0;
    let errors = 0;
    
    // Process in small batches
    const batchSize = 50;
    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (address) => {
        try {
          // Get outgoing stats
          const outStats = await db.collection('transfers').aggregate([
            { 
              $match: { 
                chain: network.toLowerCase(),
                from: { $regex: `^${address}$`, $options: 'i' }
              }
            },
            {
              $group: {
                _id: null,
                outTxCount: { $sum: 1 },
                outVolumeUsd: { $sum: { $ifNull: ['$amountUsd', '$amountNormalized'] } },
                uniqueOutDegree: { $addToSet: { $toLower: '$to' } },
                firstSeenOut: { $min: '$timestamp' },
                lastSeenOut: { $max: '$timestamp' },
              }
            },
            {
              $project: {
                outTxCount: 1,
                outVolumeUsd: 1,
                uniqueOutDegree: { $size: '$uniqueOutDegree' },
                firstSeenOut: 1,
                lastSeenOut: 1,
              }
            }
          ]).toArray();
          
          // Get incoming stats
          const inStats = await db.collection('transfers').aggregate([
            { 
              $match: { 
                chain: network.toLowerCase(),
                to: { $regex: `^${address}$`, $options: 'i' }
              }
            },
            {
              $group: {
                _id: null,
                inTxCount: { $sum: 1 },
                inVolumeUsd: { $sum: { $ifNull: ['$amountUsd', '$amountNormalized'] } },
                uniqueInDegree: { $addToSet: { $toLower: '$from' } },
                firstSeenIn: { $min: '$timestamp' },
                lastSeenIn: { $max: '$timestamp' },
              }
            },
            {
              $project: {
                inTxCount: 1,
                inVolumeUsd: 1,
                uniqueInDegree: { $size: '$uniqueInDegree' },
                firstSeenIn: 1,
                lastSeenIn: 1,
              }
            }
          ]).toArray();
          
          const out = outStats[0] || {};
          const inc = inStats[0] || {};
          
          const rawData: any = {
            address,
            network,
            outTxCount: out.outTxCount || 0,
            outVolumeUsd: out.outVolumeUsd || 0,
            uniqueOutDegree: out.uniqueOutDegree || 0,
            inTxCount: inc.inTxCount || 0,
            inVolumeUsd: inc.inVolumeUsd || 0,
            uniqueInDegree: inc.uniqueInDegree || 0,
            firstSeen: out.firstSeenOut || inc.firstSeenIn,
            lastSeen: out.lastSeenOut || inc.lastSeenIn,
          };
          
          // Get entity info
          const entityInfo = KNOWN_ENTITIES[address];
          if (entityInfo) {
            rawData.entityType = entityInfo.type;
            rawData.entityName = entityInfo.name;
            rawData.tags = [entityInfo.type];
          }
          
          // Derive full analytics
          const analytics = deriveNodeAnalytics(rawData);
          
          // Upsert
          await upsertNodeAnalytics(analytics);
          processed++;
        } catch (err) {
          errors++;
          console.error(`[NodeAnalytics] Error processing ${address}:`, err);
        }
      }));
      
      if ((i + batchSize) % 200 === 0 || i + batchSize >= addresses.length) {
        console.log(`[NodeAnalytics] Processed ${Math.min(i + batchSize, addresses.length)}/${addresses.length}`);
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`[NodeAnalytics] Completed ${network}: ${processed} nodes in ${duration}ms`);
    
    return { processed, errors };
    
  } catch (err) {
    console.error('[NodeAnalytics] Fatal error:', err);
    return { processed: 0, errors: 1 };
  }
}

/**
 * Calculate analytics for a single address (on-demand)
 * 
 * Used when we need fresh analytics for an address not in cache.
 */
export async function calculateAddressAnalytics(
  address: string,
  network: NetworkType
): Promise<any | null> {
  const addr = address.toLowerCase();
  
  try {
    const db = mongoose.connection?.db;
    if (!db) return null;
    
    // Check cache first
    const cached = await getNodeAnalytics(addr, network);
    if (cached) {
      // Return cached if less than 1 hour old
      const age = Date.now() - new Date(cached.updatedAt).getTime();
      if (age < 60 * 60 * 1000) {
        return cached;
      }
    }
    
    // Calculate fresh from transfers
    const pipeline = buildAddressAnalyticsPipeline(addr, network);
    const results = await db.collection('transfers').aggregate(pipeline).toArray();
    
    if (!results[0]) return cached; // Return stale cache if no fresh data
    
    const { outgoing = [], incoming = [] } = results[0];
    
    // Extract data
    const out = outgoing[0] || {};
    const inc = incoming[0] || {};
    
    const rawData = {
      address: addr,
      network,
      outTxCount: out.outTxCount || 0,
      outVolumeUsd: out.outVolumeUsd || 0,
      uniqueOutDegree: out.uniqueOutDegree || 0,
      inTxCount: inc.inTxCount || 0,
      inVolumeUsd: inc.inVolumeUsd || 0,
      uniqueInDegree: inc.uniqueInDegree || 0,
      firstSeen: out.firstSeenOut || inc.firstSeenIn,
      lastSeen: out.lastSeenOut || inc.lastSeenIn,
    };
    
    // Add entity info if known
    const entityInfo = KNOWN_ENTITIES[addr];
    if (entityInfo) {
      rawData.entityType = entityInfo.type;
      rawData.entityName = entityInfo.name;
      rawData.tags = [entityInfo.type];
    }
    
    // Derive analytics
    const analytics = deriveNodeAnalytics(rawData);
    
    // Cache it
    await upsertNodeAnalytics(analytics);
    
    return analytics;
    
  } catch (err) {
    console.error(`[NodeAnalytics] Error calculating for ${addr}:`, err);
    return null;
  }
}

/**
 * Get analytics for nodes in a graph
 * 
 * Used by graph builder to enrich nodes with pre-calculated analytics.
 */
export async function enrichNodesWithAnalytics(
  addresses: string[],
  network: NetworkType
): Promise<Map<string, any>> {
  const result = new Map<string, any>();
  
  if (addresses.length === 0) return result;
  
  // Get batch from cache
  const cached = await getNodeAnalyticsBatch(addresses, network);
  
  // Index by address
  for (const analytics of cached) {
    result.set(analytics.address.toLowerCase(), analytics);
  }
  
  // For missing addresses, calculate on-demand (limited)
  const missing = addresses.filter(a => !result.has(a.toLowerCase()));
  
  // Only calculate for first 10 missing to avoid slowdown
  for (const addr of missing.slice(0, 10)) {
    const analytics = await calculateAddressAnalytics(addr, network);
    if (analytics) {
      result.set(addr.toLowerCase(), analytics);
    }
  }
  
  return result;
}

export const nodeAnalyticsService = {
  calculateNetworkNodeAnalytics,
  calculateAddressAnalytics,
  enrichNodesWithAnalytics,
};
