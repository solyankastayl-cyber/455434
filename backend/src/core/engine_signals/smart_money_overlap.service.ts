/**
 * Smart Money Overlap Service (Layer 1 - Engine)
 * 
 * Detects unusual overlap of "smart money" wallets across multiple tokens.
 * Smart money = wallets with high volume or known profitable behavior.
 * 
 * Rules:
 * - R1: Find top N wallets by volume (L0 data)
 * - R2: Detect when ≥X of these wallets are active in same tokens
 * - R3: Calculate overlap score
 * 
 * Output: Signal showing which tokens have unusual smart money convergence
 */
import { v4 as uuidv4 } from 'uuid';
import { TransferModel } from '../transfers/transfers.model.js';
import { EngineSignalModel, EngineSignalType, SignalStrength } from './engine_signal.model.js';
import { TokenRegistryModel } from '../resolver/token_registry.model.js';

// Configuration
const CONFIG = {
  // Top wallets to consider as "smart money"
  topWalletsCount: 100,
  
  // Minimum wallet overlap to trigger signal
  minWalletOverlap: 3,
  
  // Minimum overlap percentage
  minOverlapPercent: 30,
  
  // Time window (hours)
  defaultTimeWindow: 168, // 7 days
  
  // Signal expiry (hours)
  signalExpiryHours: 72,
  
  // Score weights
  weights: {
    overlapCount: 0.4,
    overlapPercent: 0.35,
    volumeConcentration: 0.25,
  },
};

// Chain mapping
const CHAIN_NAME_MAP: Record<number, string> = {
  1: 'ethereum',
  42161: 'arbitrum',
  137: 'polygon',
  8453: 'base',
  10: 'optimism',
};

export interface SmartMoneyWallet {
  address: string;
  totalVolume: number;
  tokenCount: number;
  topTokens: string[];
}

export interface TokenOverlap {
  tokenAddress: string;
  tokenSymbol?: string;
  chainId: number;
  smartMoneyWallets: string[];
  overlapCount: number;
  overlapPercent: number;
  totalVolume: number;
  score: number;
  strength: SignalStrength;
}

/**
 * Get top wallets by volume (smart money candidates)
 */
