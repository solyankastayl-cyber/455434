/**
 * P2.1 Feature Store - Market Feature Builder Job
 * 
 * Runs every 15 minutes
 * Computes market-level features (CEX pressure, zones, corridors)
 */

import { 
  FeatureMarketModel, 
  toBucket, 
  getWindowBoundaries,
  calculateEntropy,
  type WindowValues 
} from './feature.models.js';
import { TransferModel } from '../transfers/transfers.model.js';
import { RelationModel } from '../relations/relations.model.js';
import { ZoneModel } from '../zones/zones.routes.js';
import { SUPPORTED_NETWORKS } from '../../common/network.types.js';
import { getCexAddresses } from '../market/exchange_pressure.routes.js';

const BUCKET_SEC = 900; // 15 minutes
const VERSION = 'P2.1.0';

/**
 * Build market features for a specific network and bucket
 */
async function buildMarketFeatures(network: string, bucketTs: number): Promise<boolean> {
  const windows = getWindowBoundaries(bucketTs);
  const cexAddresses = getCexAddresses(network);
  
  // === CEX PRESSURE ===
  const since24h = new Date(windows.w24h.start * 1000);
  const since7d = new Date(windows.w7d.start * 1000);
  
  // CEX inflows (deposits to CEX)
  const [cexIn24h, cexIn7d] = await Promise.all([
    TransferModel.countDocuments({
      chain: network,
      timestamp: { $gte: since24h },
      to: { $in: Array.from(cexAddresses) },
    }),
    TransferModel.countDocuments({
      chain: network,
      timestamp: { $gte: since7d },
      to: { $in: Array.from(cexAddresses) },
    }),
  ]);
  
  // CEX outflows (withdrawals from CEX)
  const [cexOut24h, cexOut7d] = await Promise.all([
    TransferModel.countDocuments({
      chain: network,
      timestamp: { $gte: since24h },
      from: { $in: Array.from(cexAddresses) },
    }),
    TransferModel.countDocuments({
      chain: network,
      timestamp: { $gte: since7d },
      from: { $in: Array.from(cexAddresses) },
    }),
  ]);
  
  // Calculate pressure: (IN - OUT) / (IN + OUT)
  const calcPressure = (inVal: number, outVal: number) => {
    const total = inVal + outVal;
    if (total === 0) return 0;
    return Math.round(((inVal - outVal) / total) * 1000) / 1000;
  };
  
  const cexPressure = {
    cexInUsd: { w24h: cexIn24h, w7d: cexIn7d },
    cexOutUsd: { w24h: cexOut24h, w7d: cexOut7d },
    pressure: { 
      w24h: calcPressure(cexIn24h, cexOut24h),
      w7d: calcPressure(cexIn7d, cexOut7d),
    },
  };
  
  // === ZONES ===
  const [accZones, distZones] = await Promise.all([
    ZoneModel.countDocuments({ network, type: 'ACCUMULATION' }),
    ZoneModel.countDocuments({ network, type: 'DISTRIBUTION' }),
  ]);
  
  const totalZones = accZones + distZones;
  const accStrength = totalZones > 0 ? accZones / totalZones : 0;
  const distStrength = totalZones > 0 ? distZones / totalZones : 0;
  
  let marketRegime: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL' = 'NEUTRAL';
  if (accStrength > 0.55) marketRegime = 'ACCUMULATION';
  else if (distStrength > 0.55) marketRegime = 'DISTRIBUTION';
  
  const zones = {
    accumulationStrength: { w7d: Math.round(accStrength * 100) / 100 },
    distributionStrength: { w7d: Math.round(distStrength * 100) / 100 },
    marketRegime,
  };
  
  // === CORRIDORS ===
  // Get top corridors by volume
  const corridorPipeline = [
    {
      $match: { chain: network, window: '7d' },
    },
    {
      $group: {
        _id: {
          // Create corridor key based on address types
          // Simplified: just use from-to direction
          key: { $concat: ['$from', '->', '$to'] },
        },
        volumeUsd: { $sum: '$interactionCount' },
      },
    },
    { $sort: { volumeUsd: -1 } },
    { $limit: 5 },
  ];
  
  const topCorridorsResult = await RelationModel.aggregate(corridorPipeline);
  const topCorridors = topCorridorsResult.map((c: any) => ({
    key: c._id.key?.slice(0, 20) + '...' || 'unknown',
    volumeUsd: c.volumeUsd,
  }));
  
  // Corridor entropy (how distributed are flows)
  const volumes = topCorridorsResult.map((c: any) => c.volumeUsd);
  const corridorEntropy = calculateEntropy(volumes);
  
  const corridors = {
    entropy: { w7d: Math.round(corridorEntropy * 100) / 100 },
    topCorridors,
  };
  
  // === UPSERT ===
  await FeatureMarketModel.updateOne(
    { network, bucketTs },
    {
      $set: {
        bucketSec: BUCKET_SEC,
        cexPressure,
        zones,
        corridors,
        meta: {
          computedAtTs: Math.floor(Date.now() / 1000),
          version: VERSION,
        },
      },
    },
    { upsert: true }
  );
  
  return true;
}

/**
 * Run market feature builder for all networks
 */
export async function runMarketFeatureBuilder(): Promise<{ network: string; success: boolean }[]> {
  const bucketTs = toBucket(Math.floor(Date.now() / 1000), BUCKET_SEC);
  const results: { network: string; success: boolean }[] = [];
  
  for (const network of SUPPORTED_NETWORKS) {
    try {
      const success = await buildMarketFeatures(network, bucketTs);
      results.push({ network, success });
      console.log(`[P2.1 Market Features] ${network}: computed`);
    } catch (err) {
      console.error(`[P2.1 Market Features] ${network} error:`, err);
      results.push({ network, success: false });
    }
  }
  
  return results;
}

export default { runMarketFeatureBuilder, buildMarketFeatures };
