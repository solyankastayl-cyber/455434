/**
 * S10.5 — Pattern Admin Routes
 * 
 * Diagnostics and control endpoints for admin.
 */

import { FastifyInstance } from 'fastify';
import * as patternService from './pattern.service.js';

export async function patternAdminRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/admin/exchange/patterns/:symbol/diagnostics
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string } }>(
    '/api/admin/exchange/patterns/:symbol/diagnostics',
    async (request) => {
      const { symbol } = request.params;
      
      // Generate mock input and run diagnostics
      const input = patternService.generateMockPatternInput(symbol.toUpperCase());
      const diagnostics = patternService.updatePatternsWithDiagnostics(input);
      
      return {
        ok: true,
        ...diagnostics,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/admin/exchange/patterns/diagnostics — All diagnostics
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/admin/exchange/patterns/diagnostics', async () => {
    const states = patternService.getAllPatternStates();
    
    return {
      ok: true,
      symbols: states.map(s => s.symbol),
      summary: {
        totalSymbols: states.length,
        totalPatterns: states.reduce((sum, s) => sum + s.patterns.length, 0),
        conflictingSymbols: states.filter(s => s.hasConflict).length,
      },
      states: states.map(s => ({
        symbol: s.symbol,
        patternCount: s.patterns.length,
        hasConflict: s.hasConflict,
        patterns: s.patterns.map(p => p.name),
        lastUpdated: s.lastUpdated,
      })),
    };
  });

  // ─────────────────────────────────────────────────────────────
  // POST /api/admin/exchange/patterns/clear — Clear all state
  // ─────────────────────────────────────────────────────────────
  fastify.post('/api/admin/exchange/patterns/clear', async () => {
    patternService.clearPatternState();
    
    return {
      ok: true,
      message: 'Pattern state cleared',
    };
  });

  // ─────────────────────────────────────────────────────────────
  // POST /api/admin/exchange/patterns/test — Test detection
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { symbol: string } }>(
    '/api/admin/exchange/patterns/test',
    async (request) => {
      const symbol = request.body?.symbol || 'BTCUSDT';
      
      // Generate mock input
      const input = patternService.generateMockPatternInput(symbol);
      
      // Run with diagnostics
      const diagnostics = patternService.updatePatternsWithDiagnostics(input);
      
      return {
        ok: true,
        input,
        diagnostics,
      };
    }
  );

  console.log('[S10.5] Pattern Admin routes registered: /api/admin/exchange/patterns/*');
}

export default patternAdminRoutes;
