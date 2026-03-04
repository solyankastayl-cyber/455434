/**
 * X1 — Provider Selector
 * =======================
 * 
 * Resolves the best provider for a given symbol.
 * Falls back to MOCK if no provider available.
 */

import { IExchangeProvider, ProviderId } from './exchangeProvider.types.js';
import { getEnabledProviders, getProvider } from './provider.registry.js';

// Symbol cache to avoid repeated getSymbols calls
const symbolCache = new Map<ProviderId, { symbols: Set<string>; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5 minutes

/**
 * Resolve the best provider for a symbol
 */
export async function resolveProviderForSymbol(
  symbol: string
): Promise<IExchangeProvider> {
  const normalizedSymbol = symbol.toUpperCase().replace('-', '');
  const candidates = getEnabledProviders();
  
  // Common symbols that all major providers support
  const COMMON_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
  const isCommonSymbol = COMMON_SYMBOLS.includes(normalizedSymbol);
  
  for (const entry of candidates) {
    // Skip MOCK for common symbols if real providers available
    if (entry.config.id === 'MOCK' && isCommonSymbol && candidates.length > 1) {
      continue;
    }
    
    // If provider doesn't have getSymbols, assume it supports common symbols
    if (!entry.provider.getSymbols) {
      if (isCommonSymbol) {
        console.log(`[Selector] Using ${entry.config.id} for common symbol ${symbol}`);
        return entry.provider;
      }
      continue;
    }
    
    // Check cache first
    const cached = symbolCache.get(entry.provider.id);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      if (cached.symbols.has(normalizedSymbol)) {
        return entry.provider;
      }
      continue;
    }
    
    // Fetch and cache symbols
    try {
      const symbols = await entry.provider.getSymbols();
      const symbolSet = new Set(symbols.map(s => s.symbol.toUpperCase()));
      symbolCache.set(entry.provider.id, {
        symbols: symbolSet,
        cachedAt: Date.now(),
      });
      
      if (symbolSet.has(normalizedSymbol)) {
        return entry.provider;
      }
    } catch (error) {
      console.warn(`[Selector] Failed to get symbols from ${entry.provider.id}:`, error);
      // For common symbols, assume provider supports them even if getSymbols fails
      if (isCommonSymbol && entry.config.id !== 'MOCK') {
        console.log(`[Selector] Assuming ${entry.config.id} supports common symbol ${symbol}`);
        return entry.provider;
      }
      continue;
    }
  }
  
  // Fallback to MOCK provider
  const mockEntry = getProvider('MOCK');
  if (mockEntry) {
    console.warn(`[Selector] No real provider for ${symbol}, using MOCK`);
    return mockEntry.provider;
  }
  
  throw new Error(`No provider available for symbol ${symbol}`);
}

/**
 * Clear symbol cache (admin action)
 */
export function clearSymbolCache(): void {
  symbolCache.clear();
  console.log('[Selector] Symbol cache cleared');
}

/**
 * Get cache stats
 */
export function getCacheStats() {
  const entries: Record<string, number> = {};
  symbolCache.forEach((value, key) => {
    entries[key] = value.symbols.size;
  });
  return entries;
}

console.log('[X1] Provider Selector loaded');
