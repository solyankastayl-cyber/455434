// TwitterAccount Controller - v4.0 Parser Control Plane
// Admin API endpoints for Twitter accounts

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TwitterAccountService } from '../services/twitterAccount.service.js';
import { CreateTwitterAccountDto, UpdateTwitterAccountDto } from '../dto/twitterAccount.dto.js';

export function registerTwitterAccountRoutes(
  fastify: FastifyInstance,
  accountService: TwitterAccountService
) {
  // GET /accounts - List all accounts
  fastify.get('/accounts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { status } = request.query as { status?: string };
      const accounts = await accountService.list(
        status ? { status: status as any } : undefined
      );
      return { ok: true, data: accounts, total: accounts.length };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // GET /accounts/:id - Get account by ID
  fastify.get('/accounts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const account = await accountService.getById(id);
      if (!account) {
        return reply.status(404).send({ ok: false, error: 'Account not found' });
      }
      return { ok: true, data: account };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /accounts - Create account
  fastify.post('/accounts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const dto = request.body as CreateTwitterAccountDto;
      if (!dto.label) {
        return reply.status(400).send({ ok: false, error: 'Label is required' });
      }
      const account = await accountService.create(dto);
      return reply.status(201).send({ ok: true, data: account });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // PATCH /accounts/:id - Update account
  fastify.patch('/accounts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const dto = request.body as UpdateTwitterAccountDto;
      const account = await accountService.update(id, dto);
      if (!account) {
        return reply.status(404).send({ ok: false, error: 'Account not found' });
      }
      return { ok: true, data: account };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /accounts/:id/enable - Enable account
  fastify.post('/accounts/:id/enable', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const account = await accountService.enable(id);
      if (!account) {
        return reply.status(404).send({ ok: false, error: 'Account not found' });
      }
      return { ok: true, data: account };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // POST /accounts/:id/disable - Disable account
  fastify.post('/accounts/:id/disable', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const account = await accountService.disable(id);
      if (!account) {
        return reply.status(404).send({ ok: false, error: 'Account not found' });
      }
      return { ok: true, data: account };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // DELETE /accounts/:id - Delete account
  fastify.delete('/accounts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await accountService.delete(id);
      if (!deleted) {
        return reply.status(404).send({ ok: false, error: 'Account not found' });
      }
      return { ok: true, message: 'Account deleted' };
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });
}
