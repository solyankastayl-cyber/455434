/**
 * Source Pool Capability Routing Tests (P2.1)
 * 
 * Tests for capabilities-aware source selection.
 */

import { describe, it, expect } from 'vitest';

// ============================================
// Types
// ============================================

interface SourceCapabilities {
  candles: boolean;
  price: boolean;
  volume: boolean;
  marketContext: boolean;
  candleIntervals?: string[];
  rateLimitRpm: number;
  requiresKey: boolean;
}

interface MockSource {
  provider: string;
  label: string;
  capabilities: string[];
  limits: { rpm: number };
  weight: number;
  enabled: boolean;
  apiKey: string | null;
}

// ============================================
// Capability Routing Tests
// ============================================

describe('Source Pool Capability Routing', () => {
  
  function getCapabilities(source: MockSource): SourceCapabilities {
    return {
      candles: source.capabilities.includes('candles'),
      price: source.capabilities.includes('price'),
      volume: source.capabilities.includes('volume'),
      marketContext: source.capabilities.includes('market_context'),
      candleIntervals: source.provider === 'binance' ? ['1m', '5m', '1h', '4h', '1d'] : ['1h', '4h', '1d'],
      rateLimitRpm: source.limits.rpm,
      requiresKey: source.provider === 'coinmarketcap'
    };
  }
  
  it('should identify Binance candle capabilities', () => {
    const binanceSource: MockSource = {
      provider: 'binance',
      label: 'Binance Public',
      capabilities: ['candles', 'price', 'volume'],
      limits: { rpm: 1200 },
      weight: 10,
      enabled: true,
      apiKey: null
    };
    
    const caps = getCapabilities(binanceSource);
    
    expect(caps.candles).toBe(true);
    expect(caps.volume).toBe(true);
    expect(caps.marketContext).toBe(false);
    expect(caps.candleIntervals).toContain('1m');
    expect(caps.candleIntervals).toContain('5m');
    expect(caps.requiresKey).toBe(false);
  });
  
  it('should identify CoinGecko capabilities', () => {
    const coingeckoSource: MockSource = {
      provider: 'coingecko',
      label: 'CoinGecko Free',
      capabilities: ['candles', 'price', 'volume', 'market_context'],
      limits: { rpm: 30 },
      weight: 8,
      enabled: true,
      apiKey: null
    };
    
    const caps = getCapabilities(coingeckoSource);
    
    expect(caps.candles).toBe(true);
    expect(caps.marketContext).toBe(true);
    expect(caps.rateLimitRpm).toBe(30);
    expect(caps.requiresKey).toBe(false);
  });
  
  it('should identify CMC as requiring API key', () => {
    const cmcSource: MockSource = {
      provider: 'coinmarketcap',
      label: 'CMC Basic',
      capabilities: ['price', 'volume', 'market_context'],
      limits: { rpm: 333 }, // ~10k/month free tier
      weight: 5,
      enabled: true,
      apiKey: 'cmc_key_123'
    };
    
    const caps = getCapabilities(cmcSource);
    
    expect(caps.candles).toBe(false); // CMC doesn't provide candles in free tier
    expect(caps.marketContext).toBe(true);
    expect(caps.requiresKey).toBe(true);
  });
});

// ============================================
// Source Selection Tests
// ============================================

describe('Source Selection by Capability', () => {
  
  function selectSourceForCapability(
    sources: MockSource[],
    requiredCapability: string
  ): MockSource | null {
    // Filter by capability
    const eligible = sources.filter(s => 
      s.enabled && 
      s.capabilities.includes(requiredCapability)
    );
    
    if (eligible.length === 0) return null;
    
    // Sort by weight (highest first)
    eligible.sort((a, b) => b.weight - a.weight);
    
    return eligible[0];
  }
  
  it('should select highest weight source for candles', () => {
    const sources: MockSource[] = [
      {
        provider: 'coingecko',
        label: 'CoinGecko',
        capabilities: ['candles', 'price'],
        limits: { rpm: 30 },
        weight: 8,
        enabled: true,
        apiKey: null
      },
      {
        provider: 'binance',
        label: 'Binance',
        capabilities: ['candles', 'price', 'volume'],
        limits: { rpm: 1200 },
        weight: 10,
        enabled: true,
        apiKey: null
      }
    ];
    
    const selected = selectSourceForCapability(sources, 'candles');
    
    expect(selected?.provider).toBe('binance');
    expect(selected?.weight).toBe(10);
  });
  
  it('should skip disabled sources', () => {
    const sources: MockSource[] = [
      {
        provider: 'binance',
        label: 'Binance',
        capabilities: ['candles'],
        limits: { rpm: 1200 },
        weight: 10,
        enabled: false, // Disabled
        apiKey: null
      },
      {
        provider: 'coingecko',
        label: 'CoinGecko',
        capabilities: ['candles'],
        limits: { rpm: 30 },
        weight: 8,
        enabled: true,
        apiKey: null
      }
    ];
    
    const selected = selectSourceForCapability(sources, 'candles');
    
    expect(selected?.provider).toBe('coingecko');
  });
  
  it('should return null if no source has capability', () => {
    const sources: MockSource[] = [
      {
        provider: 'coingecko',
        label: 'CoinGecko',
        capabilities: ['candles', 'price'],
        limits: { rpm: 30 },
        weight: 8,
        enabled: true,
        apiKey: null
      }
    ];
    
    const selected = selectSourceForCapability(sources, 'market_context');
    
    // CoinGecko doesn't have market_context in this mock
    expect(selected).toBeNull();
  });
  
  it('should find CMC for market_context', () => {
    const sources: MockSource[] = [
      {
        provider: 'binance',
        label: 'Binance',
        capabilities: ['candles', 'price', 'volume'],
        limits: { rpm: 1200 },
        weight: 10,
        enabled: true,
        apiKey: null
      },
      {
        provider: 'coinmarketcap',
        label: 'CMC',
        capabilities: ['price', 'market_context'],
        limits: { rpm: 333 },
        weight: 5,
        enabled: true,
        apiKey: 'key'
      }
    ];
    
    const selected = selectSourceForCapability(sources, 'market_context');
    
    expect(selected?.provider).toBe('coinmarketcap');
  });
});

