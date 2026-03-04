// TwitterAccount Controller - MULTI Architecture
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { accountService, CreateAccountDTO, UpdateAccountDTO } from './account.service.js';

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  // Get all accounts
  app.get('/accounts', async (req: FastifyRequest, reply: FastifyReply) => {
    const accounts = await accountService.findAll();
    const counts = await accountService.count();
    return reply.send({ ok: true, data: accounts, stats: counts });
  });

  // Get single account
  app.get<{ Params: { id: string } }>('/accounts/:id', async (req, reply) => {
    const account = await accountService.findById(req.params.id);
    if (!account) {
      return reply.status(404).send({ ok: false, error: 'Account not found' });
    }
    return reply.send({ ok: true, data: account });
  });

  // Create account
  app.post<{ Body: CreateAccountDTO }>('/accounts', async (req, reply) => {
    try {
      const account = await accountService.create(req.body);
      return reply.status(201).send({ ok: true, data: account });
    } catch (error: any) {
      if (error.code === 11000) {
        return reply.status(400).send({ ok: false, error: 'Username already exists' });
      }
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // Update account
  app.put<{ Params: { id: string }; Body: UpdateAccountDTO }>('/accounts/:id', async (req, reply) => {
    const account = await accountService.update(req.params.id, req.body);
    if (!account) {
      return reply.status(404).send({ ok: false, error: 'Account not found' });
    }
    return reply.send({ ok: true, data: account });
  });

  // Delete account
  app.delete<{ Params: { id: string } }>('/accounts/:id', async (req, reply) => {
    const deleted = await accountService.delete(req.params.id);
    if (!deleted) {
      return reply.status(404).send({ ok: false, error: 'Account not found' });
    }
    return reply.send({ ok: true, message: 'Account deleted' });
  });

  // Change status
  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/accounts/:id/status',
    async (req, reply) => {
      const { status } = req.body;
      if (!['ACTIVE', 'DISABLED', 'SUSPENDED'].includes(status)) {
        return reply.status(400).send({ ok: false, error: 'Invalid status' });
      }
      await accountService.setStatus(req.params.id, status as any);
      return reply.send({ ok: true, message: `Status changed to ${status}` });
    }
  );
}
