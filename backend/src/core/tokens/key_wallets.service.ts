/**
 * Key Wallets Service (Layer 0 - Research)
 * 
 * Provides factual data about top wallets for a specific token.
 * NO ML, NO predictions, NO intent analysis.
 * 
 * Rule-based roles:
 * - Accumulator: netFlow > +20% of their volume
 * - Distributor: netFlow < -20% of their volume
 * - Mixed: significant activity in both directions
 * - Passive: volume exists but netFlow ≈ 0
 */
import { TransferModel } from '../transfers/transfers.model.js';

// Types
export interface KeyWallet {
  address: string;
  shortAddress: string;
  shareOfVolume: number;      // Percentage of total token volume
  volumeUsd: number | null;   // USD volume if available
  netFlow: number;            // in - out (positive = accumulating)
  netFlowPercent: number;     // netFlow as % of wallet's volume
  txCount: number;            // Total transaction count
  inTxCount: number;          // Incoming transactions
  outTxCount: number;         // Outgoing transactions
  role: 'Accumulator' | 'Distributor' | 'Mixed' | 'Passive';
  lastActive: Date | null;
}

export interface KeyWalletsResult {
  tokenAddress: string;
  chainId: number;
  timeWindow: string;
  totalVolume: number;
  totalWallets: number;
  wallets: KeyWallet[];
  disclaimer: string;
  computedAt: Date;
}

// Chain mapping
const CHAIN_ID_MAP: Record<string, number> = {
  'ethereum': 1,
  'arbitrum': 42161,
  'polygon': 137,
  'base': 8453,
  'optimism': 10,
};

const CHAIN_NAME_MAP: Record<number, string> = {
  1: 'ethereum',
  42161: 'arbitrum',
  137: 'polygon',
  8453: 'base',
  10: 'optimism',
};

/**
 * Determine wallet role based on net flow
 * Rule-based, no ML
 */
function determineRole(
  netFlowPercent: number,
  inTxCount: number,
  outTxCount: number
): KeyWallet['role'] {
  // Threshold: 20% net flow determines direction
  const THRESHOLD = 20;
  
  if (netFlowPercent > THRESHOLD) {
    return 'Accumulator';
  }
  
  if (netFlowPercent < -THRESHOLD) {
    return 'Distributor';
  }
  
  // If both in and out activity is significant
  if (inTxCount > 0 && outTxCount > 0) {
    const ratio = Math.min(inTxCount, outTxCount) / Math.max(inTxCount, outTxCount);
    if (ratio > 0.3) {
      return 'Mixed';
    }
  }
  
  return 'Passive';
}

/**
 * Get key wallets for a token
 * 
 * @param chainId - Chain ID (1 = Ethereum, 42161 = Arbitrum, etc.)
 * @param tokenAddress - Token contract address
 * @param timeWindow - Time window ('24h', '7d', '30d')
 * @param limit - Max wallets to return (default 10)
 */
