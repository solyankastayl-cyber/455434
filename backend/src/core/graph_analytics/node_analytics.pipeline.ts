/**
 * Node Analytics Pipeline - ETAP D2
 * 
 * MongoDB aggregation pipeline for calculating node analytics
 * from transfers collection.
 * 
 * Note: Uses 'transfers' collection with 'chain' field (not 'relations' with 'network')
 */

import type { NetworkType } from '../../common/network.types.js';

/**
 * Build pipeline to calculate node analytics for a network
 * 
 * Strategy:
 * 1. $facet to get both outgoing and incoming aggregates
 * 2. Merge results by address
 * 3. Calculate derived metrics
 * 
 * NOTE: Uses 'transfers' collection, not 'relations'
 */
export function buildNodeAnalyticsPipeline(network: NetworkType) {
  return [
    // Match network (field is 'chain' in transfers collection)
    { $match: { chain: network.toLowerCase() } },
    
    // Facet: separate outgoing and incoming
    {
      $facet: {
        outgoing: [
          {
            $group: {
              _id: { $toLower: '$from' },
              outTxCount: { $sum: 1 },
              outVolumeUsd: { $sum: { $ifNull: ['$amountUsd', '$amountNormalized'] } },
              uniqueOutDegree: { $addToSet: { $toLower: '$to' } },
              firstSeenOut: { $min: '$timestamp' },
              lastSeenOut: { $max: '$timestamp' },
            },
          },
          {
            $project: {
              _id: 1,
              outTxCount: 1,
              outVolumeUsd: 1,
              uniqueOutDegree: { $size: '$uniqueOutDegree' },
              firstSeenOut: 1,
              lastSeenOut: 1,
            },
          },
        ],
        incoming: [
          {
            $group: {
              _id: { $toLower: '$to' },
              inTxCount: { $sum: 1 },
              inVolumeUsd: { $sum: { $ifNull: ['$amountUsd', '$amountNormalized'] } },
              uniqueInDegree: { $addToSet: { $toLower: '$from' } },
              firstSeenIn: { $min: '$timestamp' },
              lastSeenIn: { $max: '$timestamp' },
            },
          },
          {
            $project: {
              _id: 1,
              inTxCount: 1,
              inVolumeUsd: 1,
              uniqueInDegree: { $size: '$uniqueInDegree' },
              firstSeenIn: 1,
              lastSeenIn: 1,
            },
          },
        ],
      },
    },
  ];
}

/**
 * Build pipeline to calculate analytics for a specific address
 */
export function buildAddressAnalyticsPipeline(address: string, network: NetworkType) {
  const addr = address.toLowerCase();
  
  return [
    // Match address and network
    {
      $match: {
        chain: network.toLowerCase(),
        $or: [
          { from: { $regex: `^${addr}$`, $options: 'i' } },
          { to: { $regex: `^${addr}$`, $options: 'i' } },
        ],
      },
    },
    
    // Facet for outgoing/incoming
    {
      $facet: {
        outgoing: [
          { $match: { from: { $regex: `^${addr}$`, $options: 'i' } } },
          {
            $group: {
              _id: null,
              outTxCount: { $sum: 1 },
              outVolumeUsd: { $sum: { $ifNull: ['$amountUsd', '$amountNormalized'] } },
              uniqueOutDegree: { $addToSet: { $toLower: '$to' } },
              firstSeenOut: { $min: '$timestamp' },
              lastSeenOut: { $max: '$timestamp' },
            },
          },
          {
            $project: {
              outTxCount: 1,
              outVolumeUsd: 1,
              uniqueOutDegree: { $size: '$uniqueOutDegree' },
              firstSeenOut: 1,
              lastSeenOut: 1,
            },
          },
        ],
        incoming: [
          { $match: { to: { $regex: `^${addr}$`, $options: 'i' } } },
          {
            $group: {
              _id: null,
              inTxCount: { $sum: 1 },
              inVolumeUsd: { $sum: { $ifNull: ['$amountUsd', '$amountNormalized'] } },
              uniqueInDegree: { $addToSet: { $toLower: '$from' } },
              firstSeenIn: { $min: '$timestamp' },
              lastSeenIn: { $max: '$timestamp' },
            },
          },
          {
            $project: {
              inTxCount: 1,
              inVolumeUsd: 1,
              uniqueInDegree: { $size: '$uniqueInDegree' },
              firstSeenIn: 1,
              lastSeenIn: 1,
            },
          },
        ],
      },
    },
  ];
}

/**
 * Merge outgoing and incoming results into single node analytics
 */
export function mergeNodeAnalytics(
  outgoing: {
    _id: string;
    outTxCount: number;
    outVolumeUsd: number;
    uniqueOutDegree: number;
    firstSeenOut?: Date;
    lastSeenOut?: Date;
  }[],
  incoming: {
    _id: string;
    inTxCount: number;
    inVolumeUsd: number;
    uniqueInDegree: number;
    firstSeenIn?: Date;
    lastSeenIn?: Date;
  }[],
  network: string
): Map<string, any> {
  const nodeMap = new Map<string, any>();
  
  // Process outgoing
  for (const out of outgoing) {
    const addr = out._id.toLowerCase();
    nodeMap.set(addr, {
      address: addr,
      network,
      outTxCount: out.outTxCount || 0,
      outVolumeUsd: out.outVolumeUsd || 0,
      uniqueOutDegree: out.uniqueOutDegree || 0,
      inTxCount: 0,
      inVolumeUsd: 0,
      uniqueInDegree: 0,
      firstSeen: out.firstSeenOut,
      lastSeen: out.lastSeenOut,
    });
  }
  
  // Merge incoming
  for (const inc of incoming) {
    const addr = inc._id.toLowerCase();
    const existing = nodeMap.get(addr);
    
    if (existing) {
      existing.inTxCount = inc.inTxCount || 0;
      existing.inVolumeUsd = inc.inVolumeUsd || 0;
      existing.uniqueInDegree = inc.uniqueInDegree || 0;
      // Update firstSeen/lastSeen to earliest/latest
      if (inc.firstSeenIn && (!existing.firstSeen || inc.firstSeenIn < existing.firstSeen)) {
        existing.firstSeen = inc.firstSeenIn;
      }
      if (inc.lastSeenIn && (!existing.lastSeen || inc.lastSeenIn > existing.lastSeen)) {
        existing.lastSeen = inc.lastSeenIn;
      }
    } else {
      nodeMap.set(addr, {
        address: addr,
        network,
        outTxCount: 0,
        outVolumeUsd: 0,
        uniqueOutDegree: 0,
        inTxCount: inc.inTxCount || 0,
        inVolumeUsd: inc.inVolumeUsd || 0,
        uniqueInDegree: inc.uniqueInDegree || 0,
        firstSeen: inc.firstSeenIn,
        lastSeen: inc.lastSeenIn,
      });
    }
  }
  
  return nodeMap;
}
