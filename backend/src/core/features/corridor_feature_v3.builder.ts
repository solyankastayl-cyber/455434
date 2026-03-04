/**
 * V3.0 Pack A - Corridor Feature Builder
 * 
 * C) Corridor Persistence & Entropy
 * 
 * Detects strategic capital flow patterns vs noise
 * Runs every 1 hour
 */

import { 
  FeatureCorridorModel, 
  toBucket, 
  calculateEntropy,
  clamp01,
} from './feature.models.js';
import { TransferModel } from '../transfers/transfers.model.js';
import { RelationModel } from '../relations/relations.model.js';
import { SUPPORTED_NETWORKS } from '../../common/network.types.js';
import { getCexAddresses } from '../market/exchange_pressure.routes.js';

const BUCKET_SEC = 3600; // 1 hour
const VERSION = 'V3.0.0';

// Corridor key types
type EntityType = 'CEX' | 'BRIDGE' | 'DEX' | 'WALLET' | 'CONTRACT';

/**
 * Classify address type
 */
function classifyAddress(address: string, cexAddresses: Set<string>): EntityType {
  if (cexAddresses.has(address.toLowerCase())) return 'CEX';
  // TODO: Add bridge, dex detection from labels
  return 'WALLET';
}

/**
 * Build corridor key
 */
function buildCorridorKey(fromType: EntityType, toType: EntityType, direction: 'IN' | 'OUT'): string {
  return `${direction}:${fromType}->${toType}`;
}

/**
 * Calculate linear regression slope for trend detection
 */
