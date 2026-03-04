/**
 * Token Routes - Wallet Cohorts API
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as cohortsService from './cohorts.service.js';

export async function routes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /tokens/:address/cohorts
   * Get wallet cohorts for a specific token
   * 
   * Query params:
   * - window: '7d' | '30d' (default: '7d')
   */
  app.get('/:address/cohorts', async (request: FastifyRequest) => {
    const { address } = request.params as { address: string };
    const { window: windowParam } = request.query as { window?: string };
    
    const windowDays = windowParam === '30d' ? 30 : 7;
    
    try {
      const result = await cohortsService.calculateTokenCohorts(address, windowDays);
      
      return {
        ok: true,
        data: result,
      };
    } catch (error) {
      console.error('[Tokens] Cohorts calculation error:', error);
      return {
        ok: false,
        error: 'Failed to calculate cohorts',
      };
    }
  });
  
  // Placeholder for other token routes
  app.get('/', async () => ({ ok: true, message: 'Token API' }));
}
