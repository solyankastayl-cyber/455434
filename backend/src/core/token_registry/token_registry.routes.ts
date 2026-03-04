/**
 * Token Registry API Routes (P0.2.1)
 */

import { FastifyInstance } from 'fastify';
import {
  upsertToken,
  resolveToken,
  searchTokensInRegistry,
  getTokensByCanonical,
  getRegistryStats
} from './token_registry.service.js';
import {
  resolveCanonical,
  upsertCanonicalMapping,
  searchCanonical,
  getCanonicalById,
  getCanonicalStats,
  seedKnownMappings
} from './canonical_mapper.service.js';
import { getToken } from './token_registry.model.js';

export default async function tokenRegistryRoutes(fastify: FastifyInstance) {
  
  /**
   * GET /api/registry/tokens
   * 
   * Search tokens in registry
   */
  fastify.get('/tokens', async (request, reply) => {
    try {
      const { q, chain, symbol, limit = 100 } = request.query as {
        q?: string;
        chain?: string;
        symbol?: string;
        limit?: number;
      };
      
      const tokens = await searchTokensInRegistry({
        q,
        chain,
        symbol,
        limit: Number(limit)
      });
      
      return {
        ok: true,
        data: {
          tokens,
          count: tokens.length
        }
      };
      
    } catch (error: any) {
      fastify.log.error('[TokenRegistry] Error searching tokens:', error);
      return reply.code(500).send({
        ok: false,
        error: 'SEARCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/tokens/:chain/:address
   * 
   * Get specific token
   */
  fastify.get('/tokens/:chain/:address', async (request, reply) => {
    try {
      const { chain, address } = request.params as { chain: string; address: string };
      
      const token = await getToken(chain, address);
      
      if (!token) {
        return reply.code(404).send({
          ok: false,
          error: 'TOKEN_NOT_FOUND',
          message: `Token not found: ${chain}:${address}`
        });
      }
      
      // Try to get canonical
      const canonical = await resolveCanonical(chain, address);
      
      return {
        ok: true,
        data: {
          token,
          canonical
        }
      };
      
    } catch (error: any) {
      fastify.log.error('[TokenRegistry] Error fetching token:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/tokens/upsert
   * 
   * Create or update token (admin/internal)
   */
  fastify.post('/tokens/upsert', async (request, reply) => {
    try {
      const { chain, address, meta, source = 'manual' } = request.body as {
        chain: string;
        address: string;
        meta?: any;
        source?: string;
      };
      
      if (!chain || !address) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_INPUT',
          message: 'chain and address are required'
        });
      }
      
      const token = await upsertToken(chain, address, meta, source as any);
      
      return {
        ok: true,
        data: token,
        message: `Token upserted: ${token.symbol}`
      };
      
    } catch (error: any) {
      fastify.log.error('[TokenRegistry] Error upserting token:', error);
      return reply.code(500).send({
        ok: false,
        error: 'UPSERT_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/tokens/stats
   * 
   * Get registry statistics
   */
  fastify.get('/tokens/stats', async (request, reply) => {
    try {
      const stats = await getRegistryStats();
      
      return {
        ok: true,
        data: stats
      };
      
    } catch (error: any) {
      fastify.log.error('[TokenRegistry] Error fetching stats:', error);
      return reply.code(500).send({
        ok: false,
        error: 'STATS_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/tokens/canonical
   * 
   * Search canonical mappings
   */
  fastify.get('/tokens/canonical', async (request, reply) => {
    try {
      const { q, symbol, limit = 100 } = request.query as {
        q?: string;
        symbol?: string;
        limit?: number;
      };
      
      const canonicals = await searchCanonical({ q, symbol, limit: Number(limit) });
      
      return {
        ok: true,
        data: {
          canonicals,
          count: canonicals.length
        }
      };
      
    } catch (error: any) {
      fastify.log.error('[TokenRegistry] Error searching canonicals:', error);
      return reply.code(500).send({
        ok: false,
        error: 'SEARCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/tokens/canonical/:canonicalId
   * 
   * Get specific canonical mapping with tokens
   */
  fastify.get('/tokens/canonical/:canonicalId', async (request, reply) => {
    try {
      const { canonicalId } = request.params as { canonicalId: string };
      
      const canonical = await getCanonicalById(canonicalId);
      
      if (!canonical) {
        return reply.code(404).send({
          ok: false,
          error: 'CANONICAL_NOT_FOUND',
          message: `Canonical not found: ${canonicalId}`
        });
      }
      
      // Get all tokens for this canonical
      const tokens = await getTokensByCanonical(canonicalId);
      
      return {
        ok: true,
        data: {
          canonical,
          tokens
        }
      };
      
    } catch (error: any) {
      fastify.log.error('[TokenRegistry] Error fetching canonical:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/tokens/canonical/upsert
   * 
   * Create or update canonical mapping (admin)
   */
  fastify.post('/tokens/canonical/upsert', async (request, reply) => {
    try {
      const data = request.body as any;
      
      if (!data.symbol || !data.name || !data.variants || data.variants.length === 0) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_INPUT',
          message: 'symbol, name, and variants are required'
        });
      }
      
      const canonical = await upsertCanonicalMapping(data);
      
      return {
        ok: true,
        data: canonical,
        message: `Canonical mapping upserted: ${canonical.canonicalId}`
      };
      
    } catch (error: any) {
      fastify.log.error('[TokenRegistry] Error upserting canonical:', error);
      return reply.code(500).send({
        ok: false,
        error: 'UPSERT_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/tokens/canonical/stats
   * 
   * Get canonical mapping statistics
   */
  fastify.get('/tokens/canonical/stats', async (request, reply) => {
    try {
      const stats = await getCanonicalStats();
      
      return {
        ok: true,
        data: stats
      };
      
    } catch (error: any) {
      fastify.log.error('[TokenRegistry] Error fetching canonical stats:', error);
      return reply.code(500).send({
        ok: false,
        error: 'STATS_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/tokens/canonical/seed
   * 
   * Seed known canonical mappings (admin)
   */
  fastify.post('/tokens/canonical/seed', async (request, reply) => {
    try {
      const result = await seedKnownMappings();
      
      return {
        ok: true,
        data: result,
        message: `Seeded ${result.created} canonical mappings`
      };
      
    } catch (error: any) {
      fastify.log.error('[TokenRegistry] Error seeding canonicals:', error);
      return reply.code(500).send({
        ok: false,
        error: 'SEED_ERROR',
        message: error.message
      });
    }
  });
  
  fastify.log.info('[Token Registry] Routes registered');
}