export async function getKeyWallets(
  chainId: number,
  tokenAddress: string,
  timeWindow: string = '24h',
  limit: number = 10
): Promise<KeyWalletsResult> {
  const address = tokenAddress.toLowerCase();
  const chainName = CHAIN_NAME_MAP[chainId] || 'ethereum';
  
  // Calculate time range
  const now = new Date();
  let hoursBack = 24;
  if (timeWindow === '7d') hoursBack = 24 * 7;
  if (timeWindow === '30d') hoursBack = 24 * 30;
  
  const startTime = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);
  
  // Aggregation pipeline to get wallet statistics
  const pipeline = [
    // Match transfers for this token in time window
    {
      $match: {
        assetAddress: address,
        chain: chainName,
        timestamp: { $gte: startTime },
      },
    },
    // Create unified wallet view (each wallet appears as both sender and receiver)
    {
      $facet: {
        outgoing: [
          {
            $group: {
              _id: '$from',
              outVolume: { 
                $sum: { 
                  $cond: [
                    { $ne: ['$amountNormalized', null] },
                    { $toDouble: '$amountNormalized' },
                    { $toDouble: '$amountRaw' }
                  ]
                } 
              },
              outTxCount: { $sum: 1 },
              lastOut: { $max: '$timestamp' },
            },
          },
        ],
        incoming: [
          {
            $group: {
              _id: '$to',
              inVolume: { 
                $sum: { 
                  $cond: [
                    { $ne: ['$amountNormalized', null] },
                    { $toDouble: '$amountNormalized' },
                    { $toDouble: '$amountRaw' }
                  ]
                } 
              },
              inTxCount: { $sum: 1 },
              lastIn: { $max: '$timestamp' },
            },
          },
        ],
      },
    },
    // Combine outgoing and incoming
    {
      $project: {
        all: { $setUnion: ['$outgoing', '$incoming'] },
      },
    },
    { $unwind: '$all' },
    {
      $group: {
        _id: '$all._id',
        outVolume: { $max: '$all.outVolume' },
        inVolume: { $max: '$all.inVolume' },
        outTxCount: { $max: '$all.outTxCount' },
        inTxCount: { $max: '$all.inTxCount' },
        lastOut: { $max: '$all.lastOut' },
        lastIn: { $max: '$all.lastIn' },
      },
    },
    // Calculate total volume per wallet
    {
      $addFields: {
        totalVolume: {
          $add: [
            { $ifNull: ['$outVolume', 0] },
            { $ifNull: ['$inVolume', 0] },
          ],
        },
        netFlow: {
          $subtract: [
            { $ifNull: ['$inVolume', 0] },
            { $ifNull: ['$outVolume', 0] },
          ],
        },
        txCount: {
          $add: [
            { $ifNull: ['$outTxCount', 0] },
            { $ifNull: ['$inTxCount', 0] },
          ],
        },
        lastActive: {
          $max: [
            { $ifNull: ['$lastOut', null] },
            { $ifNull: ['$lastIn', null] },
          ],
        },
      },
    },
    // Filter out zero volume
    {
      $match: {
        totalVolume: { $gt: 0 },
      },
    },
    // Sort by volume
    { $sort: { totalVolume: -1 } },
    // Limit
    { $limit: limit + 10 }, // Extra buffer for filtering
  ];
  
  try {
    const results = await TransferModel.aggregate(pipeline);
    
    // Calculate total volume for percentage
    let totalVolume = 0;
    for (const wallet of results) {
      totalVolume += wallet.totalVolume || 0;
    }
    
    // Transform to KeyWallet format
    const wallets: KeyWallet[] = results
      .slice(0, limit)
      .filter((w: any) => w._id && w._id !== '0x0000000000000000000000000000000000000000') // Filter null/zero address
      .map((w: any) => {
        const volume = w.totalVolume || 0;
        const netFlow = w.netFlow || 0;
        const netFlowPercent = volume > 0 ? (netFlow / volume) * 100 : 0;
        const inTxCount = w.inTxCount || 0;
        const outTxCount = w.outTxCount || 0;
        
        return {
          address: w._id,
          shortAddress: `${w._id.slice(0, 6)}...${w._id.slice(-4)}`,
          shareOfVolume: totalVolume > 0 ? (volume / totalVolume) * 100 : 0,
          volumeUsd: null, // Would need price data
          netFlow: netFlow,
          netFlowPercent: netFlowPercent,
          txCount: inTxCount + outTxCount,
          inTxCount: inTxCount,
          outTxCount: outTxCount,
          role: determineRole(netFlowPercent, inTxCount, outTxCount),
          lastActive: w.lastActive || null,
        };
      });
    
    return {
      tokenAddress: address,
      chainId,
      timeWindow,
      totalVolume,
      totalWallets: results.length,
      wallets,
      disclaimer: 'This describes volume behavior, not intent. Roles are rule-based classifications.',
      computedAt: new Date(),
    };
  } catch (error) {
    console.error('[KeyWallets] Aggregation error:', error);
    
    // Return empty result on error
    return {
      tokenAddress: address,
      chainId,
      timeWindow,
      totalVolume: 0,
      totalWallets: 0,
      wallets: [],
      disclaimer: 'This describes volume behavior, not intent. Roles are rule-based classifications.',
      computedAt: new Date(),
    };
  }
}
