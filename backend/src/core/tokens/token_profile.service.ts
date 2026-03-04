/**
 * Token Profile Service (Phase 15.5)
 * 
 * Aggregated token data snapshot
 */
import { SignalModel } from '../signals/signals.model.js';
import { MarketRegimeModel } from '../market_regimes/market_regime.model.js';
import { SignalReputationModel } from '../reputation/signal_reputation.model.js';
import * as priceService from '../market/price.service.js';
import * as metricsService from '../market/market_metrics.service.js';
import { Types } from 'mongoose';

export interface TokenProfile {
  address: string;
  chain: string;
  
  // Price data
  price: {
    current: number | null;
    change24h: number | null;
    available: boolean;
  };
  
  // Market metrics
  metrics: {
    volatility: number | null;
    trend: string | null;
    trendStrength: number | null;
    liquidityScore: number | null;
    available: boolean;
  };
  
  // Market regime
  regime: {
    current: string | null;
    confidence: number | null;
    available: boolean;
  };
  
  // Signal stats
  signals: {
    total: number;
    last24h: number;
    byType: Record<string, number>;
    available: boolean;
  };
  
  // Trust overview
  trust: {
    avgScore: number | null;
    signalsWithTrust: number;
    available: boolean;
  };
  
  // Top actors
  topActors: Array<{
    address: string;
    signalCount: number;
  }>;
  
  // Metadata
  lastUpdated: Date;
}

/**
 * Get comprehensive token profile
 */
export async function getTokenProfile(
  address: string,
  chain: string = 'ethereum'
): Promise<TokenProfile | null> {
  const addr = address.toLowerCase();
  
  // Parallel fetch all data
  const [
    latestPrice,
    metrics,
    regime,
    signalStats,
    signalsByType,
    recentSignals,
    topActors,
    trustData,
  ] = await Promise.all([
    // Price
    priceService.getLatestPrice(addr, chain).catch(() => null),
    
    // Metrics
    metricsService.getMarketMetrics(addr, chain, '24h').catch(() => null),
    
    // Regime
    MarketRegimeModel.findOne({ assetAddress: addr, chain })
      .sort({ detectedAt: -1 })
      .lean()
      .catch(() => null),
    
    // Signal count
    SignalModel.countDocuments({ assetAddress: addr }).catch(() => 0),
    
    // Signals by type
    SignalModel.aggregate([
      { $match: { assetAddress: addr } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]).catch(() => []),
    
    // Recent signals (24h)
    SignalModel.countDocuments({
      assetAddress: addr,
      timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }).catch(() => 0),
    
    // Top actors for this token
    SignalModel.aggregate([
      { $match: { assetAddress: addr } },
      { $group: { _id: '$fromAddress', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]).catch(() => []),
    
    // Trust scores for signals on this token
    SignalReputationModel.aggregate([
      {
        $lookup: {
          from: 'signals',
          localField: 'signalId',
          foreignField: '_id',
          as: 'signal',
        },
      },
      { $unwind: '$signal' },
      { $match: { 'signal.assetAddress': addr } },
      {
        $group: {
          _id: null,
          avgScore: { $avg: '$trustScore' },
          count: { $sum: 1 },
        },
      },
    ]).catch(() => []),
  ]);
  
  // Build profile
  const profile: TokenProfile = {
    address: addr,
    chain,
    
    price: {
      current: latestPrice?.priceUsd ? parseFloat(latestPrice.priceUsd.toString()) : null,
      change24h: metrics?.priceChange || null,
      available: !!latestPrice,
    },
    
    metrics: {
      volatility: metrics?.volatility || null,
      trend: metrics?.trend || null,
      trendStrength: metrics?.trendStrength || null,
      liquidityScore: metrics?.liquidityScore || null,
      available: !!metrics,
    },
    
    regime: {
      current: regime?.regimeType || null,
      confidence: regime?.confidence || null,
      available: !!regime,
    },
    
    signals: {
      total: signalStats || 0,
      last24h: recentSignals || 0,
      byType: signalsByType.reduce((acc: Record<string, number>, item: any) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      available: signalStats > 0,
    },
    
    trust: {
      avgScore: trustData[0]?.avgScore || null,
      signalsWithTrust: trustData[0]?.count || 0,
      available: trustData.length > 0 && trustData[0].count > 0,
    },
    
    topActors: topActors.map((a: any) => ({
      address: a._id,
      signalCount: a.count,
    })),
    
    lastUpdated: new Date(),
  };
  
  return profile;
}

/**
 * Get multiple token profiles
 */
export async function getTokenProfiles(
  addresses: string[],
  chain: string = 'ethereum'
): Promise<TokenProfile[]> {
  const profiles = await Promise.all(
    addresses.map(addr => getTokenProfile(addr, chain))
  );
  
  return profiles.filter((p): p is TokenProfile => p !== null);
}

/**
 * Get trending tokens by signal activity
 */
export async function getTrendingTokens(
  limit: number = 10,
  timeframe: '1h' | '24h' | '7d' = '24h'
): Promise<Array<{ address: string; signalCount: number; change: number }>> {
  const timeMs = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  }[timeframe];
  
  const cutoff = new Date(Date.now() - timeMs);
  const prevCutoff = new Date(Date.now() - timeMs * 2);
  
  // Current period
  const current = await SignalModel.aggregate([
    { $match: { timestamp: { $gte: cutoff } } },
    { $group: { _id: '$assetAddress', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);
  
  // Previous period for change calculation
  const previous = await SignalModel.aggregate([
    { $match: { timestamp: { $gte: prevCutoff, $lt: cutoff } } },
    { $group: { _id: '$assetAddress', count: { $sum: 1 } } },
  ]);
  
  const prevMap = new Map(previous.map(p => [p._id, p.count]));
  
  return current.map(c => ({
    address: c._id,
    signalCount: c.count,
    change: prevMap.has(c._id)
      ? ((c.count - prevMap.get(c._id)!) / prevMap.get(c._id)!) * 100
      : 100,
  }));
}
