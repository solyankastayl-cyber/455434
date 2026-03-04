/**
 * Token Signals Service - ANALYTICAL LAYER
 * 
 * This service provides the "meaning" layer for token analytics.
 * It transforms raw data into insights.
 * 
 * KEY PRINCIPLE: Even "empty" results must explain what was checked.
 * 
 * Modules:
 * 1. Activity Drivers (B2) - WHO is driving this token?
 * 2. Signals - DEVIATIONS from baseline
 * 3. Smart Money (B4) - What are profitable wallets doing?
 * 4. Clusters (B3) - Are wallets coordinated?
 */

import { ERC20LogModel } from '../../onchain/ethereum/logs_erc20.model.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const BASELINE_HOURS = 168; // 7 days for baseline
const CURRENT_WINDOW_HOURS = 24; // Current comparison window

// Concentration thresholds
const CONCENTRATION = {
  HIGH: 0.6,      // Top 5 wallets > 60% = highly concentrated
  MODERATE: 0.3,  // 30-60% = moderately concentrated
};

// Signal thresholds
const SIGNAL_THRESHOLDS = {
  activitySpike: 2.0,     // 2x baseline = spike
  largeTransfer: 0.01,    // Top 1% of transfers
  accumulationRatio: 0.7, // 70%+ of flow to few wallets
};

// ============================================================================
// TYPES
// ============================================================================

export interface TokenSignal {
  type: 'activity_spike' | 'large_move' | 'accumulation' | 'distribution' | 'concentration_shift';
  severity: number; // 0-100
  confidence: number; // 0-1
  title: string;
  description: string;
  evidence: {
    metric: string;
    baseline: number;
    current: number;
    deviation: number;
    context?: string;
  };
  timestamp: Date;
}

export interface ActivityDriver {
  wallet: string;
  role: 'accumulator' | 'distributor' | 'mixed';
  volumeIn: number;
  volumeOut: number;
  netFlow: number;
  txCount: number;
  influence: number; // Percentage of total volume
}

export interface ConcentrationMetrics {
  top1Share: number;
  top5Share: number;
  top10Share: number;
  totalWallets: number;
  interpretation: 'highly_concentrated' | 'moderately_concentrated' | 'distributed';
  headline: string;
  description: string;
}

export interface SignalsResult {
  signals: TokenSignal[];
  baseline: {
    avgTransfersPerHour: number;
    avgWalletsPerHour: number;
    avgVolumePerHour: number;
    periodHours: number;
  };
  current: {
    transfers: number;
    wallets: number;
    volume: number;
    windowHours: number;
  };
  analysisStatus: 'completed' | 'insufficient_data';
  checkedMetrics: string[];
}

// ============================================================================
// 1. ACTIVITY DRIVERS (B2) - Concentration Analysis
// ============================================================================

/**
 * Get activity drivers with concentration analysis
 * 
 * CRITICAL: This is what makes the page NOT empty
 */
