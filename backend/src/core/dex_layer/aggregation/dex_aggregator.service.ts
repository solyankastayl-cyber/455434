/**
 * DEX Aggregator Service (P0.4)
 * 
 * Aggregates DEX trade data for:
 * - Wallet activity summaries
 * - Token trading summaries
 * - Recent swap activity windows
 */

import { 
  DexTradeModel, 
  SupportedDexChain,
  getTradesByWallet,
  getTradesByToken,
  getDexStats
} from '../storage/dex_trade.model.js';

// ============================================
// Types
// ============================================

export interface WalletDexSummary {
  wallet: string;
  totalTrades: number;
  totalVolumeUsd: number;
  uniqueTokens: number;
  chainActivity: Record<string, number>;
  recentTrades: number;         // Last 24h
  lastTradeAt: Date | null;
  topTokensTraded: Array<{ token: string; symbol?: string; count: number }>;
}

export interface TokenDexSummary {
  token: string;
  chain?: SupportedDexChain;
  symbol?: string;
  totalTrades: number;
  totalVolumeUsd: number;
  uniqueTraders: number;
  buyTrades: number;            // Token was tokenOut
  sellTrades: number;           // Token was tokenIn
  recentTrades: number;         // Last 24h
  lastTradeAt: Date | null;
}

export interface RecentSwapActivity {
  timeWindow: '1h' | '24h' | '7d';
  totalTrades: number;
  totalVolumeUsd: number;
  byChain: Record<string, { trades: number; volumeUsd: number }>;
  topTokens: Array<{ token: string; symbol?: string; trades: number; volumeUsd: number }>;
  topTraders: Array<{ trader: string; trades: number; volumeUsd: number }>;
}

// ============================================
// Wallet Summary
// ============================================

/**
 * Get comprehensive DEX activity summary for a wallet
 */
export async function getWalletDexSummary(
  wallet: string,
  options?: { chain?: SupportedDexChain }
): Promise<WalletDexSummary> {
  const query: any = { trader: wallet.toLowerCase() };
  if (options?.chain) query.chain = options.chain;
  
  const now = Date.now();
  const oneDayAgo = Math.floor((now - 24 * 60 * 60 * 1000) / 1000);
  
  const [trades, recentCount, chainAgg, tokenAgg] = await Promise.all([
    // Get all trades (limited)
    DexTradeModel.find(query)
      .sort({ timestamp: -1 })
      .limit(1000)
      .lean(),
    
    // Count recent trades
    DexTradeModel.countDocuments({
      ...query,
      timestamp: { $gte: oneDayAgo }
    }),
    
    // Chain aggregation
    DexTradeModel.aggregate([
      { $match: query },
      { $group: { _id: '$chain', count: { $sum: 1 } } }
    ]),
    
    // Token aggregation (both in and out)
    DexTradeModel.aggregate([
      { $match: query },
      { $project: { tokens: ['$tokenIn', '$tokenOut'], tokenInSymbol: 1, tokenOutSymbol: 1 } },
      { $unwind: '$tokens' },
      { $group: { _id: '$tokens', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ])
  ]);
  
  // Calculate totals
  const totalVolumeUsd = trades.reduce((sum, t) => {
    const usd = t.amountInUsd || t.amountOutUsd || 0;
    return sum + usd;
  }, 0);
  
  const uniqueTokens = new Set<string>();
  trades.forEach(t => {
    uniqueTokens.add(t.tokenIn);
    uniqueTokens.add(t.tokenOut);
  });
  
  const chainActivity = chainAgg.reduce((acc, c) => {
    acc[c._id] = c.count;
    return acc;
  }, {} as Record<string, number>);
  
  // Get token symbols
  const topTokensTraded = await Promise.all(
    tokenAgg.slice(0, 5).map(async (t) => {
      // Try to find symbol from trades
      const trade = trades.find(tr => 
        tr.tokenIn === t._id || tr.tokenOut === t._id
      );
      return {
        token: t._id,
        symbol: trade?.tokenIn === t._id ? trade.tokenInSymbol : trade?.tokenOutSymbol,
        count: t.count
      };
    })
  );
  
  return {
    wallet: wallet.toLowerCase(),
    totalTrades: trades.length,
    totalVolumeUsd: Math.round(totalVolumeUsd),
    uniqueTokens: uniqueTokens.size,
    chainActivity,
    recentTrades: recentCount,
    lastTradeAt: trades.length > 0 ? new Date(trades[0].timestamp * 1000) : null,
    topTokensTraded
  };
}

// ============================================
// Token Summary
// ============================================

/**
 * Get comprehensive DEX activity summary for a token
 */
export async function getTokenDexSummary(
  tokenAddress: string,
  options?: { chain?: SupportedDexChain }
): Promise<TokenDexSummary> {
  const token = tokenAddress.toLowerCase();
  const now = Date.now();
  const oneDayAgo = Math.floor((now - 24 * 60 * 60 * 1000) / 1000);
  
  const matchQuery: any = {
    $or: [{ tokenIn: token }, { tokenOut: token }]
  };
  if (options?.chain) matchQuery.chain = options.chain;
  
  const [totalStats, recentCount, sampleTrade] = await Promise.all([
    // Aggregate stats
    DexTradeModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalTrades: { $sum: 1 },
          totalVolumeUsd: { $sum: { $ifNull: ['$amountInUsd', { $ifNull: ['$amountOutUsd', 0] }] } },
          uniqueTraders: { $addToSet: '$trader' },
          buyTrades: {
            $sum: { $cond: [{ $eq: ['$tokenOut', token] }, 1, 0] }
          },
          sellTrades: {
            $sum: { $cond: [{ $eq: ['$tokenIn', token] }, 1, 0] }
          },
          lastTimestamp: { $max: '$timestamp' }
        }
      }
    ]),
    
    // Recent count
    DexTradeModel.countDocuments({
      ...matchQuery,
      timestamp: { $gte: oneDayAgo }
    }),
    
    // Sample trade for symbol
    DexTradeModel.findOne(matchQuery).lean()
  ]);
  
  const stats = totalStats[0] || {
    totalTrades: 0,
    totalVolumeUsd: 0,
    uniqueTraders: [],
    buyTrades: 0,
    sellTrades: 0,
    lastTimestamp: null
  };
  
  // Get symbol
  let symbol: string | undefined;
  if (sampleTrade) {
    symbol = sampleTrade.tokenIn === token 
      ? sampleTrade.tokenInSymbol 
      : sampleTrade.tokenOutSymbol;
  }
  
  return {
    token,
    chain: options?.chain,
    symbol,
    totalTrades: stats.totalTrades,
    totalVolumeUsd: Math.round(stats.totalVolumeUsd),
    uniqueTraders: stats.uniqueTraders.length,
    buyTrades: stats.buyTrades,
    sellTrades: stats.sellTrades,
    recentTrades: recentCount,
    lastTradeAt: stats.lastTimestamp ? new Date(stats.lastTimestamp * 1000) : null
  };
}

