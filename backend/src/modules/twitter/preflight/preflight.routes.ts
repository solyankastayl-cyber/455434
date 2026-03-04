// Twitter Preflight Check Routes
import type { FastifyInstance } from 'fastify';
import { runTwitterPreflight } from './preflight.service.js';
import { ApiKeyService } from '../../twitter-user/services/api-key.service.js';

const apiKeyService = new ApiKeyService();

export async function preflightRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v4/twitter/preflight-check
   * Check if system is ready to run parsing
   */
  app.get('/api/v4/twitter/preflight-check', async (request, reply) => {
    const sessionId = (request.query as any).sessionId;
    
    if (!sessionId) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_SESSION_ID',
        message: 'Query param sessionId is required'
      });
    }

    const result = await runTwitterPreflight(sessionId);
    
    return reply.status(result.canRun ? 200 : 412).send(result);
  });

  /**
   * GET /api/v4/twitter/preflight-check/system
   * Check only system services (no session required)
   */
  app.get('/api/v4/twitter/preflight-check/system', async (_request, reply) => {
    // Run with empty sessionId to check only services
    const result = await runTwitterPreflight('');
    
    // Filter to only return service checks
    return reply.send({
      status: result.checks.services.parser === 'ok' ? 'ok' : 'blocked',
      services: result.checks.services,
      blockers: result.blockers.filter(b => 
        ['PARSER_DOWN', 'BROWSER_NOT_READY'].includes(b.code)
      )
    });
  });

  /**
   * POST /api/v4/twitter/preflight-check/extension
   * Phase 8.2: Preflight for Chrome Extension before sync
   * 
   * Validates:
   * - API key (via Authorization header)
   * - Cookies quality (from body)
   * - System status
   * 
   * Returns:
   * - state: READY | SESSION_EXPIRED | NO_COOKIES | API_KEY_INVALID | ACCOUNT_RESTRICTED
   * - fixHint: Human-readable suggestion
   */
  app.post('/api/v4/twitter/preflight-check/extension', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      
      // Check API key presence
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({
          ok: false,
          state: 'API_KEY_INVALID',
          details: { hasAuth: false, cookiesCount: 0 },
          fixHint: 'Please enter a valid API key'
        });
      }

      // Validate API key (supports usr_xxx format)
      const apiKey = authHeader.slice(7);
      
      // Check if it's a user API key (usr_ prefix)
      if (apiKey.startsWith('usr_')) {
        const validation = await apiKeyService.validate(apiKey, 'twitter:cookies:write');
        if (!validation.valid) {
          return reply.status(401).send({
            ok: false,
            state: 'API_KEY_INVALID',
            details: { hasAuth: true, cookiesCount: 0, reason: 'invalid_key' },
            fixHint: 'API key is invalid or expired. Please generate a new key from the admin panel'
          });
        }
      }
      // For other key formats, just check it's not empty
      else if (!apiKey || apiKey.length < 10) {
        return reply.status(401).send({
          ok: false,
          state: 'API_KEY_INVALID',
          details: { hasAuth: true, cookiesCount: 0, reason: 'key_too_short' },
          fixHint: 'API key format is invalid'
        });
      }

      const body = request.body as { cookies?: any[], accountId?: string } || {};
      const cookies = body.cookies || [];
      
      // Check cookies
      if (!cookies || cookies.length === 0) {
        return reply.send({
          ok: false,
          state: 'NO_COOKIES',
          details: { hasAuth: true, cookiesCount: 0 },
          fixHint: 'Open twitter.com and log in first'
        });
      }

      // Check for critical auth cookies
      const authCookies = ['auth_token', 'ct0', 'twid'];
      const foundAuth = authCookies.filter(name => 
        cookies.some((c: any) => c.name === name)
      );
      
      if (foundAuth.length < 2) {
        return reply.send({
          ok: false,
          state: 'SESSION_EXPIRED',
          details: { hasAuth: true, cookiesCount: cookies.length, foundAuth },
          fixHint: 'You are logged out of Twitter. Please log in and try again'
        });
      }

      // Check system health - skip parser check for extension mode
      // Extension sends cookies directly, parser is not required
      // const systemResult = await runTwitterPreflight('');
      // if (systemResult.checks.services.parser !== 'ok') {
      //   return reply.send({
      //     ok: false,
      //     state: 'SERVICE_UNAVAILABLE',
      //     details: { hasAuth: true, cookiesCount: cookies.length },
      //     fixHint: 'Service is temporarily unavailable. Please try again in a moment'
      //   });
      // }

      // All checks passed
      return reply.send({
        ok: true,
        state: 'READY',
        details: {
          hasAuth: true,
          cookiesCount: cookies.length,
          foundAuth
        },
        fixHint: null
      });

    } catch (err: any) {
      app.log.error(err, 'Extension preflight error');
      return reply.status(500).send({
        ok: false,
        state: 'INTERNAL_ERROR',
        details: { hasAuth: false, cookiesCount: 0 },
        fixHint: 'Something went wrong. Please try again'
      });
    }
  });
}
