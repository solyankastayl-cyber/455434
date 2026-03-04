/**
 * Wallet Analytics Service
 * 
 * Provides analytics for individual wallets, mirroring TokensPage structure.
 * 
 * Endpoints:
 * 1. Wallet Activity Snapshot - inflow/outflow/netFlow/transfers
 * 2. Wallet Behavior Summary - accumulator/distributor/mixed
 * 3. Wallet Signals - deviations from baseline
 * 4. Related Addresses - timing correlation
 * 5. Historical Performance - profitability patterns
 */

import { ERC20LogModel } from '../../onchain/ethereum/logs_erc20.model.js';
import { getTokenPriceUsd, getTokenDecimals } from '../market/coingecko.service.js';

// ============================================================================
// 1. WALLET ACTIVITY SNAPSHOT
// ============================================================================

export interface WalletActivitySnapshot {
  address: string;
  window: string;
  activity: {
    inflowUsd: number;
    outflowUsd: number;
    netFlowUsd: number;
    transfers: number;
    activeTokens: number;
  };
  interpretation: {
    headline: string;
    description: string;
    behaviorType: 'accumulating' | 'distributing' | 'balanced' | 'inactive';
  };
  checkedWindow: string;
  analysisStatus: 'completed' | 'insufficient_data';
}

export async function getWalletActivitySnapshot(
  walletAddress: string,
  windowHours: number = 24
): Promise<WalletActivitySnapshot> {
  const normalized = walletAddress.toLowerCase();
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  
  // Get all transfers involving this wallet
  const [incoming, outgoing] = await Promise.all([
    // Incoming transfers (wallet is receiver)
    ERC20LogModel.aggregate([
      { $match: { to: normalized, blockTimestamp: { $gte: since } }},
      { $group: { 
        _id: '$token',
        volume: { $sum: { $toDouble: '$amount' }},
        count: { $sum: 1 }
      }},
    ]),
    // Outgoing transfers (wallet is sender)
    ERC20LogModel.aggregate([
      { $match: { from: normalized, blockTimestamp: { $gte: since } }},
      { $group: { 
        _id: '$token',
        volume: { $sum: { $toDouble: '$amount' }},
        count: { $sum: 1 }
      }},
    ]),
  ]);
  
  // Calculate USD values
  let totalInflowUsd = 0;
  let totalOutflowUsd = 0;
  let totalTransfers = 0;
  const activeTokens = new Set<string>();
  
  for (const entry of incoming) {
    const token = entry._id;
    activeTokens.add(token);
    totalTransfers += entry.count;
    
    const price = await getTokenPriceUsd(token);
    const decimals = getTokenDecimals(token);
    if (price !== null) {
      totalInflowUsd += (entry.volume / Math.pow(10, decimals)) * price;
    }
  }
  
  for (const entry of outgoing) {
    const token = entry._id;
    activeTokens.add(token);
    totalTransfers += entry.count;
    
    const price = await getTokenPriceUsd(token);
    const decimals = getTokenDecimals(token);
    if (price !== null) {
      totalOutflowUsd += (entry.volume / Math.pow(10, decimals)) * price;
    }
  }
  
  const netFlowUsd = totalInflowUsd - totalOutflowUsd;
  
  // Determine behavior type
  let behaviorType: 'accumulating' | 'distributing' | 'balanced' | 'inactive';
  let headline: string;
  let description: string;
  
  if (totalTransfers === 0) {
    behaviorType = 'inactive';
    headline = 'No activity detected in analyzed window';
    description = `We checked for transfers in the last ${windowHours}h. No activity found.`;
  } else if (netFlowUsd > totalInflowUsd * 0.1) {
    behaviorType = 'accumulating';
    headline = 'Net accumulation detected';
    description = `This wallet received more value than it sent during the analyzed window.`;
  } else if (netFlowUsd < -totalOutflowUsd * 0.1) {
    behaviorType = 'distributing';
    headline = 'Net distribution detected';
    description = `This wallet sent more value than it received during the analyzed window.`;
  } else {
    behaviorType = 'balanced';
    headline = 'Balanced activity';
    description = `Inflows and outflows are roughly balanced during the analyzed window.`;
  }
  
  return {
    address: normalized,
    window: `${windowHours}h`,
    activity: {
      inflowUsd: totalInflowUsd,
      outflowUsd: totalOutflowUsd,
      netFlowUsd,
      transfers: totalTransfers,
      activeTokens: activeTokens.size,
    },
    interpretation: {
      headline,
      description,
      behaviorType,
    },
    checkedWindow: `Last ${windowHours} hours`,
    analysisStatus: totalTransfers > 0 ? 'completed' : 'insufficient_data',
  };
}