// ============================================
// Recent Activity
// ============================================

const TIME_WINDOWS = {
  '1h': 60 * 60,
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60
};

/**
 * Get recent swap activity across all chains
 */
export async function getRecentSwapActivity(
  timeWindow: '1h' | '24h' | '7d' = '24h',
  options?: { chain?: SupportedDexChain }
): Promise<RecentSwapActivity> {
  const windowSeconds = TIME_WINDOWS[timeWindow];
  const startTime = Math.floor(Date.now() / 1000) - windowSeconds;
  
  const matchQuery: any = { timestamp: { $gte: startTime } };
  if (options?.chain) matchQuery.chain = options.chain;
  
  const [chainStats, tokenStats, traderStats, totalStats] = await Promise.all([
    // By chain
    DexTradeModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$chain',
          trades: { $sum: 1 },
          volumeUsd: { $sum: { $ifNull: ['$amountOutUsd', { $ifNull: ['$amountInUsd', 0] }] } }
        }
      }
    ]),
    
    // Top tokens (by tokenOut - what people are buying)
    DexTradeModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$tokenOut',
          trades: { $sum: 1 },
          volumeUsd: { $sum: { $ifNull: ['$amountOutUsd', 0] } },
          symbol: { $first: '$tokenOutSymbol' }
        }
      },
      { $sort: { trades: -1 } },
      { $limit: 10 }
    ]),
    
    // Top traders
    DexTradeModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$trader',
          trades: { $sum: 1 },
          volumeUsd: { $sum: { $ifNull: ['$amountOutUsd', { $ifNull: ['$amountInUsd', 0] }] } }
        }
      },
      { $sort: { trades: -1 } },
      { $limit: 10 }
    ]),
    
    // Total stats
    DexTradeModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalTrades: { $sum: 1 },
          totalVolumeUsd: { $sum: { $ifNull: ['$amountOutUsd', { $ifNull: ['$amountInUsd', 0] }] } }
        }
      }
    ])
  ]);
  
  const total = totalStats[0] || { totalTrades: 0, totalVolumeUsd: 0 };
  
  return {
    timeWindow,
    totalTrades: total.totalTrades,
    totalVolumeUsd: Math.round(total.totalVolumeUsd),
    byChain: chainStats.reduce((acc, c) => {
      acc[c._id] = { trades: c.trades, volumeUsd: Math.round(c.volumeUsd) };
      return acc;
    }, {} as Record<string, { trades: number; volumeUsd: number }>),
    topTokens: tokenStats.map(t => ({
      token: t._id,
      symbol: t.symbol,
      trades: t.trades,
      volumeUsd: Math.round(t.volumeUsd)
    })),
    topTraders: traderStats.map(t => ({
      trader: t._id,
      trades: t.trades,
      volumeUsd: Math.round(t.volumeUsd)
    }))
  };
}

// ============================================
// Pre-Exit Detection
// ============================================

/**
 * Find wallets with recent swap activity before potential exit
 * (for Route Intelligence integration)
 */
export async function findSwapsBeforeExit(
  wallet: string,
  lookbackSeconds: number = 3600,
  chain?: SupportedDexChain
): Promise<Array<{
  tradeId: string;
  timestamp: number;
  tokenIn: string;
  tokenOut: string;
  amountUsd: number | null;
  minutesBeforeNow: number;
}>> {
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - lookbackSeconds;
  
  const query: any = {
    trader: wallet.toLowerCase(),
    timestamp: { $gte: startTime }
  };
  if (chain) query.chain = chain;
  
  const trades = await DexTradeModel.find(query)
    .sort({ timestamp: -1 })
    .limit(20)
    .lean();
  
  return trades.map(t => ({
    tradeId: t.tradeId,
    timestamp: t.timestamp,
    tokenIn: t.tokenIn,
    tokenOut: t.tokenOut,
    amountUsd: t.amountOutUsd || t.amountInUsd || null,
    minutesBeforeNow: Math.round((now - t.timestamp) / 60)
  }));
}

/**
 * Check if wallet had swap activity in time window
 */
export async function hadSwapActivity(
  wallet: string,
  windowSeconds: number,
  chain?: SupportedDexChain
): Promise<boolean> {
  const startTime = Math.floor(Date.now() / 1000) - windowSeconds;
  
  const query: any = {
    trader: wallet.toLowerCase(),
    timestamp: { $gte: startTime }
  };
  if (chain) query.chain = chain;
  
  const count = await DexTradeModel.countDocuments(query);
  return count > 0;
}

export { getDexStats };
