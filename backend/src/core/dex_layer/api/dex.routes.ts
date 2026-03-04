/**
 * DEX Layer API Routes (P0.4)
 * 
 * REST API for DEX trade data.
 * Read-only except for sync operations.
 */

import { FastifyInstance } from 'fastify';
import {
  DexTradeModel,
  SupportedDexChain,
  getTradesByWallet,
  getTradesByToken,
  getDexStats
} from '../storage/dex_trade.model.js';
import {
  getWalletDexSummary,
  getTokenDexSummary,
  getRecentSwapActivity,
  findSwapsBeforeExit
} from '../aggregation/dex_aggregator.service.js';
import {
  ingestSwapsForRange,
  ingestRecentSwaps,
  getIngestionStatus,
  seedTestTrades,
  getRpcUrl
} from '../ingestion/dex_ingestor.service.js';

export default async function dexRoutes(fastify: FastifyInstance) {
  
  // ========================================
  // Trade Query Endpoints
  // ========================================
  
  /**
   * GET /api/dex/trades
   * List trades with filtering
   */
  fastify.get('/dex/trades', async (request, reply) => {
    try {
      const query = request.query as {
        chain?: string;
        wallet?: string;
        token?: string;
        dex?: string;
        fromBlock?: string;
        toBlock?: string;
        fromTime?: string;
        toTime?: string;
        limit?: string;
        offset?: string;
      };
      
      const filter: any = {};
      
      if (query.chain) filter.chain = query.chain.toUpperCase();
      if (query.wallet) filter.trader = query.wallet.toLowerCase();
      if (query.dex) filter.dex = query.dex;
      
      if (query.token) {
        const token = query.token.toLowerCase();
        filter.$or = [{ tokenIn: token }, { tokenOut: token }];
      }
      
      if (query.fromBlock) filter.blockNumber = { $gte: parseInt(query.fromBlock) };
      if (query.toBlock) {
        filter.blockNumber = { ...filter.blockNumber, $lte: parseInt(query.toBlock) };
      }
      
      if (query.fromTime) {
        filter.timestamp = { $gte: Math.floor(new Date(query.fromTime).getTime() / 1000) };
      }
      if (query.toTime) {
        filter.timestamp = { ...filter.timestamp, $lte: Math.floor(new Date(query.toTime).getTime() / 1000) };
      }
      
      const limit = Math.min(parseInt(query.limit || '100'), 1000);
      const offset = parseInt(query.offset || '0');
      
      const trades = await DexTradeModel.find(filter)
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit)
        .lean();
      
      // Remove MongoDB _id
      const cleanTrades = trades.map(({ _id, ...t }) => t);
      
      return {
        ok: true,
        data: {
          trades: cleanTrades,
          count: cleanTrades.length,
          offset,
          limit
        }
      };
    } catch (error: any) {
      fastify.log.error('[DEX] Error listing trades:', error);
      return reply.code(500).send({
        ok: false,
        error: 'LIST_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/dex/trades/:tradeId
   * Get trade by ID
   */
  fastify.get('/dex/trades/:tradeId', async (request, reply) => {
    try {
      const { tradeId } = request.params as { tradeId: string };
      
      const trade = await DexTradeModel.findOne({ tradeId }).lean();
      
      if (!trade) {
        return reply.code(404).send({
          ok: false,
          error: 'TRADE_NOT_FOUND',
          message: `Trade not found: ${tradeId}`
        });
      }
      
      const { _id, ...cleanTrade } = trade;
      
      return {
        ok: true,
        data: cleanTrade
      };
    } catch (error: any) {
      fastify.log.error('[DEX] Error fetching trade:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Wallet Endpoints
  // ========================================
  
  /**
   * GET /api/dex/wallet/:address
   * Get wallet DEX summary
   */
  fastify.get('/dex/wallet/:address', async (request, reply) => {
    try {
      const { address } = request.params as { address: string };
      const { chain } = request.query as { chain?: string };
      
      const summary = await getWalletDexSummary(
        address,
        chain ? { chain: chain.toUpperCase() as SupportedDexChain } : undefined
      );
      
      return {
        ok: true,
        data: summary
      };
    } catch (error: any) {
      fastify.log.error('[DEX] Error fetching wallet summary:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/dex/wallet/:address/trades
   * Get wallet trades
   */
  fastify.get('/dex/wallet/:address/trades', async (request, reply) => {
    try {
      const { address } = request.params as { address: string };
      const query = request.query as {
        chain?: string;
        limit?: string;
        startTime?: string;
        endTime?: string;
      };
      
      const trades = await getTradesByWallet(address, {
        chain: query.chain?.toUpperCase() as SupportedDexChain,
        limit: query.limit ? parseInt(query.limit) : 100,
        startTime: query.startTime ? Math.floor(new Date(query.startTime).getTime() / 1000) : undefined,
        endTime: query.endTime ? Math.floor(new Date(query.endTime).getTime() / 1000) : undefined
      });
      
      const cleanTrades = trades.map(({ _id, ...t }) => t);
      
      return {
        ok: true,
        data: {
          wallet: address.toLowerCase(),
          trades: cleanTrades,
          count: cleanTrades.length
        }
      };
    } catch (error: any) {
      fastify.log.error('[DEX] Error fetching wallet trades:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/dex/wallet/:address/pre-exit
   * Get recent swaps that could precede an exit (for Route Intelligence)
   */
  fastify.get('/dex/wallet/:address/pre-exit', async (request, reply) => {
    try {
      const { address } = request.params as { address: string };
      const { chain, lookback } = request.query as { chain?: string; lookback?: string };
      
      const swaps = await findSwapsBeforeExit(
        address,
        lookback ? parseInt(lookback) : 3600,
        chain?.toUpperCase() as SupportedDexChain
      );
      
      return {
        ok: true,
        data: {
          wallet: address.toLowerCase(),
          swaps,
          count: swaps.length
        }
      };
    } catch (error: any) {
      fastify.log.error('[DEX] Error fetching pre-exit swaps:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Token Endpoints
  // ========================================
  
  /**
   * GET /api/dex/token/:address
   * Get token DEX summary
   */
  fastify.get('/dex/token/:address', async (request, reply) => {
    try {
      const { address } = request.params as { address: string };
      const { chain } = request.query as { chain?: string };
      
      const summary = await getTokenDexSummary(
        address,
        chain ? { chain: chain.toUpperCase() as SupportedDexChain } : undefined
      );
      
      return {
        ok: true,
        data: summary
      };
    } catch (error: any) {
      fastify.log.error('[DEX] Error fetching token summary:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/dex/token/:address/trades
   * Get token trades
   */
  fastify.get('/dex/token/:address/trades', async (request, reply) => {
    try {
      const { address } = request.params as { address: string };
      const query = request.query as {
        chain?: string;
        limit?: string;
        direction?: string;
      };
      
      const trades = await getTradesByToken(address, {
        chain: query.chain?.toUpperCase() as SupportedDexChain,
        limit: query.limit ? parseInt(query.limit) : 100,
        direction: query.direction as 'in' | 'out' | 'both'
      });
      
      const cleanTrades = trades.map(({ _id, ...t }) => t);
      
      return {
        ok: true,
        data: {
          token: address.toLowerCase(),
          trades: cleanTrades,
          count: cleanTrades.length
        }
      };
    } catch (error: any) {
      fastify.log.error('[DEX] Error fetching token trades:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Activity Endpoints
  // ========================================
  
  /**
   * GET /api/dex/activity
   * Get recent swap activity
   */
  fastify.get('/dex/activity', async (request, reply) => {
    try {
      const { window, chain } = request.query as { 
        window?: '1h' | '24h' | '7d';
        chain?: string;
      };
      
      const activity = await getRecentSwapActivity(
        window || '24h',
        chain ? { chain: chain.toUpperCase() as SupportedDexChain } : undefined
      );
      
      return {
        ok: true,
        data: activity
      };
    } catch (error: any) {
      fastify.log.error('[DEX] Error fetching activity:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Stats & Health
  // ========================================
  
  /**
   * GET /api/dex/stats
   * Get DEX statistics
   */
  fastify.get('/dex/stats', async (request, reply) => {
    try {
      const { chain } = request.query as { chain?: string };
      
      const stats = await getDexStats(
        chain ? chain.toUpperCase() as SupportedDexChain : undefined
      );
      
      return {
        ok: true,
        data: stats
      };
    } catch (error: any) {
      fastify.log.error('[DEX] Error fetching stats:', error);
      return reply.code(500).send({
        ok: false,
        error: 'STATS_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/dex/health
   * Get DEX ingestion health
   */
  fastify.get('/dex/health', async (request, reply) => {
    try {
      const status = await getIngestionStatus();
      
      return {
        ok: true,
        data: status
      };
    } catch (error: any) {
      fastify.log.error('[DEX] Error fetching health:', error);
      return reply.code(500).send({
        ok: false,
        error: 'HEALTH_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Admin/Sync Endpoints
  // ========================================
  
  /**
   * POST /api/dex/sync/:chain
   * Trigger sync for a specific chain
   */
  fastify.post('/dex/sync/:chain', async (request, reply) => {
    try {
      const { chain } = request.params as { chain: string };
      const body = request.body as {
        fromBlock?: number;
        toBlock?: number;
        blockCount?: number;
      } || {};
      
      const chainUpper = chain.toUpperCase() as SupportedDexChain;
      
      // Validate chain
      if (!['ETH', 'ARB', 'OP', 'BASE'].includes(chainUpper)) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_CHAIN',
          message: `Invalid chain: ${chain}. Supported: ETH, ARB, OP, BASE`
        });
      }
      
      let result;
      
      if (body.fromBlock && body.toBlock) {
        // Specific block range
        const rpcUrl = getRpcUrl(chainUpper);
        result = await ingestSwapsForRange(chainUpper, body.fromBlock, body.toBlock, rpcUrl);
      } else {
        // Recent blocks
        result = await ingestRecentSwaps(chainUpper, body.blockCount || 500);
      }
      
      return {
        ok: true,
        data: result,
        message: `Synced ${result.inserted} trades from ${chainUpper}`
      };
    } catch (error: any) {
      fastify.log.error('[DEX] Error syncing:', error);
      return reply.code(500).send({
        ok: false,
        error: 'SYNC_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/dex/seed
   * Seed test data
   */
  fastify.post('/dex/seed', async (request, reply) => {
    try {
      const result = await seedTestTrades();
      
      return {
        ok: true,
        data: result,
        message: `Seeded ${result.inserted} test trades`
      };
    } catch (error: any) {
      fastify.log.error('[DEX] Error seeding:', error);
      return reply.code(500).send({
        ok: false,
        error: 'SEED_ERROR',
        message: error.message
      });
    }
  });
  
  fastify.log.info('[DEX Layer] Routes registered');
}
