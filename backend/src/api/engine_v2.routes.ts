/**
 * Engine V2 API Routes
 * 
 * New endpoints for Engine V2 decision making
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { decideV2, getEngineHealth } from '../core/engine_v2/index.js';
import type { EngineWindow } from '../core/engine_v2/index.js';

export async function engineV2Routes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/engine/v2/decide
   * 
   * Make Engine V2 decision for a subject
   * 
   * Query params:
   *   - actor: Actor slug (e.g., "binance")
   *   - asset: Token address (e.g., "0x...")
   *   - window: Time window ("1h" | "6h" | "24h" | "7d")
   */
  app.get('/engine/v2/decide', async (request: FastifyRequest) => {
    const query = request.query as {
      actor?: string;
      asset?: string;
      window?: string;
    };
    
    const window = (['1h', '6h', '24h', '7d'].includes(query.window ?? '')
      ? query.window
      : '24h') as EngineWindow;
    
    try {
      const decision = await decideV2({
        actor: query.actor,
        asset: query.asset,
        window,
      });
      
      return {
        ok: true,
        data: decision,
      };
    } catch (error) {
      app.log.error(error, '[Engine V2] Decision error');
      return {
        ok: false,
        error: 'ENGINE_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  /**
   * GET /api/engine/v2/health
   * 
   * Get global engine health status
   */
  app.get('/engine/v2/health', async (request: FastifyRequest) => {
    const query = request.query as { window?: string };
    
    const window = (['1h', '6h', '24h', '7d'].includes(query.window ?? '')
      ? query.window
      : '24h') as EngineWindow;
    
    try {
      const health = await getEngineHealth(window);
      
      return {
        ok: true,
        data: health,
      };
    } catch (error) {
      app.log.error(error, '[Engine V2] Health check error');
      return {
        ok: false,
        error: 'ENGINE_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  /**
   * POST /api/engine/v2/analyze
   * 
   * Analyze multiple subjects (batch)
   */
  app.post('/engine/v2/analyze', async (request: FastifyRequest) => {
    const body = request.body as {
      subjects?: Array<{ actor?: string; asset?: string }>;
      window?: string;
    };
    
    if (!body.subjects || !Array.isArray(body.subjects)) {
      return {
        ok: false,
        error: 'INVALID_BODY',
        message: 'Body must contain "subjects" array',
      };
    }
    
    if (body.subjects.length > 20) {
      return {
        ok: false,
        error: 'TOO_MANY_SUBJECTS',
        message: 'Maximum 20 subjects per batch',
      };
    }
    
    const window = (['1h', '6h', '24h', '7d'].includes(body.window ?? '')
      ? body.window
      : '24h') as EngineWindow;
    
    try {
      const results = await Promise.all(
        body.subjects.map(s => decideV2({
          actor: s.actor,
          asset: s.asset,
          window,
        }))
      );
      
      return {
        ok: true,
        data: results,
        count: results.length,
      };
    } catch (error) {
      app.log.error(error, '[Engine V2] Batch analyze error');
      return {
        ok: false,
        error: 'ENGINE_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  
  app.log.info('Engine V2 routes registered');
}
