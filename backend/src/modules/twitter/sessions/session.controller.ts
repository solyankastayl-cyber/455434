// TwitterSession Controller - MULTI Architecture
// PHASE 2.2: Integrated with Twitter Error Code Registry
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sessionService, IngestSessionDTO } from './session.service.js';

// Admin auth middleware
import { requireAdminAuth } from '../../../core/admin/admin.middleware.js';

// Runtime imports
import { 
  TwitterErrorCode, 
  sendTwitterError, 
  handleError 
} from '../errors/index.js';

export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {
  // Get all sessions
  app.get('/sessions', async (req: FastifyRequest, reply: FastifyReply) => {
    const sessions = await sessionService.findAll();
    const counts = await sessionService.count();
    return reply.send({ ok: true, data: sessions, stats: counts });
  });

  // Get single session (without cookies)
  app.get<{ Params: { sessionId: string } }>('/sessions/:sessionId', async (req, reply) => {
    const session = await sessionService.findBySessionId(req.params.sessionId);
    if (!session) {
      return sendTwitterError(reply, TwitterErrorCode.SESSION_NOT_FOUND, {
        sessionId: req.params.sessionId
      });
    }
    return reply.send({ ok: true, data: session });
  });

  // Webhook for cookie ingestion (used by Chrome Extension)
  app.post<{ Body: IngestSessionDTO & { apiKey?: string; origin?: string; trigger?: string; syncedAt?: number; qualityReport?: any } }>(
    '/sessions/webhook',
    async (req, reply) => {
      const { apiKey, sessionId, cookies, userAgent, accountUsername, accountId, origin, trigger, syncedAt, qualityReport } = req.body;

      // Validate API key
      if (!sessionService.validateApiKey(apiKey || '')) {
        return sendTwitterError(reply, TwitterErrorCode.SESSION_INVALID, {
          reason: 'Invalid API key'
        });
      }

      if (!sessionId) {
        return sendTwitterError(reply, TwitterErrorCode.MISSING_PARAMETER, {
          parameter: 'sessionId'
        });
      }
      
      if (!cookies || !Array.isArray(cookies)) {
        return sendTwitterError(reply, TwitterErrorCode.COOKIES_MISSING, {
          sessionId
        });
      }
      
      if (cookies.length === 0) {
        return sendTwitterError(reply, TwitterErrorCode.COOKIES_EMPTY, {
          sessionId
        });
      }

      console.log(`[Sessions Webhook] Received ${cookies.length} cookies for ${sessionId} (trigger: ${trigger || 'manual'}, origin: ${origin || 'api'}, qualityStatus: ${qualityReport?.status || 'N/A'})`);

      try {
        const session = await sessionService.ingestSession({
          sessionId,
          cookies,
          userAgent,
          accountUsername,
          accountId,
        });

        return reply.send({
          ok: true,
          data: {
            stored: cookies.length,
            status: session.status,
            sessionId: session.sessionId,
            sessionVersion: session.version || 1,
          }
        });
      } catch (error: any) {
        console.error('[Sessions Webhook] Error:', error.message);
        return handleError(reply, error, { sessionId });
      }
    }
  );

  // Get webhook info (API key, URL)
  app.get('/sessions/webhook/info', async (req, reply) => {
    return reply.send({
      ok: true,
      data: {
        apiKey: sessionService.getWebhookApiKey(),
        webhookUrl: '/api/admin/twitter-parser/sessions/webhook',
        format: {
          sessionId: 'string',
          apiKey: 'string',
          cookies: 'Cookie[]',
          userAgent: 'string (optional)',
          accountUsername: 'string (optional)',
        },
      },
    });
  });

  // Regenerate webhook API key (ADMIN ONLY - security fix)
  app.post(
    '/sessions/webhook/regenerate-key', 
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (req, reply) => {
      try {
        const newKey = sessionService.regenerateApiKey();
        return reply.send({
          ok: true,
          data: {
            apiKey: newKey,
            message: 'API key regenerated successfully',
          },
        });
      } catch (error: any) {
        return reply.code(500).send({
          ok: false,
          error: error.message || 'Failed to regenerate key',
        });
      }
    }
  );

  // Test session (check if cookies still valid)
  app.post<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/test',
    async (req, reply) => {
      const { sessionId } = req.params;

      try {
        const cookies = await sessionService.getCookies(sessionId);
        const hasAuthToken = cookies.some((c) => c.name === 'auth_token');

        // Simple validation - check if auth_token exists and not expired
        const authToken = cookies.find((c) => c.name === 'auth_token');
        const isExpired = authToken?.expires && authToken.expires * 1000 < Date.now();

        if (!hasAuthToken) {
          await sessionService.setStatus(sessionId, 'INVALID', 'Missing auth_token');
          return sendTwitterError(reply, TwitterErrorCode.AUTH_TOKEN_MISSING, {
            sessionId,
            account: cookies.find(c => c.name === 'twid')?.value
          });
        }

        if (isExpired) {
          await sessionService.setStatus(sessionId, 'EXPIRED', 'Cookie expired');
          return sendTwitterError(reply, TwitterErrorCode.AUTH_TOKEN_EXPIRED, {
            sessionId,
            lastValidAt: authToken?.expires ? new Date(authToken.expires * 1000).toISOString() : undefined
          });
        }

        await sessionService.setStatus(sessionId, 'OK');
        return reply.send({ ok: true, valid: true, cookieCount: cookies.length });
      } catch (error: any) {
        return handleError(reply, error, { sessionId });
      }
    }
  );

  // Bind session to account
  app.post<{ Params: { sessionId: string }; Body: { accountId: string } }>(
    '/sessions/:sessionId/bind',
    async (req, reply) => {
      const { sessionId } = req.params;
      const { accountId } = req.body;

      if (!accountId) {
        return reply.status(400).send({ ok: false, error: 'Missing accountId' });
      }

      await sessionService.bindToAccount(sessionId, accountId);
      return reply.send({ ok: true, message: 'Session bound to account' });
    }
  );

  // Delete session
  app.delete<{ Params: { sessionId: string } }>('/sessions/:sessionId', async (req, reply) => {
    const deleted = await sessionService.delete(req.params.sessionId);
    if (!deleted) {
      return reply.status(404).send({ ok: false, error: 'Session not found' });
    }
    return reply.send({ ok: true, message: 'Session deleted' });
  });

  // Mark session status
  app.patch<{ Params: { sessionId: string }; Body: { status: string } }>(
    '/sessions/:sessionId/status',
    async (req, reply) => {
      const { sessionId } = req.params;
      const { status } = req.body;

      if (!['OK', 'STALE', 'INVALID', 'EXPIRED'].includes(status)) {
        return reply.status(400).send({ ok: false, error: 'Invalid status' });
      }

      await sessionService.setStatus(sessionId, status as any);
      return reply.send({ ok: true, message: `Status changed to ${status}` });
    }
  );

  // Run health check on all sessions
  app.post(
    '/sessions/health-check',
    async (req, reply) => {
      const { runHealthCheckAll } = await import('./session-health.observer.js');
      const result = await runHealthCheckAll();
      return reply.send({ ok: true, ...result });
    }
  );

  // Test Telegram notification
  app.post(
    '/sessions/test-notification',
    async (req, reply) => {
      try {
        const { sendTelegramMessage, TelegramConnectionModel } = await import('../../../core/notifications/telegram.service.js');
        
        // Find first connected admin
        const connection = await TelegramConnectionModel.findOne({ isActive: true }).sort({ connectedAt: 1 });
        
        if (!connection) {
          return reply.status(400).send({ ok: false, error: 'No Telegram connection found. Connect via bot first.' });
        }

        const testMessage = `🧪 <b>Test Notification</b>

This is a test message from FOMO Session Monitor.

If you see this, Telegram notifications are working correctly!

Time: ${new Date().toISOString()}`;

        const result = await sendTelegramMessage(connection.chatId, testMessage);
        
        return reply.send({ 
          ok: result.ok, 
          chatId: connection.chatId,
          error: result.error 
        });
      } catch (error: any) {
        return reply.status(500).send({ ok: false, error: error.message });
      }
    }
  );
}
