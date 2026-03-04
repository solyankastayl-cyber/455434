// TwitterEgressSlot Controller - v4.0 Parser Control Plane
// Admin API endpoints for Egress Slots

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TwitterEgressSlotService } from '../services/twitterEgressSlot.service.js';
import { TwitterAccountService } from '../services/twitterAccount.service.js';
import {
  CreateTwitterEgressSlotDto,
  UpdateTwitterEgressSlotDto,
  BindAccountDto,
} from '../dto/twitterEgressSlot.dto.js';

export function registerTwitterEgressSlotRoutes(
  fastify: FastifyInstance,
  slotService: TwitterEgressSlotService,
  accountService: TwitterAccountService
) {
  // GET /slots - List all slots
  fastify.get('/slots', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { enabled, type } = request.query as { enabled?: string; type?: string };
      const slots = await slotService.list({
        enabled: enabled !== undefined ? enabled === 'true' : undefined,
        type: type as any,
      });
      return { ok: true, data: slots, total: slots.length };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // GET /slots/:id - Get slot by ID
  fastify.get('/slots/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const slot = await slotService.getById(id);
      if (!slot) {
        return reply.status(404).send({ ok: false, error: 'Slot not found' });
      }
      return { ok: true, data: slot };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /slots - Create slot
  fastify.post('/slots', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const dto = request.body as CreateTwitterEgressSlotDto;
      if (!dto.label) {
        return reply.status(400).send({ ok: false, error: 'Label is required' });
      }
      if (!dto.type || !['PROXY', 'REMOTE_WORKER'].includes(dto.type)) {
        return reply.status(400).send({ ok: false, error: 'Type must be PROXY or REMOTE_WORKER' });
      }
      
      // Validate proxy/worker config
      if (dto.type === 'PROXY' && !dto.proxy?.url) {
        // Allow PROXY without URL for dev/testing (uses host IP)
      }
      if (dto.type === 'REMOTE_WORKER' && !dto.worker?.baseUrl) {
        return reply.status(400).send({ ok: false, error: 'Worker baseUrl is required for REMOTE_WORKER type' });
      }

      const slot = await slotService.create(dto);
      return reply.status(201).send({ ok: true, data: slot });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // PATCH /slots/:id - Update slot
  fastify.patch('/slots/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const dto = request.body as UpdateTwitterEgressSlotDto;
      const slot = await slotService.update(id, dto);
      if (!slot) {
        return reply.status(404).send({ ok: false, error: 'Slot not found' });
      }
      return { ok: true, data: slot };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /slots/:id/enable - Enable slot
  fastify.post('/slots/:id/enable', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const slot = await slotService.enable(id);
      if (!slot) {
        return reply.status(404).send({ ok: false, error: 'Slot not found' });
      }
      return { ok: true, data: slot };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /slots/:id/disable - Disable slot
  fastify.post('/slots/:id/disable', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const slot = await slotService.disable(id);
      if (!slot) {
        return reply.status(404).send({ ok: false, error: 'Slot not found' });
      }
      return { ok: true, data: slot };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /slots/:id/bind-account - Bind account to slot
  fastify.post('/slots/:id/bind-account', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { accountId } = request.body as BindAccountDto;
      
      if (!accountId) {
        return reply.status(400).send({ ok: false, error: 'accountId is required' });
      }

      const slot = await slotService.bindAccount(id, accountId);
      if (!slot) {
        return reply.status(404).send({ ok: false, error: 'Slot or account not found' });
      }
      return { ok: true, data: slot };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /slots/:id/unbind-account - Unbind account from slot
  fastify.post('/slots/:id/unbind-account', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const slot = await slotService.unbindAccount(id);
      if (!slot) {
        return reply.status(404).send({ ok: false, error: 'Slot not found' });
      }
      return { ok: true, data: slot };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // DELETE /slots/:id - Delete slot
  fastify.delete('/slots/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await slotService.delete(id);
      if (!deleted) {
        return reply.status(404).send({ ok: false, error: 'Slot not found' });
      }
      return { ok: true, message: 'Slot deleted' };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /slots/:id/reset-window - Reset usage window (dev only)
  fastify.post('/slots/:id/reset-window', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      await slotService.resetUsageWindow(id);
      const slot = await slotService.getById(id);
      if (!slot) {
        return reply.status(404).send({ ok: false, error: 'Slot not found' });
      }
      return { ok: true, data: slot, message: 'Usage window reset' };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // GET /monitor - Get aggregated stats
  fastify.get('/monitor', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [slotStats, accountStats] = await Promise.all([
        slotService.getStats(),
        accountService.countByStatus(),
      ]);

      return {
        ok: true,
        data: {
          totalAccounts: accountStats.total,
          activeAccounts: accountStats.active,
          totalSlots: slotStats.totalSlots,
          enabledSlots: slotStats.enabledSlots,
          healthySlots: slotStats.healthySlots,
          degradedSlots: slotStats.degradedSlots,
          errorSlots: slotStats.errorSlots,
          totalCapacityPerHour: slotStats.totalCapacityPerHour,
          usedThisHour: slotStats.usedThisHour,
          availableThisHour: slotStats.totalCapacityPerHour - slotStats.usedThisHour,
        },
      };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });
}
