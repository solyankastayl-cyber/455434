import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import { mongoose } from '../db/mongoose.js';
import { scheduler, getIndexerStatus } from '../jobs/scheduler.js';
import { env } from '../config/env.js';

/**
 * Health Routes
 */

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Basic health check
  app.get('/health', async () => {
    return {
      ok: true,
      service: 'node-backend',
      ts: Date.now(),
      uptime: process.uptime(),
    };
  });

  // Detailed health check with DB status
  app.get('/health/detailed', async () => {
    const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    const indexerStatus = await getIndexerStatus();

    return {
      ok: mongoStatus === 'connected',
      ts: Date.now(),
      uptime: process.uptime(),
      services: {
        mongodb: mongoStatus,
        indexer: indexerStatus,
      },
      jobs: scheduler.getStatus(),
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
    };
  });

  // FULL health check - all 3 services
  app.get('/health/full', async () => {
    const result: Record<string, any> = {};

    // 1. Python Gateway
    try {
      const gatewayRes = await axios.get(`http://localhost:8001/health`, { timeout: 3000 });
      result.gateway = { status: 'ok', ...gatewayRes.data };
    } catch (e: any) {
      result.gateway = { status: 'down', error: e.message };
    }

    // 2. Node Backend (self)
    result.backend = { 
      status: 'ok', 
      service: 'node-backend',
      uptime: process.uptime(),
      mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    };

    // 3. Twitter Parser V2
    const parserUrl = env.PARSER_URL || 'http://localhost:5001';
    try {
      const parserRes = await axios.get(`${parserUrl}/health`, { timeout: 3000 });
      result.parser = { status: 'ok', ...parserRes.data };
    } catch (e: any) {
      result.parser = { status: 'down', error: e.message };
    }

    const allOk = Object.values(result).every((s: any) => 
      s.status === 'ok' || s.status === 'running' || s.ok === true
    );

    return {
      status: allOk ? 'healthy' : 'degraded',
      services: result,
      timestamp: Date.now()
    };
  });

  // Indexer status endpoint
  app.get('/indexer/status', async () => {
    const status = await getIndexerStatus();
    return {
      ok: true,
      data: status,
    };
  });
}
