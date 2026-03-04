/**
 * D3 + D4 - Admin Indexer Control Panel Routes
 * 
 * Provides API endpoints to manage the DEX indexer:
 * - View status (mode, stages, RPC pools)
 * - Change mode (LIMITED/STANDARD/FULL)
 * - Pause/Resume
 * - Enable/Disable stages
 * - Boost mode (temporary FULL)
 * - D4: Checkpoints & Networks
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const DEX_INDEXER_URL = process.env.DEX_API_URL || 'http://localhost:7099';

/**
 * Proxy request to DEX indexer
 */
async function proxyToIndexer(
  path: string, 
  options: { method?: string; body?: any } = {}
): Promise<any> {
  const { method = 'GET', body } = options;
  
  const response = await fetch(`${DEX_INDEXER_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Indexer error: ${response.status} - ${text}`);
  }
  
  return response.json();
}

// Zod schemas
const IndexerModeSchema = z.enum(['LIMITED', 'STANDARD', 'FULL']);
const SetModeBodySchema = z.object({ mode: IndexerModeSchema });
const BoostBodySchema = z.object({ minutes: z.number().min(1).max(60) });
const SetStageBodySchema = z.object({
  stage: z.enum(['pools', 'swaps', 'liquidity']),
  enabled: z.boolean(),
});

export async function adminIndexerRoutes(app: FastifyInstance) {
  /**
   * GET /admin/indexer/status
   * Get full indexer status including mode, stages, RPC pools, checkpoints
   */
  app.get('/admin/indexer/status', async (_request, reply) => {
    try {
      const status = await proxyToIndexer('/admin/status');
      return reply.send(status);
    } catch (error: any) {
      return reply.status(503).send({
        ok: false,
        error: 'Indexer unavailable',
        message: error.message,
      });
    }
  });

  /**
   * GET /admin/indexer/checkpoints
   * D4: Get all checkpoints grouped by network
   */
  app.get('/admin/indexer/checkpoints', async (_request, reply) => {
    try {
      const checkpoints = await proxyToIndexer('/admin/checkpoints');
      return reply.send(checkpoints);
    } catch (error: any) {
      return reply.status(503).send({
        ok: false,
        error: 'Indexer unavailable',
        message: error.message,
      });
    }
  });

  /**
   * GET /admin/indexer/networks
   * D4: Get per-network status
   */
  app.get('/admin/indexer/networks', async (_request, reply) => {
    try {
      const networks = await proxyToIndexer('/admin/networks');
      return reply.send(networks);
    } catch (error: any) {
      return reply.status(503).send({
        ok: false,
        error: 'Indexer unavailable',
        message: error.message,
      });
    }
  });

  /**
   * GET /admin/indexer/health
   * Quick health check for indexer
   */
  app.get('/admin/indexer/health', async (_request, reply) => {
    try {
      const health = await proxyToIndexer('/health');
      return reply.send(health);
    } catch (error: any) {
      return reply.status(503).send({
        ok: false,
        error: 'Indexer unavailable',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/indexer/mode
   * Change indexer mode (LIMITED/STANDARD/FULL)
   */
  app.post('/admin/indexer/mode', async (request, reply) => {
    try {
      const body = SetModeBodySchema.parse(request.body);
      const result = await proxyToIndexer('/admin/mode', { method: 'POST', body });
      return reply.send(result);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return reply.status(400).send({ ok: false, error: 'Invalid mode', details: error.errors });
      }
      return reply.status(503).send({ ok: false, error: error.message });
    }
  });

  /**
   * POST /admin/indexer/pause
   * Pause all indexing
   */
  app.post('/admin/indexer/pause', async (_request, reply) => {
    try {
      const result = await proxyToIndexer('/admin/pause', { method: 'POST' });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(503).send({ ok: false, error: error.message });
    }
  });

  /**
   * POST /admin/indexer/resume
   * Resume indexing
   */
  app.post('/admin/indexer/resume', async (_request, reply) => {
    try {
      const result = await proxyToIndexer('/admin/resume', { method: 'POST' });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(503).send({ ok: false, error: error.message });
    }
  });

  /**
   * POST /admin/indexer/boost
   * Enable FULL mode temporarily (for catch-up)
   */
  app.post('/admin/indexer/boost', async (request, reply) => {
    try {
      const body = BoostBodySchema.parse(request.body);
      const result = await proxyToIndexer('/admin/boost', { method: 'POST', body });
      return reply.send(result);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return reply.status(400).send({ ok: false, error: 'Invalid boost config', details: error.errors });
      }
      return reply.status(503).send({ ok: false, error: error.message });
    }
  });

  /**
   * POST /admin/indexer/stage
   * Enable/disable a specific stage
   */
  app.post('/admin/indexer/stage', async (request, reply) => {
    try {
      const body = SetStageBodySchema.parse(request.body);
      const result = await proxyToIndexer('/admin/stage', { method: 'POST', body });
      return reply.send(result);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return reply.status(400).send({ ok: false, error: 'Invalid stage config', details: error.errors });
      }
      return reply.status(503).send({ ok: false, error: error.message });
    }
  });

  /**
   * GET /admin/indexer/rpc
   * Get RPC pool status for all networks
   */
  app.get('/admin/indexer/rpc', async (_request, reply) => {
    try {
      const status = await proxyToIndexer('/admin/status');
      return reply.send({
        ok: true,
        rpcPools: status.rpcPools || {},
      });
    } catch (error: any) {
      return reply.status(503).send({ ok: false, error: error.message });
    }
  });

  /**
   * POST /admin/indexer/rpc/disable
   * Disable a specific RPC provider
   */
  app.post('/admin/indexer/rpc/disable', async (request, reply) => {
    try {
      const body = z.object({ network: z.string(), providerId: z.string() }).parse(request.body);
      const result = await proxyToIndexer('/admin/rpc/disable', { method: 'POST', body });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(503).send({ ok: false, error: error.message });
    }
  });

  /**
   * POST /admin/indexer/rpc/enable
   * Enable a specific RPC provider
   */
  app.post('/admin/indexer/rpc/enable', async (request, reply) => {
    try {
      const body = z.object({ network: z.string(), providerId: z.string() }).parse(request.body);
      const result = await proxyToIndexer('/admin/rpc/enable', { method: 'POST', body });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(503).send({ ok: false, error: error.message });
    }
  });
}

export default adminIndexerRoutes;
