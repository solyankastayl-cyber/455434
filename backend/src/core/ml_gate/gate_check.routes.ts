/**
 * Gate Check API Routes
 * 
 * POST /api/ml-gate/check/run - Run gate check
 * GET /api/ml-gate/check/status - Get latest status
 * GET /api/ml-gate/check/history - Get history
 */

import type { FastifyPluginAsync } from 'fastify';
import { runGateCheck, getGateStatus, getGateHistory, isTrainingAllowed } from './gate_check.runner.js';

export const gateCheckRoutes: FastifyPluginAsync = async (app) => {
  // Run gate check (admin)
  app.post('/check/run', async (req, reply) => {
    const body = req.body as { horizon?: string; dryRun?: boolean };
    const horizon = (body.horizon === '30d' ? '30d' : '7d') as '7d' | '30d';
    const dryRun = body.dryRun ?? false;
    
    try {
      const result = await runGateCheck({ horizon, dryRun });
      return reply.send({ ok: true, data: result });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ 
        ok: false, 
        error: 'GATE_CHECK_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });
  
  // Get latest status
  app.get('/check/status', async (req, reply) => {
    const query = req.query as { horizon?: string };
    const horizon = (query.horizon === '30d' ? '30d' : '7d') as '7d' | '30d';
    
    const status = await getGateStatus(horizon);
    const allowed = await isTrainingAllowed(horizon);
    
    return reply.send({
      ok: true,
      data: {
        latest: status,
        trainingAllowed: allowed,
      }
    });
  });
  
  // Get history
  app.get('/check/history', async (req, reply) => {
    const query = req.query as { horizon?: string; limit?: string };
    const horizon = (query.horizon === '30d' ? '30d' : '7d') as '7d' | '30d';
    const limit = Math.min(parseInt(query.limit || '20', 10), 100);
    
    const history = await getGateHistory(horizon, limit);
    
    return reply.send({
      ok: true,
      data: history,
      count: history.length,
    });
  });
  
  // Quick check for training permission
  app.get('/training-allowed', async (req, reply) => {
    const query = req.query as { horizon?: string };
    const horizon = (query.horizon === '30d' ? '30d' : '7d') as '7d' | '30d';
    
    const allowed = await isTrainingAllowed(horizon);
    
    return reply.send({
      ok: true,
      horizon,
      trainingAllowed: allowed,
    });
  });
};
