/**
 * P2.1 Feature Store - Actor Feature Builder Job
 * 
 * Runs every 15 minutes
 * Computes actor features from transfers + relations
 */

import mongoose from 'mongoose';
import { 
  FeatureActorModel, 
  toBucket, 
  getWindowBoundaries,
  calculateEntropy,
  clamp01,
  type WindowValues 
} from './feature.models.js';
import { TransferModel } from '../transfers/transfers.model.js';
import { SUPPORTED_NETWORKS } from '../../common/network.types.js';
import { CEX_ADDRESSES, getCexAddresses } from '../market/exchange_pressure.routes.js';

const BUCKET_SEC = 900; // 15 minutes
const VERSION = 'P2.1.0';

// P95 normalization constants (will be replaced with dynamic stats later)
const P95_VOLUME = 1_000_000;
const P95_COUNTERPARTIES = 100;

/**
 * Build actor features for a specific network and bucket
 */
async function buildActorFeatures(network: string, bucketTs: number): Promise<number> {
  const windows = getWindowBoundaries(bucketTs);
  const cexAddresses = getCexAddresses(network);
  
  // Get all active actors in the last 7 days
  const sinceTs = new Date((bucketTs - 604800) * 1000);
  
  // Aggregate actor metrics
  const pipeline = [
    {
      $match: {
        chain: network,
        timestamp: { $gte: sinceTs },
      },
    },
    {
      $facet: {
        // Inflows by actor
        inflows: [
          {
            $group: {
              _id: '$to',
              totalIn: { $sum: 1 },
              senders: { $addToSet: '$from' },
              // Window counts
              in_7d: { $sum: 1 },
              in_24h: { 
                $sum: { 
                  $cond: [
                    { $gte: ['$timestamp', new Date(windows.w24h.start * 1000)] }, 
                    1, 
                    0
                  ] 
                } 
              },
              in_1h: { 
                $sum: { 
                  $cond: [
                    { $gte: ['$timestamp', new Date(windows.w1h.start * 1000)] }, 
                    1, 
                    0
                  ] 
                } 
              },
            },
          },
        ],
        // Outflows by actor
        outflows: [
          {
            $group: {
              _id: '$from',
              totalOut: { $sum: 1 },
              receivers: { $addToSet: '$to' },
              out_7d: { $sum: 1 },
              out_24h: { 
                $sum: { 
                  $cond: [
                    { $gte: ['$timestamp', new Date(windows.w24h.start * 1000)] }, 
                    1, 
                    0
                  ] 
                } 
              },
              out_1h: { 
                $sum: { 
                  $cond: [
                    { $gte: ['$timestamp', new Date(windows.w1h.start * 1000)] }, 
                    1, 
                    0
                  ] 
                } 
              },
            },
          },
        ],
        // CEX inflows (to CEX)
        cexIn: [
          {
            $match: {
              to: { $in: Array.from(cexAddresses) },
            },
          },
          {
            $group: {
              _id: '$from',
              cexInCount: { $sum: 1 },
            },
          },
        ],
        // CEX outflows (from CEX)
        cexOut: [
          {
            $match: {
              from: { $in: Array.from(cexAddresses) },
            },
          },
          {
            $group: {
              _id: '$to',
              cexOutCount: { $sum: 1 },
            },
          },
        ],
      },
    },
  ];
  
  const [result] = await TransferModel.aggregate(pipeline);
  
  if (!result) return 0;
  
  // Build maps
  const inflowMap = new Map(result.inflows.map((i: any) => [i._id, i]));
  const outflowMap = new Map(result.outflows.map((o: any) => [o._id, o]));
  const cexInMap = new Map(result.cexIn.map((c: any) => [c._id, c.cexInCount]));
  const cexOutMap = new Map(result.cexOut.map((c: any) => [c._id, c.cexOutCount]));
  
  // Combine all actors
  const allActors = new Set([...inflowMap.keys(), ...outflowMap.keys()]);
  
  // Build feature documents
  const bulkOps: any[] = [];
  
  for (const actorId of allActors) {
    const inData = inflowMap.get(actorId) || { in_7d: 0, in_24h: 0, in_1h: 0, senders: [] };
    const outData = outflowMap.get(actorId) || { out_7d: 0, out_24h: 0, out_1h: 0, receivers: [] };
    
    const cexIn = cexInMap.get(actorId) || 0;
    const cexOut = cexOutMap.get(actorId) || 0;
    
    // Calculate flows
    const flows = {
      inUsd: { w1h: inData.in_1h, w24h: inData.in_24h, w7d: inData.in_7d },
      outUsd: { w1h: outData.out_1h, w24h: outData.out_24h, w7d: outData.out_7d },
      netUsd: { 
        w1h: inData.in_1h - outData.out_1h, 
        w24h: inData.in_24h - outData.out_24h, 
        w7d: inData.in_7d - outData.out_7d 
      },
    };
    
    // Calculate activity
    const activity = {
      txCount: { 
        w1h: inData.in_1h + outData.out_1h, 
        w24h: inData.in_24h + outData.out_24h, 
        w7d: inData.in_7d + outData.out_7d 
      },
      uniqueCounterparties: { 
        w24h: new Set([...inData.senders, ...outData.receivers]).size,
        w7d: new Set([...inData.senders, ...outData.receivers]).size,
      },
      activeHours: { w24h: 0 }, // Simplified for v1
    };
    
    // Calculate exposure
    const exposure = {
      cexInUsd: { w24h: cexIn },
      cexOutUsd: { w24h: cexOut },
      bridgeOutUsd: { w24h: 0 }, // TODO: bridge detection
      mixerOutUsd: { w7d: 0 },
      dexNetUsd: { w24h: 0 },
    };
    
    // Calculate structure
    const fanIn = inData.senders?.length || 0;
    const fanOut = outData.receivers?.length || 0;
    
    // Entropy calculation (simplified - based on receiver distribution)
    const receiverCounts = outData.receivers?.map(() => 1) || []; // Simplified for v1
    const entropyOut = calculateEntropy(receiverCounts);
    
    // Top out share (simplified)
    const topOutShare = fanOut > 0 ? 1 / fanOut : 0;
    
    const structure = {
      fanIn: { w24h: fanIn },
      fanOut: { w24h: fanOut },
      entropyOut: { w24h: entropyOut },
      topOutShare: { w24h: topOutShare },
    };
    
    // Calculate scores
    const vol = Math.log1p(inData.in_7d + outData.out_7d);
    const cp = Math.log1p(activity.uniqueCounterparties.w24h || 0);
    
    const normVol = Math.min(1, vol / Math.log1p(P95_VOLUME));
    const normCp = Math.min(1, cp / Math.log1p(P95_COUNTERPARTIES));
    
    // Role boost
    let roleBoost = 0;
    const netRatio = inData.in_7d / ((inData.in_7d + outData.out_7d) || 1);
    if (netRatio > 0.6) roleBoost = 0.05; // Accumulator
    else if (netRatio < 0.4) roleBoost = 0.02; // Distributor
    else roleBoost = 0.03; // Router
    
    const influenceScore = clamp01(0.55 * normVol + 0.35 * normCp + roleBoost);
    
    // Whale score (based on volume)
    const whaleScore = clamp01(normVol);
    
    // Noise score (low activity, random pattern)
    const noiseScore = clamp01(1 - influenceScore);
    
    const scores = {
      influenceScore: Math.round(influenceScore * 100) / 100,
      trustScore: 0.5, // Will be computed in P2.2
      whaleScore: Math.round(whaleScore * 100) / 100,
      noiseScore: Math.round(noiseScore * 100) / 100,
    };
    
    bulkOps.push({
      updateOne: {
        filter: { network, actorId, bucketTs },
        update: {
          $set: {
            bucketSec: BUCKET_SEC,
            flows,
            activity,
            exposure,
            structure,
            scores,
            meta: {
              computedAtTs: Math.floor(Date.now() / 1000),
              dataWindowMaxTs: bucketTs,
              version: VERSION,
            },
          },
        },
        upsert: true,
      },
    });
  }
  
  // Bulk write
  if (bulkOps.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < bulkOps.length; i += batchSize) {
      const batch = bulkOps.slice(i, i + batchSize);
      await FeatureActorModel.bulkWrite(batch);
    }
  }
  
  return bulkOps.length;
}

/**
 * Run actor feature builder for all networks
 */
export async function runActorFeatureBuilder(): Promise<{ network: string; count: number }[]> {
  const bucketTs = toBucket(Math.floor(Date.now() / 1000), BUCKET_SEC);
  const results: { network: string; count: number }[] = [];
  
  for (const network of SUPPORTED_NETWORKS) {
    try {
      const count = await buildActorFeatures(network, bucketTs);
      results.push({ network, count });
      console.log(`[P2.1 Actor Features] ${network}: ${count} actors processed`);
    } catch (err) {
      console.error(`[P2.1 Actor Features] ${network} error:`, err);
      results.push({ network, count: 0 });
    }
  }
  
  return results;
}

export default { runActorFeatureBuilder, buildActorFeatures };