export async function getTopWalletsByVolume(
  chainId: number,
  timeWindowHours: number = 168,
  limit: number = CONFIG.topWalletsCount
): Promise<SmartMoneyWallet[]> {
  const chainName = CHAIN_NAME_MAP[chainId] || 'ethereum';
  const now = new Date();
  const startTime = new Date(now.getTime() - timeWindowHours * 60 * 60 * 1000);
  
  const pipeline = [
    {
      $match: {
        chain: chainName,
        timestamp: { $gte: startTime },
        assetType: 'erc20',
      },
    },
    // Get all wallet activity
    {
      $facet: {
        outgoing: [
          {
            $group: {
              _id: { wallet: '$from', token: '$assetAddress' },
              volume: { 
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
        ],
        incoming: [
          {
            $group: {
              _id: { wallet: '$to', token: '$assetAddress' },
              volume: { 
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
    // Group by wallet
    {
      $group: {
        _id: '$all._id.wallet',
        totalVolume: { $sum: '$all.volume' },
        tokens: { $addToSet: '$all._id.token' },
      },
    },
    // Filter valid addresses
    {
      $match: {
        _id: { $ne: '0x0000000000000000000000000000000000000000' },
        totalVolume: { $gt: 0 },
      },
    },
    // Sort and limit
    { $sort: { totalVolume: -1 } },
    { $limit: limit },
  ];
  
  try {
    const results = await TransferModel.aggregate(pipeline as any[]);
    
    return results.map((r: any) => ({
      address: r._id,
      totalVolume: r.totalVolume,
      tokenCount: r.tokens?.length || 0,
      topTokens: (r.tokens || []).slice(0, 10),
    }));
  } catch (error) {
    console.error('[SmartMoneyOverlap] Error getting top wallets:', error);
    return [];
  }
}

/**
 * Analyze token overlap among smart money wallets
 */
export async function analyzeSmartMoneyOverlap(
  chainId: number,
  timeWindowHours: number = 168
): Promise<TokenOverlap[]> {
  const chainName = CHAIN_NAME_MAP[chainId] || 'ethereum';
  const now = new Date();
  const startTime = new Date(now.getTime() - timeWindowHours * 60 * 60 * 1000);
  
  // Step 1: Get smart money wallets
  const smartMoneyWallets = await getTopWalletsByVolume(chainId, timeWindowHours);
  
  if (smartMoneyWallets.length < CONFIG.minWalletOverlap) {
    return [];
  }
  
  const smartMoneyAddresses = new Set(smartMoneyWallets.map(w => w.address));
  
  // Step 2: Find tokens where smart money is active
  const pipeline = [
    {
      $match: {
        chain: chainName,
        timestamp: { $gte: startTime },
        assetType: 'erc20',
        $or: [
          { from: { $in: Array.from(smartMoneyAddresses) } },
          { to: { $in: Array.from(smartMoneyAddresses) } },
        ],
      },
    },
    // Get wallet-token pairs
    {
      $facet: {
        outgoing: [
          { $match: { from: { $in: Array.from(smartMoneyAddresses) } } },
          {
            $group: {
              _id: { token: '$assetAddress', wallet: '$from' },
              volume: { 
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
        ],
        incoming: [
          { $match: { to: { $in: Array.from(smartMoneyAddresses) } } },
          {
            $group: {
              _id: { token: '$assetAddress', wallet: '$to' },
              volume: { 
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
    // Group by token
    {
      $group: {
        _id: '$all._id.token',
        wallets: { $addToSet: '$all._id.wallet' },
        totalVolume: { $sum: '$all.volume' },
      },
    },
    // Filter for minimum overlap
    {
      $match: {
        'wallets.1': { $exists: true }, // At least 2 wallets
      },
    },
    // Sort by wallet count
    { $sort: { 'wallets': -1 } },
    { $limit: 50 },
  ];
  
  try {
    const results = await TransferModel.aggregate(pipeline as any[]);
    
    // Calculate overlap for each token
    const overlaps: TokenOverlap[] = [];
    
    for (const result of results) {
      const walletCount = result.wallets?.length || 0;
      
      if (walletCount < CONFIG.minWalletOverlap) {
        continue;
      }
      
      const overlapPercent = (walletCount / smartMoneyWallets.length) * 100;
      
      if (overlapPercent < CONFIG.minOverlapPercent) {
        continue;
      }
      
      // Get token info
      const tokenInfo = await TokenRegistryModel.findOne({
        address: result._id,
        chainId,
      }).lean();
      
      // Calculate score
      const countScore = Math.min(100, (walletCount / 10) * 100);
      const percentScore = Math.min(100, (overlapPercent / 50) * 100);
      const volumeScore = Math.min(100, Math.log10(result.totalVolume + 1) * 20);
      
      const score = Math.round(
        countScore * CONFIG.weights.overlapCount +
        percentScore * CONFIG.weights.overlapPercent +
        volumeScore * CONFIG.weights.volumeConcentration
      );
      
      let strength: SignalStrength = 'weak';
      if (score >= 70) strength = 'strong';
      else if (score >= 50) strength = 'moderate';
      
      overlaps.push({
        tokenAddress: result._id,
        tokenSymbol: tokenInfo?.symbol,
        chainId,
        smartMoneyWallets: result.wallets.slice(0, 10),
        overlapCount: walletCount,
        overlapPercent,
        totalVolume: result.totalVolume,
        score,
        strength,
      });
    }
    
    // Sort by score
    overlaps.sort((a, b) => b.score - a.score);
    
    return overlaps;
  } catch (error) {
    console.error('[SmartMoneyOverlap] Analysis error:', error);
    return [];
  }
}

/**
 * Create engine signal from overlap pattern
 */
export async function createOverlapSignal(
  overlap: TokenOverlap,
  timeWindowHours: number
): Promise<void> {
  const now = new Date();
  const signalId = `smo_${overlap.chainId}_${overlap.tokenAddress}_${Date.now()}`;
  
  // Check for existing signal
  const existingSignal = await EngineSignalModel.findOne({
    signalType: 'smart_money_overlap',
    targetAddress: overlap.tokenAddress,
    chainId: overlap.chainId,
    status: 'active',
    detectedAt: { $gte: new Date(now.getTime() - 60 * 60 * 1000) },
  });
  
  if (existingSignal) {
    // Update existing
    await EngineSignalModel.updateOne(
      { _id: existingSignal._id },
      {
        $set: {
          score: overlap.score,
          strength: overlap.strength,
          evidence: {
            description: `${overlap.overlapCount} smart money wallets active in ${overlap.tokenSymbol || overlap.tokenAddress}`,
            walletCount: overlap.overlapCount,
            volumeUsd: null,
            timeWindowHours,
            topWallets: overlap.smartMoneyWallets.slice(0, 5),
            overlap: overlap.overlapPercent,
          },
          'triggeredBy.actual': overlap.overlapCount,
          updatedAt: now,
        },
      }
    );
    return;
  }
  
  // Create new signal
  const signal = new EngineSignalModel({
    signalId,
    signalType: 'smart_money_overlap' as EngineSignalType,
    targetType: 'token',
    targetAddress: overlap.tokenAddress,
    targetSymbol: overlap.tokenSymbol,
    chainId: overlap.chainId,
    strength: overlap.strength,
    score: overlap.score,
    evidence: {
      description: `${overlap.overlapCount} smart money wallets active in ${overlap.tokenSymbol || overlap.tokenAddress}`,
      walletCount: overlap.overlapCount,
      volumeUsd: null,
      timeWindowHours,
      topWallets: overlap.smartMoneyWallets.slice(0, 5),
      overlap: overlap.overlapPercent,
    },
    triggeredBy: {
      rule: 'smart_money_overlap_v1',
      threshold: CONFIG.minWalletOverlap,
      actual: overlap.overlapCount,
    },
    detectedAt: now,
    windowStart: new Date(now.getTime() - timeWindowHours * 60 * 60 * 1000),
    windowEnd: now,
    expiresAt: new Date(now.getTime() + CONFIG.signalExpiryHours * 60 * 60 * 1000),
    status: 'active',
  });
  
  await signal.save();
  console.log(`[SmartMoneyOverlap] Created signal: ${signalId} (score: ${overlap.score})`);
}

/**
 * Run full overlap scan and create signals
 */
export async function runSmartMoneyOverlapScan(
  chainId: number = 1,
  timeWindowHours: number = CONFIG.defaultTimeWindow
): Promise<{
  smartMoneyWallets: number;
  tokensAnalyzed: number;
  overlapsFound: number;
  signalsCreated: number;
}> {
  console.log(`[SmartMoneyOverlap] Starting scan (chain: ${chainId}, window: ${timeWindowHours}h)`);
  
  const smartMoney = await getTopWalletsByVolume(chainId, timeWindowHours);
  const overlaps = await analyzeSmartMoneyOverlap(chainId, timeWindowHours);
  
  let signalsCreated = 0;
  for (const overlap of overlaps) {
    await createOverlapSignal(overlap, timeWindowHours);
    signalsCreated++;
  }
  
  // Expire old signals
  await EngineSignalModel.updateMany(
    {
      signalType: 'smart_money_overlap',
      status: 'active',
      expiresAt: { $lt: new Date() },
    },
    { $set: { status: 'expired' } }
  );
  
  console.log(`[SmartMoneyOverlap] Scan complete: ${overlaps.length} overlaps, ${signalsCreated} signals`);
  
  return {
    smartMoneyWallets: smartMoney.length,
    tokensAnalyzed: overlaps.length,
    overlapsFound: overlaps.length,
    signalsCreated,
  };
}
