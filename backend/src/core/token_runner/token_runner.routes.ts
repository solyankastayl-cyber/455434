/**
 * Token Runner Routes (Stage C)
 * 
 * API endpoints for batch token analysis
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  runTokenRunner,
  getTokenAnalysis,
  getAnalysisStats,
  getTopByEngineScore,
} from './token_runner.service.js';
import { TokenAnalysisModel } from './token_analysis.model.js';

export async function tokenRunnerRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/token-runner/run
   * Trigger batch token analysis
   */
  app.post('/token-runner/run', async (request: FastifyRequest) => {
    const body = request.body as {
      batchSize?: number;
      mode?: 'fast' | 'deep';
    } || {};
    
    try {
      const result = await runTokenRunner({
        batchSize: body.batchSize || 25,
        analysisMode: body.mode || 'fast',
      });
      
      return {
        ok: true,
        data: result,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Token runner failed',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/token-runner/stats
   * Get analysis statistics
   */
  app.get('/token-runner/stats', async () => {
    try {
      const stats = await getAnalysisStats();
      
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
   * GET /api/token-runner/analysis/:symbol
   * Get latest analysis for specific token
   */
  app.get('/token-runner/analysis/:symbol', async (request: FastifyRequest) => {
    const { symbol } = request.params as { symbol: string };
    
    try {
      const analysis = await getTokenAnalysis(symbol);
      
      if (!analysis) {
        return {
          ok: false,
          error: 'No analysis found for this token',
        };
      }
      
      return {
        ok: true,
        data: analysis,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get analysis',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/token-runner/top
   * Get top tokens by engine score
   */
  app.get('/token-runner/top', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string };
    
    try {
      const limit = Math.min(parseInt(query.limit || '20'), 100);
      const tokens = await getTopByEngineScore(limit);
      
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
   * GET /api/token-runner/analyses
   * Get all analyses with pagination
   */
  app.get('/token-runner/analyses', async (request: FastifyRequest) => {
    const query = request.query as {
      status?: string;
      label?: string;
      limit?: string;
      offset?: string;
    };
    
    try {
      const filter: any = {};
      
      if (query.status) {
        filter.status = query.status;
      }
      
      if (query.label) {
        filter.engineLabel = query.label.toUpperCase();
      }
      
      const limit = Math.min(parseInt(query.limit || '50'), 100);
      const offset = parseInt(query.offset || '0');
      
      const [analyses, total] = await Promise.all([
        TokenAnalysisModel.find(filter)
          .sort({ engineScore: -1 })
          .limit(limit)
          .skip(offset)
          .select('-_id symbol contractAddress engineScore confidence risk engineLabel engineStrength analyzedAt status')
          .lean(),
        TokenAnalysisModel.countDocuments(filter),
      ]);
      
      return {
        ok: true,
        data: {
          analyses,
          total,
          limit,
          offset,
          hasMore: offset + analyses.length < total,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get analyses',
        details: err.message,
      };
    }
  });
  
  app.log.info('[Token Runner] Routes registered');
}
