/**
 * PHASE 1.2 — Market Search Service
 * ===================================
 * 
 * Handles symbol search and autocomplete.
 */

import { MarketSearchResult, MarketSearchItem } from './market.types.js';
import { normalizeQueryToSymbol, extractBase, extractQuote } from './symbol.normalizer.js';
import { resolveSymbolFromUniverse, searchUniverse, getAvailableExchanges } from './symbol.resolver.js';

/**
 * Search for assets by query
 */
export async function marketSearch(query: string): Promise<MarketSearchResult> {
  const normalized = normalizeQueryToSymbol(query);
  
  if (!normalized.ok || !normalized.symbol) {
    // Try fuzzy search even with partial input
    const fuzzyResults = await searchUniverse(query);
    
    return {
      ok: fuzzyResults.length > 0,
      items: fuzzyResults,
      query,
      normalized: null,
      reason: normalized.reason,
    };
  }
  
  const resolved = await resolveSymbolFromUniverse(normalized.symbol);
  
  if (resolved.found && resolved.item) {
    return {
      ok: true,
      items: [resolved.item],
      query,
      normalized: normalized.symbol,
    };
  }
  
  // Symbol not in universe - show as available but warn
  const exchanges = getAvailableExchanges();
  
  return {
    ok: true,
    items: [{
      symbol: normalized.symbol,
      base: normalized.base || extractBase(normalized.symbol),
      quote: normalized.quote || extractQuote(normalized.symbol),
      exchanges,
      score: undefined,
      inUniverse: false,
    }],
    query,
    normalized: normalized.symbol,
    reason: 'SYMBOL_NOT_IN_UNIVERSE',
  };
}

/**
 * Get top symbols for autocomplete
 */
export async function getTopSymbols(limit: number = 10): Promise<MarketSearchItem[]> {
  const results = await searchUniverse('');
  return results.slice(0, limit);
}

console.log('[Phase 1.2] Market Search Service loaded');
