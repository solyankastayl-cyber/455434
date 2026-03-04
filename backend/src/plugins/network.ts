/**
 * Network Validation Plugin - P0.1
 * 
 * ЖЁСТКИЕ ПРАВИЛА:
 * - network ОБЯЗАТЕЛЕН во всех API (кроме whitelist)
 * - Нет network → 400 NETWORK_REQUIRED
 * - Невалидный network → 400 NETWORK_INVALID
 * - Никаких default fallback
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { isValidNetwork, normalizeNetwork, NetworkType, SUPPORTED_NETWORKS } from '../common/network.types.js';

// Endpoints which DON'T require network (system/health)
const NETWORK_EXEMPT_ROUTES = new Set([
  '/api/health',
  '/api/health/ready',
  '/api/health/live',
  '/api/system/status',
  '/api/networks',  // List networks endpoint
  '/api/ws',
  '/',
]);

// Endpoints that support network=all (aggregation)
const NETWORK_ALL_ALLOWED = new Set([
  '/api/wallet/summary',
  '/api/actors/overview',
  '/api/market/overview',
]);

declare module 'fastify' {
  interface FastifyRequest {
    network?: NetworkType;
    networkRequired: boolean;
  }
}

/**
 * Extract network from request (query, params, body)
 */
function extractNetwork(request: FastifyRequest): string | undefined {
  // Query string: ?network=ethereum
  const query = request.query as Record<string, unknown>;
  if (query.network && typeof query.network === 'string') {
    return query.network;
  }
  
  // URL params: /api/network/:network/...
  const params = request.params as Record<string, unknown>;
  if (params.network && typeof params.network === 'string') {
    return params.network;
  }
  
  // Body: { network: 'ethereum', ... }
  const body = request.body as Record<string, unknown> | null;
  if (body?.network && typeof body.network === 'string') {
    return body.network;
  }
  
  return undefined;
}

/**
 * Check if route is exempt from network requirement
 */
function isExemptRoute(url: string): boolean {
  // Check exact match
  if (NETWORK_EXEMPT_ROUTES.has(url)) {
    return true;
  }
  
  // Check prefix match for static assets, docs, etc.
  if (url.startsWith('/static/') || url.startsWith('/docs/')) {
    return true;
  }
  
  return false;
}

/**
 * Network Validation Plugin
 */
const networkPlugin: FastifyPluginCallback = (fastify, opts, done) => {
  // Add preHandler hook
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url.split('?')[0]; // Remove query string
    
    // Skip exempt routes
    if (isExemptRoute(url)) {
      request.networkRequired = false;
      return;
    }
    
    request.networkRequired = true;
    
    const rawNetwork = extractNetwork(request);
    
    // No network provided
    if (!rawNetwork) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required. Supported networks: ${SUPPORTED_NETWORKS.join(', ')}`,
      });
    }
    
    // Handle 'all' for aggregation endpoints
    if (rawNetwork.toLowerCase() === 'all') {
      if (NETWORK_ALL_ALLOWED.has(url)) {
        request.network = undefined; // Signal to query all networks
        return;
      }
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_ALL_NOT_ALLOWED',
        message: `This endpoint does not support network=all. Please specify a network: ${SUPPORTED_NETWORKS.join(', ')}`,
      });
    }
    
    // Validate and normalize network
    try {
      request.network = normalizeNetwork(rawNetwork);
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_INVALID',
        message: `Invalid network "${rawNetwork}". Supported networks: ${SUPPORTED_NETWORKS.join(', ')}`,
      });
    }
  });
  
  // Add helper route to list networks
  fastify.get('/api/networks', async (request, reply) => {
    return {
      ok: true,
      data: {
        networks: SUPPORTED_NETWORKS,
        default: null, // NO DEFAULT!
        description: 'Network parameter is REQUIRED for all API endpoints',
      },
    };
  });
  
  done();
};

export default fp(networkPlugin, {
  name: 'network-validation',
  fastify: '4.x',
});

export { extractNetwork, isExemptRoute };