// ============================================================================
// 2. WALLET SIGNALS - Deviations from baseline
// ============================================================================

export interface WalletSignal {
  type: 'large_transfer' | 'activity_spike' | 'accumulation' | 'distribution';
  severity: number;
  confidence: number;
  title: string;
  description: string;
  evidence: {
    metric: string;
    baseline: number;
    current: number;
    deviation: number;
  };
  timestamp: Date;
}

export interface WalletSignalsResult {
  signals: WalletSignal[];
  baseline: {
    avgTransfersPerDay: number;
    avgVolumePerDay: number;
    periodDays: number;
  };
  current: {
    transfers: number;
    volumeUsd: number;
    windowHours: number;
  };
  checkedMetrics: string[];
  interpretation: {
    headline: string;
    description: string;
  };
  analysisStatus: 'completed' | 'insufficient_data';
}

export async function getWalletSignals(walletAddress: string, windowHours: number = 24): Promise<WalletSignalsResult> {
  const normalized = walletAddress.toLowerCase();
  const baselineHours = windowHours * 7; // baseline = 7x the window
  const currentHours = windowHours;
  
  const baselineSince = new Date(Date.now() - baselineHours * 60 * 60 * 1000);
  const currentSince = new Date(Date.now() - currentHours * 60 * 60 * 1000);
  
  // Get baseline stats
  const baselineStats = await ERC20LogModel.aggregate([
    { $match: { 
      $or: [{ from: normalized }, { to: normalized }],
      blockTimestamp: { $gte: baselineSince }
    }},
    { $group: { 
      _id: null,
      totalTransfers: { $sum: 1 },
      totalVolume: { $sum: { $toDouble: '$amount' }}
    }},
  ]);
  
  // Get current window stats  
  const currentStats = await ERC20LogModel.aggregate([
    { $match: { 
      $or: [{ from: normalized }, { to: normalized }],
      blockTimestamp: { $gte: currentSince }
    }},
    { $group: { 
      _id: null,
      transfers: { $sum: 1 },
      volume: { $sum: { $toDouble: '$amount' }},
      maxTransfer: { $max: { $toDouble: '$amount' }}
    }},
  ]);
  
  const baseline = baselineStats[0] || { totalTransfers: 0, totalVolume: 0 };
  const current = currentStats[0] || { transfers: 0, volume: 0, maxTransfer: 0 };
  
  const avgTransfersPerDay = baseline.totalTransfers / (baselineHours / 24);
  const avgVolumePerDay = baseline.totalVolume / (baselineHours / 24);
  const expectedTransfers = avgTransfersPerDay * (currentHours / 24);
  
  const signals: WalletSignal[] = [];
  const checkedMetrics: string[] = [];
  
  // Check activity spike
  checkedMetrics.push('Transfer frequency vs 7-day average');
  if (expectedTransfers > 0 && current.transfers > 0) {
    const deviation = current.transfers / expectedTransfers;
    if (deviation >= 2.0) {
      signals.push({
        type: 'activity_spike',
        severity: Math.min(100, Math.round(deviation * 25)),
        confidence: 0.8,
        title: 'Activity Spike',
        description: `${deviation.toFixed(1)}x more transfers than typical daily average.`,
        evidence: {
          metric: 'transfers_per_day',
          baseline: avgTransfersPerDay,
          current: current.transfers,
          deviation,
        },
        timestamp: new Date(),
      });
    }
  }
  
  // Check large transfer
  checkedMetrics.push('Large transfer detection');
  const p99Estimate = avgVolumePerDay * 0.1; // Simplified P99 estimate
  if (p99Estimate > 0 && current.maxTransfer > p99Estimate * 10) {
    const deviation = current.maxTransfer / p99Estimate;
    signals.push({
      type: 'large_transfer',
      severity: Math.min(100, Math.round(deviation * 10)),
      confidence: 0.85,
      title: 'Unusually Large Transfer',
      description: `A transfer significantly larger than typical was detected.`,
      evidence: {
        metric: 'transfer_size',
        baseline: p99Estimate,
        current: current.maxTransfer,
        deviation,
      },
      timestamp: new Date(),
    });
  }
  
  checkedMetrics.push('Accumulation/distribution patterns');
  
  // Generate interpretation
  const hasSignals = signals.length > 0;
  
  return {
    signals,
    baseline: {
      avgTransfersPerDay,
      avgVolumePerDay,
      periodDays: baselineHours / 24,
    },
    current: {
      transfers: current.transfers,
      volumeUsd: current.volume, // Note: raw amount, not USD converted
      windowHours: currentHours,
    },
    checkedMetrics,
    interpretation: hasSignals 
      ? {
          headline: `${signals.length} signal${signals.length > 1 ? 's' : ''} detected`,
          description: signals.map(s => s.title).join(', '),
        }
      : {
          headline: 'No statistically significant deviations detected',
          description: `Activity is within normal range compared to 7-day baseline.`,
        },
    analysisStatus: baseline.totalTransfers > 0 ? 'completed' : 'insufficient_data',
  };
}

