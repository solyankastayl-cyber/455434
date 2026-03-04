/**
 * API Key Routes - управление ключами пользователя
 */

import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/require-user.hook.js';
import { ApiKeyService, type CreateApiKeyDTO } from '../services/api-key.service.js';

export async function registerApiKeyRoutes(app: FastifyInstance) {
  const apiKeyService = new ApiKeyService();

  /**
   * GET /api/v4/user/api-keys
   * Список ключей пользователя
   */
  app.get('/api/v4/user/api-keys', async (req, reply) => {
    try {
      const u = requireUser(req);
      const keys = await apiKeyService.list(u.id);
      
      return reply.send({
        ok: true,
        data: keys,
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/user/api-keys
   * Создать новый ключ
   * ВАЖНО: plainKey возвращается ТОЛЬКО здесь!
   */
  app.post('/api/v4/user/api-keys', async (req, reply) => {
    try {
      const u = requireUser(req);
      const body = req.body as CreateApiKeyDTO;
      
      // Default scopes for extension
      const scopes = body.scopes || ['twitter:cookies:write'];
      const name = body.name || 'Chrome Extension';
      
      const result = await apiKeyService.create(u.id, { name, scopes });
      
      return reply.send({
        ok: true,
        data: {
          apiKey: result.apiKey, // ТОЛЬКО здесь!
          info: result.info,
        },
        warning: 'Save this API key now. It will not be shown again.',
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * DELETE /api/v4/user/api-keys/:id
   * Отозвать ключ
   */
  app.delete('/api/v4/user/api-keys/:id', async (req, reply) => {
    try {
      const u = requireUser(req);
      const { id } = req.params as { id: string };
      
      const revoked = await apiKeyService.revoke(u.id, id);
      
      if (!revoked) {
        return reply.code(404).send({
          ok: false,
          error: 'Key not found or already revoked',
        });
      }
      
      return reply.send({ ok: true });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}
