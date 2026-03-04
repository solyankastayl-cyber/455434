/**
 * SYMBOL NORMALIZER
 * =================
 * 
 * P3: Smart Caching Layer - Block 14
 * Canonical symbol normalization to prevent cache fragmentation.
 * 
 * Normalizes:
 * - BTC, BTCUSDT, BTC-PERP, btc → BTC
 * - ETH/USDT, ETHUSDT, eth → ETH
 * 
 * This ensures we don't create 3 separate cache entries for the same asset.
 */

// Common suffixes to strip
const SUFFIXES = ['USDT', 'USD', '-PERP', 'PERP', '/USDT', '/USD'];

// Symbol aliases (map to canonical)
const ALIASES: Record<string, string> = {
  'BITCOIN': 'BTC',
  'ETHEREUM': 'ETH',
  'SOLANA': 'SOL',
  'BINANCE': 'BNB',
  'RIPPLE': 'XRP',
  'CARDANO': 'ADA',
  'DOGECOIN': 'DOGE',
  'POLKADOT': 'DOT',
  'AVALANCHE': 'AVAX',
  'CHAINLINK': 'LINK',
  'POLYGON': 'MATIC',
  'LITECOIN': 'LTC',
};

/**
 * Normalize symbol to canonical form
 */
export function normalizeSymbol(symbol: string): string {
  if (!symbol) return 'BTC';
  
  let s = symbol.toUpperCase().trim();
  
  // Strip suffixes
  for (const suffix of SUFFIXES) {
    if (s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }
  
  // Check aliases
  if (ALIASES[s]) {
    s = ALIASES[s];
  }
  
  return s;
}

/**
 * Build normalized cache key
 */
export function buildNormalizedKey(
  symbol: string,
  horizon: string,
  prefix: string = 'symbol'
): string {
  const norm = normalizeSymbol(symbol);
  return `${prefix}:${norm}|h:${horizon.toUpperCase()}`;
}

/**
 * Normalize full trading pair to canonical base + quote
 */
export function normalizePair(symbol: string): { base: string; quote: string; full: string } {
  const base = normalizeSymbol(symbol);
  const quote = 'USDT'; // Default quote
  return {
    base,
    quote,
    full: `${base}${quote}`,
  };
}

console.log('[SymbolNormalizer] Module loaded');
