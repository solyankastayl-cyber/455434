/**
 * Token Profile Routes (Phase 15.5)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as tokenProfileService from './token_profile.service.js';
import * as cohortsService from './cohorts.service.js';

export async function tokenProfileRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/tokens/:address/profile
   * Get comprehensive token profile
   */
  app.get('/:address/profile', async (request: FastifyRequest) => {
    const { address } = request.params as { address: string };
    const query = request.query as { chain?: string };
    
    const profile = await tokenProfileService.getTokenProfile(
      address,
      query.chain || 'ethereum'
    );
    
    if (!profile) {
      return {
        ok: false,
        error: 'TOKEN_NOT_FOUND',
        message: 'No data available for this token',
      };
    }
    
    return {
      ok: true,
      data: profile,
    };
  });
  
  /**
   * GET /api/tokens/:address/cohorts
   * Get wallet cohorts for a specific token
   * 
   * Query params:
   * - window: '7d' | '30d' (default: '7d')
   * 
   * Returns:
   * - Cohort metrics (Early/Mid/New wallets)
   * - Holdings distribution by cohort
   * - Flows between cohorts
   * - Fact-based interpretation
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
        error: 'COHORTS_CALCULATION_FAILED',
        message: 'Failed to calculate wallet cohorts',
      };
    }
  });
  
  /**
   * POST /api/tokens/profiles/batch
   * Get multiple token profiles
   */
  app.post('/profiles/batch', async (request: FastifyRequest) => {
    const body = request.body as { addresses?: string[]; chain?: string };
    
    if (!body.addresses || !Array.isArray(body.addresses)) {
      return {
        ok: false,
        error: 'INVALID_BODY',
        message: 'Body must contain "addresses" array',
      };
    }
    
    if (body.addresses.length > 20) {
      return {
        ok: false,
        error: 'TOO_MANY_ADDRESSES',
        message: 'Maximum 20 addresses per batch',
      };
    }
    
    const profiles = await tokenProfileService.getTokenProfiles(
      body.addresses,
      body.chain || 'ethereum'
    );
    
    return {
      ok: true,
      data: profiles,
      count: profiles.length,
    };
  });
  
  /**
   * GET /api/tokens/trending
   * Get trending tokens by signal activity
   */
  app.get('/trending', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string; timeframe?: string };
    
    const limit = Math.min(50, parseInt(query.limit || '10'));
    const timeframe = (query.timeframe || '24h') as '1h' | '24h' | '7d';
    
    if (!['1h', '24h', '7d'].includes(timeframe)) {
      return {
        ok: false,
        error: 'INVALID_TIMEFRAME',
        message: 'Timeframe must be 1h, 24h, or 7d',
      };
    }
    
    const trending = await tokenProfileService.getTrendingTokens(limit, timeframe);
    
    return {
      ok: true,
      data: trending,
      count: trending.length,
    };
  });
  
  /**
   * GET /api/tokens/:chainId/:address/key-wallets
   * Get key wallets for a specific token (Layer 0 - Research)
   * 
   * Query params:
   * - window: '24h' | '7d' | '30d' (default: '24h')
   * - limit: number (default: 10, max: 20)
   * 
   * Returns:
   * - Top wallets by volume share
   * - Rule-based roles (Accumulator/Distributor/Mixed/Passive)
   * - Net flow and transaction counts
   * - NO ML, NO predictions, NO intent
   */
  app.get('/:chainId/:address/key-wallets', async (request: FastifyRequest) => {
    const { chainId, address } = request.params as { chainId: string; address: string };
    const { window: windowParam, limit: limitParam } = request.query as { 
      window?: string; 
      limit?: string; 
    };
    
    const chainIdNum = parseInt(chainId);
    if (isNaN(chainIdNum)) {
      return {
        ok: false,
        error: 'INVALID_CHAIN_ID',
        message: 'chainId must be a valid number',
      };
    }
    
    // Validate time window
    const validWindows = ['24h', '7d', '30d'];
    const timeWindow = validWindows.includes(windowParam || '') ? windowParam! : '24h';
    
    // Validate limit
    const limit = Math.min(20, Math.max(1, parseInt(limitParam || '10') || 10));
    
    try {
      const { getKeyWallets } = await import('./key_wallets.service.js');
      const result = await getKeyWallets(chainIdNum, address, timeWindow, limit);
      
      return {
        ok: true,
        data: result,
      };
    } catch (error) {
      console.error('[Tokens] Key wallets error:', error);
      return {
        ok: false,
        error: 'KEY_WALLETS_FAILED',
        message: 'Failed to fetch key wallets data',
      };
    }
  });
  
  app.log.info('Token profile routes registered');
}
