/**
 * Coordinated Accumulation Service (Layer 1 - Engine)
 * 
 * Detects when multiple wallets are accumulating the same token
 * within a short time window. This is a rule-based signal.
 * 
 * Rules:
 * - R1: ≥3 wallets with role="Accumulator" in same token within 24h
 * - R2: Combined accumulation ≥ X% of total volume
 * - R3: Wallets are NOT the same cluster (if cluster data available)
 * 
 * Output: Signal with score based on:
 * - Number of accumulators
 * - Share of volume
 * - Time concentration
 */
import { v4 as uuidv4 } from 'uuid';
import { TransferModel } from '../transfers/transfers.model.js';
import { EngineSignalModel, EngineSignalType, SignalStrength } from './engine_signal.model.js';
import { TokenRegistryModel } from '../resolver/token_registry.model.js';

// Configuration
const CONFIG = {
  // Minimum accumulators to trigger signal
  minAccumulators: 3,
  
  // Net flow threshold to be considered accumulator (%)
  accumulatorThreshold: 20,
  
  // Minimum share of total volume (%)
  minVolumeShare: 10,
  
  // Time windows to analyze
  timeWindows: [24, 168, 720], // 24h, 7d, 30d
  
  // Signal expiry (hours after detection)
  signalExpiryHours: 48,
  
  // Score weights
  weights: {
    walletCount: 0.4,
    volumeShare: 0.35,
    timeConcentration: 0.25,
  },
};

// Chain ID mapping
const CHAIN_NAME_MAP: Record<number, string> = {
  1: 'ethereum',
  42161: 'arbitrum',
  137: 'polygon',
  8453: 'base',
  10: 'optimism',
};

export interface AccumulationPattern {
  tokenAddress: string;
  tokenSymbol?: string;
  chainId: number;
  accumulators: {
    address: string;
    netFlowPercent: number;
    volumeShare: number;
    txCount: number;
  }[];
  totalAccumulators: number;
  combinedVolumeShare: number;
  timeWindowHours: number;
  score: number;
  strength: SignalStrength;
}

/**
 * Analyze a single token for coordinated accumulation
 */
export async function analyzeTokenAccumulation(
  chainId: number,
  tokenAddress: string,
  timeWindowHours: number = 24
): Promise<AccumulationPattern | null> {
  const address = tokenAddress.toLowerCase();
  const chainName = CHAIN_NAME_MAP[chainId] || 'ethereum';
  
  const now = new Date();
  const startTime = new Date(now.getTime() - timeWindowHours * 60 * 60 * 1000);
  
  // Aggregation pipeline to find accumulators
  const pipeline = [
    {
      $match: {
        assetAddress: address,
        chain: chainName,
        timestamp: { $gte: startTime },
      },
    },
    // Group by wallet (combine in/out)
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
                    0
                  ]
                } 
              },
              outTxCount: { $sum: 1 },
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
                    0
                  ]
                } 
              },
              inTxCount: { $sum: 1 },
            },
          },
        ],
      },
    },
    // Combine
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
      },
    },
    // Calculate metrics
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
      },
    },
    // Filter for positive volume
    {
      $match: {
        totalVolume: { $gt: 0 },
      },
    },
    // Calculate net flow percent
    {
      $addFields: {
        netFlowPercent: {
          $multiply: [
            { $divide: ['$netFlow', '$totalVolume'] },
            100
          ],
        },
      },
    },
    // Filter for accumulators only
    {
      $match: {
        netFlowPercent: { $gt: CONFIG.accumulatorThreshold },
      },
    },
    // Sort by volume
    { $sort: { totalVolume: -1 } },
    // Limit
    { $limit: 50 },
  ];
  
  try {
    const results = await TransferModel.aggregate(pipeline as any[]);
    
    if (results.length < CONFIG.minAccumulators) {
      return null;
    }
    
    // Calculate total volume for share calculation
    const totalVolumeQuery = await TransferModel.aggregate([
      {
        $match: {
          assetAddress: address,
          chain: chainName,
          timestamp: { $gte: startTime },
        },
      },
      {
        $group: {
          _id: null,
          totalVolume: { 
            $sum: { 
              $cond: [
                { $ne: ['$amountNormalized', null] },
                { $toDouble: '$amountNormalized' },
                0
              ]
            } 
          },
        },
      },
    ]);
    
    const totalTokenVolume = totalVolumeQuery[0]?.totalVolume || 1;
    
    // Build accumulator list
    const accumulators = results
      .filter((w: any) => w._id && w._id !== '0x0000000000000000000000000000000000000000')
      .map((w: any) => ({
        address: w._id,
        netFlowPercent: w.netFlowPercent || 0,
        volumeShare: (w.totalVolume / totalTokenVolume) * 100,
        txCount: (w.inTxCount || 0) + (w.outTxCount || 0),
      }));
    
    const combinedVolumeShare = accumulators.reduce((sum, a) => sum + a.volumeShare, 0);
    
    // Check minimum volume share
    if (combinedVolumeShare < CONFIG.minVolumeShare) {
      return null;
    }
    
    // Calculate score
    const walletScore = Math.min(100, (accumulators.length / 10) * 100);
    const volumeScore = Math.min(100, (combinedVolumeShare / 50) * 100);
    const timeScore = timeWindowHours <= 24 ? 100 : timeWindowHours <= 168 ? 70 : 40;
    
    const score = Math.round(
      walletScore * CONFIG.weights.walletCount +
      volumeScore * CONFIG.weights.volumeShare +
      timeScore * CONFIG.weights.timeConcentration
    );
    
    // Determine strength
    let strength: SignalStrength = 'weak';
    if (score >= 70) strength = 'strong';
    else if (score >= 50) strength = 'moderate';
    
    // Get token symbol
    const tokenInfo = await TokenRegistryModel.findOne({ 
      address: address,
      chainId: chainId,
    }).lean();
    
    return {
      tokenAddress: address,
      tokenSymbol: tokenInfo?.symbol,
      chainId,
      accumulators: accumulators.slice(0, 10), // Top 10
      totalAccumulators: accumulators.length,
      combinedVolumeShare,
      timeWindowHours,
      score,
      strength,
    };
  } catch (error) {
    console.error('[CoordinatedAccumulation] Analysis error:', error);
    return null;
  }
}

