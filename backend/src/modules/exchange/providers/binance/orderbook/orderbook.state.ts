/**
 * PHASE 1 — Binance Orderbook State
 * ===================================
 * 
 * In-memory orderbook state management.
 */

import { OrderbookState, OrderbookLevel, BinanceDepthSnapshot, OrderbookSyncStatus } from './orderbook.types.js';

// ═══════════════════════════════════════════════════════════════
// STATE FACTORY
// ═══════════════════════════════════════════════════════════════

export function createEmptyState(symbol: string): OrderbookState {
  return {
    symbol,
    lastUpdateId: 0,
    bids: new Map(),
    asks: new Map(),
    ready: false,
    status: 'BUFFERING',
  };
}

// ═══════════════════════════════════════════════════════════════
// APPLY SNAPSHOT
// ═══════════════════════════════════════════════════════════════

export function applySnapshot(state: OrderbookState, snap: BinanceDepthSnapshot): void {
  state.bids.clear();
  state.asks.clear();
  
  for (const [pStr, qStr] of snap.bids) {
    const p = Number(pStr);
    const q = Number(qStr);
    if (q > 0) state.bids.set(p, q);
  }
  
  for (const [pStr, qStr] of snap.asks) {
    const p = Number(pStr);
    const q = Number(qStr);
    if (q > 0) state.asks.set(p, q);
  }
  
  state.lastUpdateId = snap.lastUpdateId;
}

// ═══════════════════════════════════════════════════════════════
// TO SORTED LEVELS
// ═══════════════════════════════════════════════════════════════

export function toSortedLevels(
  map: Map<number, number>,
  side: 'bids' | 'asks',
  limit: number = 200
): OrderbookLevel[] {
  const arr: OrderbookLevel[] = [];
  
  for (const [p, q] of map.entries()) {
    if (q > 0) arr.push({ p, q });
  }
  
  // Sort: bids descending, asks ascending
  arr.sort((a, b) => side === 'bids' ? b.p - a.p : a.p - b.p);
  
  return arr.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════
// COMPUTE MID PRICE
// ═══════════════════════════════════════════════════════════════

export function computeMidPrice(state: OrderbookState): number | undefined {
  const bids = toSortedLevels(state.bids, 'bids', 1);
  const asks = toSortedLevels(state.asks, 'asks', 1);
  
  if (bids.length === 0 || asks.length === 0) return undefined;
  
  return (bids[0].p + asks[0].p) / 2;
}

console.log('[Phase 1] Binance Orderbook State loaded');