export async function getActivityDrivers(
  tokenAddress: string,
  limit: number = 10
): Promise<{
  topDrivers: ActivityDriver[];
  totalVolume: number;
  hasConcentration: boolean;
  concentration: ConcentrationMetrics;
  analysisStatus: 'completed' | 'insufficient_data';
}> {
  const normalized = tokenAddress.toLowerCase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h
  
  // Aggregate volume per wallet (both in and out)
  const walletVolumes = await ERC20LogModel.aggregate([
    { $match: { token: normalized, blockTimestamp: { $gte: since } }},
    { $facet: {
      // Volume received per wallet
      incoming: [
        { $group: { _id: '$to', volume: { $sum: { $toDouble: '$amount' } }, txCount: { $sum: 1 } }},
      ],
      // Volume sent per wallet
      outgoing: [
        { $group: { _id: '$from', volume: { $sum: { $toDouble: '$amount' } }, txCount: { $sum: 1 } }},
      ],
      // Total volume
      total: [
        { $group: { _id: null, total: { $sum: { $toDouble: '$amount' } } }},
      ],
    }},
  ]);
  
  const incomingMap = new Map<string, { volumeIn: number; txIn: number }>();
  const outgoingMap = new Map<string, { volumeOut: number; txOut: number }>();
  
  for (const entry of walletVolumes[0]?.incoming || []) {
    incomingMap.set(entry._id, { volumeIn: entry.volume, txIn: entry.txCount });
  }
  
  for (const entry of walletVolumes[0]?.outgoing || []) {
    outgoingMap.set(entry._id, { volumeOut: entry.volume, txOut: entry.txCount });
  }
  
  const totalVolume = walletVolumes[0]?.total?.[0]?.total || 0;
  
  // Merge into wallet stats
  const allWallets = new Set([...incomingMap.keys(), ...outgoingMap.keys()]);
  const walletStats: { wallet: string; totalVolume: number; volumeIn: number; volumeOut: number; netFlow: number; txCount: number }[] = [];
  
  for (const wallet of allWallets) {
    const incoming = incomingMap.get(wallet) || { volumeIn: 0, txIn: 0 };
    const outgoing = outgoingMap.get(wallet) || { volumeOut: 0, txOut: 0 };
    
    walletStats.push({
      wallet,
      totalVolume: incoming.volumeIn + outgoing.volumeOut,
      volumeIn: incoming.volumeIn,
      volumeOut: outgoing.volumeOut,
      netFlow: incoming.volumeIn - outgoing.volumeOut,
      txCount: incoming.txIn + outgoing.txOut,
    });
  }
  
  // Sort by total volume
  walletStats.sort((a, b) => b.totalVolume - a.totalVolume);
  
  // Calculate concentration metrics
  const totalWallets = walletStats.length;
  const top1Volume = walletStats[0]?.totalVolume || 0;
  const top5Volume = walletStats.slice(0, 5).reduce((sum, w) => sum + w.totalVolume, 0);
  const top10Volume = walletStats.slice(0, 10).reduce((sum, w) => sum + w.totalVolume, 0);
  
  // Note: Each transfer counts twice (once for sender, once for receiver)
  // So we divide by 2 for accurate share calculation
  const volumeForShare = totalVolume > 0 ? totalVolume : 1;
  const top1Share = (top1Volume / volumeForShare) / 2; // Normalize
  const top5Share = Math.min((top5Volume / volumeForShare) / 2, 1);
  const top10Share = Math.min((top10Volume / volumeForShare) / 2, 1);
  
  // Determine interpretation - DESCRIPTIVE ONLY, not verdict
  let interpretation: 'highly_concentrated' | 'moderately_concentrated' | 'distributed';
  let headline: string;
  let description: string;
  
  if (top5Share > CONCENTRATION.HIGH) {
    interpretation = 'highly_concentrated';
    headline = `Activity concentrated among top wallets — top 5 represent ${(top5Share * 100).toFixed(0)}% of volume`;
    description = `This describes volume structure, not intent. Top wallet: ${(top1Share * 100).toFixed(1)}% share.`;
  } else if (top5Share > CONCENTRATION.MODERATE) {
    interpretation = 'moderately_concentrated';
    headline = `Activity moderately concentrated — top 5 wallets represent ${(top5Share * 100).toFixed(0)}% of volume`;
    description = `This describes volume distribution structure, not market direction.`;
  } else {
    interpretation = 'distributed';
    headline = `Activity distributed across ${totalWallets.toLocaleString()} wallets`;
    description = `Volume is spread among many participants. This describes structure, not intent.`;
  }
  
  // If no data, provide explanation
  if (totalWallets === 0) {
    return {
      topDrivers: [],
      totalVolume: 0,
      hasConcentration: false,
      concentration: {
        top1Share: 0,
        top5Share: 0,
        top10Share: 0,
        totalWallets: 0,
        interpretation: 'distributed',
        headline: 'No transfer activity in the selected window',
        description: 'We checked for wallet activity but found no transfers in the last 24 hours.',
      },
      analysisStatus: 'insufficient_data',
    };
  }
  
  // Build top drivers list
  const topDrivers: ActivityDriver[] = walletStats.slice(0, limit).map(w => ({
    wallet: w.wallet,
    role: w.netFlow > w.totalVolume * 0.1 ? 'accumulator' : 
          w.netFlow < -w.totalVolume * 0.1 ? 'distributor' : 'mixed',
    volumeIn: w.volumeIn,
    volumeOut: w.volumeOut,
    netFlow: w.netFlow,
    txCount: w.txCount,
    influence: ((w.totalVolume / volumeForShare) / 2) * 100, // As percentage
  }));
  
  return {
    topDrivers,
    totalVolume,
    hasConcentration: interpretation === 'highly_concentrated',
    concentration: {
      top1Share,
      top5Share,
      top10Share,
      totalWallets,
      interpretation,
      headline,
      description,
    },
    analysisStatus: 'completed',
  };
}

