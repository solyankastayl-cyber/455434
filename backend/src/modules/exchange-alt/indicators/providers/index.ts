/**
 * INDICATOR PROVIDERS INDEX
 * ==========================
 */

export * from './momentum.provider.js';
export * from './trend.provider.js';
export * from './volatility.provider.js';
export * from './volume.provider.js';
export * from './derivatives.provider.js';
export * from './structure.provider.js';

import { momentumProvider } from './momentum.provider.js';
import { trendProvider } from './trend.provider.js';
import { volatilityProvider } from './volatility.provider.js';
import { volumeProvider } from './volume.provider.js';
import { derivativesProvider } from './derivatives.provider.js';
import { structureProvider } from './structure.provider.js';

export const ALL_PROVIDERS = [
  momentumProvider,
  trendProvider,
  volatilityProvider,
  volumeProvider,
  derivativesProvider,
  structureProvider,
];

console.log('[ExchangeAlt] All indicator providers loaded');
