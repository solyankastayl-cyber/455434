/**
 * Strategy Signals Routes
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './strategy_signals.service.js';
import {
  GetLatestStrategySignalsQuery,
  GetStrategySignalsByAddressParams,
  GetStrategySignalsByAddressQuery,
} from './strategy_signals.schema.js';

export async function strategySignalsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/strategy-signals/latest
   * Get latest strategy signals with optional filters
   */
  app.get('/latest', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = GetLatestStrategySignalsQuery.parse(request.query);
    
    const signals = await service.getLatestSignals(
      {
        type: query.type,
        window: query.window,
        strategyType: query.strategyType,
        minSeverity: query.minSeverity,
        minConfidence: query.minConfidence,
      },
      query.limit,
      query.offset
    );
    
    return { ok: true, data: signals, count: signals.length };
  });
  
  /**
   * GET /api/strategy-signals/address/:address
   * Get strategy signals for specific address
   */
  app.get('/address/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = GetStrategySignalsByAddressParams.parse(request.params);
    const query = GetStrategySignalsByAddressQuery.parse(request.query);
    
    const signals = await service.getSignalsByAddress(params.address, query.limit);
    
    return { ok: true, data: signals, count: signals.length };
  });
  
  /**
   * GET /api/strategy-signals/stats
   * Get strategy signals statistics
   */
  app.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const stats = await service.getStats();
    return { ok: true, data: stats };
  });
}
