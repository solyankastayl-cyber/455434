/**
 * Personalized Routes (Phase 12B)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as service from './personalized.service.js';
import { z } from 'zod';
import { ADAPTIVE_VERSION } from '../../config/env.js';

const UpdatePreferencesBody = z.object({
  riskTolerance: z.number().min(0).max(1).optional(),
  preferredStrategies: z.array(z.string()).optional(),
  excludedStrategies: z.array(z.string()).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  timeHorizon: z.enum(['short', 'mid', 'long']).optional(),
  aggressiveness: z.number().min(0).max(1).optional(),
  alertThreshold: z.number().min(0).max(100).optional(),
  defaultView: z.enum(['market', 'actors', 'signals', 'watchlist']).optional(),
  showExplanations: z.boolean().optional(),
});

const RecordDecisionBody = z.object({
  signalId: z.string(),
  decision: z.enum(['follow', 'ignore', 'dismiss', 'watchlist']),
  context: z.object({
    signalType: z.string(),
    signalSeverity: z.number(),
    actorAddress: z.string(),
    strategyType: z.string().optional(),
    confidenceAtTime: z.number(),
    globalScoreAtTime: z.number(),
    personalizedScoreAtTime: z.number().optional(),
  }),
});

const CalculateScoreBody = z.object({
  globalScore: z.number(),
  strategyType: z.string().optional(),
  riskLevel: z.number().min(0).max(100),
  volatility: z.number().min(0).max(1),
  actorInfluence: z.number().min(0).max(100),
  signalMomentum: z.number().min(-1).max(1),
});

export async function personalizedRoutes(app: FastifyInstance): Promise<void> {
  // Add version header
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Adaptive-Version', ADAPTIVE_VERSION);
  });
  
  /**
   * GET /api/user/preferences
   * Get user preferences (uses mock userId for now)
   */
  app.get('/preferences', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const prefs = await service.getOrCreatePreferences(userId);
    return { ok: true, data: prefs };
  });
  
  /**
   * PUT /api/user/preferences
   * Update user preferences
   */
  app.put('/preferences', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const body = UpdatePreferencesBody.parse(request.body);
    const prefs = await service.updatePreferences(userId, body);
    return { ok: true, data: prefs };
  });
  
  /**
   * GET /api/user/bias
   * Get user learned bias
   */
  app.get('/bias', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const bias = await service.getOrCreateBias(userId);
    return { ok: true, data: bias };
  });
  
  /**
   * GET /api/user/stats
   * Get personalization stats
   */
  app.get('/stats', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const stats = await service.getUserPersonalizationStats(userId);
    return { ok: true, data: stats };
  });
  
  /**
   * POST /api/user/decision
   * Record user decision on a signal
   */
  app.post('/decision', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const body = RecordDecisionBody.parse(request.body);
    
    const outcome = await service.recordSignalDecision(
      userId,
      body.signalId,
      body.decision,
      body.context
    );
    
    return { ok: true, data: outcome };
  });
  
  /**
   * POST /api/user/score
   * Calculate personalized score for a signal
   */
  app.post('/score', async (request: FastifyRequest) => {
    const userId = (request.headers['x-user-id'] as string) || 'default';
    const body = CalculateScoreBody.parse(request.body);
    
    const result = await service.calculatePersonalizedScore(userId, body);
    
    return { ok: true, data: result };
  });
  
  app.log.info('Personalized routes registered');
}
