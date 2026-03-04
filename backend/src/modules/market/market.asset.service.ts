/**
 * PHASE 1.2 — Market Asset Service
 * ==================================
 * 
 * Main service for getting full asset market diagnosis.
 * 
 * This is THE product endpoint:
 * User types "ETH" → gets full Exchange verdict + Whale + Stress + Explainability
 */

import {
  MarketAssetResponse,
  MarketAssetAvailability,
  MarketAssetExchange,
  MarketAssetWhale,
  MarketAssetStress,
  MarketDataMode,
} from './market.types.js';
import { normalizeQueryToSymbol, extractBase, extractQuote } from './symbol.normalizer.js';
import { resolveSymbolFromUniverse, getAvailableExchanges } from './symbol.resolver.js';
import { resolveProviderForSymbol } from '../exchange/providers/provider.selector.js';
import { getProvider } from '../exchange/providers/provider.registry.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function createNoDataResponse(symbol: string, reason: string): MarketAssetResponse {
  return {
    symbol,
    base: extractBase(symbol),
    quote: extractQuote(symbol),
    availability: {
      exchanges: [],
      dataMode: 'MOCK',
      providerUsed: 'NONE',
      inUniverse: false,
      reasons: [reason],
    },
    exchange: {
      verdict: 'NO_DATA',
      confidence: 0,
      strength: 'NONE',
      drivers: [],
      risks: ['no_data_available'],
    },
    whale: {
      riskLevel: 'UNKNOWN',
      impact: 'Unable to assess',
      patterns: [],
    },
    stress: {
      level: 0,
      status: 'NORMAL',
      factors: [],
    },
    explainability: {
      drivers: [],
      risks: ['No data available for analysis'],
      summary: 'Unable to provide market diagnosis due to insufficient data.',
    },
    meta: {
      t0: new Date().toISOString(),
      version: 'market-v1.2',
      processingMs: 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// MOCK DATA GENERATORS (until real pipeline wiring)
// ═══════════════════════════════════════════════════════════════

function generateMockExchangeVerdict(symbol: string): MarketAssetExchange {
  // Deterministic based on symbol hash for consistency
  const hash = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const seed = hash % 100;
  
  let verdict: MarketAssetExchange['verdict'] = 'NEUTRAL';
  let confidence = 0.5;
  let drivers: string[] = [];
  let risks: string[] = [];
  
  if (seed < 30) {
    verdict = 'BULLISH';
    confidence = 0.55 + (seed / 100) * 0.3;
    drivers = ['Strong momentum indicators', 'Accumulation pattern detected', 'Positive order flow imbalance'];
    risks = ['Elevated whale activity'];
  } else if (seed < 60) {
    verdict = 'BEARISH';
    confidence = 0.55 + ((seed - 30) / 100) * 0.3;
    drivers = ['Weakening momentum', 'Distribution pattern detected', 'Negative order flow'];
    risks = ['Cascade liquidation risk', 'High leverage in market'];
  } else {
    verdict = 'NEUTRAL';
    confidence = 0.40 + ((seed - 60) / 100) * 0.2;
    drivers = ['Mixed signals', 'Low volatility regime'];
    risks = ['Unclear direction', 'Low conviction environment'];
  }
  
  const strength = confidence > 0.75 ? 'STRONG' : confidence > 0.55 ? 'MODERATE' : 'WEAK';
  
  return { verdict, confidence, strength, drivers, risks };
}

function generateMockWhaleData(symbol: string): MarketAssetWhale {
  const hash = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const seed = hash % 100;
  
  if (seed < 20) {
    return {
      riskLevel: 'HIGH',
      impact: 'Large whale positions detected, high manipulation risk',
      patterns: ['WHALE_ACCUMULATION', 'LARGE_TRANSFERS'],
    };
  } else if (seed < 50) {
    return {
      riskLevel: 'MEDIUM',
      impact: 'Moderate whale activity, normal for market',
      patterns: ['STEADY_FLOW'],
    };
  } else {
    return {
      riskLevel: 'LOW',
      impact: 'Low whale activity, retail-dominated flow',
      patterns: [],
    };
  }
}

function generateMockStressData(symbol: string): MarketAssetStress {
  const hash = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const seed = hash % 100;
  
  const level = seed / 100;
  let status: MarketAssetStress['status'] = 'NORMAL';
  let factors: string[] = [];
  
  if (level > 0.8) {
    status = 'CRITICAL';
    factors = ['Extreme volatility', 'Liquidation cascade imminent', 'Funding rate spike'];
  } else if (level > 0.6) {
    status = 'HIGH';
    factors = ['High volatility', 'Elevated OI', 'Abnormal spreads'];
  } else if (level > 0.4) {
    status = 'ELEVATED';
    factors = ['Moderate volatility', 'Increasing OI'];
  } else if (level > 0.2) {
    status = 'NORMAL';
    factors = ['Normal market conditions'];
  } else {
    status = 'LOW';
    factors = ['Low volatility', 'Stable market'];
  }
  
  return { level, status, factors };
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

/**
 * Get full market diagnosis for an asset
 */
export async function getMarketAsset(queryOrSymbol: string): Promise<MarketAssetResponse> {
  const startTime = Date.now();
  
  // 1. Normalize input
  const normalized = normalizeQueryToSymbol(queryOrSymbol);
  
  if (!normalized.ok || !normalized.symbol) {
    return createNoDataResponse(queryOrSymbol.toUpperCase(), normalized.reason || 'INVALID_QUERY');
  }
  
  const symbol = normalized.symbol;
  const base = normalized.base || extractBase(symbol);
  const quote = normalized.quote || extractQuote(symbol);
  
  // 2. Check universe
  const universeResult = await resolveSymbolFromUniverse(symbol);
  const inUniverse = universeResult.found;
  
  // 3. Resolve provider
  const provider = await resolveProviderForSymbol(symbol);
  const providerId = provider.id;
  const providerEntry = getProvider(providerId);
  const exchanges = getAvailableExchanges();
  
  // 4. Determine data mode
  let dataMode: MarketDataMode = 'MOCK';
  if (providerId !== 'MOCK') {
    const health = providerEntry?.health;
    if (health?.status === 'UP') {
      dataMode = 'LIVE';
    } else if (health?.status === 'DEGRADED') {
      dataMode = 'MIXED';
    }
  }
  
  // 5. Get exchange verdict (MOCK for now - will wire to real verdict engine)
  const exchange = generateMockExchangeVerdict(symbol);
  
  // 6. Get whale data (MOCK)
  const whale = generateMockWhaleData(symbol);
  
  // 7. Get stress data (MOCK)
  const stress = generateMockStressData(symbol);
  
  // 8. Build availability
  const availability: MarketAssetAvailability = {
    exchanges,
    dataMode,
    providerUsed: providerId,
    inUniverse,
    reasons: inUniverse ? [] : ['NOT_IN_UNIVERSE'],
  };
  
  // 9. Build explainability
  const allDrivers = [...exchange.drivers];
  const allRisks = [...exchange.risks, ...whale.patterns.map(p => `Whale: ${p}`)];
  
  if (whale.riskLevel === 'HIGH') {
    allRisks.unshift('HIGH WHALE RISK');
  }
  
  if (stress.status === 'CRITICAL' || stress.status === 'HIGH') {
    allRisks.unshift(`MARKET STRESS: ${stress.status}`);
  }
  
  const summary = buildSummary(symbol, exchange, whale, stress);
  
  const processingMs = Date.now() - startTime;
  
  return {
    symbol,
    base,
    quote,
    availability,
    exchange,
    whale,
    stress,
    explainability: {
      drivers: allDrivers,
      risks: allRisks,
      summary,
    },
    meta: {
      t0: new Date().toISOString(),
      version: 'market-v1.2',
      processingMs,
    },
  };
}

function buildSummary(
  symbol: string,
  exchange: MarketAssetExchange,
  whale: MarketAssetWhale,
  stress: MarketAssetStress
): string {
  const conf = Math.round(exchange.confidence * 100);
  
  let summary = `${symbol}: ${exchange.verdict} (${conf}% confidence, ${exchange.strength}).`;
  
  if (whale.riskLevel === 'HIGH') {
    summary += ' Warning: High whale activity detected.';
  }
  
  if (stress.status === 'CRITICAL') {
    summary += ' Market stress is CRITICAL.';
  } else if (stress.status === 'HIGH') {
    summary += ' Market stress is elevated.';
  }
  
  if (exchange.verdict === 'NEUTRAL') {
    summary += ' No clear directional signal.';
  }
  
  return summary;
}

console.log('[Phase 1.2] Market Asset Service loaded');