function calculateSlope(values: number[]): number {
  if (values.length < 2) return 0;
  
  const n = values.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = values.reduce((sum, y, x) => sum + x * y, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  return isNaN(slope) ? 0 : slope;
}

// ============================================
// C) CORRIDOR PERSISTENCE & ENTROPY
// ============================================

interface CorridorV3Features {
  persistence_7d: number;
  persistence_30d: number;
  repeatRate: number;
  netFlowTrend: number;
  entropy: number;
  concentrationIndex: number;
  topActorShare: number;
  newActorRate: number;
  qualityScore: number;
}

interface CorridorAggregation {
  corridorKey: string;
  txCount_24h: number;
  txCount_7d: number;
  txCount_30d: number;
  actors: Set<string>;
  actorCounts: Map<string, number>;
  dailyTxCounts: number[];
  netFlow: number;
}

async function buildCorridorFeaturesV3(
  network: string,
  bucketTs: number
): Promise<number> {
  const cexAddresses = getCexAddresses(network);
  const now = bucketTs * 1000;
  
  const since24h = new Date(now - 24 * 60 * 60 * 1000);
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000);
  
  // Aggregate transfers by corridor with time granularity
  const pipeline = [
    {
      $match: {
        chain: network,
        timestamp: { $gte: since30d },
      },
    },
    {
      $addFields: {
        dayBucket: {
          $floor: {
            $divide: [{ $toLong: '$timestamp' }, 86400000]
          },
        },
      },
    },
    {
      $group: {
        _id: {
          from: '$from',
          to: '$to',
        },
        txCount_30d: { $sum: 1 },
        txCount_7d: {
          $sum: {
            $cond: [{ $gte: ['$timestamp', since7d] }, 1, 0],
          },
        },
        txCount_24h: {
          $sum: {
            $cond: [{ $gte: ['$timestamp', since24h] }, 1, 0],
          },
        },
        actors: { $addToSet: '$from' },
        activeDays: { $addToSet: '$dayBucket' },
        // Track actor frequency
        actorTxs: { $push: '$from' },
      },
    },
    {
      $match: {
        txCount_7d: { $gte: 5 }, // Minimum activity threshold
      },
    },
  ];
  
  const relations = await TransferModel.aggregate(pipeline);
  
  // Group by corridor type and compute V3 features
  const corridorMap = new Map<string, CorridorAggregation>();
  
  for (const rel of relations) {
    const fromType = classifyAddress(rel._id.from, cexAddresses);
    const toType = classifyAddress(rel._id.to, cexAddresses);
    
    // Determine direction based on CEX involvement
    let direction: 'IN' | 'OUT' = 'OUT';
    if (toType === 'CEX') direction = 'OUT';
    if (fromType === 'CEX') direction = 'IN';
    
    const corridorKey = buildCorridorKey(fromType, toType, direction);
    
    if (!corridorMap.has(corridorKey)) {
      corridorMap.set(corridorKey, {
        corridorKey,
        txCount_24h: 0,
        txCount_7d: 0,
        txCount_30d: 0,
        actors: new Set(),
        actorCounts: new Map(),
        dailyTxCounts: [],
        netFlow: 0,
      });
    }
    
    const corridor = corridorMap.get(corridorKey)!;
    corridor.txCount_24h += rel.txCount_24h;
    corridor.txCount_7d += rel.txCount_7d;
    corridor.txCount_30d += rel.txCount_30d;
    
    // Track actors
    rel.actors.forEach((a: string) => corridor.actors.add(a));
    
    // Track actor frequency for concentration
    rel.actorTxs.forEach((a: string) => {
      corridor.actorCounts.set(a, (corridor.actorCounts.get(a) || 0) + 1);
    });
    
    // Track daily activity for trend
    corridor.dailyTxCounts.push(rel.activeDays?.length || 0);
    
    // Net flow: positive = inflow, negative = outflow
    corridor.netFlow += direction === 'IN' ? rel.txCount_7d : -rel.txCount_7d;
  }
  
  // Calculate V3 features and upsert
  const bulkOps: any[] = [];
  
  for (const [corridorKey, data] of corridorMap) {
    const v3Features = computeCorridorV3Features(data);
    
    bulkOps.push({
      updateOne: {
        filter: { network, corridorKey, bucketTs },
        update: {
          $set: {
            bucketSec: BUCKET_SEC,
            flow: {
              volumeUsd: { w24h: data.txCount_24h, w7d: data.txCount_7d },
              txCount: { w24h: data.txCount_24h, w7d: data.txCount_7d },
              uniqueActors: { w24h: data.actors.size },
            },
            corridorV3: v3Features,
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
 * Compute V3 features for a single corridor
 */
function computeCorridorV3Features(data: CorridorAggregation): CorridorV3Features {
  // === Persistence ===
  // Ratio of active time vs total window
  const persistence_7d = data.txCount_7d > 0 
    ? clamp01(data.txCount_7d / 100) // Normalize to reasonable range
    : 0;
    
  const persistence_30d = data.txCount_30d > 0 
    ? clamp01(data.txCount_30d / 300)
    : 0;
  
  // === Repeat Rate ===
  // How often this corridor is used relative to all activity
  const repeatRate = data.txCount_7d > 0 
    ? clamp01(data.txCount_7d / data.txCount_30d)
    : 0;
  
  // === Net Flow Trend ===
  // Slope of daily tx counts
  const netFlowTrend = data.dailyTxCounts.length > 1
    ? calculateSlope(data.dailyTxCounts)
    : 0;
  
  // === Entropy & Concentration ===
  // How distributed are actors in this corridor
  const actorVolumes = Array.from(data.actorCounts.values());
  const entropy = calculateEntropy(actorVolumes);
  const concentrationIndex = clamp01(1 - entropy); // High concentration = low entropy
  
  // === Top Actor Share ===
  const maxActorTxs = actorVolumes.length > 0 ? Math.max(...actorVolumes) : 0;
  const totalTxs = actorVolumes.reduce((a, b) => a + b, 0);
  const topActorShare = totalTxs > 0 ? maxActorTxs / totalTxs : 0;
  
  // === New Actor Rate ===
  // Simplified: assume actors appearing only in 24h are "new"
  const newActorRate = data.txCount_24h > 0 && data.txCount_7d > 0
    ? clamp01(data.txCount_24h / data.txCount_7d)
    : 0;
  
  // === Quality Score ===
  // Combination of persistence, low concentration (diverse actors), and consistent activity
  const qualityScore = clamp01(
    persistence_7d * 0.25 +
    (1 - topActorShare) * 0.25 + // Diverse actors = higher quality
    repeatRate * 0.25 +
    (entropy * 0.25) // High entropy = more distributed = better signal
  );
  
  return {
    persistence_7d: Math.round(persistence_7d * 1000) / 1000,
    persistence_30d: Math.round(persistence_30d * 1000) / 1000,
    repeatRate: Math.round(repeatRate * 1000) / 1000,
    netFlowTrend: Math.round(netFlowTrend * 1000) / 1000,
    entropy: Math.round(entropy * 1000) / 1000,
    concentrationIndex: Math.round(concentrationIndex * 1000) / 1000,
    topActorShare: Math.round(topActorShare * 1000) / 1000,
    newActorRate: Math.round(newActorRate * 1000) / 1000,
    qualityScore: Math.round(qualityScore * 1000) / 1000,
  };
}

/**
 * Run V3 corridor feature builder for all networks
 */
export async function runCorridorFeatureV3Builder(): Promise<{ 
  network: string; 
  count: number;
  topQualityCorridor?: string;
}[]> {
  const bucketTs = toBucket(Math.floor(Date.now() / 1000), BUCKET_SEC);
  const results: { 
    network: string; 
    count: number;
    topQualityCorridor?: string;
  }[] = [];
  
  for (const network of SUPPORTED_NETWORKS) {
    try {
      const count = await buildCorridorFeaturesV3(network, bucketTs);
      
      // Find top quality corridor for this network
      const topCorridor = await FeatureCorridorModel.findOne(
        { network, bucketTs },
        { corridorKey: 1, 'corridorV3.qualityScore': 1 }
      )
        .sort({ 'corridorV3.qualityScore': -1 })
        .lean();
      
      results.push({ 
        network, 
        count,
        topQualityCorridor: (topCorridor as any)?.corridorKey || undefined,
      });
      
      console.log(`[V3 Corridor Features] ${network}: ${count} corridors processed`);
      
    } catch (err) {
      console.error(`[V3 Corridor Features] ${network} error:`, err);
      results.push({ network, count: 0 });
    }
  }
  
  return results;
}

/**
 * Get V3 corridor summary for a network
 */
export async function getCorridorV3Summary(network: string): Promise<{
  totalCorridors: number;
  avgQualityScore: number;
  topCorridors: Array<{
    key: string;
    qualityScore: number;
    persistence: number;
    entropy: number;
  }>;
  concentrationAlert: boolean;
}> {
  const latest = await FeatureCorridorModel.find(
    { network },
    { corridorKey: 1, corridorV3: 1 }
  )
    .sort({ bucketTs: -1 })
    .limit(50)
    .lean();
  
  if (latest.length === 0) {
    return {
      totalCorridors: 0,
      avgQualityScore: 0,
      topCorridors: [],
      concentrationAlert: false,
    };
  }
  
  const qualityScores = latest
    .map((c: any) => c.corridorV3?.qualityScore || 0)
    .filter((q: number) => q > 0);
  
  const avgQualityScore = qualityScores.length > 0
    ? qualityScores.reduce((a: number, b: number) => a + b, 0) / qualityScores.length
    : 0;
  
  const topCorridors = latest
    .filter((c: any) => c.corridorV3?.qualityScore > 0)
    .sort((a: any, b: any) => (b.corridorV3?.qualityScore || 0) - (a.corridorV3?.qualityScore || 0))
    .slice(0, 5)
    .map((c: any) => ({
      key: c.corridorKey,
      qualityScore: c.corridorV3?.qualityScore || 0,
      persistence: c.corridorV3?.persistence_7d || 0,
      entropy: c.corridorV3?.entropy || 0,
    }));
  
  // Concentration alert: if top corridor has > 50% of activity
  const topShare = latest[0]?.corridorV3?.topActorShare || 0;
  const concentrationAlert = topShare > 0.5;
  
  return {
    totalCorridors: latest.length,
    avgQualityScore: Math.round(avgQualityScore * 1000) / 1000,
    topCorridors,
    concentrationAlert,
  };
}

export default { 
  runCorridorFeatureV3Builder, 
  buildCorridorFeaturesV3,
  getCorridorV3Summary,
};
