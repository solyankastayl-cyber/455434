// ProxySlot Controller - MULTI Architecture
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { proxySlotService, CreateProxySlotDTO, UpdateProxySlotDTO } from './proxy-slot.service.js';

export async function registerProxySlotRoutes(app: FastifyInstance): Promise<void> {
  // Get all slots
  app.get('/slots', async (req: FastifyRequest, reply: FastifyReply) => {
    // Recover cooldowns first
    await proxySlotService.checkAndRecoverCooldowns();

    const slots = await proxySlotService.findAll();
    const counts = await proxySlotService.count();
    return reply.send({ ok: true, data: slots, stats: counts });
  });

  // Get available slots (for execution)
  app.get('/slots/available', async (req, reply) => {
    await proxySlotService.checkAndRecoverCooldowns();
    const slots = await proxySlotService.findAvailable();
    return reply.send({ ok: true, data: slots, count: slots.length });
  });

  // Get single slot
  app.get<{ Params: { id: string } }>('/slots/:id', async (req, reply) => {
    const slot = await proxySlotService.findById(req.params.id);
    if (!slot) {
      return reply.status(404).send({ ok: false, error: 'Slot not found' });
    }
    return reply.send({ ok: true, data: slot });
  });

  // Create slot
  app.post<{ Body: CreateProxySlotDTO }>('/slots', async (req, reply) => {
    try {
      const slot = await proxySlotService.create(req.body);
      return reply.status(201).send({ ok: true, data: slot });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // Update slot
  app.put<{ Params: { id: string }; Body: UpdateProxySlotDTO }>('/slots/:id', async (req, reply) => {
    const slot = await proxySlotService.update(req.params.id, req.body);
    if (!slot) {
      return reply.status(404).send({ ok: false, error: 'Slot not found' });
    }
    return reply.send({ ok: true, data: slot });
  });

  // Delete slot
  app.delete<{ Params: { id: string } }>('/slots/:id', async (req, reply) => {
    const deleted = await proxySlotService.delete(req.params.id);
    if (!deleted) {
      return reply.status(404).send({ ok: false, error: 'Slot not found' });
    }
    return reply.send({ ok: true, message: 'Slot deleted' });
  });

  // Change status
  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/slots/:id/status',
    async (req, reply) => {
      const { status } = req.body;
      if (!['ACTIVE', 'COOLDOWN', 'DISABLED', 'ERROR'].includes(status)) {
        return reply.status(400).send({ ok: false, error: 'Invalid status' });
      }
      await proxySlotService.setStatus(req.params.id, status as any);
      return reply.send({ ok: true, message: `Status changed to ${status}` });
    }
  );

  // Test slot connectivity
  app.post<{ Params: { id: string } }>('/slots/:id/test', async (req, reply) => {
    const slot = await proxySlotService.findById(req.params.id);
    if (!slot) {
      return reply.status(404).send({ ok: false, error: 'Slot not found' });
    }

    // Simple connectivity test
    try {
      const proxyUrl = proxySlotService.getProxyUrl(slot);
      // TODO: Add actual proxy test via fetch
      return reply.send({
        ok: true,
        data: {
          host: slot.host,
          port: slot.port,
          proxyUrl: proxyUrl.replace(/:[^:@]+@/, ':***@'), // Hide password
          status: 'reachable',
        },
      });
    } catch (error: any) {
      await proxySlotService.setError(req.params.id, error.message);
      return reply.send({
        ok: true,
        data: { status: 'unreachable', error: error.message },
      });
    }
  });

  // Manual cooldown recovery
  app.post('/slots/recover-cooldowns', async (req, reply) => {
    const recovered = await proxySlotService.checkAndRecoverCooldowns();
    return reply.send({ ok: true, recovered });
  });
}