/**
 * Scan all tokens for coordinated accumulation patterns
 */
export async function scanForCoordinatedAccumulation(
  chainId: number = 1,
  timeWindowHours: number = 24,
  limit: number = 100
): Promise<AccumulationPattern[]> {
  const chainName = CHAIN_NAME_MAP[chainId] || 'ethereum';
  const now = new Date();
  const startTime = new Date(now.getTime() - timeWindowHours * 60 * 60 * 1000);
  
  // Find tokens with recent activity
  const activeTokens = await TransferModel.aggregate([
    {
      $match: {
        chain: chainName,
        timestamp: { $gte: startTime },
        assetType: 'erc20',
      },
    },
    {
      $group: {
        _id: '$assetAddress',
        txCount: { $sum: 1 },
      },
    },
    { $match: { txCount: { $gte: 10 } } }, // Minimum activity
    { $sort: { txCount: -1 } },
    { $limit: limit },
  ]);
  
  const patterns: AccumulationPattern[] = [];
  
  for (const token of activeTokens) {
    const pattern = await analyzeTokenAccumulation(chainId, token._id, timeWindowHours);
    if (pattern) {
      patterns.push(pattern);
    }
  }
  
  // Sort by score
  patterns.sort((a, b) => b.score - a.score);
  
  return patterns;
}

/**
 * Create engine signal from accumulation pattern
 */
export async function createAccumulationSignal(
  pattern: AccumulationPattern
): Promise<void> {
  const now = new Date();
  const signalId = `acc_${pattern.chainId}_${pattern.tokenAddress}_${pattern.timeWindowHours}h_${Date.now()}`;
  
  // Check if similar signal exists (same token, same window, within last hour)
  const existingSignal = await EngineSignalModel.findOne({
    signalType: 'coordinated_accumulation',
    targetAddress: pattern.tokenAddress,
    chainId: pattern.chainId,
    'evidence.timeWindowHours': pattern.timeWindowHours,
    status: 'active',
    detectedAt: { $gte: new Date(now.getTime() - 60 * 60 * 1000) },
  });
  
  if (existingSignal) {
    // Update existing signal
    await EngineSignalModel.updateOne(
      { _id: existingSignal._id },
      {
        $set: {
          score: pattern.score,
          strength: pattern.strength,
          evidence: {
            description: `${pattern.totalAccumulators} wallets accumulating ${pattern.tokenSymbol || pattern.tokenAddress}`,
            walletCount: pattern.totalAccumulators,
            volumeUsd: null,
            timeWindowHours: pattern.timeWindowHours,
            topWallets: pattern.accumulators.slice(0, 5).map(a => a.address),
          },
          'triggeredBy.actual': pattern.totalAccumulators,
          updatedAt: now,
        },
      }
    );
    return;
  }
  
  // Create new signal
  const signal = new EngineSignalModel({
    signalId,
    signalType: 'coordinated_accumulation' as EngineSignalType,
    targetType: 'token',
    targetAddress: pattern.tokenAddress,
    targetSymbol: pattern.tokenSymbol,
    chainId: pattern.chainId,
    strength: pattern.strength,
    score: pattern.score,
    evidence: {
      description: `${pattern.totalAccumulators} wallets accumulating ${pattern.tokenSymbol || pattern.tokenAddress}`,
      walletCount: pattern.totalAccumulators,
      volumeUsd: null,
      timeWindowHours: pattern.timeWindowHours,
      topWallets: pattern.accumulators.slice(0, 5).map(a => a.address),
    },
    triggeredBy: {
      rule: 'coordinated_accumulation_v1',
      threshold: CONFIG.minAccumulators,
      actual: pattern.totalAccumulators,
    },
    detectedAt: now,
    windowStart: new Date(now.getTime() - pattern.timeWindowHours * 60 * 60 * 1000),
    windowEnd: now,
    expiresAt: new Date(now.getTime() + CONFIG.signalExpiryHours * 60 * 60 * 1000),
    status: 'active',
  });
  
  await signal.save();
  console.log(`[CoordinatedAccumulation] Created signal: ${signalId} (score: ${pattern.score})`);
}

/**
 * Run full scan and create signals
 */
export async function runCoordinatedAccumulationScan(
  chainId: number = 1,
  timeWindowHours: number = 24
): Promise<{
  scanned: number;
  patternsFound: number;
  signalsCreated: number;
}> {
  console.log(`[CoordinatedAccumulation] Starting scan (chain: ${chainId}, window: ${timeWindowHours}h)`);
  
  const patterns = await scanForCoordinatedAccumulation(chainId, timeWindowHours);
  
  let signalsCreated = 0;
  for (const pattern of patterns) {
    await createAccumulationSignal(pattern);
    signalsCreated++;
  }
  
  // Expire old signals
  await EngineSignalModel.updateMany(
    {
      signalType: 'coordinated_accumulation',
      status: 'active',
      expiresAt: { $lt: new Date() },
    },
    { $set: { status: 'expired' } }
  );
  
  console.log(`[CoordinatedAccumulation] Scan complete: ${patterns.length} patterns, ${signalsCreated} signals`);
  
  return {
    scanned: 100, // Max tokens scanned
    patternsFound: patterns.length,
    signalsCreated,
  };
}
