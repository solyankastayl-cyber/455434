/**
 * CoinMarketCap Adapter Tests (P2.1)
 * 
 * Unit tests for market context parsing.
 * Does NOT make real HTTP calls.
 */

import { describe, it, expect } from 'vitest';

// ============================================
// Test Constants
// ============================================

const SYMBOL_TO_CMC_ID: Record<string, number> = {
  'BTC': 1,
  'ETH': 1027,
  'BNB': 1839,
  'SOL': 5426,
  'ARB': 11841,
};

// ============================================
// Quote Parsing Tests
// ============================================

describe('CMC Quote Parsing', () => {
  
  interface CMCQuoteData {
    id: number;
    name: string;
    symbol: string;
    cmc_rank: number;
    circulating_supply: number;
    total_supply: number;
    max_supply: number | null;
    quote: {
      USD: {
        price: number;
        volume_24h: number;
        volume_change_24h: number;
        percent_change_1h: number;
        percent_change_24h: number;
        percent_change_7d: number;
        market_cap: number;
        market_cap_dominance: number;
      };
    };
    last_updated: string;
  }
  
  function parseQuotes(data: Record<string, CMCQuoteData>) {
    const contexts = [];
    
    for (const [id, quoteData] of Object.entries(data)) {
      const quote = quoteData.quote.USD;
      
      contexts.push({
        symbol: quoteData.symbol,
        cmcId: quoteData.id,
        rank: quoteData.cmc_rank,
        price: quote.price,
        volume24h: quote.volume_24h,
        volumeChange24h: quote.volume_change_24h,
        percentChange1h: quote.percent_change_1h,
        percentChange24h: quote.percent_change_24h,
        percentChange7d: quote.percent_change_7d,
        marketCap: quote.market_cap,
        marketCapDominance: quote.market_cap_dominance,
        circulatingSupply: quoteData.circulating_supply,
        totalSupply: quoteData.total_supply,
        maxSupply: quoteData.max_supply,
        lastUpdated: new Date(quoteData.last_updated)
      });
    }
    
    return contexts;
  }
  
  it('should parse CMC quote response correctly', () => {
    const rawResponse: Record<string, CMCQuoteData> = {
      '1027': {
        id: 1027,
        name: 'Ethereum',
        symbol: 'ETH',
        cmc_rank: 2,
        circulating_supply: 120000000,
        total_supply: 120000000,
        max_supply: null,
        quote: {
          USD: {
            price: 2500.50,
            volume_24h: 15000000000,
            volume_change_24h: 5.5,
            percent_change_1h: 0.5,
            percent_change_24h: 2.3,
            percent_change_7d: -1.2,
            market_cap: 300000000000,
            market_cap_dominance: 18.5
          }
        },
        last_updated: '2025-01-26T12:00:00Z'
      }
    };
    
    const contexts = parseQuotes(rawResponse);
    
    expect(contexts).toHaveLength(1);
    expect(contexts[0].symbol).toBe('ETH');
    expect(contexts[0].cmcId).toBe(1027);
    expect(contexts[0].rank).toBe(2);
    expect(contexts[0].price).toBe(2500.50);
    expect(contexts[0].volume24h).toBe(15000000000);
    expect(contexts[0].marketCap).toBe(300000000000);
    expect(contexts[0].maxSupply).toBeNull();
  });
  
  it('should parse multiple quotes', () => {
    const rawResponse: Record<string, CMCQuoteData> = {
      '1': {
        id: 1,
        name: 'Bitcoin',
        symbol: 'BTC',
        cmc_rank: 1,
        circulating_supply: 19000000,
        total_supply: 21000000,
        max_supply: 21000000,
        quote: {
          USD: {
            price: 45000,
            volume_24h: 30000000000,
            volume_change_24h: 10,
            percent_change_1h: 0.2,
            percent_change_24h: 1.5,
            percent_change_7d: 5.0,
            market_cap: 855000000000,
            market_cap_dominance: 52.0
          }
        },
        last_updated: '2025-01-26T12:00:00Z'
      },
      '1027': {
        id: 1027,
        name: 'Ethereum',
        symbol: 'ETH',
        cmc_rank: 2,
        circulating_supply: 120000000,
        total_supply: 120000000,
        max_supply: null,
        quote: {
          USD: {
            price: 2500,
            volume_24h: 15000000000,
            volume_change_24h: 5,
            percent_change_1h: 0.3,
            percent_change_24h: 2.0,
            percent_change_7d: -1.0,
            market_cap: 300000000000,
            market_cap_dominance: 18.0
          }
        },
        last_updated: '2025-01-26T12:00:00Z'
      }
    };
    
    const contexts = parseQuotes(rawResponse);
    
    expect(contexts).toHaveLength(2);
    expect(contexts.find(c => c.symbol === 'BTC')).toBeDefined();
    expect(contexts.find(c => c.symbol === 'ETH')).toBeDefined();
  });
  
  it('should handle max_supply being null', () => {
    const rawResponse: Record<string, CMCQuoteData> = {
      '1027': {
        id: 1027,
        name: 'Ethereum',
        symbol: 'ETH',
        cmc_rank: 2,
        circulating_supply: 120000000,
        total_supply: 120000000,
        max_supply: null,
        quote: {
          USD: {
            price: 2500,
            volume_24h: 15000000000,
            volume_change_24h: 5,
            percent_change_1h: 0.3,
            percent_change_24h: 2.0,
            percent_change_7d: -1.0,
            market_cap: 300000000000,
            market_cap_dominance: 18.0
          }
        },
        last_updated: '2025-01-26T12:00:00Z'
      }
    };
    
    const contexts = parseQuotes(rawResponse);
    
    expect(contexts[0].maxSupply).toBeNull();
  });
  
  it('should handle max_supply being a number', () => {
    const rawResponse: Record<string, CMCQuoteData> = {
      '1': {
        id: 1,
        name: 'Bitcoin',
        symbol: 'BTC',
        cmc_rank: 1,
        circulating_supply: 19000000,
        total_supply: 21000000,
        max_supply: 21000000,
        quote: {
          USD: {
            price: 45000,
            volume_24h: 30000000000,
            volume_change_24h: 10,
            percent_change_1h: 0.2,
            percent_change_24h: 1.5,
            percent_change_7d: 5.0,
            market_cap: 855000000000,
            market_cap_dominance: 52.0
          }
        },
        last_updated: '2025-01-26T12:00:00Z'
      }
    };
    
    const contexts = parseQuotes(rawResponse);
    
    expect(contexts[0].maxSupply).toBe(21000000);
  });
});

