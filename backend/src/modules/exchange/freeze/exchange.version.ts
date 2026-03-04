/**
 * PHASE 1.4 — Exchange Version Lock
 * ==================================
 * Tracks versioning of Exchange logic components
 */

export const EXCHANGE_VERSION = {
  indicatorRegistry: 'v1.1.0', // 38 indicators incl. whales
  regimes: 'v1.0.0',
  patterns: 'v1.0.0',
  verdict: 'v1.0.0',
  metaBrainHook: 'v1.0.0',
  dataWiring: 'v1.1.0', // Phase 1.1 complete
  wsLayer: 'v1.2.0', // Phase 1.2 complete
};

export function getExchangeVersionString(): string {
  return [
    `ind:${EXCHANGE_VERSION.indicatorRegistry}`,
    `reg:${EXCHANGE_VERSION.regimes}`,
    `pat:${EXCHANGE_VERSION.patterns}`,
    `ver:${EXCHANGE_VERSION.verdict}`,
    `hook:${EXCHANGE_VERSION.metaBrainHook}`,
    `data:${EXCHANGE_VERSION.dataWiring}`,
    `ws:${EXCHANGE_VERSION.wsLayer}`,
  ].join('|');
}

export function getExchangeVersionObject(): typeof EXCHANGE_VERSION {
  return { ...EXCHANGE_VERSION };
}

console.log('[Phase 1.4] Exchange Version loaded:', getExchangeVersionString());
