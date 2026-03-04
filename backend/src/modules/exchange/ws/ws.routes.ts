/**
 * PHASE 1.2 — WebSocket Admin Routes
 * ====================================
 * API for managing WebSocket connections
 */

import { FastifyInstance } from 'fastify';
import { wsManager } from './ws.manager.js';
import { wsRegistry } from './ws.registry.js';
import { marketRealtimeCache } from './market.realtime.cache.js';
import { WsProviderId } from './ws.types.js';

function asProviderId(x: string): WsProviderId {
  const upper = x.toUpperCase();
  if (upper !== 'BYBIT' && upper !== 'BINANCE') {
    throw new Error(`Invalid provider: ${x}. Must be BYBIT or BINANCE`);
  }
  return upper as WsProviderId;
}

export async function registerWsRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ws/status — All WS statuses
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/ws/status', async () => {
    return {
      ok: true,
      registry: wsRegistry.list(),
      runtime: wsManager.statusAll(),
      cache: marketRealtimeCache.getStatus(),
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/exchange/ws/:provider/start — Start WS
  // ─────────────────────────────────────────────────────────────
  fastify.post<{
    Params: { provider: string };
    Body: { symbols?: string[] };
  }>('/api/v10/exchange/ws/:provider/start', async (request) => {
    const providerId = asProviderId(request.params.provider);
    const symbols = request.body?.symbols;
    
    const status = wsManager.start(providerId, symbols);
    
    return {
      ok: true,
      message: `Started ${providerId} WebSocket`,
      status,
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/exchange/ws/:provider/stop — Stop WS
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Params: { provider: string } }>(
    '/api/v10/exchange/ws/:provider/stop',
    async (request) => {
      const providerId = asProviderId(request.params.provider);
      const status = wsManager.stop(providerId);
      
      return {
        ok: true,
        message: `Stopped ${providerId} WebSocket`,
        status,
      };
    }
  );
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ws/realtime/:symbol — Get realtime data
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/ws/realtime/:symbol',
    async (request) => {
      const symbol = request.params.symbol.toUpperCase();
      const data = marketRealtimeCache.get(symbol);
      const hasRealtime = marketRealtimeCache.hasRealtimeData(symbol);
      
      return {
        ok: true,
        symbol,
        hasRealtimeData: hasRealtime,
        data,
      };
    }
  );
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/ws/realtime — All realtime data
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/ws/realtime', async () => {
    return {
      ok: true,
      data: marketRealtimeCache.listAll(),
      status: marketRealtimeCache.getStatus(),
    };
  });
  
  console.log('[Phase 1.2] WS Routes registered');
}
