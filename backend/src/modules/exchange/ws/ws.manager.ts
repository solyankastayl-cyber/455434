/**
 * PHASE 1.2 — WebSocket Manager
 * ==============================
 * Manages WS connections with auto-reconnect and circuit-breaker
 */

import { WsProviderId, WsStatus, TradeTick } from './ws.types.js';
import { wsRegistry } from './ws.registry.js';
import { marketRealtimeCache } from './market.realtime.cache.js';
import { BybitWsClient } from './bybit.ws.client.js';
import { BinanceWsClient } from './binance.ws.client.js';
import { timelineService } from '../../observability/services/timeline.service.js';

const nowIso = () => new Date().toISOString();

type ClientWrapper = {
  start: () => void;
  stop: () => void;
};

export class ExchangeWsManager {
  private statuses = new Map<WsProviderId, WsStatus>();
  private clients = new Map<WsProviderId, ClientWrapper>();
  private reconnectTimers = new Map<WsProviderId, NodeJS.Timeout>();
  
  constructor() {
    this.init('BYBIT');
    this.init('BINANCE');
  }
  
  private init(provider: WsProviderId): void {
    const cfg = wsRegistry.get(provider);
    this.statuses.set(provider, {
      provider,
      state: 'STOPPED',
      enabled: cfg.enabled,
      streams: cfg.streams,
      symbols: cfg.symbols,
      reconnects: 0,
      errors: 0,
    });
  }
  
  // ===== PUBLIC API =====
  
  statusAll(): WsStatus[] {
    return Array.from(this.statuses.values());
  }
  
  status(provider: WsProviderId): WsStatus {
    return this.statuses.get(provider)!;
  }
  
  start(provider: WsProviderId, symbols?: string[]): WsStatus {
    const cfg = wsRegistry.get(provider);
    const syms = symbols ?? cfg.symbols;
    
    // Update registry
    wsRegistry.patch(provider, { enabled: true, symbols: syms });
    
    const cur = this.status(provider);
    if (cur.state === 'RUNNING' || cur.state === 'STARTING') {
      return cur;
    }
    
    this.clearReconnect(provider);
    
    this.setStatus(provider, {
      ...cur,
      state: 'STARTING',
      enabled: true,
      symbols: syms,
      startedAt: nowIso(),
      lastError: undefined,
    });
    
    const onTrade = (t: TradeTick) => {
      marketRealtimeCache.upsertTrade(t);
    };
    
    const onHeartbeat = () => {
      const s = this.status(provider);
      this.setStatus(provider, {
        ...s,
        state: s.state === 'STARTING' ? 'RUNNING' : s.state,
        lastHeartbeatAt: nowIso(),
      });
    };
    
    const onError = (err: Error) => {
      const s = this.status(provider);
      const errors = s.errors + 1;
      
      const nextState = errors >= 5 ? 'DOWN' : errors >= 3 ? 'DEGRADED' : s.state;
      
      this.setStatus(provider, {
        ...s,
        errors,
        state: nextState,
        lastError: err.message,
      });
      
      if (errors < 5) {
        this.scheduleReconnect(provider, syms);
      }
    };
    
    const onClose = () => {
      const s = this.status(provider);
      if (s.state !== 'STOPPED' && s.enabled) {
        this.scheduleReconnect(provider, syms);
      }
    };
    
    let client: ClientWrapper;
    
    if (provider === 'BYBIT') {
      client = new BybitWsClient({
        url: 'wss://stream.bybit.com/v5/public/linear',
        symbols: syms,
        onTrade,
        onHeartbeat,
        onError,
        onClose,
      });
    } else {
      client = new BinanceWsClient({
        baseUrl: 'wss://fstream.binance.com',
        symbols: syms,
        onTrade,
        onHeartbeat,
        onError,
        onClose,
      });
    }
    
    this.clients.set(provider, client);
    
    try {
      client.start();
      
      // Emit timeline event
      timelineService.emit({
        type: 'WS_STARTED',
        severity: 'INFO',
        providerId: provider,
        message: `WebSocket ${provider} started`,
        data: { symbols: syms },
      });
    } catch (e: any) {
      onError(new Error(e?.message ?? String(e)));
    }
    
    return this.status(provider);
  }
  
  stop(provider: WsProviderId): WsStatus {
    wsRegistry.patch(provider, { enabled: false });
    this.clearReconnect(provider);
    
    const client = this.clients.get(provider);
    if (client) {
      try {
        client.stop();
      } catch {}
      this.clients.delete(provider);
    }
    
    const cur = this.status(provider);
    this.setStatus(provider, {
      ...cur,
      state: 'STOPPED',
      enabled: false,
    });
    
    // Emit timeline event
    timelineService.emit({
      type: 'WS_STOPPED',
      severity: 'INFO',
      providerId: provider,
      message: `WebSocket ${provider} stopped`,
    });
    
    return this.status(provider);
  }
  
  // ===== INTERNAL =====
  
  private setStatus(provider: WsProviderId, status: WsStatus): void {
    this.statuses.set(provider, status);
  }
  
  private scheduleReconnect(provider: WsProviderId, symbols: string[]): void {
    this.clearReconnect(provider);
    
    const cur = this.status(provider);
    const delay = Math.min(10_000, 1_000 + cur.reconnects * 1_000);
    
    console.log(`[WsManager] Scheduling reconnect for ${provider} in ${delay}ms`);
    
    // Emit reconnect event
    timelineService.emit({
      type: 'WS_RECONNECT',
      severity: 'WARN',
      providerId: provider,
      message: `WebSocket ${provider} reconnecting (attempt ${cur.reconnects + 1})`,
      data: { attempt: cur.reconnects + 1, delayMs: delay },
    });
    
    const timer = setTimeout(() => {
      const next = this.status(provider);
      this.setStatus(provider, {
        ...next,
        reconnects: next.reconnects + 1,
      });
      
      // Stop and restart
      const client = this.clients.get(provider);
      if (client) {
        try {
          client.stop();
        } catch {}
        this.clients.delete(provider);
      }
      
      this.start(provider, symbols);
    }, delay);
    
    this.reconnectTimers.set(provider, timer);
  }
  
  private clearReconnect(provider: WsProviderId): void {
    const t = this.reconnectTimers.get(provider);
    if (t) {
      clearTimeout(t);
      this.reconnectTimers.delete(provider);
    }
  }
}

// Singleton
export const wsManager = new ExchangeWsManager();

console.log('[Phase 1.2] WS Manager loaded');