// ============================================================================
// 2. SIGNALS - Baseline Deviation Analysis
// ============================================================================

/**
 * Calculate baseline metrics for comparison
 */
async function calculateBaseline(tokenAddress: string): Promise<{
  avgTransfersPerHour: number;
  avgWalletsPerHour: number;
  avgVolumePerHour: number;
  p99TransferAmount: number;
}> {
  const since = new Date(Date.now() - BASELINE_HOURS * 60 * 60 * 1000);
  
  const stats = await ERC20LogModel.aggregate([
    { $match: { token: tokenAddress, blockTimestamp: { $gte: since } }},
    { $group: {
      _id: null,
      totalTransfers: { $sum: 1 },
      totalAmount: { $sum: { $toDouble: '$amount' } },
      amounts: { $push: { $toDouble: '$amount' } },
      senders: { $addToSet: '$from' },
      receivers: { $addToSet: '$to' },
    }},
    { $project: {
      totalTransfers: 1,
      totalAmount: 1,
      amounts: 1,
      uniqueWallets: { $size: { $setUnion: ['$senders', '$receivers'] } }
    }}
  ]);
  
  if (!stats[0] || stats[0].totalTransfers === 0) {
    return { avgTransfersPerHour: 0, avgWalletsPerHour: 0, avgVolumePerHour: 0, p99TransferAmount: 0 };
  }
  
  const data = stats[0];
  const amounts = data.amounts || [];
  amounts.sort((a: number, b: number) => a - b);
  const p99Index = Math.floor(amounts.length * 0.99);
  
  return {
    avgTransfersPerHour: data.totalTransfers / BASELINE_HOURS,
    avgWalletsPerHour: data.uniqueWallets / BASELINE_HOURS,
    avgVolumePerHour: data.totalAmount / BASELINE_HOURS,
    p99TransferAmount: amounts[p99Index] || 0,
  };
}

/**
 * Get current window metrics
 */
async function getCurrentMetrics(tokenAddress: string): Promise<{
  transfers: number;
  wallets: number;
  volume: number;
  largestTransfer: number;
}> {
  const since = new Date(Date.now() - CURRENT_WINDOW_HOURS * 60 * 60 * 1000);
  
  const stats = await ERC20LogModel.aggregate([
    { $match: { token: tokenAddress, blockTimestamp: { $gte: since } }},
    { $group: {
      _id: null,
      transfers: { $sum: 1 },
      volume: { $sum: { $toDouble: '$amount' } },
      maxAmount: { $max: { $toDouble: '$amount' } },
      senders: { $addToSet: '$from' },
      receivers: { $addToSet: '$to' },
    }},
    { $project: {
      transfers: 1,
      volume: 1,
      maxAmount: 1,
      wallets: { $size: { $setUnion: ['$senders', '$receivers'] } }
    }}
  ]);
  
  const data = stats[0] || { transfers: 0, wallets: 0, volume: 0, maxAmount: 0 };
  
  return {
    transfers: data.transfers,
    wallets: data.wallets,
    volume: data.volume,
    largestTransfer: data.maxAmount,
  };
}

/**
 * Generate signals based on baseline deviation
 * 
 * CRITICAL: Always returns what was checked, even if no signals
 */
