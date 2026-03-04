/**
 * Token Ranking Routes (Block D + C5)
 * 
 * API endpoints for ranking and buckets v2
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { 
  computeTokenRankings,
  getRankingsByBucket,
  getBucketsSummary,
  getTokenRanking,
  getTopMovers,
} from './ranking.service.js';
import {
  computeTokenRankingsV2,
} from './ranking_v2.service.js';
import {
  getTokenBucketHistory,
  getBucketChangeStats,
  getRecentBucketChanges,
  analyzeBucketStability,
} from './bucket_history.service.js';
import { TokenRankingModel } from './ranking.model.js';

export async function rankingRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/rankings/compute
   * Trigger ranking computation
   */
  app.post('/rankings/compute', async () => {
    try {
      const result = await computeTokenRankings();
      
      return {
        ok: true,
        data: result,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Ranking computation failed',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/rankings/buckets
   * Get summary of all buckets
   */
  app.get('/rankings/buckets', async () => {
    try {
      const summary = await getBucketsSummary();
      
      return {
        ok: true,
        data: summary,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get buckets summary',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/rankings/bucket/:bucket
   * Get tokens in specific bucket
   */
  app.get('/rankings/bucket/:bucket', async (request: FastifyRequest) => {
    const { bucket } = request.params as { bucket: string };
    const query = request.query as { limit?: string };
    
    const validBuckets = ['BUY', 'WATCH', 'SELL'];
    const normalizedBucket = bucket.toUpperCase();
    
    if (!validBuckets.includes(normalizedBucket)) {
      return {
        ok: false,
        error: `Invalid bucket. Must be one of: ${validBuckets.join(', ')}`,
      };
    }
    
    try {
      const limit = Math.min(parseInt(query.limit || '50'), 100);
      const rankings = await getRankingsByBucket(normalizedBucket as any, limit);
      
      return {
        ok: true,
        data: {
          bucket: normalizedBucket,
          tokens: rankings,
          count: rankings.length,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get bucket rankings',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/rankings/token/:symbol
   * Get ranking for specific token
   */
  app.get('/rankings/token/:symbol', async (request: FastifyRequest) => {
    const { symbol } = request.params as { symbol: string };
    
    try {
      const ranking = await getTokenRanking(symbol);
      
      if (!ranking) {
        return {
          ok: false,
          error: 'Token not found in rankings',
        };
      }
      
      return {
        ok: true,
        data: ranking,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get token ranking',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/rankings/movers
   * Get top movers by momentum
   */
  app.get('/rankings/movers', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string };
    
    try {
      const limit = Math.min(parseInt(query.limit || '10'), 50);
      const movers = await getTopMovers(limit);
      
      return {
        ok: true,
        data: {
          movers,
          count: movers.length,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get top movers',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/rankings
   * Get all rankings with pagination
   */
  app.get('/rankings', async (request: FastifyRequest) => {
    const query = request.query as {
      bucket?: string;
      limit?: string;
      offset?: string;
      sortBy?: string;
      sortOrder?: string;
    };
    
    try {
      const filter: any = {};
      
      if (query.bucket) {
        filter.bucket = query.bucket.toUpperCase();
      }
      
      const limit = Math.min(parseInt(query.limit || '50'), 100);
      const offset = parseInt(query.offset || '0');
      const sortField = query.sortBy || 'globalRank';
      const sortOrder = query.sortOrder === 'desc' ? -1 : 1;
      
      const [rankings, total] = await Promise.all([
        TokenRankingModel.find(filter)
          .sort({ [sortField]: sortOrder })
          .limit(limit)
          .skip(offset)
          .select('-_id symbol name contractAddress bucket compositeScore bucketRank globalRank priceUsd priceChange24h marketCap volume24h imageUrl actorSignalScore engineMode coverage coverageLevel signalFreshness isUnstable stabilityPenalty computedAt')
          .lean(),
        TokenRankingModel.countDocuments(filter),
      ]);
      
      return {
        ok: true,
        data: {
          rankings,
          total,
          limit,
          offset,
          hasMore: offset + rankings.length < total,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get rankings',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/rankings/dashboard
   * Get dashboard data (all buckets with top tokens)
   */
  app.get('/rankings/dashboard', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '20'), 50);
    
    try {
      const [summary, buyTokens, watchTokens, sellTokens] = await Promise.all([
        getBucketsSummary(),
        getRankingsByBucket('BUY', limit),
        getRankingsByBucket('WATCH', limit),
        getRankingsByBucket('SELL', limit),
      ]);
      
      return {
        ok: true,
        data: {
          summary,
          buckets: {
            BUY: buyTokens,
            WATCH: watchTokens,
            SELL: sellTokens,
          },
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get dashboard data',
        details: err.message,
      };
    }
  });
  
  // ============================================================
  // BLOCK D + C5 ENDPOINTS
  // ============================================================
  
  /**
   * POST /api/rankings/v2/compute
   * DEPRECATED - now handled by rankings_v2.routes.ts
   * This route redirects to the new V2 implementation
   */
  app.post('/rankings/v2/compute-legacy', async () => {
    try {
      const result = await computeTokenRankingsV2();
      
      return {
        ok: true,
        data: result,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Ranking v2 computation failed',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/rankings/history/:token
   * Get bucket transition history for token (D3)
   */
  app.get('/rankings/history/:token', async (request: FastifyRequest) => {
    const { token } = request.params as { token: string };
    const query = request.query as { limit?: string };
    
    try {
      const limit = Math.min(parseInt(query.limit || '20'), 100);
      const history = await getTokenBucketHistory(token, limit);
      
      return {
        ok: true,
        data: {
          token,
          history,
          count: history.length,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get bucket history',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/rankings/changes
   * Get recent bucket changes (C5.1)
   */
  app.get('/rankings/changes', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string; sinceMinutes?: string };
    
    try {
      const limit = Math.min(parseInt(query.limit || '20'), 100);
      const sinceMinutes = parseInt(query.sinceMinutes || '60');
      
      const changes = await getRecentBucketChanges(limit, sinceMinutes);
      
      return {
        ok: true,
        data: {
          changes,
          count: changes.length,
          sinceMinutes,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get bucket changes',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/rankings/stats/transitions
   * Get bucket transition statistics (C5.1)
   */
  app.get('/rankings/stats/transitions', async (request: FastifyRequest) => {
    const query = request.query as { windowHours?: string };
    
    try {
      const windowHours = Math.min(parseInt(query.windowHours || '24'), 168);
      const stats = await getBucketChangeStats(windowHours);
      
      return {
        ok: true,
        data: stats,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get transition stats',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/rankings/stability
   * Analyze bucket stability across all tokens (C5.5)
   */
  app.get('/rankings/stability', async () => {
    try {
      const stability = await analyzeBucketStability();
      
      return {
        ok: true,
        data: stability,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to analyze stability',
        details: err.message,
      };
    }
  });
  
  app.log.info('[Ranking] Routes registered (Block D + C5)');
}
