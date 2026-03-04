import type { FastifyInstance } from 'fastify';

/**
 * Auth Plugin (Placeholder)
 * Will be implemented when authentication is needed
 */

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    isAuthenticated: boolean;
  }
}

export async function authPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('userId', undefined);
  app.decorateRequest('isAuthenticated', false);

  // Placeholder for future JWT/session authentication
  app.log.info('Auth plugin registered (placeholder)');
}
