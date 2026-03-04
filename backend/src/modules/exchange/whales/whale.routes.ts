/**
 * S10.W — Whale Intelligence Routes
 * 
 * API endpoints for whale data:
 * - GET /api/v10/exchange/whales/health
 * - GET /api/v10/exchange/whales/state/:symbol
 * - GET /api/v10/exchange/whales/events/:symbol
 * - GET /api/v10/exchange/whales/snapshots/:symbol
 * - GET /api/v10/exchange/whales/indicators/:symbol
 * - POST /api/v10/exchange/whales/mock/seed
 * - POST /api/v10/exchange/whales/mock/tick
 * - DELETE /api/v10/exchange/whales/clear (admin)
 * 
 * NO SIGNALS, NO PREDICTIONS — only data access.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import * as storage from './whale-storage.service.js';
import { buildWhaleMarketState, calculateWhaleIndicators } from './whale-state.service.js';
import { seedMockWhaleData, generateWhaleTick } from './whale-mock.generator.js';
import {
  WhaleHealthResponse,
  WhaleStateResponse,
  WhaleEventsResponse,
  WhaleSeedResponse,
  ExchangeId,
  WhaleSourceStatus,
  LargePositionSnapshot,
} from './whale.types.js';
import { hyperliquidWhaleProvider } from './providers/hyperliquid.provider.js';
import { runWhaleIngest, getIngestStatus } from './whale-ingest.job.js';

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export const whaleRoutes: FastifyPluginAsync = async (fastify) => {
  // Ensure indexes on startup
  await storage.ensureWhaleIndexes();
  
  // ─────────────────────────────────────────────────────────────
  // GET /health — Overall whale data health
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/health', async (request, reply) => {
    try {
      const allHealth = await storage.getAllHealth();
      const stats = await storage.getWhaleStats();
      
      // Get provider status
      const providerStatus = hyperliquidWhaleProvider.getStatus();
      const dataMode = hyperliquidWhaleProvider.getDataMode();
      
      // Determine aggregated status
      let aggregatedStatus: WhaleSourceStatus = 'UP';
      if (allHealth.some(h => h.status === 'DOWN')) {
        aggregatedStatus = 'DEGRADED';
      }
      if (allHealth.every(h => h.status === 'DOWN')) {
        aggregatedStatus = 'DOWN';
      }
      
      const response: WhaleHealthResponse & { dataMode: string; providerRunning: boolean } = {
        sources: allHealth,
        aggregatedStatus,
        totalPositionsTracked: allHealth.reduce((sum, h) => sum + h.positionsTracked, 0),
        symbolsCovered: stats.symbolsCovered,
        lastGlobalUpdate: Math.max(...allHealth.map(h => h.lastUpdate), 0),
        dataMode,
        providerRunning: providerStatus.running,
      };
      
      return response;
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to get whale health',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /state/:symbol — Latest whale state for symbol
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Params: { symbol: string };
    Querystring: { exchange?: ExchangeId };
  }>('/state/:symbol', async (request, reply) => {
    try {
      const { symbol } = request.params;
      const exchange = request.query.exchange ?? 'hyperliquid';
      
      // Get latest state from storage
      let state = await storage.getLatestState(exchange, symbol);
      
      // If no state, try to build from snapshots
      if (!state) {
        const snapshots = await storage.getLatestSnapshots(exchange, symbol, 50);
        if (snapshots.length > 0) {
          state = buildWhaleMarketState(exchange, symbol, snapshots);
        }
      }
      
      // Calculate indicators if we have state
      const indicators = state ? calculateWhaleIndicators(state) : null;
      
      const response: WhaleStateResponse = {
        state,
        indicators,
        source: state?.source ?? 'mock',
        timestamp: Date.now(),
      };
      
      return response;
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to get whale state',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /events/:symbol — Whale events for symbol
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Params: { symbol: string };
    Querystring: {
      exchange?: ExchangeId;
      limit?: string;
      startTime?: string;
      endTime?: string;
    };
  }>('/events/:symbol', async (request, reply) => {
    try {
      const { symbol } = request.params;
      const {
        exchange,
        limit = '50',
        startTime,
        endTime,
      } = request.query;
      
      const events = await storage.getEvents({
        exchange,
        symbol,
        limit: parseInt(limit),
        startTime: startTime ? parseInt(startTime) : undefined,
        endTime: endTime ? parseInt(endTime) : undefined,
      });
      
      const response: WhaleEventsResponse = {
        events,
        totalCount: events.length,
        startTime: events.length > 0 ? Math.min(...events.map(e => e.timestamp)) : 0,
        endTime: events.length > 0 ? Math.max(...events.map(e => e.timestamp)) : 0,
      };
      
      return response;
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to get whale events',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /snapshots/:symbol — Position snapshots for symbol
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Params: { symbol: string };
    Querystring: {
      exchange?: ExchangeId;
      side?: 'LONG' | 'SHORT';
      minSizeUsd?: string;
      limit?: string;
    };
  }>('/snapshots/:symbol', async (request, reply) => {
    try {
      const { symbol } = request.params;
      const {
        exchange,
        side,
        minSizeUsd,
        limit = '50',
      } = request.query;
      
      const snapshots = await storage.getSnapshots({
        exchange,
        symbol,
        side,
        minSizeUsd: minSizeUsd ? parseFloat(minSizeUsd) : undefined,
        limit: parseInt(limit),
      });
      
      return {
        snapshots,
        count: snapshots.length,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to get whale snapshots',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /indicators/:symbol — Whale indicators only
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Params: { symbol: string };
    Querystring: { exchange?: ExchangeId };
  }>('/indicators/:symbol', async (request, reply) => {
    try {
      const { symbol } = request.params;
      const exchange = request.query.exchange ?? 'hyperliquid';
      
      // Get or build state
      let state = await storage.getLatestState(exchange, symbol);
      
      if (!state) {
        const snapshots = await storage.getLatestSnapshots(exchange, symbol, 50);
        if (snapshots.length > 0) {
          state = buildWhaleMarketState(exchange, symbol, snapshots);
        }
      }
      
      if (!state) {
        return {
          indicators: null,
          message: 'No whale data available for symbol',
          timestamp: Date.now(),
        };
      }
      
      const indicators = calculateWhaleIndicators(state);
      
      return {
        indicators,
        stateTimestamp: state.timestamp,
        confidence: state.confidence,
        source: state.source,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to get whale indicators',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /stats — Overall statistics
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/stats', async (request, reply) => {
    try {
      const stats = await storage.getWhaleStats();
      return {
        ...stats,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to get whale stats',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /mock/seed — Seed mock data
  // ─────────────────────────────────────────────────────────────
  
  fastify.post<{
    Body: {
      exchanges?: ExchangeId[];
      symbols?: string[];
      positionsPerSymbol?: number;
      eventsPerSymbol?: number;
    };
  }>('/mock/seed', async (request, reply) => {
    try {
      const result = await seedMockWhaleData(request.body ?? {});
      
      const response: WhaleSeedResponse = {
        success: true,
        snapshotsCreated: result.snapshotsCreated,
        eventsCreated: result.eventsCreated,
        statesCreated: result.statesCreated,
        duration: result.duration,
      };
      
      return response;
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to seed mock data',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /mock/tick — Generate single tick of mock data
  // ─────────────────────────────────────────────────────────────
  
  fastify.post<{
    Body: {
      exchange?: ExchangeId;
      symbol: string;
    };
  }>('/mock/tick', async (request, reply) => {
    try {
      const { exchange = 'hyperliquid', symbol } = request.body;
      
      if (!symbol) {
        return reply.status(400).send({
          error: 'symbol is required',
        });
      }
      
      const result = await generateWhaleTick(exchange, symbol);
      
      return {
        success: true,
        state: result.state,
        indicators: result.indicators,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to generate tick',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // DELETE /clear — Clear all whale data (admin)
  // ─────────────────────────────────────────────────────────────
  
  fastify.delete('/clear', async (request, reply) => {
    try {
      const result = await storage.clearAllWhaleData();
      
      return {
        success: true,
        deleted: result.deleted,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to clear whale data',
        message: error.message,
      });
    }
  });
};

// ═══════════════════════════════════════════════════════════════
// ADMIN ROUTES (separate prefix)
// ═══════════════════════════════════════════════════════════════

export const whaleAdminRoutes: FastifyPluginAsync = async (fastify) => {
  // ─────────────────────────────────────────────────────────────
  // GET /provider/status — Get Hyperliquid provider status
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/provider/status', async (request, reply) => {
    try {
      const status = hyperliquidWhaleProvider.getStatus();
      const dataMode = hyperliquidWhaleProvider.getDataMode();
      const addressCount = hyperliquidWhaleProvider.getWhaleAddressCount();
      
      return {
        ...status,
        dataMode,
        whaleAddressCount: addressCount,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to get provider status',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /provider/start — Start Hyperliquid provider polling
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/provider/start', async (request, reply) => {
    try {
      await hyperliquidWhaleProvider.start();
      
      return {
        success: true,
        running: hyperliquidWhaleProvider.isRunning(),
        dataMode: hyperliquidWhaleProvider.getDataMode(),
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to start provider',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /provider/stop — Stop Hyperliquid provider polling
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/provider/stop', async (request, reply) => {
    try {
      await hyperliquidWhaleProvider.stop();
      
      return {
        success: true,
        running: hyperliquidWhaleProvider.isRunning(),
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to stop provider',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /provider/fetch — Manual fetch from Hyperliquid
  // ─────────────────────────────────────────────────────────────
  
  fastify.post<{
    Body: {
      symbols?: string[];
      minPositionUsd?: number;
      limit?: number;
    };
  }>('/provider/fetch', async (request, reply) => {
    try {
      const result = await hyperliquidWhaleProvider.fetchSnapshots(request.body ?? {});
      
      return {
        success: true,
        dataMode: hyperliquidWhaleProvider.getDataMode(),
        snapshotCount: result.snapshots.length,
        durationMs: result.durationMs,
        errors: result.errors,
        snapshots: result.snapshots.slice(0, 20), // Return first 20
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to fetch from provider',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /provider/config — Update provider config
  // ─────────────────────────────────────────────────────────────
  
  fastify.post<{
    Body: {
      symbols?: string[];
      minPositionUsd?: number;
      pollingIntervalMs?: number;
      enabled?: boolean;
      useMockFallback?: boolean;
      whaleAddresses?: string[];
    };
  }>('/provider/config', async (request, reply) => {
    try {
      hyperliquidWhaleProvider.updateConfig(request.body ?? {});
      
      return {
        success: true,
        config: hyperliquidWhaleProvider.getConfig(),
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to update provider config',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /provider/clear-cache — Clear whale address cache
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/provider/clear-cache', async (request, reply) => {
    try {
      hyperliquidWhaleProvider.clearAddressCache();
      
      return {
        success: true,
        message: 'Address cache cleared, will fetch fresh leaderboard on next poll',
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to clear cache',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /ingest/run — Run whale ingest job manually
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/ingest/run', async (request, reply) => {
    try {
      const result = await runWhaleIngest();
      
      return {
        success: true,
        ...result,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to run ingest',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /ingest/status — Get ingest job status
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/ingest/status', async (request, reply) => {
    try {
      const status = getIngestStatus();
      
      return {
        ...status,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to get ingest status',
        message: error.message,
      });
    }
  });

  // GET /diagnostics — Full diagnostic info
  fastify.get('/diagnostics', async (request, reply) => {
    try {
      const [health, stats] = await Promise.all([
        storage.getAllHealth(),
        storage.getWhaleStats(),
      ]);
      
      return {
        health,
        stats,
        timestamp: Date.now(),
        module: 'S10.W',
        version: '1.0.0',
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to get diagnostics',
        message: error.message,
      });
    }
  });
  
  // POST /health/update — Manually update health status
  fastify.post<{
    Body: {
      exchange: ExchangeId;
      status: 'UP' | 'DEGRADED' | 'DOWN';
      error?: string;
    };
  }>('/health/update', async (request, reply) => {
    try {
      const { exchange, status, error } = request.body;
      
      const existingHealth = await storage.getHealth(exchange);
      
      await storage.saveHealth({
        exchange,
        status,
        lastUpdate: Date.now(),
        coverage: existingHealth?.coverage ?? 0,
        confidence: existingHealth?.confidence ?? 0,
        positionsTracked: existingHealth?.positionsTracked ?? 0,
        lastError: error,
        errorCountLastHour: status === 'DOWN' 
          ? (existingHealth?.errorCountLastHour ?? 0) + 1 
          : 0,
      });
      
      return {
        success: true,
        exchange,
        status,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to update health',
        message: error.message,
      });
    }
  });
};

console.log('[S10.W] Whale Routes loaded');
