/**
 * Market Context Service (Phase 15.5.2 - Step 2)
 * 
 * Aggregated market context for any asset
 */
import { MarketRegimeModel } from '../market_regimes/market_regime.model.js';
import { SignalModel } from '../signals/signals.model.js';
import { SignalReputationModel } from '../reputation/signal_reputation.model.js';
import * as priceService from './price.service.js';
import * as metricsService from './market_metrics.service.js';

export interface MarketContext {
  assetAddress: string;
  chain: string;
  
  // Current price
  price: {
    current: number | null;
    change24h: number | null;
    change7d: number | null;
  };
  
  // Market regime
  regime: {
    current: string | null;
    confidence: number | null;
    since: Date | null;
    expectedDuration: string | null;
  };
  
  // Volatility & metrics
  metrics: {
    volatility: number | null;
    trend: string | null;
    trendStrength: number | null;
    liquidityScore: number | null;
  };
  
  // Trust delta (how trust changed recently)
  trustDelta: {
    avgTrustScore: number | null;
    changeFromPrevious: number | null;
    signalsWithTrust: number;
  };
  
  // Signal reaction summary
  signalReactions: {
    total24h: number;
    bullish: number;
    bearish: number;
    neutral: number;
    avgImpact: number | null;
  };
  
  // Top recent signals
  recentSignals: Array<{
    id: string;
    type: string;
    actorAddress: string;
    timestamp: Date;
    confidence?: number;
  }>;
  
  lastUpdated: Date;
}

/**
 * Get comprehensive market context for an asset
 */
export async function getMarketContext(
  assetAddress: string,
  chain: string = 'ethereum'
): Promise<MarketContext> {
  const addr = assetAddress.toLowerCase();
  const now = new Date();
  const day24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const day7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  // Parallel fetch all data
  const [
    latestPrice,
    metrics24h,
    metrics7d,
    regime,
    signals24h,
    signalsByType,
    recentSignals,
    trustData,
  ] = await Promise.all([
    priceService.getLatestPrice(addr, chain).catch(() => null),
    metricsService.getMarketMetrics(addr, chain, '24h').catch(() => null),
    metricsService.getMarketMetrics(addr, chain, '7d').catch(() => null),
    MarketRegimeModel.findOne({ assetAddress: addr, chain }).sort({ detectedAt: -1 }).lean().catch(() => null),
    SignalModel.countDocuments({ assetAddress: addr, timestamp: { $gte: day24h } }).catch(() => 0),
    SignalModel.aggregate([
      { $match: { assetAddress: addr, timestamp: { $gte: day24h } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]).catch(() => []),
    SignalModel.find({ assetAddress: addr })
      .sort({ timestamp: -1 })
      .limit(5)
      .lean()
      .catch(() => []),
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
  
  // Calculate signal breakdown
  const signalBreakdown = signalsByType.reduce((acc: Record<string, number>, item: any) => {
    acc[item._id] = item.count;
    return acc;
  }, {});
  
  const bullish = (signalBreakdown['accumulation'] || 0) + (signalBreakdown['buy'] || 0);
  const bearish = (signalBreakdown['distribution'] || 0) + (signalBreakdown['sell'] || 0);
  const neutral = signals24h - bullish - bearish;
  
  return {
    assetAddress: addr,
    chain,
    
    price: {
      current: latestPrice?.priceUsd ? parseFloat(latestPrice.priceUsd.toString()) : null,
      change24h: metrics24h?.priceChange || null,
      change7d: metrics7d?.priceChange || null,
    },
    
    regime: {
      current: regime?.regimeType || null,
      confidence: regime?.confidence || null,
      since: regime?.detectedAt || null,
      expectedDuration: regime?.expectedDuration || null,
    },
    
    metrics: {
      volatility: metrics24h?.volatility || null,
      trend: metrics24h?.trend || null,
      trendStrength: metrics24h?.trendStrength || null,
      liquidityScore: metrics24h?.liquidityScore || null,
    },
    
    trustDelta: {
      avgTrustScore: trustData[0]?.avgScore || null,
      changeFromPrevious: null, // Would need historical comparison
      signalsWithTrust: trustData[0]?.count || 0,
    },
    
    signalReactions: {
      total24h: signals24h,
      bullish,
      bearish,
      neutral,
      avgImpact: null, // Would need signal reaction data
    },
    
    recentSignals: recentSignals.map((s: any) => ({
      id: s._id.toString(),
      type: s.type,
      actorAddress: s.fromAddress,
      timestamp: s.timestamp,
      confidence: s.confidence,
    })),
    
    lastUpdated: now,
  };
}
