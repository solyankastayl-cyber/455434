/**
 * PHASE 1.2 — Symbol Resolver
 * ============================
 * 
 * Resolves symbol from Universe and determines exchange availability.
 */

import { MarketSearchItem } from './market.types.js';
import { listProviders } from '../exchange/providers/provider.registry.js';

// ═══════════════════════════════════════════════════════════════
// DEFAULT UNIVERSE (fallback when DB empty)
// ═══════════════════════════════════════════════════════════════

const DEFAULT_UNIVERSE: MarketSearchItem[] = [
  { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', exchanges: ['BYBIT_USDTPERP', 'BINANCE_USDM', 'MOCK'], score: 100, inUniverse: true },
  { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT', exchanges: ['BYBIT_USDTPERP', 'BINANCE_USDM', 'MOCK'], score: 95, inUniverse: true },
  { symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT', exchanges: ['BYBIT_USDTPERP', 'BINANCE_USDM', 'MOCK'], score: 85, inUniverse: true },
  { symbol: 'BNBUSDT', base: 'BNB', quote: 'USDT', exchanges: ['BYBIT_USDTPERP', 'BINANCE_USDM', 'MOCK'], score: 80, inUniverse: true },
  { symbol: 'XRPUSDT', base: 'XRP', quote: 'USDT', exchanges: ['BYBIT_USDTPERP', 'BINANCE_USDM', 'MOCK'], score: 75, inUniverse: true },
  { symbol: 'ADAUSDT', base: 'ADA', quote: 'USDT', exchanges: ['BYBIT_USDTPERP', 'BINANCE_USDM', 'MOCK'], score: 70, inUniverse: true },
  { symbol: 'DOGEUSDT', base: 'DOGE', quote: 'USDT', exchanges: ['BYBIT_USDTPERP', 'BINANCE_USDM', 'MOCK'], score: 65, inUniverse: true },
  { symbol: 'AVAXUSDT', base: 'AVAX', quote: 'USDT', exchanges: ['BYBIT_USDTPERP', 'BINANCE_USDM', 'MOCK'], score: 60, inUniverse: true },
  { symbol: 'DOTUSDT', base: 'DOT', quote: 'USDT', exchanges: ['BYBIT_USDTPERP', 'BINANCE_USDM', 'MOCK'], score: 55, inUniverse: true },
  { symbol: 'LINKUSDT', base: 'LINK', quote: 'USDT', exchanges: ['BYBIT_USDTPERP', 'BINANCE_USDM', 'MOCK'], score: 50, inUniverse: true },
];

// ═══════════════════════════════════════════════════════════════
// RESOLVER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export interface ResolveResult {
  found: boolean;
  item?: MarketSearchItem;
  reason?: string;
}

/**
 * Resolve symbol from universe
 */
export async function resolveSymbolFromUniverse(symbol: string): Promise<ResolveResult> {
  const normalizedSymbol = symbol.toUpperCase();
  
  // Try to find in default universe first
  const item = DEFAULT_UNIVERSE.find(x => x.symbol === normalizedSymbol);
  
  if (item) {
    return { found: true, item };
  }
  
  // Symbol not in universe - create ephemeral entry
  return {
    found: false,
    reason: 'SYMBOL_NOT_IN_UNIVERSE',
  };
}

/**
 * Get all available exchanges for a symbol
 */
export function getAvailableExchanges(): string[] {
  const providers = listProviders();
  return providers
    .filter(p => p.enabled)
    .map(p => p.id);
}

/**
 * Search universe by query (fuzzy match)
 */
export async function searchUniverse(query: string): Promise<MarketSearchItem[]> {
  const q = query.toUpperCase().trim();
  
  // If empty query, return all sorted by score
  if (!q) {
    return [...DEFAULT_UNIVERSE].sort((a, b) => (b.score || 0) - (a.score || 0));
  }
  
  // Exact match first
  const exact = DEFAULT_UNIVERSE.find(x => x.symbol === q || x.base === q);
  if (exact) {
    return [exact];
  }
  
  // Fuzzy match on base or symbol
  const matches = DEFAULT_UNIVERSE.filter(x => 
    x.symbol.includes(q) || x.base.includes(q)
  );
  
  // Sort by score descending
  return matches.sort((a, b) => (b.score || 0) - (a.score || 0));
}

/**
 * Get universe statistics
 */
export function getUniverseStats() {
  return {
    total: DEFAULT_UNIVERSE.length,
    active: DEFAULT_UNIVERSE.filter(x => x.inUniverse).length,
    avgScore: DEFAULT_UNIVERSE.reduce((sum, x) => sum + (x.score || 0), 0) / DEFAULT_UNIVERSE.length,
  };
}

console.log('[Phase 1.2] Symbol Resolver loaded');
