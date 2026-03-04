/**
 * Simulations Routes
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './simulations.service.js';
import {
  GetSimulationsQuery,
  SimulationIdParams,
  TargetIdParams,
  InvalidateBody,
} from './simulations.schema.js';

export async function simulationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/simulations
   * Get active simulations
   */
  app.get('/', async (request: FastifyRequest) => {
    const query = GetSimulationsQuery.parse(request.query);
    
    const simulations = await service.getActiveSimulations(query.limit);
    
    return { ok: true, data: simulations, count: simulations.length };
  });
  
  /**
   * GET /api/simulations/target/:targetId
   * Get simulations for target
   */
  app.get('/target/:targetId', async (request: FastifyRequest) => {
    const params = TargetIdParams.parse(request.params);
    const query = GetSimulationsQuery.parse(request.query);
    
    const simulations = await service.getSimulationsForTarget(params.targetId, query.limit);
    
    return { ok: true, data: simulations, count: simulations.length };
  });
  
  /**
   * GET /api/simulations/target/:targetId/performance
   * Get performance summary for target
   */
  app.get('/target/:targetId/performance', async (request: FastifyRequest) => {
    const params = TargetIdParams.parse(request.params);
    
    const summary = await service.getPerformanceSummary(params.targetId);
    
    return { ok: true, data: summary };
  });
  
  /**
   * GET /api/simulations/:id
   * Get simulation by ID
   */
  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = SimulationIdParams.parse(request.params);
    
    const simulation = await service.getSimulationForDecision(params.id);
    
    if (!simulation) {
      return reply.status(404).send({ ok: false, error: 'Simulation not found' });
    }
    
    return { ok: true, data: simulation };
  });
  
  /**
   * POST /api/simulations/:id/complete
   * Complete simulation
   */
  app.post('/:id/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = SimulationIdParams.parse(request.params);
    
    const simulation = await service.completeSimulation(params.id);
    
    if (!simulation) {
      return reply.status(404).send({ ok: false, error: 'Simulation not found or already completed' });
    }
    
    return { ok: true, data: simulation };
  });
  
  /**
   * POST /api/simulations/:id/invalidate
   * Invalidate simulation
   */
  app.post('/:id/invalidate', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = SimulationIdParams.parse(request.params);
    const body = InvalidateBody.parse(request.body);
    
    const simulation = await service.invalidateSimulation(params.id, body.reason);
    
    if (!simulation) {
      return reply.status(404).send({ ok: false, error: 'Simulation not found' });
    }
    
    return { ok: true, data: simulation };
  });
  
  /**
   * GET /api/simulations/stats
   * Get simulations statistics
   */
  app.get('/stats', async () => {
    const stats = await service.getStats();
    return { ok: true, data: stats };
  });
}
