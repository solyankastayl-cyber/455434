/**
 * Aggregation Pipeline - ETAP D1
 * 
 * MongoDB aggregation for relation consolidation.
 * Transforms raw transactions into analytical relations.
 * 
 * RAW:    1 tx = 1 record
 * OUTPUT: 1 relation = aggregated edge (A → B)
 */

import type { NetworkType } from '../../common/network.types.js';

/**
 * Aggregated Relation (contract between backend and graph)
 */
export interface AggregatedRelation {
  from: string;
  to: string;
  network: NetworkType;
  txCount: number;
  volumeUsd: number;
  volumeNative: number;
  avgTxSize: number;
  firstSeen: Date;
  lastSeen: Date;
  confidence: number;
  direction: 'IN' | 'OUT';
  tags: string[];
}

/**
 * MongoDB aggregation pipeline for relation aggregation
 * 
 * Groups transactions by (from, to) and calculates metrics.
 */
export function buildAggregationPipeline(network: NetworkType, options?: {
  minTxCount?: number;
  minVolumeUsd?: number;
  timeWindowDays?: number;
}) {
  const minTxCount = options?.minTxCount ?? 1;
  const minVolumeUsd = options?.minVolumeUsd ?? 0;
  const timeWindowDays = options?.timeWindowDays ?? 365;
  
  const timeThreshold = new Date(Date.now() - timeWindowDays * 24 * 60 * 60 * 1000);
  
  return [
    // Stage 1: Match by network and time
    {
      $match: {
        $or: [
          { chain: network },
          { chain: network.toLowerCase() },
          { network: network },
        ],
        timestamp: { $gte: timeThreshold },
      },
    },
    
    // Stage 2: Group by (from, to) pair
    {
      $group: {
        _id: {
          from: { $toLower: '$from' },
          to: { $toLower: '$to' },
        },
        txCount: { $sum: 1 },
        volumeUsd: { 
          $sum: { 
            $ifNull: [
              { $toDouble: '$valueUsd' }, 
              { $toDouble: '$amountUsd' },
              0
            ] 
          } 
        },
        volumeNative: { 
          $sum: { 
            $ifNull: [
              { $toDouble: '$value' },
              { $toDouble: '$amountNormalized' },
              { $toDouble: '$amountRaw' },
              0
            ] 
          } 
        },
        firstSeen: { $min: '$timestamp' },
        lastSeen: { $max: '$timestamp' },
        tokens: { $addToSet: '$assetAddress' },
      },
    },
    
    // Stage 3: Calculate derived metrics
    {
      $addFields: {
        avgTxSize: {
          $cond: [
            { $eq: ['$txCount', 0] },
            0,
            { $divide: ['$volumeUsd', '$txCount'] },
          ],
        },
        daySpan: {
          $divide: [
            { $subtract: ['$lastSeen', '$firstSeen'] },
            86400000, // ms per day
          ],
        },
      },
    },
    
    // Stage 4: Filter by thresholds
    {
      $match: {
        txCount: { $gte: minTxCount },
        volumeUsd: { $gte: minVolumeUsd },
      },
    },
    
    // Stage 5: Sort by volume (most significant first)
    {
      $sort: { volumeUsd: -1 },
    },
  ];
}

/**
 * Pipeline for aggregating relations for a specific address
 */
export function buildAddressRelationsPipeline(
  address: string, 
  network: NetworkType,
  options?: {
    limit?: number;
    minTxCount?: number;
    minVolumeUsd?: number;
    timeWindowDays?: number;
  }
) {
  const addr = address.toLowerCase();
  const limit = options?.limit ?? 100;
  const minTxCount = options?.minTxCount ?? 1;
  const minVolumeUsd = options?.minVolumeUsd ?? 0;
  const timeWindowDays = options?.timeWindowDays ?? 365;
  
  const timeThreshold = new Date(Date.now() - timeWindowDays * 24 * 60 * 60 * 1000);
  
  return [
    // Stage 1: Match transactions involving this address
    {
      $match: {
        $and: [
          {
            $or: [
              { from: { $regex: addr, $options: 'i' } },
              { to: { $regex: addr, $options: 'i' } },
            ],
          },
          {
            $or: [
              { chain: network },
              { chain: network.toLowerCase() },
              { network: network },
            ],
          },
        ],
        timestamp: { $gte: timeThreshold },
      },
    },
    
    // Stage 2: Group by (from, to)
    {
      $group: {
        _id: {
          from: { $toLower: '$from' },
          to: { $toLower: '$to' },
        },
        txCount: { $sum: 1 },
        volumeUsd: { 
          $sum: { 
            $ifNull: [
              { $toDouble: '$valueUsd' }, 
              { $toDouble: '$amountUsd' },
              0
            ] 
          } 
        },
        volumeNative: { 
          $sum: { 
            $ifNull: [
              { $toDouble: '$value' },
              { $toDouble: '$amountNormalized' },
              { $toDouble: '$amountRaw' },
              0
            ] 
          } 
        },
        firstSeen: { $min: '$timestamp' },
        lastSeen: { $max: '$timestamp' },
        tokens: { $addToSet: '$assetAddress' },
        txHashes: { $push: '$txHash' },
      },
    },
    
    // Stage 3: Calculate derived metrics
    {
      $addFields: {
        avgTxSize: {
          $cond: [
            { $eq: ['$txCount', 0] },
            0,
            { $divide: ['$volumeUsd', '$txCount'] },
          ],
        },
        // Determine direction relative to query address
        direction: {
          $cond: [
            { $eq: ['$_id.from', addr] },
            'OUT',
            'IN',
          ],
        },
        // Counterparty (the other address)
        counterparty: {
          $cond: [
            { $eq: ['$_id.from', addr] },
            '$_id.to',
            '$_id.from',
          ],
        },
      },
    },
    
    // Stage 4: Filter
    {
      $match: {
        txCount: { $gte: minTxCount },
        volumeUsd: { $gte: minVolumeUsd },
      },
    },
    
    // Stage 5: Sort and limit
    { $sort: { volumeUsd: -1 } },
    { $limit: limit },
  ];
}
