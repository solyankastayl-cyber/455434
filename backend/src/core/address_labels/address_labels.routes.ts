/**
 * Address Labels API Routes (P0.2.2)
 */

import { FastifyInstance } from 'fastify';
import {
  upsertAddressLabel,
  batchUpsertLabels,
  deleteAddressLabel,
  verifyLabel,
  getLabelsByCategory,
  getLabelsStats,
  upsertExchangeEntity,
  addWalletToEntity,
  removeWalletFromEntity,
  deleteExchangeEntity,
  getExchangeStats,
  resolveAddress,
  batchResolveAddresses,
  seedKnownLabels,
  getLabel,
  searchLabels,
  getExchangeEntity,
  searchExchangeEntities
} from './address_labels.service.js';

export default async function addressLabelsRoutes(fastify: FastifyInstance) {
  
  // ========================================
  // Address Labels Routes
  // ========================================
  
  /**
   * GET /api/labels
   * Search address labels
   */
  fastify.get('/labels', async (request, reply) => {
    try {
      const { q, chain, category, limit = 100 } = request.query as {
        q?: string;
        chain?: string;
        category?: string;
        limit?: number;
      };
      
      const labels = await searchLabels({
        q,
        chain,
        category: category as any,
        limit: Number(limit)
      });
      
      return {
        ok: true,
        data: { labels, count: labels.length }
      };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error searching labels:', error);
      return reply.code(500).send({
        ok: false,
        error: 'SEARCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/labels/:chain/:address
   * Get specific label
   */
  fastify.get('/labels/:chain/:address', async (request, reply) => {
    try {
      const { chain, address } = request.params as { chain: string; address: string };
      
      const result = await resolveAddress(chain, address);
      
      if (!result.label) {
        return reply.code(404).send({
          ok: false,
          error: 'LABEL_NOT_FOUND',
          message: `No label found for ${chain}:${address}`
        });
      }
      
      return {
        ok: true,
        data: result
      };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error fetching label:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/labels/upsert
   * Create or update label
   */
  fastify.post('/labels/upsert', async (request, reply) => {
    try {
      const data = request.body as any;
      
      if (!data.chain || !data.address || !data.name || !data.category) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_INPUT',
          message: 'chain, address, name, and category are required'
        });
      }
      
      const label = await upsertAddressLabel(data);
      
      return {
        ok: true,
        data: label,
        message: `Label upserted: ${label.name}`
      };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error upserting label:', error);
      return reply.code(500).send({
        ok: false,
        error: 'UPSERT_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/labels/batch
   * Batch upsert labels
   */
  fastify.post('/labels/batch', async (request, reply) => {
    try {
      const { labels } = request.body as { labels: any[] };
      
      if (!labels || !Array.isArray(labels)) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_INPUT',
          message: 'labels array is required'
        });
      }
      
      const result = await batchUpsertLabels(labels);
      
      return {
        ok: true,
        data: result,
        message: `Created ${result.created}, updated ${result.updated} labels`
      };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error batch upserting labels:', error);
      return reply.code(500).send({
        ok: false,
        error: 'BATCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * DELETE /api/labels/:chain/:address
   * Delete label
   */
  fastify.delete('/labels/:chain/:address', async (request, reply) => {
    try {
      const { chain, address } = request.params as { chain: string; address: string };
      
      const deleted = await deleteAddressLabel(chain, address);
      
      if (!deleted) {
        return reply.code(404).send({
          ok: false,
          error: 'LABEL_NOT_FOUND',
          message: `No label found for ${chain}:${address}`
        });
      }
      
      return {
        ok: true,
        message: `Label deleted: ${chain}:${address}`
      };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error deleting label:', error);
      return reply.code(500).send({
        ok: false,
        error: 'DELETE_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/labels/:chain/:address/verify
   * Verify label
   */
  fastify.post('/labels/:chain/:address/verify', async (request, reply) => {
    try {
      const { chain, address } = request.params as { chain: string; address: string };
      const { verifiedBy = 'admin' } = request.body as { verifiedBy?: string };
      
      const label = await verifyLabel(chain, address, verifiedBy);
      
      if (!label) {
        return reply.code(404).send({
          ok: false,
          error: 'LABEL_NOT_FOUND',
          message: `No label found for ${chain}:${address}`
        });
      }
      
      return {
        ok: true,
        data: label,
        message: `Label verified by ${verifiedBy}`
      };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error verifying label:', error);
      return reply.code(500).send({
        ok: false,
        error: 'VERIFY_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/labels/category/:category
   * Get labels by category
   */
  fastify.get('/labels/category/:category', async (request, reply) => {
    try {
      const { category } = request.params as { category: string };
      const { chain, limit = 500 } = request.query as { chain?: string; limit?: number };
      
      const labels = await getLabelsByCategory(category as any, chain, Number(limit));
      
      return {
        ok: true,
        data: { labels, count: labels.length }
      };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error fetching category labels:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/labels/stats
   * Get labels statistics
   */
  fastify.get('/labels/stats', async (request, reply) => {
    try {
      const stats = await getLabelsStats();
      return { ok: true, data: stats };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error fetching stats:', error);
      return reply.code(500).send({
        ok: false,
        error: 'STATS_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/labels/resolve
   * Batch resolve addresses
   */
  fastify.post('/labels/resolve', async (request, reply) => {
    try {
      const { addresses } = request.body as { addresses: Array<{ chain: string; address: string }> };
      
      if (!addresses || !Array.isArray(addresses)) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_INPUT',
          message: 'addresses array is required'
        });
      }
      
      const results = await batchResolveAddresses(addresses);
      
      // Convert Map to object
      const data: Record<string, any> = {};
      results.forEach((value, key) => {
        data[key] = value;
      });
      
      return {
        ok: true,
        data: { resolved: data, count: results.size }
      };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error resolving addresses:', error);
      return reply.code(500).send({
        ok: false,
        error: 'RESOLVE_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Exchange Entity Routes
  // ========================================
  
  /**
   * GET /api/exchanges
   * Search exchange entities
   */
  fastify.get('/exchanges', async (request, reply) => {
    try {
      const { q, type, tier, limit = 100 } = request.query as {
        q?: string;
        type?: string;
        tier?: number;
        limit?: number;
      };
      
      const entities = await searchExchangeEntities({
        q,
        type,
        tier: tier ? Number(tier) : undefined,
        limit: Number(limit)
      });
      
      return {
        ok: true,
        data: { entities, count: entities.length }
      };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error searching exchanges:', error);
      return reply.code(500).send({
        ok: false,
        error: 'SEARCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/exchanges/:identifier
   * Get exchange by ID or name
   */
  fastify.get('/exchanges/:identifier', async (request, reply) => {
    try {
      const { identifier } = request.params as { identifier: string };
      
      const entity = await getExchangeEntity(identifier);
      
      if (!entity) {
        return reply.code(404).send({
          ok: false,
          error: 'EXCHANGE_NOT_FOUND',
          message: `Exchange not found: ${identifier}`
        });
      }
      
      return {
        ok: true,
        data: entity
      };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error fetching exchange:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/exchanges/upsert
   * Create or update exchange entity
   */
  fastify.post('/exchanges/upsert', async (request, reply) => {
    try {
      const data = request.body as any;
      
      if (!data.name || !data.shortName || !data.type) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_INPUT',
          message: 'name, shortName, and type are required'
        });
      }
      
      const entity = await upsertExchangeEntity(data);
      
      return {
        ok: true,
        data: entity,
        message: `Exchange upserted: ${entity.name}`
      };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error upserting exchange:', error);
      return reply.code(500).send({
        ok: false,
        error: 'UPSERT_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/exchanges/:entityId/wallets
   * Add wallet to exchange
   */
  fastify.post('/exchanges/:entityId/wallets', async (request, reply) => {
    try {
      const { entityId } = request.params as { entityId: string };
      const wallet = request.body as any;
      
      if (!wallet.chain || !wallet.address) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_INPUT',
          message: 'chain and address are required'
        });
      }
      
      // Generate labelId for the wallet
      wallet.labelId = `LABEL:${wallet.chain.toUpperCase()}:${wallet.address.toLowerCase()}`;
      
      const entity = await addWalletToEntity(entityId, wallet);
      
      if (!entity) {
        return reply.code(404).send({
          ok: false,
          error: 'EXCHANGE_NOT_FOUND',
          message: `Exchange not found: ${entityId}`
        });
      }
      
      return {
        ok: true,
        data: entity,
        message: `Wallet added to ${entity.name}`
      };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error adding wallet:', error);
      return reply.code(500).send({
        ok: false,
        error: 'ADD_WALLET_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * DELETE /api/exchanges/:entityId/wallets/:chain/:address
   * Remove wallet from exchange
   */
  fastify.delete('/exchanges/:entityId/wallets/:chain/:address', async (request, reply) => {
    try {
      const { entityId, chain, address } = request.params as { 
        entityId: string; 
        chain: string; 
        address: string 
      };
      
      const entity = await removeWalletFromEntity(entityId, chain, address);
      
      if (!entity) {
        return reply.code(404).send({
          ok: false,
          error: 'EXCHANGE_NOT_FOUND',
          message: `Exchange not found: ${entityId}`
        });
      }
      
      return {
        ok: true,
        data: entity,
        message: `Wallet removed from ${entity.name}`
      };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error removing wallet:', error);
      return reply.code(500).send({
        ok: false,
        error: 'REMOVE_WALLET_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * DELETE /api/exchanges/:entityId
   * Delete exchange entity
   */
  fastify.delete('/exchanges/:entityId', async (request, reply) => {
    try {
      const { entityId } = request.params as { entityId: string };
      
      const deleted = await deleteExchangeEntity(entityId);
      
      if (!deleted) {
        return reply.code(404).send({
          ok: false,
          error: 'EXCHANGE_NOT_FOUND',
          message: `Exchange not found: ${entityId}`
        });
      }
      
      return {
        ok: true,
        message: `Exchange deleted: ${entityId}`
      };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error deleting exchange:', error);
      return reply.code(500).send({
        ok: false,
        error: 'DELETE_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/exchanges/stats
   * Get exchange statistics
   */
  fastify.get('/exchanges/stats', async (request, reply) => {
    try {
      const stats = await getExchangeStats();
      return { ok: true, data: stats };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error fetching exchange stats:', error);
      return reply.code(500).send({
        ok: false,
        error: 'STATS_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Seed Route
  // ========================================
  
  /**
   * POST /api/labels/seed
   * Seed known labels and exchanges
   */
  fastify.post('/labels/seed', async (request, reply) => {
    try {
      const result = await seedKnownLabels();
      
      return {
        ok: true,
        data: result,
        message: `Seeded ${result.entities} entities and ${result.labels} labels`
      };
    } catch (error: any) {
      fastify.log.error('[AddressLabels] Error seeding labels:', error);
      return reply.code(500).send({
        ok: false,
        error: 'SEED_ERROR',
        message: error.message
      });
    }
  });
  
  fastify.log.info('[Address Labels] Routes registered');
}
