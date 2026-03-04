/**
 * Cross-Chain API Routes (P2.3.2)
 * 
 * Read-only endpoints for unified event store
 */

import { FastifyInstance } from 'fastify';
import {
  getEventsByWallet,
  getEventsByToken,
  getEventStats
} from '../storage/unified_events.model.js';
import {
  aggregateByWallet,
  aggregateByToken,
  aggregateByTimeWindow,
  getCrossChainActivity,
  getAggregationStats
} from '../aggregation/event_aggregator.service.js';
import {
  getIngestionStats
} from '../ingestion/event_ingestor.service.js';

export default async function crossChainRoutes(fastify: FastifyInstance) {
  
  /**
   * GET /api/cross-chain/events
   * 
   * Get unified events with filters
   */
  fastify.get('/api/cross-chain/events', async (request, reply) => {
    try {
      const { 
        wallet, 
        token, 
        chain,
        limit = 100,
        startTime,
        endTime
      } = request.query as {
        wallet?: string;
        token?: string;
        chain?: string;
        limit?: number;
        startTime?: number;
        endTime?: number;
      };
      
      let events;
      
      if (wallet) {
        events = await getEventsByWallet(wallet, {
          chain,
          limit: Number(limit),
          startTime,
          endTime
        });
      } else if (token) {
        events = await getEventsByToken(token, {
          chain,
          limit: Number(limit)
        });
      } else {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_QUERY',
          message: 'Must provide wallet or token parameter'
        });
      }
      
      return {
        ok: true,
        data: {
          events,
          count: events.length
        }
      };
      
    } catch (error) {
      fastify.log.error('[CrossChain] Error fetching events:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: 'Failed to fetch events'
      });
    }
  });
  
  /**
   * GET /api/cross-chain/wallet/:address
   * 
   * Get aggregated wallet data
   */
  fastify.get('/api/cross-chain/wallet/:address', async (request, reply) => {
    try {
      const { address } = request.params as { address: string };
      const { startTime, endTime } = request.query as {
        startTime?: number;
        endTime?: number;
      };
      
      const [aggregation, crossChain] = await Promise.all([
        aggregateByWallet(address, { startTime, endTime }),
        getCrossChainActivity(address)
      ]);
      
      if (!aggregation) {
        return {
          ok: true,
          data: null,
          message: 'No events found for wallet'
        };
      }
      
      return {
        ok: true,
        data: {
          ...aggregation,
          crossChain
        }
      };
      
    } catch (error) {
      fastify.log.error('[CrossChain] Error fetching wallet data:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: 'Failed to fetch wallet data'
      });
    }
  });
  
  /**
   * GET /api/cross-chain/token/:address
   * 
   * Get aggregated token data
   */
  fastify.get('/api/cross-chain/token/:address', async (request, reply) => {
    try {
      const { address } = request.params as { address: string };
      const { chain, startTime, endTime } = request.query as {
        chain?: string;
        startTime?: number;
        endTime?: number;
      };
      
      const aggregation = await aggregateByToken(address, {
        chain,
        startTime,
        endTime
      });
      
      if (!aggregation) {
        return {
          ok: true,
          data: null,
          message: 'No events found for token'
        };
      }
      
      return {
        ok: true,
        data: aggregation
      };
      
    } catch (error) {
      fastify.log.error('[CrossChain] Error fetching token data:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: 'Failed to fetch token data'
      });
    }
  });
  
  /**
   * GET /api/cross-chain/window
   * 
   * Get time window aggregation
   */
  fastify.get('/api/cross-chain/window', async (request, reply) => {
    try {
      const { 
        startTime, 
        endTime,
        chain,
        eventType
      } = request.query as {
        startTime: number;
        endTime: number;
        chain?: string;
        eventType?: string;
      };
      
      if (!startTime || !endTime) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_QUERY',
          message: 'startTime and endTime are required'
        });
      }
      
      const aggregation = await aggregateByTimeWindow(
        Number(startTime),
        Number(endTime),
        { chain, eventType }
      );
      
      return {
        ok: true,
        data: aggregation
      };
      
    } catch (error) {
      fastify.log.error('[CrossChain] Error fetching window data:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: 'Failed to fetch window data'
      });
    }
  });
  
  /**
   * GET /api/cross-chain/stats
   * 
   * Get cross-chain statistics
   */
  fastify.get('/api/cross-chain/stats', async (request, reply) => {
    try {
      const { chain } = request.query as { chain?: string };
      
      const [eventStats, aggStats, ingestionStats] = await Promise.all([
        getEventStats(chain),
        getAggregationStats(),
        getIngestionStats()
      ]);
      
      return {
        ok: true,
        data: {
          events: eventStats,
          aggregation: aggStats,
          ingestion: ingestionStats
        }
      };
      
    } catch (error) {
      fastify.log.error('[CrossChain] Error fetching stats:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: 'Failed to fetch statistics'
      });
    }
  });
  
  fastify.log.info('[Cross-Chain] Routes registered');
}
