/**
 * API Key Auth Middleware
 * 
 * Извлекает ownerUserId из API key в Authorization header
 * Используется для webhook и других API endpoints
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { ApiKeyService } from '../services/api-key.service.js';
import type { ApiKeyScope } from '../models/user-api-key.model.js';

const apiKeyService = new ApiKeyService();

/**
 * Middleware factory для проверки API key с определённым scope
 */
export function requireApiKey(scope: ApiKeyScope) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({
        ok: false,
        error: 'Missing or invalid Authorization header',
      });
    }
    
    const apiKey = authHeader.slice(7); // Remove "Bearer "
    
    const result = await apiKeyService.validate(apiKey, scope);
    
    if (!result.valid) {
      return reply.code(401).send({
        ok: false,
        error: result.error || 'Invalid API key',
      });
    }
    
    // Attach ownerUserId to request
    (request as any).apiKeyUserId = result.ownerUserId;
  };
}

/**
 * Get ownerUserId from API key auth
 */
export function getApiKeyUserId(request: FastifyRequest): string | undefined {
  return (request as any).apiKeyUserId;
}

/**
 * Require API key user ID (throws if not present)
 */
export function requireApiKeyUser(request: FastifyRequest): { id: string } {
  const userId = getApiKeyUserId(request);
  if (!userId) {
    throw new Error('API key authentication required');
  }
  return { id: userId };
}
