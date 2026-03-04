/**
 * PHASE 2 — Observability Routes
 * ===============================
 * API for transparency & diagnostics
 */

import { FastifyInstance } from 'fastify';
import { timelineService } from '../services/timeline.service.js';
import { systemStatusService } from '../services/system.status.service.js';
import { dataQualityService } from '../services/dataquality.service.js';
import { truthAnalyticsService } from '../services/truth.analytics.service.js';

export async function registerObservabilityRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // PHASE 2.1 — SYSTEM STATUS
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/v10/observability/status — Full system status
  fastify.get('/api/v10/observability/status', async () => {
    const status = await systemStatusService.getStatus();
    return { ok: true, ...status };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PHASE 2.4 — TIMELINE
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/v10/observability/timeline — List events
  fastify.get<{
    Querystring: {
      limit?: string;
      cursor?: string;
      symbol?: string;
      type?: string;
      severity?: string;
    };
  }>('/api/v10/observability/timeline', async (request) => {
    const { limit, cursor, symbol, type, severity } = request.query;
    
    const result = await timelineService.list({
      limit: limit ? parseInt(limit) : 200,
      cursor: cursor || undefined,
      symbol: symbol || undefined,
      type: type as any,
      severity: severity as any,
    });
    
    return { ok: true, ...result };
  });
  
  // GET /api/v10/observability/timeline/stats — Event counts
  fastify.get<{ Querystring: { hours?: string } }>(
    '/api/v10/observability/timeline/stats',
    async (request) => {
      const hours = request.query.hours ? parseInt(request.query.hours) : 24;
      
      const byType = await timelineService.countByType(hours);
      const bySeverity = await timelineService.countBySeverity(hours);
      
      return {
        ok: true,
        hours,
        byType,
        bySeverity,
      };
    }
  );
  
  // POST /api/v10/observability/timeline/emit — Manual event (admin)
  fastify.post<{ Body: any }>('/api/v10/observability/timeline/emit', async (request) => {
    await timelineService.emit(request.body);
    return { ok: true };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PHASE 2.2 — DATA QUALITY
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/v10/observability/quality — Quality for all symbols
  fastify.get('/api/v10/observability/quality', async () => {
    const result = await dataQualityService.qualityList();
    return { ok: true, ...result };
  });
  
  // GET /api/v10/observability/quality/summary — Quality summary
  fastify.get('/api/v10/observability/quality/summary', async () => {
    const summary = await dataQualityService.summary();
    return { ok: true, ...summary };
  });
  
  // GET /api/v10/observability/quality/:symbol — Quality for symbol
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/observability/quality/:symbol',
    async (request) => {
      const quality = await dataQualityService.qualityForSymbol(
        request.params.symbol.toUpperCase()
      );
      return { ok: true, ...quality };
    }
  );
  
  // ═══════════════════════════════════════════════════════════════
  // PHASE 2.3 — TRUTH ANALYTICS
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/v10/observability/truth — Overall truth analytics
  fastify.get('/api/v10/observability/truth', async () => {
    const result = await truthAnalyticsService.overall();
    return { ok: true, ...result };
  });
  
  // GET /api/v10/observability/truth/:symbol — Truth for symbol
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/observability/truth/:symbol',
    async (request) => {
      const stats = truthAnalyticsService.statsForSymbol(
        request.params.symbol.toUpperCase()
      );
      return { ok: true, ...stats };
    }
  );
  
  // GET /api/v10/observability/truth/symbols — Symbols with truth data
  fastify.get('/api/v10/observability/truth/symbols', async () => {
    const symbols = truthAnalyticsService.getSymbolsWithData();
    return { ok: true, symbols };
  });
  
  console.log('[Phase 2] Observability Routes registered');
}
