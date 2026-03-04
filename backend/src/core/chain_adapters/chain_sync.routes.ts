/**
 * Chain Sync API Routes (P2.3.1)
 * 
 * Endpoints for managing chain synchronization
 */

import { FastifyInstance } from 'fastify';
import {
  syncAllChains,
  syncChainByName,
  getSyncState,
  getChainSyncState
} from './chain_sync.service.js';
import { ALL_ADAPTERS } from './index.js';

export default async function chainSyncRoutes(fastify: FastifyInstance) {
  
  /**
   * POST /api/chain-sync/all
   * 
   * Trigger sync for all chains
   */
  fastify.post('/api/chain-sync/all', async (request, reply) => {
    try {
      const { blockRange = 1000 } = request.body as { blockRange?: number };
      
      const result = await syncAllChains(blockRange);
      
      return {
        ok: true,
        data: result,
        message: `Synced ${result.successful} chains, ingested ${result.totalEventsIngested} events`
      };
      
    } catch (error: any) {
      fastify.log.error('[ChainSync] Error syncing all chains:', error);
      return reply.code(500).send({
        ok: false,
        error: 'SYNC_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/chain-sync/:chain
   * 
   * Trigger sync for specific chain
   */
  fastify.post('/api/chain-sync/:chain', async (request, reply) => {
    try {
      const { chain } = request.params as { chain: string };
      const { startBlock, endBlock } = request.body as {
        startBlock: number;
        endBlock?: number;
      };
      
      if (!startBlock) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_INPUT',
          message: 'startBlock is required'
        });
      }
      
      const result = await syncChainByName(chain, startBlock, endBlock);
      
      return {
        ok: true,
        data: result,
        message: `Synced ${result.eventsIngested} events from ${chain}`
      };
      
    } catch (error: any) {
      fastify.log.error('[ChainSync] Error syncing chain:', error);
      return reply.code(500).send({
        ok: false,
        error: 'SYNC_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/chain-sync/state
   * 
   * Get sync state for all chains
   */
  fastify.get('/api/chain-sync/state', async (request, reply) => {
    try {
      const state = getSyncState();
      
      return {
        ok: true,
        data: {
          chains: state,
          total: state.length
        }
      };
      
    } catch (error: any) {
      fastify.log.error('[ChainSync] Error fetching state:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/chain-sync/state/:chain
   * 
   * Get sync state for specific chain
   */
  fastify.get('/api/chain-sync/state/:chain', async (request, reply) => {
    try {
      const { chain } = request.params as { chain: string };
      const state = getChainSyncState(chain);
      
      if (!state) {
        return {
          ok: true,
          data: null,
          message: `No sync state for chain: ${chain}`
        };
      }
      
      return {
        ok: true,
        data: state
      };
      
    } catch (error: any) {
      fastify.log.error('[ChainSync] Error fetching chain state:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/chain-sync/adapters
   * 
   * List all available chain adapters
   */
  fastify.get('/api/chain-sync/adapters', async (request, reply) => {
    try {
      const adapters = ALL_ADAPTERS.map(adapter => {
        const config = adapter.getConfig();
        return {
          name: config.name,
          chainId: config.chainId,
          nativeToken: config.nativeToken,
          explorer: config.explorer
        };
      });
      
      return {
        ok: true,
        data: {
          adapters,
          total: adapters.length
        }
      };
      
    } catch (error: any) {
      fastify.log.error('[ChainSync] Error fetching adapters:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  fastify.log.info('[Chain Sync] Routes registered');
}
