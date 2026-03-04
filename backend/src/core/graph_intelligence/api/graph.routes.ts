/**
 * Graph Intelligence API (P1.7 + P2.3 + ETAP B1)
 * 
 * REST endpoints for explainability graph generation.
 * Read-only API for graph visualization and risk explanation.
 * 
 * ETAP B1: Network-scoped queries
 * - All endpoints require `network` parameter
 * - No cross-network data leakage
 * 
 * P2.3: Added cache metrics endpoint
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { graphBuilder } from '../builders/graph_builder.service.js';
import { 
  getSnapshotStats, 
  GraphSnapshotModel 
} from '../storage/graph_snapshot.model.js';
import { snapshotCache, CALIBRATION_VERSION, TTL_CONFIG } from '../cache/snapshot_cache.service.js';
import { GraphBuildOptions, GraphSnapshot } from '../storage/graph_types.js';
import { 
  NetworkType, 
  isValidNetwork, 
  SUPPORTED_NETWORKS 
} from '../../../common/network.types.js';

// ============================================
// Response Helpers
// ============================================

function formatSnapshotResponse(snapshot: GraphSnapshot) {
  return {
    snapshotId: snapshot.snapshotId,
    kind: snapshot.kind,
    address: snapshot.address,
    routeId: snapshot.routeId,
    
    // Graph data
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    highlightedPath: snapshot.highlightedPath,
    
    // P2.2: Calibration data
    corridors: (snapshot as any).corridors || [],
    calibrationMeta: (snapshot as any).calibrationMeta || null,
    
    // Risk analysis
    riskSummary: snapshot.riskSummary,
    explain: snapshot.explain,
    
    // Metadata
    generatedAt: snapshot.generatedAt,
    expiresAt: snapshot.expiresAt,
    buildTimeMs: snapshot.buildTimeMs,
    truncated: snapshot.truncated,
  };
}

// ============================================
// Routes
// ============================================

export async function graphIntelligenceRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ========================================
  // GET /address/:address
  // Build/retrieve graph for an address
  // ETAP B1: Requires network parameter
  // ========================================
  fastify.get<{
    Params: { address: string };
    Querystring: { 
      network: string;        // REQUIRED (ETAP B1)
      maxRoutes?: string;
      maxEdges?: string;
      timeWindowHours?: string;
      chains?: string;
      mode?: string; // 🔥 NEW: 'raw' | 'calibrated'
    };
  }>('/address/:address', async (request, reply) => {
    const { address } = request.params;
    const { network } = request.query;
    
    // ETAP B1: Validate network parameter
    if (!network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: 'network query parameter is required',
        supportedNetworks: SUPPORTED_NETWORKS,
      });
    }
    
    if (!isValidNetwork(network)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_NETWORK',
        message: `Invalid network: ${network}`,
        supportedNetworks: SUPPORTED_NETWORKS,
      });
    }
    
    if (!address || address.length < 10) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid address'
      });
    }
    
    // Parse options
    const options: GraphBuildOptions = {
      network: network as NetworkType, // ETAP B1
    };
    if (request.query.maxRoutes) {
      options.maxRoutes = parseInt(request.query.maxRoutes);
    }
    if (request.query.maxEdges) {
      options.maxEdges = parseInt(request.query.maxEdges);
    }
    if (request.query.timeWindowHours) {
      options.timeWindowHours = parseInt(request.query.timeWindowHours);
    }
    if (request.query.chains) {
      options.chains = request.query.chains.split(',');
    }
    
    // Parse mode (A1: mode=calibrated support)
    const mode = request.query.mode || 'raw';
    
    try {
      const snapshot = await graphBuilder.buildForAddress(address, options, mode);
      
      return {
        ok: true,
        network, // ETAP B1: Echo network in response
        data: formatSnapshotResponse(snapshot)
      };
    } catch (err: any) {
      fastify.log.error(`[GraphAPI] Error building graph for address: ${err.message}`);
      return reply.status(500).send({
        ok: false,
        error: 'Failed to build graph',
        details: err.message
      });
    }
  });
  
  // ========================================
  // GET /route/:routeId
  // Build/retrieve graph for a specific route
  // ========================================
  fastify.get<{
    Params: { routeId: string };
    Querystring: { 
      maxEdges?: string;
    };
  }>('/route/:routeId', async (request, reply) => {
    const { routeId } = request.params;
    
    if (!routeId) {
      return reply.status(400).send({
        ok: false,
        error: 'routeId is required'
      });
    }
    
    // Parse options
    const options: GraphBuildOptions = {};
    if (request.query.maxEdges) {
      options.maxEdges = parseInt(request.query.maxEdges);
    }
    
    try {
      const snapshot = await graphBuilder.buildForRoute(routeId, options);
      
      return {
        ok: true,
        data: formatSnapshotResponse(snapshot)
      };
    } catch (err: any) {
      fastify.log.error(`[GraphAPI] Error building graph for route: ${err.message}`);
      return reply.status(500).send({
        ok: false,
        error: 'Failed to build graph',
        details: err.message
      });
    }
  });
  
  // ========================================
  // GET /stats
  // Get graph snapshot statistics
  // ========================================
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await getSnapshotStats();
      
      return {
        ok: true,
        stats
      };
    } catch (err: any) {
      fastify.log.error(`[GraphAPI] Error getting stats: ${err.message}`);
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get stats'
      });
    }
  });
  
  // ========================================
  // GET /cached/:snapshotId
  // Get a specific cached snapshot by ID
  // ========================================
  fastify.get<{
    Params: { snapshotId: string };
  }>('/cached/:snapshotId', async (request, reply) => {
    const { snapshotId } = request.params;
    
    try {
      const snapshot = await GraphSnapshotModel.findOne({ snapshotId });
      
      if (!snapshot) {
        return reply.status(404).send({
          ok: false,
          error: 'Snapshot not found'
        });
      }
      
      // Check if expired
      if (snapshot.expiresAt < Date.now()) {
        return reply.status(410).send({
          ok: false,
          error: 'Snapshot expired'
        });
      }
      
      return {
        ok: true,
        data: formatSnapshotResponse(snapshot as any)
      };
    } catch (err: any) {
      fastify.log.error(`[GraphAPI] Error getting cached snapshot: ${err.message}`);
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get snapshot'
      });
    }
  });
  
  // ========================================
  // DELETE /cache/clear
  // Clear expired snapshots (admin)
  // ========================================
  fastify.delete('/cache/clear', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await GraphSnapshotModel.deleteMany({
        expiresAt: { $lt: Date.now() }
      });
      
      return {
        ok: true,
        deletedCount: result.deletedCount
      };
    } catch (err: any) {
      fastify.log.error(`[GraphAPI] Error clearing cache: ${err.message}`);
      return reply.status(500).send({
        ok: false,
        error: 'Failed to clear cache'
      });
    }
  });
  
  // ========================================
  // GET /health
  // Health check for graph module
  // ========================================
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await getSnapshotStats();
      
      return {
        ok: true,
        module: 'graph_intelligence',
        version: 'P2.3',
        status: 'operational',
        calibrationVersion: CALIBRATION_VERSION,
        stats: {
          totalSnapshots: stats.total,
          avgBuildTimeMs: stats.avgBuildTimeMs
        }
      };
    } catch (err: any) {
      return {
        ok: false,
        module: 'graph_intelligence',
        version: 'P2.3',
        status: 'degraded',
        error: err.message
      };
    }
  });
  
  // ========================================
  // GET /cache/metrics
  // P2.3: Get cache performance metrics
  // ========================================
  fastify.get('/cache/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const metrics = snapshotCache.getMetrics();
      const dbStats = await getSnapshotStats();
      
      return {
        ok: true,
        cache: {
          ...metrics,
          calibrationVersion: CALIBRATION_VERSION,
          ttlConfig: TTL_CONFIG,
        },
        database: dbStats,
      };
    } catch (err: any) {
      fastify.log.error(`[GraphAPI] Error getting cache metrics: ${err.message}`);
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get cache metrics'
      });
    }
  });
  
  // ========================================
  // POST /cache/invalidate
  // P2.3: Invalidate caches by version (admin)
  // ========================================
  fastify.post<{
    Body: { version?: string };
  }>('/cache/invalidate', async (request, reply) => {
    try {
      const version = request.body?.version || CALIBRATION_VERSION;
      const deletedCount = await snapshotCache.invalidateByVersion(version);
      
      return {
        ok: true,
        deletedCount,
        currentVersion: CALIBRATION_VERSION,
      };
    } catch (err: any) {
      fastify.log.error(`[GraphAPI] Error invalidating cache: ${err.message}`);
      return reply.status(500).send({
        ok: false,
        error: 'Failed to invalidate cache'
      });
    }
  });
  
  // ========================================
  // P2.4.3: Share Routes
  // ========================================
  const { shareRoutes } = await import('../share/share.routes.js');
  await fastify.register(shareRoutes);
}
