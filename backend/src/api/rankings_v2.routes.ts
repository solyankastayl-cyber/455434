/**
 * Rankings V2 API Routes
 * 
 * Endpoints for Rankings V2 system
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  computeAllRankings,
  computeEntityRanking,
  getLatestRankings,
  getRankingAttribution,
} from '../core/rankings_v2/index.js';
import type { RankWindow } from '../core/rankings_v2/index.js';

const VALID_WINDOWS = ['1h', '6h', '24h', '7d'];

export async function rankingsV2Routes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/rankings/v2/compute
   * 
   * Compute rankings for all entities
   */
  app.post('/rankings/v2/compute', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      window?: string;
      scope?: string;
      limit?: number;
    } ?? {};
    
    const window = (VALID_WINDOWS.includes(body.window ?? '')
      ? body.window
      : '24h') as RankWindow;
    
    const limit = Math.min(body.limit ?? 200, 500);
    
    try {
      app.log.info(`[Rankings V2] Computing rankings for window=${window}, limit=${limit}`);
      
      const { results, summary } = await computeAllRankings(window, limit);
      
      // Extract top BUY tokens
      const topBUY = results
        .filter(r => r.bucket === 'BUY')
        .slice(0, 10)
        .map(r => ({
          token: r.subject.symbol || r.subject.id,
          entityId: r.subject.id,
          rankScore: r.rankScore,
          confidence: r.engine.confidence,
          risk: r.engine.risk,
          coverage: r.engine.coverage,
          freshness: r.freshness.freshnessFactor,
          bucketReason: r.bucketReason,
        }));
      
      return {
        status: 'ok',
        computedAt: new Date().toISOString(),
        window,
        summary,
        topBUY,
        totalProcessed: results.length,
      };
    } catch (error) {
      app.log.error(error, '[Rankings V2] Compute error');
      return reply.status(500).send({
        status: 'error',
        error: 'RANKINGS_COMPUTE_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
  
  /**
   * GET /api/rankings/v2/latest
   * 
   * Get latest computed rankings
   */
  app.get('/rankings/v2/latest', async (request: FastifyRequest) => {
    const query = request.query as {
      window?: string;
      bucket?: string;
      limit?: string;
    };
    
    const window = (VALID_WINDOWS.includes(query.window ?? '')
      ? query.window
      : '24h') as RankWindow;
    
    const limit = Math.min(parseInt(query.limit ?? '100', 10), 500);
    const bucket = query.bucket;
    
    try {
      const rankings = await getLatestRankings(window, bucket, limit);
      
      // Format for UI consumption
      const tokens = rankings.map(r => ({
        token: r.subject.symbol || r.subject.id,
        entityId: r.subject.id,
        address: r.subject.address,
        rankScore: r.rankScore,
        bucket: r.bucket,
        engine: {
          coverage: r.engine.coverage,
          evidence: r.engine.evidence,
          risk: r.engine.risk,
          confidence: r.engine.confidence,
          direction: r.engine.direction,
        },
        freshnessFactor: r.freshness.freshnessFactor,
        bucketReason: r.bucketReason,
        computedAt: r.computedAt,
      }));
      
      // Summary
      const summary = {
        total: rankings.length,
        BUY: rankings.filter(r => r.bucket === 'BUY').length,
        WATCH: rankings.filter(r => r.bucket === 'WATCH').length,
        SELL: rankings.filter(r => r.bucket === 'SELL').length,
        NEUTRAL: rankings.filter(r => r.bucket === 'NEUTRAL').length,
      };
      
      return {
        ok: true,
        window,
        generatedAt: new Date().toISOString(),
        summary,
        tokens,
      };
    } catch (error) {
      app.log.error(error, '[Rankings V2] Get latest error');
      return {
        ok: false,
        error: 'RANKINGS_FETCH_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  /**
   * GET /api/rankings/v2/attribution
   * 
   * Get ranking attribution for a specific token
   */
  app.get('/rankings/v2/attribution', async (request: FastifyRequest) => {
    const query = request.query as {
      token?: string;
      entityId?: string;
      window?: string;
    };
    
    const entityId = query.entityId || query.token;
    if (!entityId) {
      return {
        ok: false,
        error: 'MISSING_PARAM',
        message: 'Either token or entityId parameter is required',
      };
    }
    
    const window = (VALID_WINDOWS.includes(query.window ?? '')
      ? query.window
      : '24h') as RankWindow;
    
    try {
      const result = await getRankingAttribution(entityId, window);
      
      if (!result) {
        return {
          ok: false,
          error: 'NOT_FOUND',
          message: `No ranking data found for ${entityId}`,
        };
      }
      
      return {
        ok: true,
        token: result.subject.symbol || result.subject.id,
        entityId: result.subject.id,
        window,
        rankScore: result.rankScore,
        bucket: result.bucket,
        bucketReason: result.bucketReason,
        
        engine: result.engine,
        quality: result.quality,
        freshness: result.freshness,
        lifecycleMix: result.lifecycleMix,
        rankTrace: result.rankTrace,
        
        topSignals: result.topSignals,
        computedAt: result.computedAt,
      };
    } catch (error) {
      app.log.error(error, '[Rankings V2] Attribution error');
      return {
        ok: false,
        error: 'ATTRIBUTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  /**
   * GET /api/rankings/v2/token/:entityId
   * 
   * Compute fresh ranking for a specific token
   */
  app.get('/rankings/v2/token/:entityId', async (request: FastifyRequest) => {
    const params = request.params as { entityId: string };
    const query = request.query as { window?: string };
    
    const window = (VALID_WINDOWS.includes(query.window ?? '')
      ? query.window
      : '24h') as RankWindow;
    
    try {
      const result = await computeEntityRanking(params.entityId, window);
      
      if (!result) {
        return {
          ok: false,
          error: 'NOT_FOUND',
          message: `Could not compute ranking for ${params.entityId}`,
        };
      }
      
      return {
        ok: true,
        data: result,
      };
    } catch (error) {
      app.log.error(error, '[Rankings V2] Token ranking error');
      return {
        ok: false,
        error: 'RANKING_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  app.log.info('Rankings V2 routes registered');
}
