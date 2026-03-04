/**
 * PHASE 1.2 — WebSocket Registry
 * ===============================
 * Configuration for WS providers
 */

import { WsProviderConfig, WsProviderId } from './ws.types.js';

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

const registry: Record<WsProviderId, WsProviderConfig> = {
  BYBIT: {
    providerId: 'BYBIT',
    enabled: false,
    streams: ['orderbook', 'trades'],
    symbols: [...DEFAULT_SYMBOLS],
  },
  BINANCE: {
    providerId: 'BINANCE',
    enabled: false,
    streams: ['orderbook', 'trades'],
    symbols: [...DEFAULT_SYMBOLS],
  },
};

export const wsRegistry = {
  list(): WsProviderConfig[] {
    return Object.values(registry);
  },
  
  get(providerId: WsProviderId): WsProviderConfig {
    const cfg = registry[providerId];
    if (!cfg) throw new Error(`WS registry: unknown providerId=${providerId}`);
    return cfg;
  },
  
  patch(providerId: WsProviderId, patch: Partial<WsProviderConfig>): WsProviderConfig {
    const cur = wsRegistry.get(providerId);
    registry[providerId] = { ...cur, ...patch, providerId };
    return registry[providerId];
  },
};

console.log('[Phase 1.2] WS Registry loaded');
