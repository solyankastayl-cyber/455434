/**
 * C7 Cluster API Routes
 * 
 * Endpoints:
 * - POST /api/ae/admin/cluster/run   - Run clustering
 * - GET  /api/ae/cluster/latest      - Get latest run
 * - GET  /api/ae/cluster/current     - Current state cluster
 * - GET  /api/ae/cluster/timeline    - Historical timeline
 * - GET  /api/ae/cluster/stats       - Cluster statistics
 */

import { FastifyInstance } from 'fastify';
import type { ClusterConfig } from '../contracts/cluster.contract.js';
import {
  runClusterAnalysis,
  getLatestRun,
  getCurrentCluster,
  getClusterTimeline,
  getClusterStats,
} from '../services/cluster.service.js';

export async function registerClusterRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // ADMIN: RUN CLUSTERING
  // ═══════════════════════════════════════════════════════════════
  
  fastify.post<{
    Querystring: {
      k?: string;
      metric?: string;
      maxIter?: string;
      from?: string;
      to?: string;
    };
  }>(
    '/api/ae/admin/cluster/run',
    async (request, reply) => {
      const q = request.query;
      
      const k = parseInt(q.k || '6');
      const metric = (q.metric || 'cosine') as 'cosine';
      const maxIter = parseInt(q.maxIter || '30');
      const from = q.from || '2000-01-01';
      const to = q.to || '2025-12-31';
      
      if (k < 2 || k > 20) {
        return reply.status(400).send({
          ok: false,
          error: 'k must be between 2 and 20',
        });
      }
      
      const config: ClusterConfig = {
        k,
        metric,
        maxIter,
        seedStrategy: 'farthest',
      };
      
      try {
        const result = await runClusterAnalysis(config, from, to);
        return {
          ok: true,
          latestRun: result,
        };
      } catch (e) {
        return reply.status(500).send({
          ok: false,
          error: (e as Error).message,
        });
      }
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // GET LATEST RUN
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/ae/cluster/latest', async (request, reply) => {
    try {
      const latest = await getLatestRun();
      return {
        ok: true,
        latestRun: latest,
      };
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: (e as Error).message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET CURRENT CLUSTER
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get<{ Querystring: { asOf?: string } }>(
    '/api/ae/cluster/current',
    async (request, reply) => {
      try {
        const result = await getCurrentCluster(request.query.asOf);
        
        if (!result) {
          return reply.status(404).send({
            ok: false,
            error: 'No clustering run or state vector found',
          });
        }
        
        return {
          ok: true,
          ...result,
        };
      } catch (e) {
        return reply.status(500).send({
          ok: false,
          error: (e as Error).message,
        });
      }
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // GET TIMELINE
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get<{
    Querystring: { from?: string; to?: string };
  }>(
    '/api/ae/cluster/timeline',
    async (request, reply) => {
      const { from = '2000-01-01', to = '2025-12-31' } = request.query;
      
      try {
        const result = await getClusterTimeline(from, to);
        
        if (!result) {
          return reply.status(404).send({
            ok: false,
            error: 'No clustering run found',
          });
        }
        
        return {
          ok: true,
          from,
          to,
          ...result,
        };
      } catch (e) {
        return reply.status(500).send({
          ok: false,
          error: (e as Error).message,
        });
      }
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // GET STATS
  // ═══════════════════════════════════════════════════════════════
  
  fastify.get('/api/ae/cluster/stats', async (request, reply) => {
    try {
      const stats = await getClusterStats();
      return {
        ok: true,
        ...stats,
      };
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: (e as Error).message,
      });
    }
  });
  
  console.log('[AE Cluster] Routes registered:');
  console.log('  POST /api/ae/admin/cluster/run');
  console.log('  GET  /api/ae/cluster/latest');
  console.log('  GET  /api/ae/cluster/current');
  console.log('  GET  /api/ae/cluster/timeline');
  console.log('  GET  /api/ae/cluster/stats');
}
