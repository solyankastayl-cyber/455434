/**
 * S10.W Step 5 — Whale Pattern Routes
 * 
 * API endpoints:
 * - GET /api/v10/exchange/whales/patterns/:symbol — current patterns
 * - GET /api/v10/exchange/whales/patterns/:symbol/history — history
 * - GET /api/v10/exchange/whales/patterns/active — top active patterns
 * 
 * NO SIGNALS, NO PREDICTIONS — only risk data.
 */

import { FastifyPluginAsync } from 'fastify';
import { detectWhalePatterns } from './whale-pattern.detector.js';
import * as storage from './whale-pattern.storage.js';
import { WhalePatternId } from './whale-pattern.types.js';

export const whalePatternRoutes: FastifyPluginAsync = async (fastify) => {
  // Ensure indexes
  await storage.ensureWhalePatternIndexes();
  
  // ─────────────────────────────────────────────────────────────
  // GET /patterns/:symbol — Current whale patterns
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Params: { symbol: string };
  }>('/patterns/:symbol', async (request, reply) => {
    try {
      const { symbol } = request.params;
      const snapshot = detectWhalePatterns(symbol.toUpperCase());
      
      return {
        ok: true,
        snapshot,
      };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /patterns/:symbol/history — Pattern history
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Params: { symbol: string };
    Querystring: {
      patternId?: WhalePatternId;
      riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
      startTime?: string;
      endTime?: string;
      limit?: string;
    };
  }>('/patterns/:symbol/history', async (request, reply) => {
    try {
      const { symbol } = request.params;
      const { patternId, riskLevel, startTime, endTime, limit } = request.query;
      
      const history = await storage.getPatternHistory({
        symbol: symbol.toUpperCase(),
        patternId,
        riskLevel,
        startTime: startTime ? parseInt(startTime) : undefined,
        endTime: endTime ? parseInt(endTime) : undefined,
        limit: limit ? parseInt(limit) : 100,
      });
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        count: history.length,
        history,
      };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /patterns/active — Top active high-risk patterns
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Querystring: {
      minRiskScore?: string;
      limit?: string;
    };
  }>('/patterns/active', async (request, reply) => {
    try {
      const { minRiskScore, limit } = request.query;
      
      const active = await storage.getActivePatterns(
        minRiskScore ? parseFloat(minRiskScore) : 0.5,
        limit ? parseInt(limit) : 50
      );
      
      return {
        ok: true,
        count: active.length,
        patterns: active,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /patterns/stats — Pattern statistics
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Querystring: {
      startTime?: string;
      endTime?: string;
    };
  }>('/patterns/stats', async (request, reply) => {
    try {
      const { startTime, endTime } = request.query;
      
      const now = Date.now();
      const start = startTime ? parseInt(startTime) : now - 24 * 60 * 60 * 1000; // 24h default
      const end = endTime ? parseInt(endTime) : now;
      
      const stats = await storage.getPatternStats(start, end);
      
      return {
        ok: true,
        startTime: start,
        endTime: end,
        stats,
      };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
};

console.log('[S10.W] Whale Pattern Routes loaded');
