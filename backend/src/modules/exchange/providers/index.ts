/**
 * S10 — Exchange Providers Module
 * 
 * Multi-exchange integration layer.
 * 
 * X1-X2: New provider layer with Binance USDM
 */

export * from './provider.types.js';
export * from './base.provider.js';
export * from './okx.provider.js';
export * from './provider.registry.js';
export * from './provider.routes.js';

// X1 - New universal types
export * from './exchangeProvider.types.js';

// X1 - Health & Circuit Breaker
export {
  createInitialHealth,
  registerSuccess,
  registerError,
  resetHealth,
  isUsable,
} from './provider.health.js';

// X1 - Provider Selector
export {
  resolveProviderForSymbol,
  clearSymbolCache,
  getCacheStats,
} from './provider.selector.js';

// X2 - Providers
export { MockExchangeProvider, mockExchangeProvider } from './mock.provider.js';
export { BinanceUSDMProvider, binanceUSDMProvider } from './binance.usdm.provider.js';
export { BybitUsdtPerpProvider, bybitUsdtPerpProvider } from './bybit.usdtperp.provider.js';
export { CoinbaseSpotProvider, coinbaseSpotProvider } from './coinbase/index.js';

// ═══════════════════════════════════════════════════════════════
// PROVIDER INITIALIZATION
// ═══════════════════════════════════════════════════════════════

import { registerProvider as registerNewProvider } from './provider.registry.js';
import { mockExchangeProvider } from './mock.provider.js';
import { binanceUSDMProvider } from './binance.usdm.provider.js';
import { bybitUsdtPerpProvider } from './bybit.usdtperp.provider.js';
import { coinbaseSpotProvider } from './coinbase/index.js';

let providersInitialized = false;

/**
 * Initialize X1-X2-Z1 providers (call once at startup)
 * 
 * Priority order:
 * - Bybit USDT Perp: 100 (primary - works in more regions)
 * - Binance USDM: 90 (secondary - may have regional blocks)
 * - Coinbase Spot: 10 (spot confirmation layer only)
 * - Mock: 1 (fallback - always available)
 */
export function initializeNewProviders(): void {
  if (providersInitialized) return;
  
  // Register Bybit USDT Perp as primary (priority 100)
  registerNewProvider(bybitUsdtPerpProvider, {
    enabled: true,
    priority: 100,
    timeoutMs: 10000,
    retries: 2,
  });
  
  // Register Binance USDM as secondary (priority 90)
  registerNewProvider(binanceUSDMProvider, {
    enabled: true,
    priority: 90,
    timeoutMs: 10000,
    retries: 2,
  });
  
  // Register Coinbase Spot as confirmation layer (priority 10)
  registerNewProvider(coinbaseSpotProvider as any, {
    enabled: true,
    priority: 10,
    timeoutMs: 10000,
    retries: 1,
  });
  
  // Register Mock as fallback (priority 1)
  registerNewProvider(mockExchangeProvider, {
    enabled: true,
    priority: 1,
    timeoutMs: 1000,
    retries: 0,
  });
  
  providersInitialized = true;
  console.log('[X1-X2-Z1] New providers initialized (Bybit > Binance > Coinbase > Mock)');
}

console.log('[S10.P] Exchange Providers module loaded');
