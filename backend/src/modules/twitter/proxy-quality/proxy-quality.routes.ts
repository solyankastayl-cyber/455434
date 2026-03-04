// P1: Proxy Quality Routes
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { proxyQualityService } from './proxy-quality.service.js';

export async function registerProxyQualityRoutes(app: FastifyInstance): Promise<void> {
  // Get proxy quality report
  app.get('/proxy/quality', async (req: FastifyRequest, reply: FastifyReply) => {
    const report = await proxyQualityService.getReport();
    return reply.send({ ok: true, data: report });
  });

  // Get quality for specific proxy
  app.get<{ Params: { slotId: string } }>(
    '/proxy/quality/:slotId',
    async (req, reply) => {
      const metrics = await proxyQualityService.getMetrics(req.params.slotId);
      if (!metrics) {
        return reply.status(404).send({ ok: false, error: 'Proxy not found' });
      }
      return reply.send({ ok: true, data: metrics });
    }
  );
}