export async function generateTokenSignals(tokenAddress: string): Promise<SignalsResult> {
  const normalized = tokenAddress.toLowerCase();
  
  const [baseline, current] = await Promise.all([
    calculateBaseline(normalized),
    getCurrentMetrics(normalized),
  ]);
  
  const signals: TokenSignal[] = [];
  const checkedMetrics: string[] = [];
  
  // Check for activity spike
  checkedMetrics.push('Transfer frequency vs 7-day average');
  const expectedTransfers = baseline.avgTransfersPerHour * CURRENT_WINDOW_HOURS;
  if (expectedTransfers > 0 && current.transfers > 0) {
    const deviation = current.transfers / expectedTransfers;
    
    if (deviation >= SIGNAL_THRESHOLDS.activitySpike) {
      signals.push({
        type: 'activity_spike',
        severity: Math.min(100, Math.round(deviation * 30)),
        confidence: Math.min(0.95, 0.5 + (current.transfers / 1000) * 0.01),
        title: 'Activity Spike Detected',
        description: `Transfer activity is ${deviation.toFixed(1)}x higher than the 7-day average.`,
        evidence: {
          metric: 'transfers_per_hour',
          baseline: baseline.avgTransfersPerHour,
          current: current.transfers / CURRENT_WINDOW_HOURS,
          deviation,
          context: `Expected ~${Math.round(expectedTransfers).toLocaleString()} transfers in ${CURRENT_WINDOW_HOURS}h, observed ${current.transfers.toLocaleString()}`,
        },
        timestamp: new Date(),
      });
    }
  }
  
  // Check for large transfers
  checkedMetrics.push('Large transfer detection (P99)');
  if (baseline.p99TransferAmount > 0 && current.largestTransfer > baseline.p99TransferAmount) {
    const deviation = current.largestTransfer / baseline.p99TransferAmount;
    
    signals.push({
      type: 'large_move',
      severity: Math.min(100, Math.round(deviation * 20)),
      confidence: 0.9,
      title: 'Unusual Large Transfer',
      description: `A transfer ${deviation.toFixed(1)}x larger than typical was detected.`,
      evidence: {
        metric: 'transfer_amount',
        baseline: baseline.p99TransferAmount,
        current: current.largestTransfer,
        deviation,
        context: `Typical large transfer (P99): ${baseline.p99TransferAmount.toLocaleString()}, Observed: ${current.largestTransfer.toLocaleString()}`,
      },
      timestamp: new Date(),
    });
  }
  
  // Check for wallet count deviation
  checkedMetrics.push('Unique wallet participation');
  const expectedWallets = baseline.avgWalletsPerHour * CURRENT_WINDOW_HOURS;
  if (expectedWallets > 0 && current.wallets > 0) {
    const walletDeviation = current.wallets / expectedWallets;
    
    if (walletDeviation >= 1.5) {
      signals.push({
        type: 'activity_spike',
        severity: Math.min(80, Math.round(walletDeviation * 25)),
        confidence: 0.8,
        title: 'Increased Wallet Participation',
        description: `${walletDeviation.toFixed(1)}x more wallets are active than the 7-day average.`,
        evidence: {
          metric: 'unique_wallets',
          baseline: baseline.avgWalletsPerHour,
          current: current.wallets / CURRENT_WINDOW_HOURS,
          deviation: walletDeviation,
        },
        timestamp: new Date(),
      });
    }
  }
  
  // Determine analysis status
  const hasBaselineData = baseline.avgTransfersPerHour > 0;
  const hasCurrentData = current.transfers > 0;
  
  return {
    signals,
    baseline: {
      avgTransfersPerHour: baseline.avgTransfersPerHour,
      avgWalletsPerHour: baseline.avgWalletsPerHour,
      avgVolumePerHour: baseline.avgVolumePerHour,
      periodHours: BASELINE_HOURS,
    },
    current: {
      transfers: current.transfers,
      wallets: current.wallets,
      volume: current.volume,
      windowHours: CURRENT_WINDOW_HOURS,
    },
    analysisStatus: hasBaselineData && hasCurrentData ? 'completed' : 'insufficient_data',
    checkedMetrics,
  };
}

// ============================================================================
// 3. SMART MONEY ANALYSIS (B4)
// ============================================================================

// In a real system, this would be a database of known profitable wallets
// For now, we simulate with high-volume wallets as proxy
const SMART_MONEY_VOLUME_THRESHOLD = 1000000; // $1M+ volume = "smart money" proxy

export interface SmartMoneyResult {
  participants: {
    wallet: string;
    action: 'accumulating' | 'distributing' | 'neutral';
    volumeUsd: number;
    netFlowUsd: number;
  }[];
  totalSmartVolume: number;
  shareOfTotalVolume: number;
  checkedWallets: number;
  interpretation: {
    headline: string;
    description: string;
  };
  analysisStatus: 'completed' | 'insufficient_data';
}

