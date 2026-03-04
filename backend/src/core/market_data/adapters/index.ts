/**
 * Market Adapters Index (P1.5 + P2.1)
 */

export { coingeckoAdapter } from './coingecko.adapter.js';
export { binanceAdapter, binanceProtocolAdapter } from './binance.adapter.js';
export { 
  coinMarketCapAdapter, 
  coinMarketCapProtocolAdapter,
  SYMBOL_TO_CMC_ID 
} from './coinmarketcap.adapter.js';
export type { CMCMarketContext, CMCQuoteData } from './coinmarketcap.adapter.js';

export {
  resolveSymbol,
  getSupportedSymbols,
  getDefaultSymbols,
  isSymbolSupported,
  getBestSource,
  normalizeSymbol
} from './symbol_resolver.service.js';

export type { ResolvedSymbol } from './symbol_resolver.service.js';

export {
  SYMBOL_TO_COINGECKO,
  SYMBOL_TO_BINANCE,
  DEFAULT_MARKET_SYMBOLS,
  INTERVAL_TO_MS,
  INTERVAL_TO_COINGECKO_DAYS
} from './types.js';

export type {
  MarketAdapter,
  FetchCandlesRequest,
  FetchCandlesResponse
} from './types.js';
