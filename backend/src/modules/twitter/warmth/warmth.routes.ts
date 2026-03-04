// P1: Warmth Routes
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { warmthWorker } from './warmth.worker.js';
import { warmthService } from './warmth.service.js';

export async function registerWarmthRoutes(app: FastifyInstance): Promise<void> {
  // Get warmth status for all sessions
  app.get('/warmth/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const sessions = await warmthService.getSessionsNeedingWarmth();
    return reply.send({
      ok: true,
      needingWarmth: sessions.length,
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        lastWarmthAt: s.lastWarmthAt,
        lastUsedAt: s.lastUsedAt,
        status: s.status,
      })),
    });
  });

  // Run warmth on all eligible sessions
  app.post('/warmth/run', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await warmthWorker.runAll();
      return reply.send({ ok: true, ...result });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // Run warmth on specific session
  app.post<{ Params: { sessionId: string } }>(
    '/warmth/run/:sessionId',
    async (req, reply) => {
      try {
        const result = await warmthWorker.runOne(req.params.sessionId);
        return reply.send({ ok: true, result });
      } catch (error: any) {
        return reply.status(500).send({ ok: false, error: error.message });
      }
    }
  );
}
