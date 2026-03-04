/**
 * PHASE 1 — Network Admin Routes
 * ================================
 * 
 * Admin API for network/proxy management.
 * 
 * ENDPOINTS:
 *   GET  /api/v10/admin/network/config     - Get current config
 *   PATCH /api/v10/admin/network/config    - Update config
 *   POST /api/v10/admin/network/test       - Test connectivity
 *   POST /api/v10/admin/network/test/:provider - Test specific provider
 *   GET  /api/v10/admin/network/health     - Get health status
 *   POST /api/v10/admin/network/proxy/add  - Add proxy to pool
 *   DELETE /api/v10/admin/network/proxy/:id - Remove proxy
 *   POST /api/v10/admin/network/proxy/:id/reset - Reset proxy errors
 */

import { FastifyInstance } from 'fastify';
import {
  getNetworkConfig,
  updateNetworkConfig,
  refreshNetworkConfig,
  addProxyToPool,
  removeProxyFromPool,
  resetProxyErrors,
} from './network.config.service.js';
import {
  probeAllEndpoints,
  probeProvider,
  getNetworkHealth,
} from './network.health.service.js';
import { NetworkConfig, ProxyPoolItem } from './network.config.types.js';

export async function networkAdminRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // CONFIG MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /config - Get current network config
   */
  fastify.get('/config', async (request, reply) => {
    const config = await getNetworkConfig();
    
    // Mask proxy passwords in response
    const masked = { ...config };
    if (masked.proxy?.url) {
      masked.proxy = { ...masked.proxy, url: masked.proxy.url.replace(/:[^:@]+@/, ':***@') };
    }
    masked.proxyPool = (masked.proxyPool || []).map(p => ({
      ...p,
      url: p.url.replace(/:[^:@]+@/, ':***@'),
    }));
    
    return { ok: true, config: masked };
  });
  
  /**
   * PATCH /config - Update network config
   */
  fastify.patch<{
    Body: Partial<NetworkConfig>;
  }>('/config', async (request, reply) => {
    const patch = request.body;
    
    try {
      const config = await updateNetworkConfig(patch, 'admin');
      
      // Mask for response
      const masked = { ...config };
      if (masked.proxy?.url) {
        masked.proxy = { ...masked.proxy, url: masked.proxy.url.replace(/:[^:@]+@/, ':***@') };
      }
      
      return { ok: true, config: masked };
    } catch (error) {
      reply.code(500);
      return { ok: false, error: error instanceof Error ? error.message : 'Update failed' };
    }
  });
  
  /**
   * POST /refresh - Force refresh config from DB
   */
  fastify.post('/refresh', async (request, reply) => {
    const config = await refreshNetworkConfig();
    return { ok: true, message: 'Config refreshed', egressMode: config.egressMode };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // CONNECTIVITY TESTING
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /test - Test all endpoints
   */
  fastify.post('/test', async (request, reply) => {
    const results = await probeAllEndpoints();
    
    const summary = {
      total: results.length,
      ok: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
    };
    
    return { ok: true, summary, results };
  });
  
  /**
   * POST /test/:provider - Test specific provider
   */
  fastify.post<{
    Params: { provider: string };
  }>('/test/:provider', async (request, reply) => {
    const { provider } = request.params;
    
    const result = await probeProvider(provider.toUpperCase());
    
    if (!result) {
      reply.code(404);
      return { ok: false, error: `Unknown provider: ${provider}` };
    }
    
    return { ok: result.ok, result };
  });
  
  /**
   * GET /health - Get network health status
   */
  fastify.get('/health', async (request, reply) => {
    const health = await getNetworkHealth();
    return { ok: true, health };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PROXY POOL MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /proxy/add - Add proxy to pool
   */
  fastify.post<{
    Body: { id: string; url: string; weight?: number };
  }>('/proxy/add', async (request, reply) => {
    const { id, url, weight = 1 } = request.body;
    
    if (!id || !url) {
      reply.code(400);
      return { ok: false, error: 'id and url are required' };
    }
    
    try {
      const config = await addProxyToPool({ id, url, weight, enabled: true });
      return { ok: true, poolSize: config.proxyPool.length };
    } catch (error) {
      reply.code(500);
      return { ok: false, error: error instanceof Error ? error.message : 'Failed to add proxy' };
    }
  });
  
  /**
   * DELETE /proxy/:id - Remove proxy from pool
   */
  fastify.delete<{
    Params: { id: string };
  }>('/proxy/:id', async (request, reply) => {
    const { id } = request.params;
    
    try {
      const config = await removeProxyFromPool(id);
      return { ok: true, poolSize: config.proxyPool.length };
    } catch (error) {
      reply.code(500);
      return { ok: false, error: error instanceof Error ? error.message : 'Failed to remove proxy' };
    }
  });
  
  /**
   * POST /proxy/:id/reset - Reset proxy error count
   */
  fastify.post<{
    Params: { id: string };
  }>('/proxy/:id/reset', async (request, reply) => {
    const { id } = request.params;
    
    try {
      await resetProxyErrors(id);
      return { ok: true, message: `Proxy ${id} reset` };
    } catch (error) {
      reply.code(500);
      return { ok: false, error: error instanceof Error ? error.message : 'Failed to reset proxy' };
    }
  });
  
  console.log('[Phase 1] Network Admin Routes registered');
}

export default networkAdminRoutes;
