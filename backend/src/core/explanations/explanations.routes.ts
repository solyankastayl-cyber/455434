/**
 * Explanations Routes
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { explainScore } from './score_explain.service.js';
import { explainStrategy } from './strategy_explain.service.js';
import { explainAlert } from './alert_explain.service.js';
import {
  ExplainScoreParams,
  ExplainScoreQuery,
  ExplainStrategyParams,
  ExplainAlertParams,
} from './explanations.schema.js';

export async function explanationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/explain/score/:address
   * Explain score for an address
   */
  app.get('/score/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = ExplainScoreParams.parse(request.params);
    const query = ExplainScoreQuery.parse(request.query);
    
    const explanation = await explainScore(params.address, query.window);
    
    if (!explanation) {
      return reply.status(404).send({ ok: false, error: 'Score not found for address' });
    }
    
    return { ok: true, data: explanation };
  });
  
  /**
   * GET /api/explain/strategy/:address
   * Explain strategy for an address
   */
  app.get('/strategy/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = ExplainStrategyParams.parse(request.params);
    
    const explanation = await explainStrategy(params.address);
    
    if (!explanation) {
      return reply.status(404).send({ ok: false, error: 'Strategy not found for address' });
    }
    
    return { ok: true, data: explanation };
  });
  
  /**
   * GET /api/explain/alert/:id
   * Explain why an alert was triggered
   */
  app.get('/alert/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = ExplainAlertParams.parse(request.params);
    
    const explanation = await explainAlert(params.id);
    
    if (!explanation) {
      return reply.status(404).send({ ok: false, error: 'Alert not found' });
    }
    
    return { ok: true, data: explanation };
  });
}
