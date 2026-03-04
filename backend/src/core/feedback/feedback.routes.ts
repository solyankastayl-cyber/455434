/**
 * Feedback Routes
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './feedback.service.js';
import {
  SubmitDecisionFeedbackParams,
  SubmitActionFeedbackParams,
  SubmitSimulationFeedbackParams,
  SubmitFeedbackBody,
  GetFeedbackParams,
  GetHistoryQuery,
  TargetIdParams,
} from './feedback.schema.js';

function getUserId(request: FastifyRequest): string {
  return (request.headers['x-user-id'] as string) || 'anonymous';
}

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/feedback/decision/:decisionId
   * Submit feedback for decision
   */
  app.post('/decision/:decisionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const params = SubmitDecisionFeedbackParams.parse(request.params);
    const body = SubmitFeedbackBody.parse(request.body);
    
    const feedback = await service.submitDecisionFeedback(params.decisionId, userId, body);
    
    if (!feedback) {
      return reply.status(404).send({ ok: false, error: 'Decision not found' });
    }
    
    return { ok: true, data: feedback };
  });
  
  /**
   * POST /api/feedback/action/:actionId
   * Submit feedback for action
   */
  app.post('/action/:actionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const params = SubmitActionFeedbackParams.parse(request.params);
    const body = SubmitFeedbackBody.parse(request.body);
    
    const feedback = await service.submitActionFeedback(params.actionId, userId, body);
    
    if (!feedback) {
      return reply.status(404).send({ ok: false, error: 'Action not found' });
    }
    
    return { ok: true, data: feedback };
  });
  
  /**
   * POST /api/feedback/simulation/:simulationId
   * Submit feedback for simulation
   */
  app.post('/simulation/:simulationId', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const params = SubmitSimulationFeedbackParams.parse(request.params);
    const body = SubmitFeedbackBody.parse(request.body);
    
    const feedback = await service.submitSimulationFeedback(params.simulationId, userId, body);
    
    if (!feedback) {
      return reply.status(404).send({ ok: false, error: 'Simulation not found' });
    }
    
    return { ok: true, data: feedback };
  });
  
  /**
   * GET /api/feedback/:sourceId
   * Get feedback for source
   */
  app.get('/:sourceId', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const params = GetFeedbackParams.parse(request.params);
    
    const feedback = await service.getFeedback(params.sourceId, userId);
    
    if (!feedback) {
      return reply.status(404).send({ ok: false, error: 'Feedback not found' });
    }
    
    return { ok: true, data: feedback };
  });
  
  /**
   * GET /api/feedback/history
   * Get user's feedback history
   */
  app.get('/history', async (request: FastifyRequest) => {
    const userId = getUserId(request);
    const query = GetHistoryQuery.parse(request.query);
    
    const history = await service.getUserFeedbackHistory(userId, query.limit);
    
    return { ok: true, data: history, count: history.length };
  });
  
  /**
   * GET /api/feedback/target/:targetId/metrics
   * Get feedback metrics for target
   */
  app.get('/target/:targetId/metrics', async (request: FastifyRequest) => {
    const params = TargetIdParams.parse(request.params);
    
    const metrics = await service.getTargetFeedbackMetrics(params.targetId);
    
    return { ok: true, data: metrics };
  });
  
  /**
   * GET /api/feedback/tags
   * Get available feedback tags
   */
  app.get('/tags', async () => {
    const tags = service.getAvailableTags();
    return { ok: true, data: tags };
  });
  
  /**
   * GET /api/feedback/analysis
   * Get decision quality analysis
   */
  app.get('/analysis', async () => {
    const analysis = await service.analyzeDecisionQuality();
    return { ok: true, data: analysis };
  });
  
  /**
   * GET /api/feedback/stats
   * Get feedback statistics
   */
  app.get('/stats', async () => {
    const stats = await service.getStats();
    return { ok: true, data: stats };
  });
}