// ============================================
// Failover Tests
// ============================================

describe('Source Failover', () => {
  
  function getFailoverSources(
    sources: MockSource[],
    capability: string,
    excludeProviders: string[]
  ): MockSource[] {
    return sources.filter(s =>
      s.enabled &&
      s.capabilities.includes(capability) &&
      !excludeProviders.includes(s.provider)
    ).sort((a, b) => b.weight - a.weight);
  }
  
  it('should provide failover sources', () => {
    const sources: MockSource[] = [
      {
        provider: 'binance',
        label: 'Binance',
        capabilities: ['candles'],
        limits: { rpm: 1200 },
        weight: 10,
        enabled: true,
        apiKey: null
      },
      {
        provider: 'coingecko',
        label: 'CoinGecko',
        capabilities: ['candles'],
        limits: { rpm: 30 },
        weight: 8,
        enabled: true,
        apiKey: null
      }
    ];
    
    // Binance failed, get failover
    const failovers = getFailoverSources(sources, 'candles', ['binance']);
    
    expect(failovers).toHaveLength(1);
    expect(failovers[0].provider).toBe('coingecko');
  });
  
  it('should return empty array if no failover available', () => {
    const sources: MockSource[] = [
      {
        provider: 'binance',
        label: 'Binance',
        capabilities: ['candles'],
        limits: { rpm: 1200 },
        weight: 10,
        enabled: true,
        apiKey: null
      }
    ];
    
    const failovers = getFailoverSources(sources, 'candles', ['binance']);
    
    expect(failovers).toHaveLength(0);
  });
});

// ============================================
// Rate Limit Aggregation Tests
// ============================================

describe('Rate Limit Aggregation', () => {
  
  function aggregateRateLimits(sources: MockSource[]): {
    totalRpm: number;
    providers: Record<string, number>;
  } {
    const providers: Record<string, number> = {};
    let totalRpm = 0;
    
    for (const source of sources) {
      if (!source.enabled) continue;
      
      providers[source.provider] = (providers[source.provider] || 0) + source.limits.rpm;
      totalRpm += source.limits.rpm;
    }
    
    return { totalRpm, providers };
  }
  
  it('should sum rate limits across all sources', () => {
    const sources: MockSource[] = [
      {
        provider: 'coingecko',
        label: 'CG #1',
        capabilities: ['candles'],
        limits: { rpm: 30 },
        weight: 10,
        enabled: true,
        apiKey: null
      },
      {
        provider: 'coingecko',
        label: 'CG #2',
        capabilities: ['candles'],
        limits: { rpm: 30 },
        weight: 8,
        enabled: true,
        apiKey: null
      },
      {
        provider: 'binance',
        label: 'Binance',
        capabilities: ['candles'],
        limits: { rpm: 1200 },
        weight: 10,
        enabled: true,
        apiKey: null
      }
    ];
    
    const { totalRpm, providers } = aggregateRateLimits(sources);
    
    expect(totalRpm).toBe(1260); // 30 + 30 + 1200
    expect(providers['coingecko']).toBe(60);
    expect(providers['binance']).toBe(1200);
  });
  
  it('should exclude disabled sources from totals', () => {
    const sources: MockSource[] = [
      {
        provider: 'coingecko',
        label: 'CG #1',
        capabilities: ['candles'],
        limits: { rpm: 30 },
        weight: 10,
        enabled: true,
        apiKey: null
      },
      {
        provider: 'binance',
        label: 'Binance',
        capabilities: ['candles'],
        limits: { rpm: 1200 },
        weight: 10,
        enabled: false, // Disabled
        apiKey: null
      }
    ];
    
    const { totalRpm } = aggregateRateLimits(sources);
    
    expect(totalRpm).toBe(30); // Only CoinGecko
  });
});
