/**
 * PHASE 1.2 — Symbol Normalizer
 * ==============================
 * 
 * Converts user input (ETH, btcusdt, SOL) into canonical symbol format.
 */

const QUOTES = ['USDT', 'USDC', 'USD', 'BUSD', 'BTC', 'ETH'];

export interface NormalizeResult {
  ok: boolean;
  symbol?: string;
  base?: string;
  quote?: string;
  reason?: string;
}

/**
 * Normalize user query to canonical symbol format
 * 
 * Examples:
 *   "eth" → ETHUSDT
 *   "BTCUSDT" → BTCUSDT
 *   "sol" → SOLUSDT
 *   "BTC/USD" → BTCUSD
 */
export function normalizeQueryToSymbol(qRaw: string): NormalizeResult {
  const q = (qRaw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  
  if (!q) {
    return { ok: false, reason: 'EMPTY_QUERY' };
  }
  
  if (q.length < 2) {
    return { ok: false, reason: 'QUERY_TOO_SHORT' };
  }
  
  if (q.length > 20) {
    return { ok: false, reason: 'QUERY_TOO_LONG' };
  }
  
  // Check if user already typed full symbol with known quote
  for (const quote of QUOTES) {
    if (q.endsWith(quote) && q.length > quote.length) {
      const base = q.slice(0, q.length - quote.length);
      return { ok: true, symbol: `${base}${quote}`, base, quote };
    }
  }
  
  // User typed base only (ETH, BTC, SOL) → default to USDT
  if (/^[A-Z0-9]{2,12}$/.test(q)) {
    return { ok: true, symbol: `${q}USDT`, base: q, quote: 'USDT' };
  }
  
  return { ok: false, reason: 'INVALID_FORMAT' };
}

/**
 * Extract base from symbol
 */
export function extractBase(symbol: string): string {
  for (const quote of QUOTES) {
    if (symbol.endsWith(quote)) {
      return symbol.slice(0, symbol.length - quote.length);
    }
  }
  return symbol;
}

/**
 * Extract quote from symbol
 */
export function extractQuote(symbol: string): string {
  for (const quote of QUOTES) {
    if (symbol.endsWith(quote)) {
      return quote;
    }
  }
  return 'USDT';
}

console.log('[Phase 1.2] Symbol Normalizer loaded');