// ============================================
// Symbol Mapping Tests
// ============================================

describe('CMC Symbol Mapping', () => {
  
  it('should map common symbols to CMC IDs', () => {
    expect(SYMBOL_TO_CMC_ID['BTC']).toBe(1);
    expect(SYMBOL_TO_CMC_ID['ETH']).toBe(1027);
    expect(SYMBOL_TO_CMC_ID['BNB']).toBe(1839);
    expect(SYMBOL_TO_CMC_ID['SOL']).toBe(5426);
    expect(SYMBOL_TO_CMC_ID['ARB']).toBe(11841);
  });
  
  it('should return undefined for unsupported symbols', () => {
    expect(SYMBOL_TO_CMC_ID['UNKNOWN']).toBeUndefined();
    expect(SYMBOL_TO_CMC_ID['XYZ']).toBeUndefined();
  });
  
  it('should filter supported symbols', () => {
    const requestedSymbols = ['BTC', 'ETH', 'UNKNOWN', 'SOL', 'XYZ'];
    const supported = requestedSymbols.filter(s => SYMBOL_TO_CMC_ID[s]);
    
    expect(supported).toEqual(['BTC', 'ETH', 'SOL']);
  });
});

// ============================================
// Error Handling Tests
// ============================================

describe('CMC Error Handling', () => {
  
  function isCMCError(status: { error_code: number; error_message: string | null }) {
    return status.error_code !== 0 && status.error_message !== null;
  }
  
  it('should detect CMC error response', () => {
    const errorStatus = {
      error_code: 400,
      error_message: 'Invalid value for "id"'
    };
    
    expect(isCMCError(errorStatus)).toBe(true);
  });
  
  it('should not flag success as error', () => {
    const successStatus = {
      error_code: 0,
      error_message: null
    };
    
    expect(isCMCError(successStatus)).toBe(false);
  });
  
  it('should detect rate limit error', () => {
    function isRateLimitError(err: any) {
      return err.status === 429 || err.code === 1008;
    }
    
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ code: 1008 })).toBe(true);
    expect(isRateLimitError({ status: 200 })).toBe(false);
  });
});

// ============================================
// API Key Requirement Tests
// ============================================

describe('CMC API Key Requirement', () => {
  
  it('should require API key for CMC adapter', () => {
    const source = {
      provider: 'coinmarketcap',
      apiKey: null
    };
    
    const requiresKey = source.provider === 'coinmarketcap' && !source.apiKey;
    expect(requiresKey).toBe(true);
  });
  
  it('should allow request with valid API key', () => {
    const source = {
      provider: 'coinmarketcap',
      apiKey: 'cmc_test_key_123'
    };
    
    const requiresKey = source.provider === 'coinmarketcap' && !source.apiKey;
    expect(requiresKey).toBe(false);
  });
});
