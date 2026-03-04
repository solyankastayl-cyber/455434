/**
 * Actors Graph Routes
 * 
 * API endpoints for the Actors Graph (Structural Intelligence Layer)
 * Philosophy: Structure only, no predictions, no advice
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import * as actorsGraphService from './actors_graph.service.js';

export const actorsGraphRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /actors/graph
   * Get the full actors graph with nodes and edges
   */
  fastify.get('/graph', async (request: FastifyRequest) => {
    const query = request.query as { window?: string };
    const windowDays = query.window === '24h' ? 1 : query.window === '30d' ? 30 : 7;
    
    try {
      const graph = await actorsGraphService.buildActorsGraph(windowDays);
      
      return {
        ok: true,
        data: {
          nodes: graph.nodes.map(n => ({
            id: n.id,
            label: n.label,
            type: n.type,
            metrics: {
              centralityScore: n.metrics.centralityScore,
              inDegree: n.metrics.inDegree,
              outDegree: n.metrics.outDegree,
              totalFlowUsd: n.metrics.totalFlowUsd,
              netFlowUsd: n.metrics.netFlowUsd,
            },
            dominantPattern: n.dominantPattern,
            category: n.category,
            coverage: n.coverage,
            addressCount: n.addressCount,
            ui: n.ui,
          })),
          edges: graph.edges.map(e => ({
            id: e.id,
            from: e.from,
            to: e.to,
            flow: e.flow,
            relationship: e.relationship,
            ui: e.ui,
            evidence: {
              txCount: e.evidence.txCount,
              firstSeen: e.evidence.firstSeen,
              lastSeen: e.evidence.lastSeen,
            },
          })),
          metadata: graph.metadata,
          interpretation: {
            headline: `${graph.nodes.length} actors with ${graph.edges.length} structural relationships`,
            description: 'Graph shows observed flow and pattern relationships. Not predictive.',
            disclaimer: 'Ranking = network position (structural, not predictive)',
          },
        },
      };
    } catch (error) {
      console.error('[ActorsGraph] Error building graph:', error);
      return {
        ok: false,
        error: 'Failed to build actors graph',
      };
    }
  });

  /**
   * GET /actors/graph/edge/:from/:to
   * Get detailed evidence for a specific edge (corridor)
   */
  fastify.get('/graph/edge/:from/:to', async (request: FastifyRequest) => {
    const { from, to } = request.params as { from: string; to: string };
    const query = request.query as { window?: string };
    const windowDays = query.window === '24h' ? 1 : query.window === '30d' ? 30 : 7;
    
    try {
      const details = await actorsGraphService.getEdgeDetails(from, to, windowDays);
      
      return {
        ok: true,
        data: {
          from: details.from,
          to: details.to,
          transactions: details.transactions,
          summary: details.summary,
          interpretation: {
            headline: `${details.transactions.length} transfers between ${from} and ${to}`,
            description: 'Direct evidence of flow relationship',
          },
        },
      };
    } catch (error) {
      console.error('[ActorsGraph] Error getting edge details:', error);
      return {
        ok: false,
        error: 'Failed to get edge details',
      };
    }
  });

  /**
   * GET /actors/graph/ranking
   * Get top actors by centrality (network position)
   */
  fastify.get('/graph/ranking', async (request: FastifyRequest) => {
    const query = request.query as { limit?: string; window?: string };
    const limit = Math.min(parseInt(query.limit || '10'), 50);
    const windowDays = query.window === '24h' ? 1 : query.window === '30d' ? 30 : 7;
    
    try {
      const graph = await actorsGraphService.buildActorsGraph(windowDays);
      const ranking = graph.nodes.slice(0, limit);
      
      return {
        ok: true,
        data: {
          ranking: ranking.map((n, i) => ({
            rank: i + 1,
            id: n.id,
            label: n.label,
            centralityScore: n.metrics.centralityScore,
            dominantPattern: n.dominantPattern,
            category: n.category,
            ui: n.ui,
          })),
          interpretation: {
            headline: `Top ${ranking.length} actors by network position`,
            description: 'Ranking by structural centrality (connections + flow volume). Not predictive.',
          },
        },
      };
    } catch (error) {
      console.error('[ActorsGraph] Error getting ranking:', error);
      return {
        ok: false,
        error: 'Failed to get ranking',
      };
    }
  });

  console.log('[ActorsGraph] Routes registered');
};

export default actorsGraphRoutes;
