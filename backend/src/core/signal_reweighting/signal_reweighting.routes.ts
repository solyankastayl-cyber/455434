/**
 * Signal Reweighting v1.1 Routes
 * 
 * API endpoints for signal weight management and monitoring.
 */
import { FastifyPluginAsync } from 'fastify';
import * as service from './signal_reweighting.service.js';
import { SignalType, SignalComponent } from './signal_reweighting.types.js';

const signalReweightingRoutes: FastifyPluginAsync = async (fastify) => {
  
  /**
   * GET /api/signal-reweighting/status
   * Get overall signal reweighting status
   */
  fastify.get('/status', async (request, reply) => {
    try {
      const stats = await service.getSignalReweightingStats();
      
      return reply.code(200).send({
        ok: true,
        data: stats,
      });
    } catch (err: any) {
      fastify.log.error(err, '[Signal Reweighting] Error getting status');
      return reply.code(500).send({
        ok: false,
        error: err.message,
      });
    }
  });
  
  /**
   * GET /api/signal-reweighting/weights
   * Get all signal weights with effectiveness
   */
  fastify.get('/weights', async (request, reply) => {
    try {
      const { horizon = '7d' } = request.query as { horizon?: '7d' | '30d' };
      
      const weights = await service.getAllSignalWeightsWithEffectiveness(horizon);
      
      return reply.code(200).send({
        ok: true,
        data: {
          horizon,
          weights,
        },
      });
    } catch (err: any) {
      fastify.log.error(err, '[Signal Reweighting] Error getting weights');
      return reply.code(500).send({
        ok: false,
        error: err.message,
      });
    }
  });
  
  /**
   * GET /api/signal-reweighting/weights/:signalType
   * Get specific signal weight and effectiveness
   */
  fastify.get<{ Params: { signalType: string }; Querystring: { horizon?: '7d' | '30d' } }>(
    '/weights/:signalType',
    async (request, reply) => {
      try {
        const { signalType } = request.params;
        const { horizon = '7d' } = request.query;
        
        const signalTypeEnum = signalType.toUpperCase() as SignalType;
        
        const effectiveness = await service.getSignalEffectiveness(signalTypeEnum, horizon);
        
        return reply.code(200).send({
          ok: true,
          data: {
            signalType: signalTypeEnum,
            horizon,
            effectiveness,
          },
        });
      } catch (err: any) {
        fastify.log.error(err, '[Signal Reweighting] Error getting signal weight');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * POST /api/signal-reweighting/reweight
   * Trigger manual batch reweighting
   */
  fastify.post<{ Body: { horizon?: '7d' | '30d'; lookbackHours?: number } }>(
    '/reweight',
    async (request, reply) => {
      try {
        const { horizon = '7d', lookbackHours = 24 } = request.body || {};
        
        const result = await service.batchReweighting(horizon, lookbackHours);
        
        return reply.code(200).send({
          ok: true,
          data: result,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Signal Reweighting] Error in manual reweighting');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * POST /api/signal-reweighting/reset/:signalType
   * Reset signal weight to base
   */
  fastify.post<{ 
    Params: { signalType: string }; 
    Body: { component?: SignalComponent } 
  }>(
    '/reset/:signalType',
    async (request, reply) => {
      try {
        const { signalType } = request.params;
        const { component } = request.body || {};
        
        const signalTypeEnum = signalType.toUpperCase() as SignalType;
        
        const success = await service.resetSignalWeight(signalTypeEnum, component);
        
        if (!success) {
          return reply.code(404).send({
            ok: false,
            error: 'Signal weight not found',
          });
        }
        
        return reply.code(200).send({
          ok: true,
          message: `Reset ${signalTypeEnum}${component ? `.${component}` : ''} to base weight`,
        });
      } catch (err: any) {
        fastify.log.error(err, '[Signal Reweighting] Error resetting weight');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
  /**
   * GET /api/signal-reweighting/effectiveness
   * Get effectiveness for all signal types
   */
  fastify.get<{ Querystring: { horizon?: '7d' | '30d' } }>(
    '/effectiveness',
    async (request, reply) => {
      try {
        const { horizon = '7d' } = request.query;
        
        const signalTypes: SignalType[] = [
          'DEX_FLOW',
          'WHALE_TRANSFER',
          'CONFLICT',
          'CORRIDOR_SPIKE',
          'BEHAVIOR_SHIFT',
        ];
        
        const effectiveness = [];
        
        for (const signalType of signalTypes) {
          const eff = await service.getSignalEffectiveness(signalType, horizon);
          if (eff) {
            effectiveness.push(eff);
          }
        }
        
        return reply.code(200).send({
          ok: true,
          data: {
            horizon,
            effectiveness,
          },
        });
      } catch (err: any) {
        fastify.log.error(err, '[Signal Reweighting] Error getting effectiveness');
        return reply.code(500).send({
          ok: false,
          error: err.message,
        });
      }
    }
  );
  
};

export default signalReweightingRoutes;
