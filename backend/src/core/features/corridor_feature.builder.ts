/**
 * P2.1 Feature Store - Corridor Feature Builder Job
 * 
 * Runs every 1 hour
 * Computes corridor features (density, persistence, volatility)
 */

import { 
  FeatureCorridorModel, 
  toBucket, 
  getWindowBoundaries,
  calculateEntropy,
} from './feature.models.js';
import { TransferModel } from '../transfers/transfers.model.js';
import { SUPPORTED_NETWORKS } from '../../common/network.types.js';
import { getCexAddresses } from '../market/exchange_pressure.routes.js';

const BUCKET_SEC = 3600; // 1 hour
const VERSION = 'P2.1.0';

// Corridor key types
type EntityType = 'CEX' | 'BRIDGE' | 'DEX' | 'WALLET' | 'CONTRACT';

/**
 * Classify address type
 */
function classifyAddress(address: string, cexAddresses: Set<string>): EntityType {
  if (cexAddresses.has(address.toLowerCase())) return 'CEX';
  // TODO: Add bridge, dex, mixer detection
  return 'WALLET';
}

/**
 * Build corridor key
 */
function buildCorridorKey(fromType: EntityType, toType: EntityType, direction: 'IN' | 'OUT'): string {
  return `${direction}:${fromType}->${toType}`;
}

/**
 * Build corridor features for a specific network and bucket
 */
async function buildCorridorFeatures(network: string, bucketTs: number): Promise<number> {
  const windows = getWindowBoundaries(bucketTs);
  const cexAddresses = getCexAddresses(network);
  
  const since7d = new Date(windows.w7d.start * 1000);
  const since24h = new Date(windows.w24h.start * 1000);
  
  // Aggregate transfers by corridor type
  const pipeline = [
    {
      $match: {
        chain: network,
        timestamp: { $gte: since7d },
      },
    },
    {
      $group: {
        _id: {
          from: '$from',
          to: '$to',
        },
        txCount_7d: { $sum: 1 },
        txCount_24h: {
          $sum: {
            $cond: [
              { $gte: ['$timestamp', since24h] },
              1,
              0,
            ],
          },
        },
        actors: { $addToSet: '$from' },
      },
    },
  ];
  
  const relations = await TransferModel.aggregate(pipeline);
  
  // Group by corridor type
  const corridorMap = new Map<string, {
    volumeUsd_24h: number;
    volumeUsd_7d: number;
    txCount_24h: number;
    txCount_7d: number;
    actors: Set<string>;
  }>();
  
  for (const rel of relations) {
    const fromType = classifyAddress(rel._id.from, cexAddresses);
    const toType = classifyAddress(rel._id.to, cexAddresses);
    
    // Determine direction based on CEX involvement
    let direction: 'IN' | 'OUT' = 'OUT';
    if (toType === 'CEX') direction = 'OUT'; // Deposit to CEX = outflow from users
    if (fromType === 'CEX') direction = 'IN'; // Withdrawal from CEX = inflow to users
    
    const corridorKey = buildCorridorKey(fromType, toType, direction);
    
    if (!corridorMap.has(corridorKey)) {
      corridorMap.set(corridorKey, {
        volumeUsd_24h: 0,
        volumeUsd_7d: 0,
        txCount_24h: 0,
        txCount_7d: 0,
        actors: new Set(),
      });
    }
    
    const corridor = corridorMap.get(corridorKey)!;
    corridor.txCount_24h += rel.txCount_24h;
    corridor.txCount_7d += rel.txCount_7d;
    corridor.volumeUsd_24h += rel.txCount_24h;
    corridor.volumeUsd_7d += rel.txCount_7d;
    rel.actors.forEach((a: string) => corridor.actors.add(a));
  }
  
  // Calculate features and upsert
  const bulkOps: any[] = [];
  
  for (const [corridorKey, data] of corridorMap) {
    // Persistence: ratio of active hours (simplified)
    const persistence = data.txCount_7d > 0 ? Math.min(1, data.txCount_7d / 168) : 0; // 168 hours in 7d
    
    // Volatility: std/mean (simplified using txCount variance)
    const volatility = data.txCount_7d > 0 
      ? Math.abs(data.txCount_24h * 7 - data.txCount_7d) / (data.txCount_7d + 1)
      : 0;
    
    // Actor entropy
    const actorCounts = Array.from(data.actors).map(() => 1); // Simplified
    const entropyActors = calculateEntropy(actorCounts);
    
    // Direction bias (simplified)
    const directionBias = corridorKey.startsWith('OUT:') ? -0.5 : 0.5;
    
    bulkOps.push({
      updateOne: {
        filter: { network, corridorKey, bucketTs },
        update: {
          $set: {
            bucketSec: BUCKET_SEC,
            flow: {
              volumeUsd: { w24h: data.volumeUsd_24h, w7d: data.volumeUsd_7d },
              txCount: { w24h: data.txCount_24h, w7d: data.txCount_7d },
              uniqueActors: { w24h: data.actors.size },
            },
            density: {
              persistence: { w7d: Math.round(persistence * 100) / 100 },
              volatility: { w7d: Math.round(volatility * 100) / 100 },
              entropyActors: { w7d: Math.round(entropyActors * 100) / 100 },
            },
            pressure: {
              directionBias: { w24h: directionBias },
            },
            meta: {
              computedAtTs: Math.floor(Date.now() / 1000),
              version: VERSION,
            },
          },
        },
        upsert: true,
      },
    });
  }
  
  if (bulkOps.length > 0) {
    await FeatureCorridorModel.bulkWrite(bulkOps);
  }
  
  return bulkOps.length;
}

/**
 * Run corridor feature builder for all networks
 */
export async function runCorridorFeatureBuilder(): Promise<{ network: string; count: number }[]> {
  const bucketTs = toBucket(Math.floor(Date.now() / 1000), BUCKET_SEC);
  const results: { network: string; count: number }[] = [];
  
  for (const network of SUPPORTED_NETWORKS) {
    try {
      const count = await buildCorridorFeatures(network, bucketTs);
      results.push({ network, count });
      console.log(`[P2.1 Corridor Features] ${network}: ${count} corridors processed`);
    } catch (err) {
      console.error(`[P2.1 Corridor Features] ${network} error:`, err);
      results.push({ network, count: 0 });
    }
  }
  
  return results;
}

export default { runCorridorFeatureBuilder, buildCorridorFeatures };
