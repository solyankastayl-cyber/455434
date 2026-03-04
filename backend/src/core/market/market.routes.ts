/**
 * Market Routes (Phase 14A)
 * 
 * Features Redis caching with SWR (stale-while-revalidate) for heavy endpoints
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as priceService from './price.service.js';
import * as metricsService from './market_metrics.service.js';
import { KNOWN_TOKENS } from './dex_pairs.model.js';
import { parsePrice } from './price_points.model.js';
import { MetricsWindow } from './market_metrics.model.js';
import { cache, type CacheStatus } from '../../infra/cache/index.js';

// Cache TTLs (fresh / stale)
const MARKET_CACHE_TTL = 120;        // 2 min fresh
const MARKET_STALE_TTL = 60 * 60;    // 60 min stale (1 hour)
const NARRATIVES_CACHE_TTL = 180;    // 3 min fresh
const NARRATIVES_STALE_TTL = 6 * 60 * 60; // 6 hours stale
const SIGNALS_CACHE_TTL = 120;       // 2 min fresh
const SIGNALS_STALE_TTL = 30 * 60;   // 30 min stale

// Response wrapper with cache status
interface MarketResponse<T> {
  ok: boolean;
  data: T;
  cacheStatus?: CacheStatus;
}

export async function marketRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/prices/:asset/latest
   * Get latest price for an asset
   */
  app.get('/prices/:asset/latest', async (request: FastifyRequest) => {
    const { asset } = request.params as { asset: string };
    const query = request.query as { chain?: string };
    
    const price = await priceService.getLatestPrice(asset, query.chain || 'ethereum');
    
    if (!price) {
      return { ok: false, error: 'Price not found' };
    }
    
    return {
      ok: true,
      data: {
        assetAddress: price.assetAddress,
        priceUsd: parsePrice(price.priceUsd),
        priceEth: parsePrice(price.priceEth),
        confidence: price.confidence,
        source: price.source,
        timestamp: price.timestamp,
      },
    };
  });
  
  /**
   * GET /api/prices/:asset
   * Get price history for an asset
   */
  app.get('/prices/:asset', async (request: FastifyRequest) => {
    const { asset } = request.params as { asset: string };
    const query = request.query as { chain?: string; from?: string; to?: string; bucket?: string };
    
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = query.to ? new Date(query.to) : new Date();
    const bucket = (query.bucket || '1m') as '1m' | '5m' | '1h';
    
    const prices = await priceService.getPriceHistory(asset, query.chain || 'ethereum', from, to, bucket);
    
    return {
      ok: true,
      data: prices.map(p => ({
        timestamp: p.timestamp,
        priceUsd: parsePrice(p.priceUsd),
        priceEth: parsePrice(p.priceEth),
        confidence: p.confidence,
      })),
      count: prices.length,
    };
  });
  
  /**
   * GET /api/prices/weth/usd
   * Get current WETH price in USD
   */
  app.get('/prices/weth/usd', async () => {
    const price = await priceService.getWethPriceUsd();
    
    return {
      ok: true,
      data: {
        symbol: 'WETH',
        priceUsd: price || 0,
        available: price !== null,
      },
    };
  });
  
  /**
   * GET /api/market-metrics/:asset
   * Get market metrics for an asset
   */
  app.get('/market-metrics/:asset', async (request: FastifyRequest) => {
    const { asset } = request.params as { asset: string };
    const query = request.query as { chain?: string; window?: string };
    
    const window = (query.window || '24h') as MetricsWindow;
    if (!['1h', '4h', '24h', '7d'].includes(window)) {
      return { ok: false, error: 'Invalid window. Use: 1h, 4h, 24h, 7d' };
    }
    
    const metrics = await metricsService.getMarketMetrics(asset, query.chain || 'ethereum', window);
    
    if (!metrics) {
      return { ok: false, error: 'Metrics not available - insufficient price data' };
    }
    
    return {
      ok: true,
      data: {
        assetAddress: metrics.assetAddress,
        window: metrics.window,
        priceChange: metrics.priceChange,
        volatility: metrics.volatility,
        trend: metrics.trend,
        trendStrength: metrics.trendStrength,
        maxDrawdown: metrics.maxDrawdown,
        liquidityScore: metrics.liquidityScore,
        priceConfidenceAvg: metrics.priceConfidenceAvg,
        dataPointsCount: metrics.dataPointsCount,
        calculatedAt: metrics.calculatedAt,
        validUntil: metrics.validUntil,
      },
    };
  });
  
  /**
   * GET /api/market-metrics/top
   * Get top assets by metric
   */
  app.get('/market-metrics/top', async (request: FastifyRequest) => {
    const query = request.query as { window?: string; by?: string; limit?: string; chain?: string };
    
    const window = (query.window || '24h') as MetricsWindow;
    const sortBy = (query.by || 'volatility') as 'volatility' | 'trend' | 'liquidity' | 'priceChange';
    const limit = Math.min(50, parseInt(query.limit || '20'));
    
    const top = await metricsService.getTopAssets(window, sortBy, limit, query.chain || 'ethereum');
    
    return {
      ok: true,
      data: top.map(m => ({
        assetAddress: m.assetAddress,
        priceChange: m.priceChange,
        volatility: m.volatility,
        trend: m.trend,
        liquidityScore: m.liquidityScore,
      })),
      count: top.length,
    };
  });
  
  /**
   * GET /api/market/known-tokens
   * Get list of known tokens
   */
  app.get('/known-tokens', async (request: FastifyRequest) => {
    const query = request.query as { chain?: string };
    const chain = query.chain || 'ethereum';
    
    const tokens = KNOWN_TOKENS[chain] || {};
    
    return {
      ok: true,
      data: Object.entries(tokens).map(([symbol, info]) => ({
        symbol,
        address: info.address,
        decimals: info.decimals,
      })),
    };
  });
  
  /**
   * GET /api/market/context/:asset
   * Get comprehensive market context for exploration mode
   */
  app.get('/context/:asset', async (request: FastifyRequest) => {
    const { asset } = request.params as { asset: string };
    const query = request.query as { chain?: string };
    
    const { getMarketContext } = await import('./market_context.service.js');
    const context = await getMarketContext(asset, query.chain || 'ethereum');
    
    return {
      ok: true,
      data: context,
    };
  });
  
  /**
   * GET /api/market/token-activity/:tokenAddress
   * Get real-time activity snapshot for a token from indexed transfers
   * 
   * This is the CRITICAL endpoint for TokensPage Activity Snapshot
   */
  app.get('/token-activity/:tokenAddress', async (request: FastifyRequest) => {
    const { tokenAddress } = request.params as { tokenAddress: string };
    const query = request.query as { window?: string };
    
    const windowHours = query.window === '1h' ? 1 : query.window === '6h' ? 6 : 24;
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    
    const { ERC20LogModel } = await import('../../onchain/ethereum/logs_erc20.model.js');
    const { getTokenPriceUsd, getTokenDecimals, getTokenMetadata } = await import('./coingecko.service.js');
    
    const normalizedAddress = tokenAddress.toLowerCase();
    
    // Get price from CoinGecko (with cache + stablecoin handling)
    const price = await getTokenPriceUsd(normalizedAddress);
    const decimals = getTokenDecimals(normalizedAddress);
    const tokenMeta = getTokenMetadata(normalizedAddress);
    
    // Aggregate from logs_erc20 (raw indexed data)
    const [transferStats, walletStats, largestTransfer, flowStats] = await Promise.all([
      // Count and sum transfers
      ERC20LogModel.aggregate([
        { $match: { 
          token: normalizedAddress,
          blockTimestamp: { $gte: since }
        }},
        { $group: {
          _id: null,
          count: { $sum: 1 },
          totalAmount: { $sum: { $toDouble: '$amount' } },
        }},
      ]),
      
      // Count unique wallets (senders ∪ receivers)
      ERC20LogModel.aggregate([
        { $match: { 
          token: normalizedAddress,
          blockTimestamp: { $gte: since }
        }},
        { $group: { _id: null, 
          senders: { $addToSet: '$from' },
          receivers: { $addToSet: '$to' }
        }},
        { $project: {
          uniqueWallets: { $setUnion: ['$senders', '$receivers'] }
        }},
        { $project: {
          count: { $size: '$uniqueWallets' }
        }}
      ]),
      
      // Find largest transfer - FIXED: convert to number for proper sorting
      ERC20LogModel.aggregate([
        { $match: { 
          token: normalizedAddress,
          blockTimestamp: { $gte: since }
        }},
        { $addFields: { amountNum: { $toDouble: '$amount' } }},
        { $sort: { amountNum: -1 }},
        { $limit: 1 },
        { $project: { amount: '$amountNum', from: 1, to: 1, txHash: 1 }}
      ]),
      
      // Calculate net flow: sum of (received - sent) per external wallet
      // Exclude known DEX/exchange addresses for cleaner signal
      ERC20LogModel.aggregate([
        { $match: { 
          token: normalizedAddress,
          blockTimestamp: { $gte: since }
        }},
        { $facet: {
          // Total inflow (sum of all received)
          totalIn: [
            { $group: { _id: null, total: { $sum: { $toDouble: '$amount' } } } }
          ],
          // Top accumulators (wallets with net positive flow)
          topAccumulators: [
            { $group: { 
              _id: '$to', 
              received: { $sum: { $toDouble: '$amount' } }
            }},
            { $lookup: {
              from: 'logs_erc20',
              let: { wallet: '$_id', tkn: normalizedAddress, since: since },
              pipeline: [
                { $match: { 
                  $expr: { 
                    $and: [
                      { $eq: ['$from', '$$wallet'] },
                      { $eq: ['$token', '$$tkn'] },
                      { $gte: ['$blockTimestamp', '$$since'] }
                    ]
                  }
                }},
                { $group: { _id: null, sent: { $sum: { $toDouble: '$amount' } } }}
              ],
              as: 'outgoing'
            }},
            { $addFields: { 
              sent: { $ifNull: [{ $arrayElemAt: ['$outgoing.sent', 0] }, 0] },
              netFlow: { $subtract: ['$received', { $ifNull: [{ $arrayElemAt: ['$outgoing.sent', 0] }, 0] }] }
            }},
            { $match: { netFlow: { $gt: 0 } }},
            { $sort: { netFlow: -1 }},
            { $limit: 10 },
            { $group: { _id: null, totalNetInflow: { $sum: '$netFlow' } }}
          ],
          // Top distributors (wallets with net negative flow)  
          topDistributors: [
            { $group: { 
              _id: '$from', 
              sent: { $sum: { $toDouble: '$amount' } }
            }},
            { $lookup: {
              from: 'logs_erc20',
              let: { wallet: '$_id', tkn: normalizedAddress, since: since },
              pipeline: [
                { $match: { 
                  $expr: { 
                    $and: [
                      { $eq: ['$to', '$$wallet'] },
                      { $eq: ['$token', '$$tkn'] },
                      { $gte: ['$blockTimestamp', '$$since'] }
                    ]
                  }
                }},
                { $group: { _id: null, received: { $sum: { $toDouble: '$amount' } } }}
              ],
              as: 'incoming'
            }},
            { $addFields: { 
              received: { $ifNull: [{ $arrayElemAt: ['$incoming.received', 0] }, 0] },
              netFlow: { $subtract: [{ $ifNull: [{ $arrayElemAt: ['$incoming.received', 0] }, 0] }, '$sent'] }
            }},
            { $match: { netFlow: { $lt: 0 } }},
            { $sort: { netFlow: 1 }},
            { $limit: 10 },
            { $group: { _id: null, totalNetOutflow: { $sum: '$netFlow' } }}
          ]
        }}
      ]),
    ]);
    
    const stats = transferStats[0] || { count: 0, totalAmount: 0 };
    const uniqueWallets = walletStats[0]?.count || 0;
    const largestAmount = largestTransfer[0]?.amount || null;
    const largestTxHash = largestTransfer[0]?.txHash || null;
    
    // Calculate USD values if we have price
    let totalVolume = 0;
    let netFlowUsd = 0;
    let inflowUsd = 0;
    let outflowUsd = 0;
    let largestTransferUsd = null;
    let flowDirection: 'inflow' | 'outflow' | 'neutral' = 'neutral';
    
    if (price !== null) {
      // Total volume in USD (half is inflow, half is outflow in closed system)
      totalVolume = stats.totalAmount ? (stats.totalAmount / Math.pow(10, decimals)) * price : 0;
      inflowUsd = totalVolume / 2;  // In closed system, inflow = outflow
      outflowUsd = totalVolume / 2;
      
      // Net flow = accumulators inflow - distributors outflow
      // Positive = more accumulation, Negative = more distribution
      const accumulatorInflow = flowStats[0]?.topAccumulators?.[0]?.totalNetInflow || 0;
      const distributorOutflow = Math.abs(flowStats[0]?.topDistributors?.[0]?.totalNetOutflow || 0);
      
      const netFlowRaw = accumulatorInflow - distributorOutflow;
      netFlowUsd = (netFlowRaw / Math.pow(10, decimals)) * price;
      
      // Determine direction
      if (netFlowUsd > 1000) flowDirection = 'inflow';
      else if (netFlowUsd < -1000) flowDirection = 'outflow';
      
      // Largest transfer in USD
      if (largestAmount) {
        largestTransferUsd = (largestAmount / Math.pow(10, decimals)) * price;
        // DEBUG: Log largest transfer calculation
        console.log(`[TokenActivity] Largest transfer: ${largestAmount} raw -> $${largestTransferUsd?.toFixed(2)} USD (decimals=${decimals}, price=${price})`);
      }
    }
    
    return {
      ok: true,
      data: {
        tokenAddress: normalizedAddress,
        window: `${windowHours}h`,
        activity: {
          transfers24h: stats.count,
          activeWallets: uniqueWallets, // unique from ∪ to
          largestTransfer: largestTransferUsd,
          largestTransferTx: largestTxHash,
        },
        flows: {
          totalVolume,
          inflowUsd,
          outflowUsd,
          netFlow: netFlowUsd,
          direction: flowDirection,
          hasPrice: price !== null,
          priceUsd: price,
          priceSource: tokenMeta.isStablecoin ? 'stablecoin' : tokenMeta.coinGeckoId ? 'coingecko' : price ? 'coingecko_contract' : 'unknown',
        },
        interpretation: {
          walletsDefinition: 'unique senders ∪ receivers',
          netFlowDefinition: 'sum(accumulator_inflows) - sum(distributor_outflows)',
          priceNote: tokenMeta.isStablecoin 
            ? 'Stablecoin price fixed at $1' 
            : price !== null 
              ? 'Live price from CoinGecko (5min cache)'
              : 'Price unavailable - showing raw amounts',
        },
        analyzedAt: new Date().toISOString(),
        dataSource: 'indexed_transfers',
      },
    };
  });
  
  /**
   * GET /api/market/token-signals/:tokenAddress
   * Get generated signals for a token based on baseline deviation
   * 
   * CRITICAL: Always returns what was checked, even if no signals
   */
  app.get('/token-signals/:tokenAddress', async (request: FastifyRequest) => {
    const { tokenAddress } = request.params as { tokenAddress: string };
    
    const { generateTokenSignals } = await import('./token_signals.service.js');
    const result = await generateTokenSignals(tokenAddress.toLowerCase());
    
    return {
      ok: true,
      data: {
        tokenAddress: tokenAddress.toLowerCase(),
        signals: result.signals,
        baseline: result.baseline,
        current: result.current,
        checkedMetrics: result.checkedMetrics,
        analysisStatus: result.analysisStatus,
        // CRITICAL: Empty state explanation
        interpretation: result.signals.length === 0 
          ? {
              headline: 'Current activity is within normal range',
              description: `We compared the last ${result.current.windowHours}h against a ${result.baseline.periodHours}h baseline. No significant deviations detected.`,
            }
          : {
              headline: `${result.signals.length} signal${result.signals.length > 1 ? 's' : ''} detected`,
              description: result.signals.map(s => s.title).join(', '),
            },
        analyzedAt: new Date().toISOString(),
      },
    };
  });
  
  /**
   * GET /api/market/token-drivers/:tokenAddress
   * Get top wallets driving activity for a token (B2 block)
   * 
   * CRITICAL: Returns concentration metrics and interpretation
   */
  app.get('/token-drivers/:tokenAddress', async (request: FastifyRequest) => {
    const { tokenAddress } = request.params as { tokenAddress: string };
    const query = request.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '10'), 50);
    
    const { getActivityDrivers } = await import('./token_signals.service.js');
    const { getTokenPriceUsd, getTokenDecimals } = await import('./coingecko.service.js');
    
    const normalized = tokenAddress.toLowerCase();
    const drivers = await getActivityDrivers(normalized, limit);
    
    // Get price from CoinGecko
    const price = await getTokenPriceUsd(normalized);
    const decimals = getTokenDecimals(normalized);
    
    // Convert to USD if we have price
    const convertedDrivers = drivers.topDrivers.map(d => ({
      ...d,
      volumeInUsd: price ? (d.volumeIn / Math.pow(10, decimals)) * price : null,
      volumeOutUsd: price ? (d.volumeOut / Math.pow(10, decimals)) * price : null,
      netFlowUsd: price ? (d.netFlow / Math.pow(10, decimals)) * price : null,
    }));
    
    return {
      ok: true,
      data: {
        tokenAddress: normalized,
        topDrivers: convertedDrivers,
        totalVolume: drivers.totalVolume,
        totalVolumeUsd: price ? (drivers.totalVolume / Math.pow(10, decimals)) * price : null,
        hasConcentration: drivers.hasConcentration,
        concentration: drivers.concentration, // NEW: Full concentration metrics
        analysisStatus: drivers.analysisStatus,
        window: '24h',
        analyzedAt: new Date().toISOString(),
      },
    };
  });
  
  /**
   * GET /api/market/token-smart-money/:tokenAddress
   * Analyze smart money activity (B4 block)
   */
  app.get('/token-smart-money/:tokenAddress', async (request: FastifyRequest) => {
    const { tokenAddress } = request.params as { tokenAddress: string };
    
    const { analyzeSmartMoney } = await import('./token_signals.service.js');
    const { getTokenPriceUsd, getTokenDecimals } = await import('./coingecko.service.js');
    
    const normalized = tokenAddress.toLowerCase();
    const price = await getTokenPriceUsd(normalized);
    const decimals = getTokenDecimals(normalized);
    
    const result = await analyzeSmartMoney(normalized, price, decimals);
    
    return {
      ok: true,
      data: {
        tokenAddress: normalized,
        ...result,
        window: '24h',
        analyzedAt: new Date().toISOString(),
      },
    };
  });
  
  /**
   * GET /api/market/token-clusters/:tokenAddress
   * Analyze wallet clusters (B3 block)
   */
  app.get('/token-clusters/:tokenAddress', async (request: FastifyRequest) => {
    const { tokenAddress } = request.params as { tokenAddress: string };
    
    const { analyzeClusters } = await import('./token_signals.service.js');
    const result = await analyzeClusters(tokenAddress.toLowerCase());
    
    return {
      ok: true,
      data: {
        tokenAddress: tokenAddress.toLowerCase(),
        ...result,
        window: '24h',
        analyzedAt: new Date().toISOString(),
      },
    };
  });
  
  /**
   * GET /api/market/top-active-tokens
   * Get top active tokens by transfer count (Market Discovery)
   */
  app.get('/top-active-tokens', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string; window?: string };
    const limit = Math.min(parseInt(query.limit || '10'), 50);
    const windowHours = query.window === '1h' ? 1 : query.window === '6h' ? 6 : 24;
    
    // Use SWR cache for this heavy endpoint
    const cacheKey = `market:top-active-tokens:${limit}:${windowHours}h`;
    
    const result = await cache.getOrStaleThenRefresh(
      cacheKey,
      MARKET_CACHE_TTL,
      MARKET_STALE_TTL,
      async () => {
        const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
        
        const { ERC20LogModel } = await import('../../onchain/ethereum/logs_erc20.model.js');
        
        // Known token metadata
        const KNOWN_TOKENS: Record<string, { symbol: string; name: string; decimals: number }> = {
          '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', name: 'Tether USD', decimals: 6 },
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
          '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
          '0x6b175474e89094c44da98b954eedeac495271d0f': { symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
          '0x514910771af9ca656af840dff83e8264ecf986ca': { symbol: 'LINK', name: 'Chainlink', decimals: 18 },
          '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': { symbol: 'UNI', name: 'Uniswap', decimals: 18 },
          '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': { symbol: 'AAVE', name: 'Aave', decimals: 18 },
          '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8 },
        };
        
        // Aggregate top tokens
        const pipeline = [
          { $match: { blockTimestamp: { $gte: since } } },
          { $group: {
            _id: '$token',
            transferCount: { $sum: 1 },
            senders: { $addToSet: '$from' },
            receivers: { $addToSet: '$to' },
            latestBlock: { $max: '$blockNumber' },
          }},
          { $project: {
            token: '$_id',
            transferCount: 1,
            walletCount: { $size: { $setUnion: ['$senders', '$receivers'] } },
            latestBlock: 1,
          }},
          { $sort: { transferCount: -1 } },
          { $limit: limit },
        ];
        
        const results = await ERC20LogModel.aggregate(pipeline);
        
        // Enrich with metadata
        return results.map((r: any) => {
          const meta = KNOWN_TOKENS[r.token] || null;
          return {
            address: r.token,
            symbol: meta?.symbol || null,
            name: meta?.name || null,
            transferCount: r.transferCount,
            activeWallets: r.walletCount,
            isKnown: !!meta,
          };
        });
      },
      15000 // 15 sec timeout
    );
    
    return {
      ok: true,
      data: {
        tokens: result.data || [],
        window: `${windowHours}h`,
        analyzedAt: new Date().toISOString(),
      },
      cacheStatus: result.status,
    };
  });
  
  /**
   * GET /api/market/flow-anomalies
   * Get flow anomalies (z-score deviations) for an asset
   */
  app.get('/flow-anomalies', async (request: FastifyRequest) => {
    const query = request.query as { 
      asset?: string; 
      chain?: string; 
      timeframe?: '7d' | '14d' | '30d';
    };
    
    const asset = query.asset || '0x0000000000000000000000000000000000000000'; // ETH default
    const chain = query.chain || 'ethereum';
    const timeframe = query.timeframe || '7d';
    
    const { getFlowAnomalies } = await import('./flow_anomalies.service.js');
    const anomalies = await getFlowAnomalies(asset, chain, timeframe);
    
    return {
      ok: true,
      data: anomalies,
    };
  });
  
  // ============================================================================
  // DISCOVERY LAYER ENDPOINTS (P2)
  // ============================================================================
  
  /**
   * GET /api/market/emerging-signals
   * Get tokens with recent signals for discovery
   */
  app.get('/emerging-signals', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '10'), 20);
    
    // Use SWR cache for this heavy endpoint
    const cacheKey = `market:emerging-signals:${limit}`;
    
    const result = await cache.getOrStaleThenRefresh(
      cacheKey,
      SIGNALS_CACHE_TTL,
      SIGNALS_STALE_TTL,
      async () => {
        const { generateTokenSignals } = await import('./token_signals.service.js');
        const { ERC20LogModel } = await import('../../onchain/ethereum/logs_erc20.model.js');
        const { getTokenMetadata } = await import('./coingecko.service.js');
        
        // Get top active tokens first
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        const topTokens = await ERC20LogModel.aggregate([
          { $match: { blockTimestamp: { $gte: since } } },
          { $group: { _id: '$token', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ]);
        
        // Check each token for signals
        const tokensWithSignals: Array<{
          address: string;
          symbol: string;
          name: string;
          signals: any[];
          transferCount: number;
          topSignal?: {
            type: string;
            severity: number;
            title: string;
          };
        }> = [];
        
        for (const token of topTokens) {
          const address = token._id.toLowerCase();
          const result = await generateTokenSignals(address);
          
          if (result.signals.length > 0) {
            const metadata = getTokenMetadata(address);
            const topSignal = result.signals.sort((a, b) => b.severity - a.severity)[0];
            
            tokensWithSignals.push({
              address,
              symbol: metadata?.symbol || address.slice(0, 8) + '...',
              name: metadata?.name || 'Unknown Token',
              signals: result.signals,
              transferCount: token.count,
              topSignal: {
                type: topSignal.type,
                severity: topSignal.severity,
                title: topSignal.title,
              },
            });
          }
          
          if (tokensWithSignals.length >= limit) break;
        }
        
        return {
          tokens: tokensWithSignals,
          checkedCount: topTokens.length,
        };
      },
      15000 // 15 sec timeout
    );
    
    const tokens = result.data?.tokens || [];
    const checkedCount = result.data?.checkedCount || 0;
    
    return {
      ok: true,
      data: {
        tokens,
        checkedCount,
        window: '24h',
        interpretation: tokens.length === 0
          ? {
              headline: result.status === 'TIMEOUT' ? 'Loading...' : 'No emerging signals detected',
              description: result.status === 'TIMEOUT' 
                ? 'Data is being refreshed in background. Refresh the page in a few seconds.'
                : `We checked ${checkedCount} most active tokens for significant deviations from baseline.`,
            }
          : {
              headline: `${tokens.length} token${tokens.length > 1 ? 's' : ''} with signals`,
              description: 'Showing tokens with statistically significant activity deviations.',
            },
        analyzedAt: new Date().toISOString(),
      },
      cacheStatus: result.status,
    };
  });
  
  /**
   * GET /api/market/new-actors
   * Get recently active new wallets
   */
  app.get('/new-actors', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '10'), 20);
    
    const { ERC20LogModel } = await import('../../onchain/ethereum/logs_erc20.model.js');
    const { getTokenPriceUsd, getTokenDecimals, getTokenMetadata } = await import('./coingecko.service.js');
    
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Find wallets with high activity but recent first appearance
    const activeWallets = await ERC20LogModel.aggregate([
      { $match: { blockTimestamp: { $gte: since } } },
      // Group by sender (from)
      { 
        $group: { 
          _id: '$from', 
          txCount: { $sum: 1 },
          firstSeen: { $min: '$blockTimestamp' },
          tokens: { $addToSet: '$token' },
          totalAmount: { $sum: { $toDouble: '$amount' } },
        } 
      },
      { $match: { txCount: { $gte: 5 } } }, // At least 5 transfers
      { $sort: { firstSeen: -1, txCount: -1 } }, // Newest first
      { $limit: limit * 2 },
    ]);
    
    // Get volume estimates
    const actors: Array<{
      address: string;
      txCount: number;
      firstSeen: Date;
      tokenCount: number;
      topToken?: string;
      estimatedVolumeUsd?: number;
    }> = [];
    
    for (const wallet of activeWallets) {
      if (actors.length >= limit) break;
      
      // Skip contracts (simple heuristic - very high activity)
      if (wallet.txCount > 1000) continue;
      
      // Get top token
      const topToken = wallet.tokens[0];
      const metadata = getTokenMetadata(topToken);
      
      actors.push({
        address: wallet._id,
        txCount: wallet.txCount,
        firstSeen: wallet.firstSeen,
        tokenCount: wallet.tokens.length,
        topToken: metadata?.symbol || topToken?.slice(0, 8) + '...',
      });
    }
    
    return {
      ok: true,
      data: {
        actors,
        window: '24h',
        interpretation: actors.length === 0
          ? {
              headline: 'No significant new actors detected',
              description: 'We checked for wallets with high recent activity and recent first appearance.',
            }
          : {
              headline: `${actors.length} new active wallet${actors.length > 1 ? 's' : ''} detected`,
              description: 'Wallets showing significant activity in the last 24h.',
            },
        analyzedAt: new Date().toISOString(),
      },
    };
  });
  
  /**
   * GET /api/market/narratives
   * Get market narratives - агрегированные факты более высокого порядка
   * 
   * Narrative = синтез signals, НЕ intent, НЕ прогноз
   */
  app.get('/narratives', async (request: FastifyRequest) => {
    const query = request.query as { window?: string; limit?: string };
    const window = (query.window === '6h' ? '6h' : '24h') as '6h' | '24h';
    const maxNarratives = Math.min(parseInt(query.limit || '5'), 10);
    
    // Use SWR cache for this heavy endpoint
    const cacheKey = `market:narratives:${window}:${maxNarratives}`;
    
    const result = await cache.getOrStaleThenRefresh(
      cacheKey,
      NARRATIVES_CACHE_TTL,
      NARRATIVES_STALE_TTL,
      async () => {
        const { generateTokenSignals } = await import('./token_signals.service.js');
        const { buildNarratives } = await import('./narratives/narrative.engine.js');
        const { ERC20LogModel } = await import('../../onchain/ethereum/logs_erc20.model.js');
        const { getTokenMetadata } = await import('./coingecko.service.js');
        
        // Get signals from top active tokens
        const since = new Date(Date.now() - (window === '6h' ? 6 : 24) * 60 * 60 * 1000);
        
        const topTokens = await ERC20LogModel.aggregate([
          { $match: { blockTimestamp: { $gte: since } } },
          { $group: { _id: '$token', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 30 }, // Check top 30 tokens
        ]);
        
        // Collect all signals
        const allSignals: any[] = [];
        
        for (const token of topTokens) {
          const address = token._id.toLowerCase();
          const signalResult = await generateTokenSignals(address);
          
          if (signalResult.signals.length > 0) {
            const metadata = getTokenMetadata(address);
            
            // Add metadata to signals
            for (const signal of signalResult.signals) {
              allSignals.push({
                ...signal,
                tokenAddress: address,
                tokenSymbol: metadata?.symbol || address.slice(0, 8) + '...',
                tokenName: metadata?.name || 'Unknown',
                detectedAt: new Date(),
              });
            }
          }
        }
        
        // Build narratives from signals
        const narratives = await buildNarratives(allSignals, {
          window,
          maxNarratives,
        });
        
        // Format for frontend
        const formattedNarratives = narratives.map(n => ({
          id: n.id,
          category: n.category,
          pattern: n.pattern,
          scope: n.scope,
          theme: n.theme,
          whyItMatters: n.whyItMatters,
          evidence: n.evidence.map(e => ({
            token: e.token,
            symbol: e.symbol,
            signalType: e.signalType,
            deviation: e.deviation,
          })),
          supportScore: n.supportScore,
          window: n.window,
          firstDetected: n.firstDetected.toISOString(),
          sector: n.sector,
        }));
        
        return {
          narratives: formattedNarratives,
          totalSignalsAnalyzed: allSignals.length,
          tokensChecked: topTokens.length,
        };
      },
      20000 // 20 sec timeout for narratives (heavier)
    );
    
    const narratives = result.data?.narratives || [];
    const totalSignals = result.data?.totalSignalsAnalyzed || 0;
    const tokensChecked = result.data?.tokensChecked || 0;
    
    return {
      ok: true,
      data: {
        narratives,
        totalSignalsAnalyzed: totalSignals,
        tokensChecked,
        window,
        interpretation: narratives.length === 0
          ? {
              headline: result.status === 'TIMEOUT' ? 'Loading narratives...' : 'No market narratives detected',
              description: result.status === 'TIMEOUT' 
                ? 'Data is being refreshed in background. Refresh the page in a few seconds.'
                : `We analyzed ${totalSignals} signals across ${tokensChecked} tokens. No coordinated patterns found.`,
            }
          : {
              headline: `${narratives.length} market narrative${narratives.length > 1 ? 's' : ''} identified`,
              description: 'Coordinated patterns detected across multiple tokens.',
            },
        analyzedAt: new Date().toISOString(),
      },
      cacheStatus: result.status,
    };
  });
  
  /**
   * GET /api/market/narratives-by-sector
   * Get narratives grouped by sector (PART 2 - Sector Aggregation)
   * 
   * SectorNarrative = Narrative WHERE involvedTokens ⊆ Sector.tokens
   */
  app.get('/narratives-by-sector', async (request: FastifyRequest) => {
    const query = request.query as { window?: string };
    const window = (query.window === '6h' ? '6h' : '24h') as '6h' | '24h';
    
    const { generateTokenSignals } = await import('./token_signals.service.js');
    const { buildNarratives } = await import('./narratives/narrative.engine.js');
    const { getAllSectors, getSectorLabel } = await import('./narratives/sector.definitions.js');
    const { ERC20LogModel } = await import('../../onchain/ethereum/logs_erc20.model.js');
    const { getTokenMetadata } = await import('./coingecko.service.js');
    
    // Get signals from top active tokens
    const since = new Date(Date.now() - (window === '6h' ? 6 : 24) * 60 * 60 * 1000);
    
    const topTokens = await ERC20LogModel.aggregate([
      { $match: { blockTimestamp: { $gte: since } } },
      { $group: { _id: '$token', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 30 },
    ]);
    
    // Collect all signals
    const allSignals: any[] = [];
    
    for (const token of topTokens) {
      const address = token._id.toLowerCase();
      const result = await generateTokenSignals(address);
      
      if (result.signals.length > 0) {
        const metadata = getTokenMetadata(address);
        
        for (const signal of result.signals) {
          allSignals.push({
            ...signal,
            tokenAddress: address,
            tokenSymbol: metadata?.symbol || address.slice(0, 8) + '...',
            tokenName: metadata?.name || 'Unknown',
            detectedAt: new Date(),
          });
        }
      }
    }
    
    // Build all narratives
    const allNarratives = await buildNarratives(allSignals, { window, maxNarratives: 20 });
    
    // Group narratives by sector
    const sectorGroups: Record<string, any[]> = {};
    const sectors = getAllSectors();
    
    for (const sector of sectors) {
      sectorGroups[sector.id] = [];
    }
    
    // Add "other" for non-sector narratives
    sectorGroups['other'] = [];
    
    // Classify narratives into sectors
    for (const narrative of allNarratives) {
      if (narrative.sector && sectorGroups[narrative.sector]) {
        sectorGroups[narrative.sector].push(narrative);
      } else {
        sectorGroups['other'].push(narrative);
      }
    }
    
    // Format for frontend
    const sectorSummaries = Object.entries(sectorGroups)
      .map(([sectorId, narratives]) => ({
        sectorId,
        sectorLabel: getSectorLabel(sectorId),
        narrativeCount: narratives.length,
        narratives: narratives.slice(0, 3).map((n: any) => ({
          id: n.id,
          category: n.category,
          pattern: n.pattern,
          theme: n.theme,
          supportScore: n.supportScore,
        })),
      }))
      .filter(s => s.narrativeCount > 0)
      .sort((a, b) => b.narrativeCount - a.narrativeCount);
    
    return {
      ok: true,
      data: {
        sectors: sectorSummaries,
        totalNarratives: allNarratives.length,
        window,
        analyzedAt: new Date().toISOString(),
      },
    };
  });
  
  /**
   * GET /api/market/discovery
   * Get aggregated Market Discovery data for all 3 blocks
   * 
   * Block 1: Unusual Activity (Raw)
   * Block 2: Narratives & Coordination
   * Block 3: Deviation Watchlist
   * 
   * Each item includes ML integration fields:
   * - decisionImpact: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'
   * - engineStatus: 'USED_IN_DECISION' | 'WEIGHTED_DOWN' | 'IGNORED'
   * - affectedTokens: string[]
   */
  app.get('/discovery', async () => {
    const { getMarketDiscoveryData } = await import('./market_discovery.service.js');
    const data = await getMarketDiscoveryData();
    
    return {
      ok: true,
      data,
    };
  });
  
  /**
   * GET /api/market/discovery/unusual-activity
   * Get only Unusual Activity block
   */
  app.get('/discovery/unusual-activity', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '10'), 20);
    
    const { getUnusualActivity } = await import('./market_discovery.service.js');
    const data = await getUnusualActivity(limit);
    
    return {
      ok: true,
      data,
    };
  });
  
  /**
   * GET /api/market/discovery/narratives
   * Get only Narratives & Coordination block
   */
  app.get('/discovery/narratives', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '5'), 10);
    
    const { getNarrativesWithImpact } = await import('./market_discovery.service.js');
    const data = await getNarrativesWithImpact(limit);
    
    return {
      ok: true,
      data,
    };
  });
  
  /**
   * GET /api/market/discovery/watchlist
   * Get only Deviation Watchlist block
   */
  app.get('/discovery/watchlist', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '10'), 20);
    
    const { getDeviationWatchlist } = await import('./market_discovery.service.js');
    const data = await getDeviationWatchlist(limit);
    
    return {
      ok: true,
      data,
    };
  });
  
  app.log.info('Market routes registered');
}
