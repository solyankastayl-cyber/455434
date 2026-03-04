/**
 * B2 — Universe Routes
 * 
 * API endpoints for Symbol Universe.
 */

import { FastifyPluginAsync } from 'fastify';
import {
  rebuildUniverse,
  getAllUniverse,
  getUniverseItem,
  getUniverseHealth,
} from './universe.builder.js';

export const universeRoutes: FastifyPluginAsync = async (fastify) => {
  // ─────────────────────────────────────────────────────────────
  // GET /universe — Get all universe items
  // Query: status, minScore, exchange, limit
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Querystring: {
      status?: string;
      minScore?: string;
      exchange?: string;
      limit?: string;
    };
  }>('/universe', async (request, reply) => {
    try {
      const { status, minScore, exchange, limit } = request.query;
      
      const items = await getAllUniverse({
        status,
        minScore: minScore ? parseFloat(minScore) : undefined,
        exchange,
        limit: limit ? parseInt(limit) : undefined,
      });
      
      return {
        ok: true,
        count: items.length,
        items,
      };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get universe',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /universe/health — Universe health status
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/universe/health', async (request, reply) => {
    try {
      const health = await getUniverseHealth();
      return { ok: true, ...health };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get universe health',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /universe/:symbol — Get specific symbol
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Params: { symbol: string };
  }>('/universe/:symbol', async (request, reply) => {
    try {
      const symbol = request.params.symbol.toUpperCase();
      const item = await getUniverseItem(symbol);
      
      if (!item) {
        return reply.status(404).send({
          ok: false,
          error: 'Symbol not found in universe',
        });
      }
      
      return { ok: true, item };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get universe item',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /universe/rebuild — Rebuild universe (admin)
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/universe/rebuild', async (request, reply) => {
    try {
      const result = await rebuildUniverse();
      return { ok: true, ...result };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to rebuild universe',
        message: error.message,
      });
    }
  });
};

console.log('[B2] Universe Routes loaded');
