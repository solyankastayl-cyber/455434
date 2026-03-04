/**
 * S10.6I — Indicator Service
 * 
 * Orchestrates indicator calculations for symbols.
 * Manages caching and batch operations.
 */

import {
  IndicatorSnapshot,
  IndicatorInput,
  IndicatorCategory,
  IndicatorValue,
  OHLCVCandle,
} from './indicator.types.js';
import * as registry from './indicator.registry.js';
import { priceStructureCalculators } from './calculators/price-structure/index.js';
import { momentumCalculators } from './calculators/momentum/index.js';
import { volumeCalculators } from './calculators/volume/index.js';
import { orderBookCalculators } from './calculators/order-book/index.js';
import { positioningCalculators } from './calculators/positioning/index.js';
import { whaleCalculators } from './calculators/whale.calculators.js';

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

let initialized = false;

export function initializeIndicators(): void {
  if (initialized) return;
  
  // Register all calculators
  registry.registerCalculators(priceStructureCalculators);
  registry.registerCalculators(momentumCalculators);
  registry.registerCalculators(volumeCalculators);
  registry.registerCalculators(orderBookCalculators);
  registry.registerCalculators(positioningCalculators);
  
  // S10.W — Register whale calculators
  registry.registerCalculators(whaleCalculators);
  
  const status = registry.getRegistryStatus();
  console.log(`[S10.6I] Indicators initialized: ${status.totalRegistered} registered`);
  console.log(`[S10.6I] By category:`, status.byCategory);
  
  if (status.missing.length > 0) {
    console.warn(`[S10.6I] Missing indicators:`, status.missing);
  }
  
  initialized = true;
}

// Auto-initialize on import
initializeIndicators();

// ═══════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════

const snapshotCache: Map<string, IndicatorSnapshot> = new Map();
const CACHE_TTL_MS = 5000; // 5 seconds

function getCacheKey(symbol: string): string {
  return symbol.toUpperCase();
}

function getCachedSnapshot(symbol: string): IndicatorSnapshot | null {
  const key = getCacheKey(symbol);
  const cached = snapshotCache.get(key);
  
  if (cached && Date.now() - cached.calculatedAt < CACHE_TTL_MS) {
    return cached;
  }
  
  return null;
}

function setCachedSnapshot(snapshot: IndicatorSnapshot): void {
  const key = getCacheKey(snapshot.symbol);
  snapshotCache.set(key, snapshot);
}

// ═══════════════════════════════════════════════════════════════
// MOCK DATA GENERATOR (for development)
// ═══════════════════════════════════════════════════════════════

function generateMockCandles(symbol: string, count: number = 100): OHLCVCandle[] {
  const now = Date.now();
  const candles: OHLCVCandle[] = [];
  
  // Seed based on symbol for consistency
  const seed = symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  let price = 40000 + (seed % 10000);
  
  for (let i = 0; i < count; i++) {
    const timestamp = now - (count - i) * 60000; // 1 minute candles
    
    // Random walk
    const change = (Math.sin(i * 0.1 + seed) * 0.02 + (Math.random() - 0.5) * 0.01) * price;
    price += change;
    
    const high = price * (1 + Math.random() * 0.005);
    const low = price * (1 - Math.random() * 0.005);
    const open = low + Math.random() * (high - low);
    const close = low + Math.random() * (high - low);
    const volume = 100 + Math.random() * 1000;
    
    candles.push({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    });
  }
  
  return candles;
}

// ═══════════════════════════════════════════════════════════════
// MAIN API
// ═══════════════════════════════════════════════════════════════

export function getIndicatorSnapshot(symbol: string): IndicatorSnapshot {
  // Check cache
  const cached = getCachedSnapshot(symbol);
  if (cached) return cached;
  
  // Generate input (in production, this would come from exchange data)
  const candles = generateMockCandles(symbol.toUpperCase(), 100);
  const currentPrice = candles[candles.length - 1].close;
  
  const input: IndicatorInput = {
    symbol: symbol.toUpperCase(),
    candles,
    price: currentPrice,
  };
  
  // Calculate all indicators
  const snapshot = registry.calculateAll(input);
  
  // Cache result
  setCachedSnapshot(snapshot);
  
  return snapshot;
}

export function getIndicatorsByCategory(
  symbol: string,
  category: IndicatorCategory
): IndicatorValue[] {
  const snapshot = getIndicatorSnapshot(symbol);
  return snapshot.byCategory[category] || [];
}

export function getSingleIndicator(
  symbol: string,
  indicatorId: string
): IndicatorValue | null {
  const snapshot = getIndicatorSnapshot(symbol);
  return snapshot.byId[indicatorId] || null;
}

// ═══════════════════════════════════════════════════════════════
// REGISTRY INFO
// ═══════════════════════════════════════════════════════════════

export function getRegistryStatus() {
  return registry.getRegistryStatus();
}

export function getAllDefinitions() {
  return registry.getAllDefinitions();
}

export function getDefinitionsByCategory(category: IndicatorCategory) {
  return registry.getDefinitionsByCategory(category);
}

// ═══════════════════════════════════════════════════════════════
// BATCH OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function getIndicatorsForSymbols(symbols: string[]): Record<string, IndicatorSnapshot> {
  const results: Record<string, IndicatorSnapshot> = {};
  
  for (const symbol of symbols) {
    results[symbol.toUpperCase()] = getIndicatorSnapshot(symbol);
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════
// CLEAR CACHE
// ═══════════════════════════════════════════════════════════════

export function clearCache(): void {
  snapshotCache.clear();
  console.log('[S10.6I] Indicator cache cleared');
}

console.log('[S10.6I] Indicator Service loaded');
