/**
 * Actor Clustering Routes (P2.2)
 * 
 * API endpoints for actor clustering
 */

import { FastifyInstance } from 'fastify';
import {
  clusterWallets,
  getCluster,
  getAllClusters,
  getWalletCluster,
  recomputeClusters,
} from './clustering.service.js';

export default async function actorClusteringRoutes(fastify: FastifyInstance) {
  
  /**
   * GET /api/actors/clusters
   * 
   * Get all actor clusters
   */
  fastify.get('/api/actors/clusters', async (request, reply) => {
    try {
      const { limit = 100 } = request.query as { limit?: number };
      
      const clusters = await getAllClusters(Number(limit));
      
      return {
        ok: true,
        data: {
          clusters,
          total: clusters.length,
        },
      };
    } catch (error) {
      fastify.log.error('[Clusters] Error fetching clusters:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: 'Failed to fetch clusters',
      });
    }
  });
  
  /**
   * GET /api/actors/clusters/:clusterId
   * 
   * Get specific cluster by ID
   */
  fastify.get('/api/actors/clusters/:clusterId', async (request, reply) => {
    try {
      const { clusterId } = request.params as { clusterId: string };
      
      const cluster = await getCluster(clusterId);
      
      if (!cluster) {
        return reply.code(404).send({
          ok: false,
          error: 'CLUSTER_NOT_FOUND',
          message: `Cluster ${clusterId} not found`,
        });
      }
      
      return {
        ok: true,
        data: cluster,
      };
    } catch (error) {
      fastify.log.error('[Clusters] Error fetching cluster:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: 'Failed to fetch cluster',
      });
    }
  });
  
  /**
   * GET /api/actors/wallet/:address/cluster
   * 
   * Get cluster for a specific wallet address
   */
  fastify.get('/api/actors/wallet/:address/cluster', async (request, reply) => {
    try {
      const { address } = request.params as { address: string };
      const { chain = 'ETH' } = request.query as { chain?: string };
      
      const cluster = await getWalletCluster(address, chain);
      
      if (!cluster) {
        return {
          ok: true,
          data: null,
          message: 'Wallet not clustered',
        };
      }
      
      return {
        ok: true,
        data: cluster,
      };
    } catch (error) {
      fastify.log.error('[Clusters] Error fetching wallet cluster:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: 'Failed to fetch wallet cluster',
      });
    }
  });
  
  /**
   * POST /api/actors/clusters/create
   * 
   * Manually cluster wallets together (admin/testing)
   */
  fastify.post('/api/actors/clusters/create', async (request, reply) => {
    try {
      const { addresses, chain = 'ETH' } = request.body as { 
        addresses: string[]; 
        chain?: string;
      };
      
      if (!addresses || addresses.length < 2) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_INPUT',
          message: 'At least 2 addresses required for clustering',
        });
      }
      
      const cluster = await clusterWallets(addresses, chain);
      
      if (!cluster) {
        return {
          ok: false,
          error: 'CLUSTERING_FAILED',
          message: 'Confidence threshold not met or wallet already clustered',
        };
      }
      
      return {
        ok: true,
        data: cluster,
        message: `Cluster created with confidence ${cluster.confidenceScore.toFixed(2)}`,
      };
    } catch (error) {
      fastify.log.error('[Clusters] Error creating cluster:', error);
      return reply.code(500).send({
        ok: false,
        error: 'CREATE_ERROR',
        message: 'Failed to create cluster',
      });
    }
  });
  
  /**
   * POST /api/actors/clusters/recompute
   * 
   * Recompute all clusters (internal/cron)
   */
  fastify.post('/api/actors/clusters/recompute', async (request, reply) => {
    try {
      const stats = await recomputeClusters();
      
      return {
        ok: true,
        data: stats,
        message: 'Cluster recomputation complete',
      };
    } catch (error) {
      fastify.log.error('[Clusters] Error recomputing clusters:', error);
      return reply.code(500).send({
        ok: false,
        error: 'RECOMPUTE_ERROR',
        message: 'Failed to recompute clusters',
      });
    }
  });
  
  /**
   * GET /api/actors/clusters/summary
   * 
   * Get clustering summary stats
   */
  fastify.get('/api/actors/clusters/summary', async (request, reply) => {
    try {
      const clusters = await getAllClusters(1000);
      
      // Calculate stats
      const totalClusters = clusters.length;
      const totalWallets = clusters.reduce((sum, c) => sum + c.wallets.length, 0);
      const avgConfidence = clusters.length > 0
        ? clusters.reduce((sum, c) => sum + c.confidenceScore, 0) / clusters.length
        : 0;
      
      const highConfidence = clusters.filter(c => c.confidenceScore >= 0.80).length;
      const mediumConfidence = clusters.filter(c => c.confidenceScore >= 0.60 && c.confidenceScore < 0.80).length;
      const lowConfidence = clusters.filter(c => c.confidenceScore < 0.60).length;
      
      const chainDistribution = clusters.reduce((acc: Record<string, number>, c) => {
        c.metrics.chains.forEach(chain => {
          acc[chain] = (acc[chain] || 0) + 1;
        });
        return acc;
      }, {});
      
      return {
        ok: true,
        data: {
          totalClusters,
          totalWallets,
          avgConfidence: Number(avgConfidence.toFixed(2)),
          confidenceDistribution: {
            high: highConfidence,
            medium: mediumConfidence,
            low: lowConfidence,
          },
          chainDistribution,
        },
      };
    } catch (error) {
      fastify.log.error('[Clusters] Error fetching summary:', error);
      return reply.code(500).send({
        ok: false,
        error: 'SUMMARY_ERROR',
        message: 'Failed to fetch clustering summary',
      });
    }
  });
  
  fastify.log.info('[Actor Clustering] Routes registered');
}
