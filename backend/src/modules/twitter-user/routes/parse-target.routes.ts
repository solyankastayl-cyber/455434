/**
 * Parse Targets API Routes
 * 
 * User-scoped CRUD for parse targets
 */

import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/require-user.hook.js';
import { TwitterParseTargetService, type CreateTargetDTO, type UpdateTargetDTO } from '../services/parse-target.service.js';

export async function registerParseTargetRoutes(app: FastifyInstance) {
  const targetService = new TwitterParseTargetService();

  /**
   * GET /api/v4/twitter/targets
   * List all user targets
   */
  app.get('/api/v4/twitter/targets', async (req, reply) => {
    try {
      const u = requireUser(req);
      const targets = await targetService.list(u.id);
      const stats = await targetService.getStats(u.id);
      
      return reply.send({
        ok: true,
        data: {
          targets,
          stats,
        },
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/twitter/targets
   * Create new target
   */
  app.post('/api/v4/twitter/targets', async (req, reply) => {
    try {
      const u = requireUser(req);
      const dto = req.body as CreateTargetDTO;

      if (!dto.type || !dto.query) {
        return reply.code(400).send({
          ok: false,
          error: 'type and query are required',
        });
      }

      if (!['KEYWORD', 'ACCOUNT'].includes(dto.type)) {
        return reply.code(400).send({
          ok: false,
          error: 'type must be KEYWORD or ACCOUNT',
        });
      }

      const target = await targetService.create(u.id, dto);
      
      return reply.send({
        ok: true,
        data: target,
      });
    } catch (err: any) {
      return reply.code(400).send({ ok: false, error: err.message });
    }
  });

  /**
   * PATCH /api/v4/twitter/targets/:id
   * Update target
   */
  app.patch('/api/v4/twitter/targets/:id', async (req, reply) => {
    try {
      const u = requireUser(req);
      const { id } = req.params as { id: string };
      const dto = req.body as UpdateTargetDTO;

      const target = await targetService.update(u.id, id, dto);
      
      if (!target) {
        return reply.code(404).send({
          ok: false,
          error: 'Target not found',
        });
      }
      
      return reply.send({
        ok: true,
        data: target,
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * DELETE /api/v4/twitter/targets/:id
   * Delete target
   */
  app.delete('/api/v4/twitter/targets/:id', async (req, reply) => {
    try {
      const u = requireUser(req);
      const { id } = req.params as { id: string };

      const deleted = await targetService.delete(u.id, id);
      
      if (!deleted) {
        return reply.code(404).send({
          ok: false,
          error: 'Target not found',
        });
      }
      
      return reply.send({ ok: true });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/twitter/targets/:id/toggle
   * Toggle enabled status
   */
  app.post('/api/v4/twitter/targets/:id/toggle', async (req, reply) => {
    try {
      const u = requireUser(req);
      const { id } = req.params as { id: string };

      const target = await targetService.toggle(u.id, id);
      
      if (!target) {
        return reply.code(404).send({
          ok: false,
          error: 'Target not found',
        });
      }
      
      return reply.send({
        ok: true,
        data: target,
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}