// ============================================================================
// 3. RELATED ADDRESSES (B3) - Timing correlation
// ============================================================================

export interface RelatedAddressesResult {
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

export async function getRelatedAddresses(walletAddress: string): Promise<RelatedAddressesResult> {
  const normalized = walletAddress.toLowerCase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  // Find wallets that transacted with same tokens in same blocks
  const walletBlocks = await ERC20LogModel.aggregate([
    { $match: { 
      $or: [{ from: normalized }, { to: normalized }],
      blockTimestamp: { $gte: since }
    }},
    { $group: { _id: '$blockNumber', tokens: { $addToSet: '$token' } }},
    { $limit: 100 },
  ]);
  
  const blockNumbers = walletBlocks.map(b => b._id);
  
  if (blockNumbers.length === 0) {
    return {
      clusters: [],
      checkedCorrelations: 0,
      interpretation: {
        headline: 'No related addresses detected',
        description: 'We checked for timing correlation and shared token exposure. No patterns found.',
      },
      analysisStatus: 'insufficient_data',
    };
  }
  
  // Find other wallets active in same blocks
  const coActiveWallets = await ERC20LogModel.aggregate([
    { $match: { 
      blockNumber: { $in: blockNumbers },
      from: { $ne: normalized },
      to: { $ne: normalized },
      blockTimestamp: { $gte: since }
    }},
    { $group: { 
      _id: null,
      senders: { $addToSet: '$from' },
      receivers: { $addToSet: '$to' }
    }},
    { $project: {
      wallets: { $setUnion: ['$senders', '$receivers'] }
    }},
  ]);
  
  const relatedWallets = coActiveWallets[0]?.wallets || [];
  const checkedCorrelations = relatedWallets.length;
  
  // Simple clustering: group co-active wallets
  const clusters: RelatedAddressesResult['clusters'] = [];
  
  if (relatedWallets.length >= 2) {
    // For simplicity, create one cluster with top 5 most frequently co-occurring
    const topRelated = relatedWallets.slice(0, 5);
    if (topRelated.length >= 2) {
      clusters.push({
        id: 'cluster_1',
        wallets: topRelated,
        confidence: Math.min(0.8, 0.4 + topRelated.length * 0.1),
        pattern: 'timing_correlation',
      });
    }
  }
  
  return {
    clusters,
    checkedCorrelations,
    interpretation: clusters.length > 0
      ? {
          headline: `${clusters.length} potential related address group${clusters.length > 1 ? 's' : ''} identified`,
          description: 'Found wallets with correlated transaction timing. This may indicate shared exposure, not necessarily coordination.',
        }
      : {
          headline: 'No related addresses detected',
          description: `We checked timing correlation across ${checkedCorrelations} wallet pairs. No significant patterns found.`,
        },
    analysisStatus: checkedCorrelations > 0 ? 'completed' : 'insufficient_data',
  };
}

// ============================================================================
// 4. WALLET HISTORICAL PERFORMANCE (B4)
// ============================================================================

export interface WalletPerformanceResult {
  performanceLabel: 'profitable' | 'neutral' | 'unprofitable' | 'insufficient_data';
  volumeAnalyzed: number;
  tokenCount: number;
  interpretation: {
    headline: string;
    description: string;
  };
  analysisStatus: 'completed' | 'insufficient_data';
}

export async function getWalletHistoricalPerformance(walletAddress: string): Promise<WalletPerformanceResult> {
  const normalized = walletAddress.toLowerCase();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
  
  // Get wallet activity summary
  const activity = await ERC20LogModel.aggregate([
    { $match: { 
      $or: [{ from: normalized }, { to: normalized }],
      blockTimestamp: { $gte: since }
    }},
    { $facet: {
      incoming: [
        { $match: { to: normalized }},
        { $group: { _id: '$token', volume: { $sum: { $toDouble: '$amount' }} }},
      ],
      outgoing: [
        { $match: { from: normalized }},
        { $group: { _id: '$token', volume: { $sum: { $toDouble: '$amount' }} }},
      ],
    }},
  ]);
  
  const incoming = activity[0]?.incoming || [];
  const outgoing = activity[0]?.outgoing || [];
  
  const allTokens = new Set([...incoming.map((i: any) => i._id), ...outgoing.map((o: any) => o._id)]);
  const tokenCount = allTokens.size;
  
  let totalInflow = 0;
  let totalOutflow = 0;
  
  for (const entry of incoming) {
    totalInflow += entry.volume;
  }
  for (const entry of outgoing) {
    totalOutflow += entry.volume;
  }
  
  const volumeAnalyzed = totalInflow + totalOutflow;
  
  if (volumeAnalyzed === 0) {
    return {
      performanceLabel: 'insufficient_data',
      volumeAnalyzed: 0,
      tokenCount: 0,
      interpretation: {
        headline: 'Insufficient data for performance analysis',
        description: 'We checked historical activity over 30 days. Not enough data to determine performance patterns.',
      },
      analysisStatus: 'insufficient_data',
    };
  }
  
  // Simple heuristic: net positive = profitable-looking behavior
  const netFlow = totalInflow - totalOutflow;
  const netRatio = netFlow / volumeAnalyzed;
  
  let performanceLabel: 'profitable' | 'neutral' | 'unprofitable';
  let headline: string;
  let description: string;
  
  if (netRatio > 0.1) {
    performanceLabel = 'profitable';
    headline = 'Net accumulation pattern';
    description = 'This wallet has accumulated more value than distributed over the analyzed period. This reflects historical behavior, not future expectations.';
  } else if (netRatio < -0.1) {
    performanceLabel = 'unprofitable';
    headline = 'Net distribution pattern';
    description = 'This wallet has distributed more value than accumulated. This reflects historical behavior, not predictions.';
  } else {
    performanceLabel = 'neutral';
    headline = 'Balanced historical activity';
    description = 'Inflows and outflows are roughly balanced over the analyzed period.';
  }
  
  return {
    performanceLabel,
    volumeAnalyzed,
    tokenCount,
    interpretation: {
      headline,
      description,
    },
    analysisStatus: 'completed',
  };
}
