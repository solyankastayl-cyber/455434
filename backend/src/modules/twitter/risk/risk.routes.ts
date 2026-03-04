// P1: Risk Routes
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { riskService } from './risk.service.js';
import { riskCalculator } from './risk.calculator.js';
import { lifetimeEstimator } from './risk.lifetime.js';
import { TwitterSessionModel } from '../sessions/session.model.js';

export async function registerRiskRoutes(app: FastifyInstance): Promise<void> {
  // Get risk report for all sessions
  app.get('/risk/report', async (req: FastifyRequest, reply: FastifyReply) => {
    const report = await riskService.getReport();
    return reply.send({ ok: true, data: report });
  });

  // Get risk details for specific session
  app.get<{ Params: { sessionId: string } }>(
    '/risk/session/:sessionId',
    async (req, reply) => {
      const session = await TwitterSessionModel.findOne({ 
        sessionId: req.params.sessionId 
      }).lean();

      if (!session) {
        return reply.status(404).send({ ok: false, error: 'Session not found' });
      }

      const factors = riskService.calculateFactors(session as any);
      const score = riskCalculator.calculate(factors);
      const breakdown = riskCalculator.getBreakdown(factors);
      const lifetime = lifetimeEstimator.estimateDetailed(score);

      return reply.send({
        ok: true,
        data: {
          sessionId: session.sessionId,
          status: session.status,
          riskScore: score,
          factors,
          breakdown,
          lifetime,
          lastCheckedAt: session.lastCheckedAt,
        },
      });
    }
  );

  // Recalculate risk for all sessions
  app.post('/risk/recalculate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await riskService.updateAllSessions();
      return reply.send({ ok: true, ...result });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // Recalculate risk for specific session
  app.post<{ Params: { sessionId: string } }>(
    '/risk/recalculate/:sessionId',
    async (req, reply) => {
      const session = await TwitterSessionModel.findOne({ 
        sessionId: req.params.sessionId 
      });

      if (!session) {
        return reply.status(404).send({ ok: false, error: 'Session not found' });
      }

      try {
        const result = await riskService.updateSession(session);
        return reply.send({ ok: true, ...result });
      } catch (error: any) {
        return reply.status(500).send({ ok: false, error: error.message });
      }
    }
  );
}
