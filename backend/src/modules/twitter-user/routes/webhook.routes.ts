/**
 * Webhook Routes - Extension → Backend (Phase 1.1 + 1.2 + 2.2)
 * 
 * PHASE 2.2: Integrated with Twitter Error Code Registry
 * 
 * SECURITY:
 * - Extension НЕ передаёт userId в payload
 * - ownerUserId извлекается ТОЛЬКО из API key (Authorization header)
 * - accountId проверяется на ownership
 */

import type { FastifyInstance } from 'fastify';
import { requireApiKey, requireApiKeyUser } from '../auth/api-key.middleware.js';
import type { CookieWebhookDTO } from '../dto/twitter-webhook.dto.js';
import type { SessionService } from '../services/session.service.js';

// Runtime imports
import { TwitterErrorCode, createErrorResponse } from '../../twitter/errors/index.js';

export async function registerTwitterWebhookRoutes(
  app: FastifyInstance,
  deps: {
    sessions: SessionService;
  }
) {
  /**
   * POST /api/v4/twitter/sessions/webhook
   * 
   * Auth: API Key в Authorization header (Bearer usr_xxx)
   * Scope: twitter:cookies:write
   * 
   * Body: { accountId, cookies, userAgent?, ts?, qualityReport? }
   * 
   * ВАЖНО:
   * - ownerUserId извлекается из API key middleware
   * - accountId проверяется на ownership внутри SessionService
   */
  app.post(
    '/api/v4/twitter/sessions/webhook',
    {
      preHandler: requireApiKey('twitter:cookies:write'),
    },
    async (req, reply) => {
      try {
        // Get ownerUserId from API key (Phase 1.1)
        const user = requireApiKeyUser(req);
        const dto = (req.body ?? {}) as CookieWebhookDTO & { qualityReport?: any };

        // Validate payload - PHASE 2.2: Return structured errors
        if (!dto.accountId) {
          return reply.code(400).send(createErrorResponse(
            TwitterErrorCode.MISSING_PARAMETER,
            { parameter: 'accountId' }
          ));
        }

        if (!Array.isArray(dto.cookies) || dto.cookies.length === 0) {
          return reply.code(400).send(createErrorResponse(
            TwitterErrorCode.COOKIES_EMPTY,
            { accountId: dto.accountId }
          ));
        }

        // Log quality report if provided (Phase 2.1 integration)
        if (dto.qualityReport) {
          app.log.info({ 
            accountId: dto.accountId, 
            qualityStatus: dto.qualityReport.status,
            cookieCount: dto.qualityReport.cookieCount 
          }, 'Cookie quality report received');
        }

        // Ingest webhook (ownership check + session versioning inside)
        const result = await deps.sessions.ingestWebhook(user.id, dto);
        
        return reply.send({ 
          ok: true, 
          data: result 
        });
      } catch (err: any) {
        const dto = (req.body ?? {}) as CookieWebhookDTO;
        
        // PHASE 2.2: Known errors with structured responses
        if (err.message === 'CONSENT_REQUIRED') {
          return reply.code(403).send(createErrorResponse(
            TwitterErrorCode.POLICY_BLOCKED,
            { reason: 'consent_required', accountId: dto.accountId }
          ));
        }
        
        if (err.message === 'ACCOUNT_NOT_FOUND') {
          return reply.code(404).send(createErrorResponse(
            TwitterErrorCode.ACCOUNT_NOT_FOUND,
            { accountId: dto.accountId }
          ));
        }
        
        if (err.message === 'ACCOUNT_OWNERSHIP_VIOLATION') {
          return reply.code(403).send(createErrorResponse(
            TwitterErrorCode.POLICY_BLOCKED,
            { reason: 'ownership_violation', accountId: dto.accountId }
          ));
        }
        
        if (err.message === 'SESSION_INVALID' || err.message?.includes('session')) {
          return reply.code(412).send(createErrorResponse(
            TwitterErrorCode.SESSION_INVALID,
            { accountId: dto.accountId, originalError: err.message }
          ));
        }

        // Unknown error - still return structured format
        app.log.error(err, 'Webhook error');
        return reply.code(500).send(createErrorResponse(
          TwitterErrorCode.INTERNAL_ERROR,
          { accountId: dto.accountId, originalError: err.message }
        ));
      }
    }
  );
}
