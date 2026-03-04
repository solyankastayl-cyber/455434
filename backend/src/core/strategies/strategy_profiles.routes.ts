/**
 * Strategy Profiles Routes
 * API endpoints for strategy profiles
 * 
 * Base path: /api/strategies
 */
import type { FastifyInstance } from 'fastify';
import { 
  strategyProfilesService, 
  formatStrategyProfile 
} from './strategy_profiles.service.js';
import { 
  StrategyType, 
  RiskLevel, 
  InfluenceLevel,
  STRATEGY_DISPLAY_NAMES,
  STRATEGY_DESCRIPTIONS 
} from './strategy_profiles.model.js';
import type { StrategySortEnum } from './strategy_profiles.schema.js';

/**
 * Strategy Profiles Routes
 */
export async function strategyProfilesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /top - Get top strategy profiles
   */
  app.get<{
    Querystring: {
      type?: string;
      riskLevel?: string;
      influenceLevel?: string;
      minConfidence?: string;
      sort?: string;
      limit?: string;
      offset?: string;
      chain?: string;
    };
  }>('/top', async (request) => {
    const {
      type,
      riskLevel,
      influenceLevel,
      minConfidence,
      sort = 'confidence',
      limit = '50',
      offset = '0',
      chain = 'ethereum',
    } = request.query;

    const result = await strategyProfilesService.getTop({
      type: type as StrategyType | undefined,
      riskLevel: riskLevel as RiskLevel | undefined,
      influenceLevel: influenceLevel as InfluenceLevel | undefined,
      minConfidence: minConfidence ? parseFloat(minConfidence) : undefined,
      sort: sort as StrategySortEnum,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      chain,
    });

    return {
      ok: true,
      data: {
        profiles: result.profiles.map(formatStrategyProfile),
        total: result.total,
      },
    };
  });

  /**
   * GET /address/:address - Get profile for address
   */
  app.get<{
    Params: { address: string };
    Querystring: { chain?: string };
  }>('/address/:address', async (request, reply) => {
    const { address } = request.params;
    const { chain = 'ethereum' } = request.query;

    // Validate address
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.status(400).send({
        ok: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid address format',
      });
    }

    const profile = await strategyProfilesService.getByAddress(address, chain);

    if (!profile) {
      return reply.status(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: 'No strategy profile found for this address',
      });
    }

    return {
      ok: true,
      data: formatStrategyProfile(profile),
    };
  });

  /**
   * GET /type/:strategyType - Get profiles by strategy type
   */
  app.get<{
    Params: { strategyType: string };
    Querystring: { limit?: string; minConfidence?: string; chain?: string };
  }>('/type/:strategyType', async (request, reply) => {
    const { strategyType } = request.params;
    const { limit = '50', minConfidence = '0', chain = 'ethereum' } = request.query;

    // Validate strategy type
    const validTypes = [
      'accumulation_sniper',
      'distribution_whale',
      'momentum_rider',
      'rotation_trader',
      'wash_operator',
      'liquidity_farmer',
      'mixed',
    ];
    if (!validTypes.includes(strategyType)) {
      return reply.status(400).send({
        ok: false,
        error: 'VALIDATION_ERROR',
        message: `Invalid strategy type. Valid types: ${validTypes.join(', ')}`,
      });
    }

    const profiles = await strategyProfilesService.getByStrategyType(
      strategyType as StrategyType,
      {
        limit: parseInt(limit, 10),
        minConfidence: parseFloat(minConfidence),
        chain,
      }
    );

    return {
      ok: true,
      data: {
        strategyType,
        strategyName: STRATEGY_DISPLAY_NAMES[strategyType as StrategyType],
        strategyDescription: STRATEGY_DESCRIPTIONS[strategyType as StrategyType],
        profiles: profiles.map(formatStrategyProfile),
        total: profiles.length,
      },
    };
  });

  /**
   * GET /stats - Get strategy statistics
   */
  app.get<{
    Querystring: { chain?: string };
  }>('/stats', async (request) => {
    const { chain = 'ethereum' } = request.query;
    const stats = await strategyProfilesService.getStats(chain);

    return {
      ok: true,
      data: stats,
    };
  });

  /**
   * GET /types - Get all strategy types with descriptions
   */
  app.get('/types', async () => {
    const types = Object.entries(STRATEGY_DISPLAY_NAMES).map(([type, name]) => ({
      type,
      name,
      description: STRATEGY_DESCRIPTIONS[type as StrategyType],
    }));

    return {
      ok: true,
      data: types,
    };
  });

  app.log.info('Strategy Profiles routes registered');
}

// Export as 'routes' for consistency
export { strategyProfilesRoutes as routes };
