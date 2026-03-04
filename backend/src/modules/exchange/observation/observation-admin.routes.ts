/**
 * S10.6 — Observation Admin Routes
 * 
 * Diagnostics and control endpoints for admin.
 */

import { FastifyInstance } from 'fastify';
import * as observationService from './observation.service.js';
import { detectPatterns } from '../patterns/pattern.detector.js';
import { generateMockPatternInput } from '../patterns/pattern.service.js';

export async function observationAdminRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/admin/exchange/observation/health — Storage health
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/admin/exchange/observation/health', async () => {
    const stats = await observationService.getStats();
    const count = await observationService.getCount();
    
    return {
      ok: true,
      health: {
        totalObservations: count,
        observationsPerHour: stats.observationsPerHour,
        conflictRate: stats.conflictRate,
        firstObservation: stats.firstObservation,
        lastObservation: stats.lastObservation,
        symbolCount: Object.keys(stats.observationsBySymbol).length,
      },
      storage: {
        type: 'mongodb',
        collection: 'exchange_observations',
        status: 'connected',
      },
    };
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/admin/exchange/observation/diagnostics — Full diagnostics
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/admin/exchange/observation/diagnostics', async () => {
    const stats = await observationService.getStats();
    const matrix = await observationService.getRegimePatternMatrix();
    
    // Get latest observation for each symbol
    const symbols = Object.keys(stats.observationsBySymbol);
    const latestBySymbol: Record<string, any> = {};
    
    for (const symbol of symbols.slice(0, 5)) {
      const recent = await observationService.getRecentObservations(symbol, 1);
      if (recent.length > 0) {
        latestBySymbol[symbol] = {
          timestamp: recent[0].timestamp,
          regime: recent[0].regime.type,
          patternCount: recent[0].patternCount,
          hasConflict: recent[0].hasConflict,
        };
      }
    }
    
    return {
      ok: true,
      stats,
      matrix,
      latestBySymbol,
      diagnostics: {
        cacheStatus: 'active',
        indexesCreated: ['symbol_timestamp', 'timestamp', 'regime.type', 'hasConflict', 'createdAt'],
      },
    };
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/admin/exchange/observation/:symbol/raw — Raw snapshot
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string } }>(
    '/api/admin/exchange/observation/:symbol/raw',
    async (request) => {
      const { symbol } = request.params;
      
      const recent = await observationService.getRecentObservations(symbol, 5);
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        count: recent.length,
        observations: recent,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // POST /api/admin/exchange/observation/clear — Clear observations
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { symbol?: string } }>(
    '/api/admin/exchange/observation/clear',
    async (request) => {
      const symbol = request.body?.symbol;
      
      const deletedCount = await observationService.clearObservations(symbol);
      
      return {
        ok: true,
        message: `Cleared ${deletedCount} observations${symbol ? ` for ${symbol}` : ''}`,
        deletedCount,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // POST /api/admin/exchange/observation/seed — Seed test data
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { symbol?: string; count?: number } }>(
    '/api/admin/exchange/observation/seed',
    async (request) => {
      const symbol = request.body?.symbol || 'BTCUSDT';
      const count = Math.min(request.body?.count || 10, 100);
      
      const created: string[] = [];
      
      for (let i = 0; i < count; i++) {
        // Generate mock market state
        const marketInput = observationService.generateMockObservationInput(symbol);
        
        // Detect patterns
        const patternInput = generateMockPatternInput(symbol);
        const patterns = detectPatterns(patternInput);
        
        // Create observation with offset timestamp
        const observation = await observationService.createObservation({
          ...marketInput,
          patterns,
        });
        
        created.push(observation.id);
        
        // Small delay to spread timestamps
        await new Promise(r => setTimeout(r, 10));
      }
      
      return {
        ok: true,
        message: `Created ${count} observations for ${symbol}`,
        count: created.length,
        ids: created.slice(0, 5),
      };
    }
  );

  console.log('[S10.6] Observation Admin routes registered: /api/admin/exchange/observation/*');
}

export default observationAdminRoutes;
