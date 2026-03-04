/**
 * Phase J: Market Provider Factory
 */

import { BinanceSpotProvider, binanceSpotProvider } from './providers/binance_spot.provider.js';
import { MockMarketProvider, mockMarketProvider } from './providers/mock.provider.js';
import { MarketProviderConfig } from './market_types.js';
import { MarketProvider } from '../outcomes_v2/market_provider.js';

export type ProviderType = 'binance' | 'mock';

/**
 * Get market provider instance
 */
export function getMarketProvider(type: ProviderType = 'binance'): MarketProvider {
  switch (type) {
    case 'binance':
      return binanceSpotProvider;
    case 'mock':
    default:
      return mockMarketProvider;
  }
}

/**
 * Create new provider with custom config
 */
export function createMarketProvider(
  type: ProviderType,
  config?: Partial<MarketProviderConfig>
): MarketProvider {
  switch (type) {
    case 'binance':
      return new BinanceSpotProvider(config);
    case 'mock':
    default:
      return new MockMarketProvider();
  }
}

// Re-export for convenience
export { BinanceSpotProvider, binanceSpotProvider } from './providers/binance_spot.provider.js';
export { MockMarketProvider, mockMarketProvider } from './providers/mock.provider.js';
export * from './market_types.js';

// Phase S2: Hardened provider
export { 
  HardenedMarketDataProvider, 
  getHardenedProvider, 
  resetHardenedProvider,
  type HardenedCandles 
} from './hardened.provider.js';
