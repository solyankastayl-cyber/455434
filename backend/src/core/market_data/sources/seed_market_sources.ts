/**
 * Market Sources Seeder (P1.5.B)
 * 
 * Seeds default market API sources if collection is empty.
 */

import {
  MarketApiSourceModel,
  createSource,
  getMinuteKey
} from '../storage/market_api_source.model.js';

// ============================================
// Default Sources Configuration
// ============================================

const DEFAULT_SOURCES = [
  {
    provider: 'coingecko' as const,
    label: 'CoinGecko #1 (Free)',
    apiKey: null,
    capabilities: ['candles', 'price', 'volume', 'market_context'],
    limits: { rpm: 30 },
    weight: 10,
    enabled: true
  },
  {
    provider: 'coingecko' as const,
    label: 'CoinGecko #2 (Free)',
    apiKey: null,
    capabilities: ['candles', 'price', 'volume', 'market_context'],
    limits: { rpm: 30 },
    weight: 8,
    enabled: true
  },
  {
    provider: 'binance' as const,
    label: 'Binance Public API',
    apiKey: null,
    capabilities: ['candles', 'price', 'volume'],
    limits: { rpm: 1200 },  // P2.1: Binance public limit is 1200 RPM
    weight: 9,              // High weight - preferred for candles
    enabled: true
  }
];

// ============================================
// Seeder
// ============================================

/**
 * Seed default sources if collection is empty
 */
export async function seedMarketSources(): Promise<{
  seeded: boolean;
  count: number;
}> {
  const existing = await MarketApiSourceModel.countDocuments();
  
  if (existing > 0) {
    return { seeded: false, count: existing };
  }
  
  console.log('[P1.5.B] Seeding default market API sources...');
  
  for (const sourceData of DEFAULT_SOURCES) {
    await createSource(sourceData);
    console.log(`[P1.5.B] Created: ${sourceData.label}`);
  }
  
  return { seeded: true, count: DEFAULT_SOURCES.length };
}

/**
 * Reset sources to defaults (for testing)
 */
export async function resetToDefaults(): Promise<void> {
  await MarketApiSourceModel.deleteMany({});
  await seedMarketSources();
}
