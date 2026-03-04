/**
 * Symbol Resolver Service (P1.5)
 * 
 * Maps internal symbols to exchange-specific pairs.
 */

import {
  SYMBOL_TO_COINGECKO,
  SYMBOL_TO_BINANCE,
  DEFAULT_MARKET_SYMBOLS
} from './types.js';
import { MarketSource } from '../storage/market_candle.model.js';

// ============================================
// Types
// ============================================

export interface ResolvedSymbol {
  internal: string;
  external: string;
  source: MarketSource;
  supported: boolean;
}

// ============================================
// Symbol Resolver
// ============================================

/**
 * Resolve symbol for a specific source
 */
export function resolveSymbol(
  symbol: string,
  source: MarketSource
): ResolvedSymbol {
  const normalized = symbol.toUpperCase();
  
  switch (source) {
    case 'coingecko': {
      const external = SYMBOL_TO_COINGECKO[normalized];
      return {
        internal: normalized,
        external: external || normalized.toLowerCase(),
        source,
        supported: !!external
      };
    }
    
    case 'binance': {
      const external = SYMBOL_TO_BINANCE[normalized];
      return {
        internal: normalized,
        external: external || `${normalized}USDT`,
        source,
        supported: !!external
      };
    }
    
    case 'bybit': {
      // Bybit uses same format as Binance
      const external = SYMBOL_TO_BINANCE[normalized];
      return {
        internal: normalized,
        external: external || `${normalized}USDT`,
        source,
        supported: !!external
      };
    }
    
    default:
      return {
        internal: normalized,
        external: normalized,
        source,
        supported: false
      };
  }
}

/**
 * Get all supported symbols for a source
 */
export function getSupportedSymbols(source: MarketSource): string[] {
  switch (source) {
    case 'coingecko':
      return Object.keys(SYMBOL_TO_COINGECKO);
    case 'binance':
    case 'bybit':
      return Object.keys(SYMBOL_TO_BINANCE);
    default:
      return [];
  }
}

/**
 * Get default symbols to track
 */
export function getDefaultSymbols(): string[] {
  return [...DEFAULT_MARKET_SYMBOLS];
}

/**
 * Check if symbol is supported by any source
 */
export function isSymbolSupported(symbol: string): boolean {
  const normalized = symbol.toUpperCase();
  return SYMBOL_TO_COINGECKO[normalized] !== undefined ||
         SYMBOL_TO_BINANCE[normalized] !== undefined;
}

/**
 * Get best source for a symbol
 */
export function getBestSource(symbol: string): MarketSource {
  const normalized = symbol.toUpperCase();
  
  // Prefer CoinGecko as primary source
  if (SYMBOL_TO_COINGECKO[normalized]) {
    return 'coingecko';
  }
  
  // Fallback to Binance
  if (SYMBOL_TO_BINANCE[normalized]) {
    return 'binance';
  }
  
  // Default to CoinGecko
  return 'coingecko';
}

/**
 * Normalize symbol (handle aliases)
 */
export function normalizeSymbol(symbol: string): string {
  const normalized = symbol.toUpperCase();
  
  // Handle common aliases
  const aliases: Record<string, string> = {
    'POL': 'MATIC',
    'WETH': 'ETH',
    'WBTC': 'BTC'
  };
  
  return aliases[normalized] || normalized;
}