export async function analyzeSmartMoney(
  tokenAddress: string,
  price: number | null,
  decimals: number = 18
): Promise<SmartMoneyResult> {
  const normalized = tokenAddress.toLowerCase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  // Get all wallets with volume
  const walletStats = await ERC20LogModel.aggregate([
    { $match: { token: normalized, blockTimestamp: { $gte: since } }},
    { $facet: {
      incoming: [
        { $group: { _id: '$to', volume: { $sum: { $toDouble: '$amount' } } }},
      ],
      outgoing: [
        { $group: { _id: '$from', volume: { $sum: { $toDouble: '$amount' } } }},
      ],
      total: [
        { $group: { _id: null, total: { $sum: { $toDouble: '$amount' } } }},
      ],
    }},
  ]);
  
  const inMap = new Map<string, number>();
  const outMap = new Map<string, number>();
  
  for (const e of walletStats[0]?.incoming || []) {
    inMap.set(e._id, e.volume);
  }
  for (const e of walletStats[0]?.outgoing || []) {
    outMap.set(e._id, e.volume);
  }
  
  const totalVolume = walletStats[0]?.total?.[0]?.total || 0;
  const allWallets = new Set([...inMap.keys(), ...outMap.keys()]);
  
  // Find "smart money" (high volume wallets as proxy)
  const participants: SmartMoneyResult['participants'] = [];
  let totalSmartVolume = 0;
  
  for (const wallet of allWallets) {
    const volIn = inMap.get(wallet) || 0;
    const volOut = outMap.get(wallet) || 0;
    const total = volIn + volOut;
    const netFlow = volIn - volOut;
    
    // Convert to USD
    const volumeUsd = price !== null ? (total / Math.pow(10, decimals)) * price : total;
    const netFlowUsd = price !== null ? (netFlow / Math.pow(10, decimals)) * price : netFlow;
    
    // Threshold for "smart money"
    if (volumeUsd >= SMART_MONEY_VOLUME_THRESHOLD) {
      totalSmartVolume += volumeUsd;
      
      participants.push({
        wallet,
        action: netFlowUsd > volumeUsd * 0.1 ? 'accumulating' : 
                netFlowUsd < -volumeUsd * 0.1 ? 'distributing' : 'neutral',
        volumeUsd,
        netFlowUsd,
      });
    }
  }
  
  // Sort by volume
  participants.sort((a, b) => b.volumeUsd - a.volumeUsd);
  
  // FIX: totalVolume counts each transfer twice (once for sender, once for receiver)
  // So we divide by 2 for accurate share calculation
  const totalVolumeUsd = price !== null ? (totalVolume / Math.pow(10, decimals)) * price / 2 : totalVolume / 2;
  
  // Cap share at 100% - anything higher indicates overlap in our counting
  const rawShare = totalVolumeUsd > 0 ? totalSmartVolume / totalVolumeUsd : 0;
  const shareOfTotal = Math.min(rawShare, 1.0); // Never exceed 100%
  const hasHighOverlap = rawShare > 1.0;
  
  // Generate interpretation
  let headline: string;
  let description: string;
  
  const accumulators = participants.filter(p => p.action === 'accumulating').length;
  const distributors = participants.filter(p => p.action === 'distributing').length;
  
  if (participants.length === 0) {
    headline = 'No high-volume wallet activity detected';
    description = `We analyzed ${allWallets.size.toLocaleString()} wallets. None exceeded the $1M volume threshold for "smart money" classification.`;
  } else if (hasHighOverlap) {
    headline = `High smart money overlap detected`;
    description = `${participants.length} high-volume wallets show significant cross-activity. ${accumulators} accumulating, ${distributors} distributing.`;
  } else if (shareOfTotal > 0.2) {
    headline = `Strong smart money involvement — ${(shareOfTotal * 100).toFixed(0)}% of volume`;
    description = `${participants.length} high-volume wallets account for significant activity. ${accumulators} accumulating, ${distributors} distributing.`;
  } else if (shareOfTotal > 0.05) {
    headline = `Moderate smart money presence — ${(shareOfTotal * 100).toFixed(0)}% of volume`;
    description = `${participants.length} high-volume wallets detected among ${allWallets.size.toLocaleString()} total participants.`;
  } else {
    headline = 'Minimal smart money participation';
    description = `Activity is primarily retail-driven. Only ${(shareOfTotal * 100).toFixed(1)}% from high-volume wallets.`;
  }
  
  return {
    participants: participants.slice(0, 10), // Top 10
    totalSmartVolume,
    shareOfTotalVolume: shareOfTotal,
    checkedWallets: allWallets.size,
    interpretation: { headline, description },
    analysisStatus: allWallets.size > 0 ? 'completed' : 'insufficient_data',
  };
}

