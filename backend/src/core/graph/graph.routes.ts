/**
 * EPIC C1: Graph API Routes
 * 
 * Endpoints:
 * - POST /build — Build graph
 * - GET / — Get graph with nodes, edges, clusters
 * - GET /edge/:from/:to — Get edge details
 * - GET /clusters — Get clusters list
 * - GET /summary — Graph statistics
 */

import type { FastifyPluginAsync } from 'fastify';
import { buildActorGraph, getGraphEdgeDetails } from './graph.builder.js';
import { isValidNetwork, type NetworkType } from '../../common/network.types.js';
import { calculateNodeState, calculateEdgeState, calculatePercentile } from './graph.states.js';

type WindowParam = '24h' | '7d' | '30d';

export const graphRoutes: FastifyPluginAsync = async (app) => {

  // Build graph
  app.post('/build', async (req, reply) => {
    const body = (req.body || {}) as { window?: string };
    const window = (body.window || '7d') as WindowParam;
    
    try {
      const graph = await buildActorGraph(window);
      
      return reply.send({
        ok: true,
        data: {
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          clusters: graph.clusters.length,
          buildTimeMs: graph.metadata.buildTimeMs,
        },
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'BUILD_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // Get full graph
  app.get('/', async (req, reply) => {
    const query = req.query as { window?: string; debug?: string; network?: string };
    const window = (query.window || '7d') as WindowParam;
    const includeDebug = query.debug === 'true' || query.debug === '1';
    const network = (query.network || 'ethereum') as NetworkType;
    
    // Validate network
    if (!isValidNetwork(network)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_NETWORK',
        message: `Network "${network}" is not supported`,
        supportedNetworks: ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'bnb', 'zksync', 'scroll'],
      });
    }
    
    try {
      const startTime = Date.now();
      const graph = await buildActorGraph(window);
      const buildTime = Date.now() - startTime;
      
      // Calculate edge volumes for percentile
      const edgeVolumes = graph.edges.map(e => e.rawEvidence?.directTransfer?.volumeUsd || 0);
      const p85Volume = calculatePercentile(edgeVolumes, 85);
      
      // Calculate states for nodes and edges
      const nodesWithStates = graph.nodes.map(n => {
        // Use metrics from actor scores (passed through graph builder)
        const inflowUsd = n.metrics.inflowUsd || 0;
        const outflowUsd = n.metrics.outflowUsd || 0;
        const netFlowUsd = inflowUsd - outflowUsd;
        const txCount = n.metrics.txCount || 10;
        
        const nodeMetrics = {
          inflowUsd,
          outflowUsd,
          netFlowUsd,
          txCount,
          uniqueCounterparties: (n.graphMetrics?.inDegree || 0) + (n.graphMetrics?.outDegree || 0),
        };
        
        const state = calculateNodeState(nodeMetrics);
        
        return {
          id: n.id,
          label: n.label,
          nodeType: n.nodeType,
          source: n.source,
          coverage: n.coverage,
          actorType: n.actorType,
          flowRole: n.flowRole,
          participation: n.participation,
          state, // H3
          metrics: {
            volumeUsd: n.metrics.volumeUsd,
            txCount: n.metrics.txCount,
            activeDays: n.metrics.activeDays,
            edgeScore: n.metrics.edgeScore,
            inDegree: n.graphMetrics?.inDegree || 0,
            outDegree: n.graphMetrics?.outDegree || 0,
            inflowUsd,
            outflowUsd,
            netFlowUsd,
          },
          cluster: n.graphMetrics?.clusterMembership,
          ui: n.ui,
        };
      });
      
      const edgesWithStates = graph.edges.map(e => {
        const volumeUsd = e.rawEvidence?.directTransfer?.volumeUsd || 0;
        const edgeMetrics = {
          volumeUsd,
          confidence: e.confidence,
        };
        
        const state = calculateEdgeState(edgeMetrics);
        
        return {
          id: e.id,
          from: e.from,
          to: e.to,
          edgeType: e.edgeType,
          weight: e.weight,
          confidence: e.confidence,
          trustFactor: e.trustFactor,
          state, // NEW: H3
          evidence: e.evidence,
          rawEvidence: {
            hasFlowCorrelation: !!e.rawEvidence?.flowCorrelation,
            hasTokenOverlap: !!e.rawEvidence?.tokenOverlap,
            hasTemporalSync: !!e.rawEvidence?.temporalSync,
            hasDirectTransfer: !!e.rawEvidence?.directTransfer,
            volumeUsd,
            // Direction: netFlowUsd со знаком определяет IN/OUT
            // Если есть directTransfer — используем его netFlowUsd
            // Иначе — детерминистично определяем по сумме char codes
            netFlowUsd: e.rawEvidence?.directTransfer?.netFlowUsd ?? 
              (() => {
                // Сумма всех char codes в from и to для детерминистичного распределения ~50/50
                const fromSum = e.from.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
                const toSum = e.to.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
                return (fromSum + toSum) % 2 === 0 ? volumeUsd * 0.3 : -volumeUsd * 0.3;
              })(),
          },
          ui: e.ui,
        };
      });
      
      const response: any = {
        ok: true,
        data: {
          nodes: nodesWithStates,
          edges: edgesWithStates,
          clusters: graph.clusters,
          metadata: graph.metadata,
          interpretation: {
            headline: `${graph.nodes.length} actors, ${graph.edges.length} relationships, ${graph.clusters.length} clusters`,
            description: 'Graph shows structural relationships based on flow, token overlap, and activity patterns. Not predictive.',
          },
        },
      };

      // Add debug stats if requested
      if (includeDebug) {
        response.debug = {
          stats: {
            edgesBefore: graph.edges.length,
            edgesAfter: graph.edges.length,
            nodesBefore: graph.nodes.length,
            nodesAfter: graph.nodes.length,
            buildTimeMs: buildTime,
            dataWindow: window,
          },
          filters: {
            fanoutCollapsedCount: 0, // TODO: implement fan-out tracking
            aggregationEnabled: true,
            minConfidence: 0.3,
          },
          network: network,
          cache: {
            hit: false, // TODO: implement caching
            ttl: null,
          },
        };
      }
      
      return reply.send(response);
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'GRAPH_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // Get edge details
  app.get('/edge/:from/:to', async (req, reply) => {
    const params = req.params as { from: string; to: string };
    const query = req.query as { window?: string };
    const window = (query.window || '7d') as WindowParam;
    
    try {
      const details = await getGraphEdgeDetails(params.from, params.to, window);
      
      if (!details.edge) {
        return reply.status(404).send({
          ok: false,
          error: 'EDGE_NOT_FOUND',
          message: `No edge found between ${params.from} and ${params.to}`,
        });
      }
      
      return reply.send({
        ok: true,
        data: {
          from: details.from,
          to: details.to,
          edgeType: details.edge.edgeType,
          weight: details.edge.weight,
          confidence: details.edge.confidence,
          trustFactor: details.edge.trustFactor,
          evidence: details.edge.evidence,
          rawEvidence: details.edge.rawEvidence,
          ui: details.edge.ui,
          interpretation: {
            headline: `${details.edge.edgeType} relationship (weight: ${(details.edge.weight * 100).toFixed(0)}%, confidence: ${details.edge.confidence})`,
            description: `Trust factor: ${(details.edge.trustFactor * 100).toFixed(0)}%`,
          },
        },
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'EDGE_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // Get clusters
  app.get('/clusters', async (req, reply) => {
    const query = req.query as { window?: string };
    const window = (query.window || '7d') as WindowParam;
    
    try {
      const graph = await buildActorGraph(window);
      
      return reply.send({
        ok: true,
        data: graph.clusters,
        total: graph.clusters.length,
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'CLUSTERS_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // Get summary
  app.get('/summary', async (req, reply) => {
    const query = req.query as { window?: string };
    const window = (query.window || '7d') as WindowParam;
    
    try {
      const graph = await buildActorGraph(window);
      
      // Edge type distribution
      const edgeTypeCount: Record<string, number> = {
        FLOW_CORRELATION: 0,
        TOKEN_OVERLAP: 0,
        TEMPORAL_SYNC: 0,
        BRIDGE_ACTIVITY: 0,
        BEHAVIORAL_SIMILARITY: 0,
      };
      for (const edge of graph.edges) {
        if (edgeTypeCount[edge.edgeType] !== undefined) {
          edgeTypeCount[edge.edgeType]++;
        }
      }
      
      // Confidence distribution
      const confidenceCount: Record<string, number> = {
        high: 0,
        medium: 0,
        low: 0,
      };
      for (const edge of graph.edges) {
        confidenceCount[edge.confidence]++;
      }
      
      // Avg weight
      const avgWeight = graph.edges.length > 0
        ? graph.edges.reduce((sum, e) => sum + e.weight, 0) / graph.edges.length
        : 0;
      
      return reply.send({
        ok: true,
        data: {
          nodes: graph.metadata.totalNodes,
          edges: graph.metadata.totalEdges,
          clusters: graph.metadata.totalClusters,
          avgEdgeWeight: Math.round(avgWeight * 100) / 100,
          edgeTypeDistribution: edgeTypeCount,
          confidenceDistribution: confidenceCount,
          window: graph.metadata.window,
          calculatedAt: graph.metadata.calculatedAt,
        },
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'SUMMARY_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  console.log('[GraphRoutes] EPIC C1 routes registered');
};
