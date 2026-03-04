/**
 * Shadow Mode API Routes
 * 
 * V1 vs V2 comparison endpoints
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  getShadowMetrics,
  evaluateKillSwitch,
  getRecentComparisons,
  compareV1V2,
} from '../core/shadow/index.js';
import type { EngineWindow } from '../core/engine_v2/index.js';

const VALID_WINDOWS = ['1h', '6h', '24h', '7d'];

export async function shadowRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/shadow/summary
   * 
   * Get shadow mode metrics summary
   */
  app.get('/shadow/summary', async (request: FastifyRequest) => {
    const query = request.query as { window?: string };
    
    const window = (VALID_WINDOWS.includes(query.window ?? '')
      ? query.window
      : '24h') as EngineWindow;
    
    try {
      const metrics = await getShadowMetrics(window);
      const killSwitch = evaluateKillSwitch(metrics);
      
      return {
        ok: true,
        data: {
          metrics,
          killSwitch,
        },
      };
    } catch (error) {
      app.log.error(error, '[Shadow] Summary error');
      return {
        ok: false,
        error: 'SHADOW_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  /**
   * GET /api/shadow/comparisons
   * 
   * Get recent shadow comparisons
   */
  app.get('/shadow/comparisons', async (request: FastifyRequest) => {
    const query = request.query as { window?: string; limit?: string };
    
    const window = (VALID_WINDOWS.includes(query.window ?? '')
      ? query.window
      : '24h') as EngineWindow;
    
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
    
    try {
      const comparisons = await getRecentComparisons(window, limit);
      
      return {
        ok: true,
        data: comparisons.map(c => ({
          subject: c.subject,
          window: c.window,
          v1: c.v1,
          v2: c.v2,
          diff: c.diff,
          computedAt: c.computedAt,
        })),
        count: comparisons.length,
      };
    } catch (error) {
      app.log.error(error, '[Shadow] Comparisons error');
      return {
        ok: false,
        error: 'SHADOW_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  /**
   * GET /api/shadow/kill-switch
   * 
   * Get kill switch status
   */
  app.get('/shadow/kill-switch', async (request: FastifyRequest) => {
    const query = request.query as { window?: string };
    
    const window = (VALID_WINDOWS.includes(query.window ?? '')
      ? query.window
      : '24h') as EngineWindow;
    
    try {
      const metrics = await getShadowMetrics(window);
      const killSwitch = evaluateKillSwitch(metrics);
      
      return {
        ok: true,
        data: killSwitch,
      };
    } catch (error) {
      app.log.error(error, '[Shadow] Kill switch error');
      return {
        ok: false,
        error: 'SHADOW_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  /**
   * POST /api/shadow/compare
   * 
   * Manually trigger a V1 vs V2 comparison
   */
  app.post('/shadow/compare', async (request: FastifyRequest) => {
    const body = request.body as {
      subjectKind?: 'entity' | 'actor' | 'wallet';
      subjectId?: string;
      window?: string;
    } ?? {};
    
    if (!body.subjectId) {
      return {
        ok: false,
        error: 'MISSING_PARAM',
        message: 'subjectId is required',
      };
    }
    
    const window = (VALID_WINDOWS.includes(body.window ?? '')
      ? body.window
      : '24h') as EngineWindow;
    
    const subjectKind = body.subjectKind || 'entity';
    
    try {
      const snapshot = await compareV1V2(subjectKind, body.subjectId, window);
      
      if (!snapshot) {
        return {
          ok: false,
          error: 'COMPARE_FAILED',
          message: 'Could not compare V1 vs V2',
        };
      }
      
      return {
        ok: true,
        data: {
          subject: snapshot.subject,
          window: snapshot.window,
          v1: snapshot.v1,
          v2: snapshot.v2,
          diff: snapshot.diff,
          computedAt: snapshot.computedAt,
        },
      };
    } catch (error) {
      app.log.error(error, '[Shadow] Compare error');
      return {
        ok: false,
        error: 'SHADOW_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  app.log.info('Shadow Mode routes registered');
}