// ============================================================================
// 4. CLUSTERS ANALYSIS (B3)
// ============================================================================

export interface ClusterResult {
  clusters: {
    id: string;
    wallets: string[];
    confidence: number;
    pattern: string;
  }[];
  checkedCorrelations: number;
  interpretation: {
    headline: string;
    description: string;
  };
  analysisStatus: 'completed' | 'insufficient_data';
}

export async function analyzeClusters(tokenAddress: string): Promise<ClusterResult> {
  const normalized = tokenAddress.toLowerCase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  // Find wallets that transact in same blocks (timing correlation)
  const blockCorrelation = await ERC20LogModel.aggregate([
    { $match: { token: normalized, blockTimestamp: { $gte: since } }},
    { $group: {
      _id: '$blockNumber',
      wallets: { $addToSet: { $concat: ['$from', ':', '$to'] } },
      count: { $sum: 1 },
    }},
    { $match: { count: { $gte: 2 } }}, // Blocks with multiple transfers
    { $limit: 100 },
  ]);
  
  // Simple clustering: wallets appearing together in multiple blocks
  const coOccurrence = new Map<string, Map<string, number>>();
  
  for (const block of blockCorrelation) {
    const allWallets = new Set<string>();
    for (const pair of block.wallets) {
      const [from, to] = pair.split(':');
      allWallets.add(from);
      allWallets.add(to);
    }
    
    const walletList = Array.from(allWallets);
    for (let i = 0; i < walletList.length; i++) {
      for (let j = i + 1; j < walletList.length; j++) {
        const key = [walletList[i], walletList[j]].sort().join(':');
        const count = coOccurrence.get(walletList[i])?.get(walletList[j]) || 0;
        
        if (!coOccurrence.has(walletList[i])) {
          coOccurrence.set(walletList[i], new Map());
        }
        coOccurrence.get(walletList[i])!.set(walletList[j], count + 1);
      }
    }
  }
  
  // Find clusters (wallets with high co-occurrence)
  const clusters: ClusterResult['clusters'] = [];
  const checkedPairs = coOccurrence.size;
  
  // For now, simple threshold-based clustering
  const usedWallets = new Set<string>();
  
  for (const [wallet1, connections] of coOccurrence) {
    if (usedWallets.has(wallet1)) continue;
    
    const strongConnections = Array.from(connections.entries())
      .filter(([_, count]) => count >= 3) // Co-occurred 3+ times
      .map(([wallet]) => wallet);
    
    if (strongConnections.length >= 2) {
      const clusterWallets = [wallet1, ...strongConnections.slice(0, 4)];
      clusters.push({
        id: `cluster_${clusters.length + 1}`,
        wallets: clusterWallets,
        confidence: Math.min(0.95, 0.5 + strongConnections.length * 0.1),
        pattern: 'timing_correlation',
      });
      
      clusterWallets.forEach(w => usedWallets.add(w));
      
      if (clusters.length >= 5) break;
    }
  }
  
  // Generate interpretation
  let headline: string;
  let description: string;
  
  if (clusters.length === 0) {
    headline = 'No coordinated wallet clusters detected';
    description = `We checked timing correlation across ${checkedPairs} wallet pairs. No significant coordination patterns found.`;
  } else {
    headline = `${clusters.length} potential wallet cluster${clusters.length > 1 ? 's' : ''} identified`;
    description = `Found wallets with correlated transaction timing. This may indicate coordinated activity or shared ownership.`;
  }
  
  return {
    clusters,
    checkedCorrelations: checkedPairs,
    interpretation: { headline, description },
    analysisStatus: checkedPairs > 0 ? 'completed' : 'insufficient_data',
  };
}
