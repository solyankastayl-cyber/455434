/**
 * Token Universe Routes
 * 
 * API endpoints for token universe management
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { TokenUniverseModel } from './token_universe.model.js';
import { 
  ingestTokenUniverse,
  getTokenUniverseStats,
} from './token_universe.service.js';
import { seedTokenUniverse } from './token_universe.seed.js';

export async function tokenUniverseRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/tokens/sync
   * Trigger sync of token universe from CoinGecko
   * 
   * This is a long-running operation (~2-5 minutes for 500 tokens)
   */
  app.post('/tokens/sync', async (request: FastifyRequest) => {
    const body = request.body as {
      minMarketCap?: number;
      minVolume24h?: number;
      maxTokens?: number;
    } || {};
    
    const startTime = Date.now();
    
    try {
      const result = await ingestTokenUniverse({
        minMarketCap: body.minMarketCap || 500_000,
        minVolume24h: body.minVolume24h || 50_000,
        chainsAllowed: [1], // Ethereum mainnet
        maxTokens: body.maxTokens || 500,
      });
      
      return {
        ok: true,
        data: result,
      };
    } catch (err: any) {
      const duration = Date.now() - startTime;
      return {
        ok: false,
        error: 'Token sync failed',
        details: err.message,
        duration_ms: duration,
      };
    }
  });
  
  /**
   * GET /api/tokens
   * Query token universe
   */
  app.get('/tokens', async (request: FastifyRequest) => {
    const query = request.query as {
      active?: string;
      chainId?: string;
      minMarketCap?: string;
      search?: string;
      limit?: string;
      offset?: string;
      sortBy?: string;
      sortOrder?: string;
    };
    
    try {
      const filter: any = {};
      
      if (query.active === 'true') {
        filter.active = true;
      }
      
      if (query.chainId) {
        filter.chainId = parseInt(query.chainId);
      }
      
      if (query.minMarketCap) {
        filter.marketCap = { $gte: parseInt(query.minMarketCap) };
      }
      
      if (query.search) {
        filter.$or = [
          { symbol: { $regex: query.search, $options: 'i' } },
          { name: { $regex: query.search, $options: 'i' } },
        ];
      }
      
      const limit = Math.min(parseInt(query.limit || '100'), 500);
      const offset = parseInt(query.offset || '0');
      
      // Sorting
      const sortField = query.sortBy || 'marketCap';
      const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
      const sort: Record<string, 1 | -1> = { [sortField]: sortOrder };
      
      const [tokens, total] = await Promise.all([
        TokenUniverseModel.find(filter)
          .sort(sort)
          .limit(limit)
          .skip(offset)
          .select('-_id symbol name contractAddress chainId marketCap volume24h priceUsd priceChange24h marketCapRank imageUrl active lastSyncedAt source')
          .lean(),
        TokenUniverseModel.countDocuments(filter),
      ]);
      
      return {
        ok: true,
        data: {
          tokens,
          total,
          limit,
          offset,
          hasMore: offset + tokens.length < total,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to query tokens',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/tokens/:symbol
   * Get single token by symbol
   */
  app.get('/tokens/:symbol', async (request: FastifyRequest) => {
    const { symbol } = request.params as { symbol: string };
    
    try {
      const token = await TokenUniverseModel.findOne({ 
        symbol: symbol.toUpperCase() 
      })
        .select('-_id')
        .lean();
      
      if (!token) {
        return {
          ok: false,
          error: 'Token not found',
        };
      }
      
      return {
        ok: true,
        data: token,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get token',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/tokens/stats
   * Get token universe statistics
   */
  app.get('/tokens/stats', async () => {
    try {
      const stats = await getTokenUniverseStats();
      
      return {
        ok: true,
        data: stats,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get stats',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/tokens/top
   * Get top tokens by market cap
   */
  app.get('/tokens/top', async (request: FastifyRequest) => {
    const query = request.query as {
      limit?: string;
      chainId?: string;
    };
    
    try {
      const limit = Math.min(parseInt(query.limit || '50'), 100);
      const filter: any = { active: true };
      
      if (query.chainId) {
        filter.chainId = parseInt(query.chainId);
      }
      
      const tokens = await TokenUniverseModel.find(filter)
        .sort({ marketCap: -1 })
        .limit(limit)
        .select('-_id symbol name contractAddress chainId marketCap volume24h priceUsd priceChange24h marketCapRank imageUrl')
        .lean();
      
      return {
        ok: true,
        data: {
          tokens,
          count: tokens.length,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get top tokens',
        details: err.message,
      };
    }
  });
  
  /**
   * POST /api/tokens/seed
   * Seed token universe with known top tokens (for testing/fallback)
   */
  app.post('/tokens/seed', async () => {
    try {
      const count = await seedTokenUniverse();
      
      return {
        ok: true,
        data: {
          seeded: count,
          note: 'Seed data is for testing. Use /tokens/sync for production data.',
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Token seed failed',
        details: err.message,
      };
    }
  });
  
  /**
   * DELETE /api/tokens/clear
   * Clear all tokens (admin only - for testing)
   */
  app.delete('/tokens/clear', async (request: FastifyRequest) => {
    const query = request.query as { confirm?: string };
    
    if (query.confirm !== 'yes') {
      return {
        ok: false,
        error: 'Add ?confirm=yes to confirm deletion',
      };
    }
    
    try {
      const result = await TokenUniverseModel.deleteMany({});
      
      return {
        ok: true,
        data: {
          deleted: result.deletedCount,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to clear tokens',
        details: err.message,
      };
    }
  });
  
  app.log.info('[Token Universe] Routes registered');
}
