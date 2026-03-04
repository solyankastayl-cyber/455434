/**
 * Wallet Routes - Pattern Detection API
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as patternService from './pattern_detection.service.js';

export async function routes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /wallets/:address/patterns
   * Analyze wallet for bot/farm patterns
   */
  app.get('/:address/patterns', async (request: FastifyRequest) => {
    const { address } = request.params as { address: string };
    
    try {
      const result = await patternService.analyzeWalletPatterns(address);
      
      // Remove internal confidence from response
      const { confidence, ...publicResult } = result;
      
      return {
        ok: true,
        data: publicResult
      };
    } catch (error) {
      console.error('[Wallets] Pattern detection error:', error);
      return {
        ok: false,
        error: 'PATTERN_ANALYSIS_FAILED'
      };
    }
  });
  
  app.get('/', async () => ({ ok: true, message: 'Wallet API' }));
}
