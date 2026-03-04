/**
 * S10.W — Whale Mock Generator
 * 
 * Generates mock whale data for testing without real exchange connection.
 * Critical for:
 * - Testing indicator calculations
 * - Testing LABS modules
 * - Development without API keys
 * 
 * NO SIGNALS, NO PREDICTIONS — only mock data.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  LargePositionSnapshot,
  WhaleEvent,
  WhaleMarketState,
  WhaleSourceHealth,
  ExchangeId,
  WhaleSide,
  WhaleEventType,
  WHALE_THRESHOLDS,
} from './whale.types.js';
import { buildWhaleMarketState, calculateWhaleIndicators } from './whale-state.service.js';
import * as storage from './whale-storage.service.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const MOCK_CONFIG = {
  // Number of whale positions per symbol
  MIN_WHALES_PER_SYMBOL: 2,
  MAX_WHALES_PER_SYMBOL: 8,
  
  // Position sizes (USD)
  POSITION_SIZES: {
    small: { min: 100_000, max: 500_000 },      // 100K - 500K
    medium: { min: 500_000, max: 5_000_000 },   // 500K - 5M
    large: { min: 5_000_000, max: 50_000_000 }, // 5M - 50M
    mega: { min: 50_000_000, max: 500_000_000 }, // 50M - 500M
  },
  
  // Distribution weights
  SIZE_DISTRIBUTION: {
    small: 0.4,
    medium: 0.35,
    large: 0.2,
    mega: 0.05,
  },
  
  // Supported symbols
  SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
  
  // Mock exchange confidence levels
  EXCHANGE_CONFIDENCE: {
    hyperliquid: 0.95,
    binance: 0.5,
    bybit: 0.45,
  },
};

// ═══════════════════════════════════════════════════════════════
// RANDOM HELPERS
// ═══════════════════════════════════════════════════════════════

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomSide(): WhaleSide {
  return Math.random() > 0.5 ? 'LONG' : 'SHORT';
}

function randomSizeCategory(): keyof typeof MOCK_CONFIG.SIZE_DISTRIBUTION {
  const rand = Math.random();
  let cumulative = 0;
  
  for (const [category, weight] of Object.entries(MOCK_CONFIG.SIZE_DISTRIBUTION)) {
    cumulative += weight;
    if (rand <= cumulative) {
      return category as keyof typeof MOCK_CONFIG.SIZE_DISTRIBUTION;
    }
  }
  
  return 'small';
}

function generateWalletAddress(): string {
  // Ethereum-style address
  return '0x' + Array.from({ length: 40 }, () => 
    '0123456789abcdef'[Math.floor(Math.random() * 16)]
  ).join('');
}

// ═══════════════════════════════════════════════════════════════
// MOCK DATA GENERATORS
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a single mock whale position.
 */
export function generateMockPosition(
  exchange: ExchangeId,
  symbol: string,
  baseTimestamp?: number
): LargePositionSnapshot {
  const sizeCategory = randomSizeCategory();
  const sizeRange = MOCK_CONFIG.POSITION_SIZES[sizeCategory];
  const sizeUsd = randomFloat(sizeRange.min, sizeRange.max);
  
  const now = baseTimestamp ?? Date.now();
  const openTimestamp = now - randomInt(60_000, 24 * 60 * 60_000); // 1min - 24h ago
  
  // Generate realistic prices based on symbol
  const basePrices: Record<string, number> = {
    BTCUSDT: 95000,
    ETHUSDT: 3500,
    SOLUSDT: 180,
    BNBUSDT: 650,
    XRPUSDT: 2.5,
  };
  const basePrice = basePrices[symbol] ?? 100;
  const entryPrice = basePrice * randomFloat(0.95, 1.05);
  const markPrice = basePrice * randomFloat(0.98, 1.02);
  
  return {
    exchange,
    symbol,
    side: randomSide(),
    sizeUsd,
    entryPrice,
    markPrice,
    leverage: randomChoice([1, 2, 3, 5, 10, 20, 25]),
    openTimestamp,
    lastSeenTimestamp: now,
    confidence: MOCK_CONFIG.EXCHANGE_CONFIDENCE[exchange] * randomFloat(0.9, 1.0),
    source: 'mock',
    positionId: uuidv4(),
    wallet: exchange === 'hyperliquid' ? generateWalletAddress() : undefined,
  };
}

/**
 * Generate mock positions for a symbol.
 */
export function generateMockPositionsForSymbol(
  exchange: ExchangeId,
  symbol: string,
  count?: number,
  baseTimestamp?: number
): LargePositionSnapshot[] {
  const positionCount = count ?? randomInt(
    MOCK_CONFIG.MIN_WHALES_PER_SYMBOL,
    MOCK_CONFIG.MAX_WHALES_PER_SYMBOL
  );
  
  return Array.from({ length: positionCount }, () =>
    generateMockPosition(exchange, symbol, baseTimestamp)
  );
}

/**
 * Generate a whale event from a position change.
 */
export function generateMockEvent(
  exchange: ExchangeId,
  symbol: string,
  eventType: WhaleEventType,
  baseTimestamp?: number
): WhaleEvent {
  const sizeCategory = randomSizeCategory();
  const sizeRange = MOCK_CONFIG.POSITION_SIZES[sizeCategory];
  const deltaUsd = randomFloat(sizeRange.min, sizeRange.max) * 
    (eventType === 'CLOSE' || eventType === 'DECREASE' ? -1 : 1);
  
  return {
    id: uuidv4(),
    exchange,
    symbol,
    eventType,
    side: randomSide(),
    deltaUsd,
    totalSizeUsd: Math.abs(deltaUsd) * randomFloat(1, 3),
    timestamp: baseTimestamp ?? Date.now(),
    source: 'mock',
    positionId: uuidv4(),
    wallet: exchange === 'hyperliquid' ? generateWalletAddress() : undefined,
  };
}

/**
 * Generate mock health status for an exchange.
 */
export function generateMockHealth(exchange: ExchangeId): WhaleSourceHealth {
  const isUp = Math.random() > 0.1; // 90% chance UP
  
  return {
    exchange,
    status: isUp ? 'UP' : (Math.random() > 0.5 ? 'DEGRADED' : 'DOWN'),
    lastUpdate: Date.now() - randomInt(0, 60_000),
    coverage: isUp ? randomFloat(0.8, 1.0) : randomFloat(0.2, 0.5),
    confidence: MOCK_CONFIG.EXCHANGE_CONFIDENCE[exchange],
    positionsTracked: isUp ? randomInt(10, 100) : randomInt(0, 5),
    errorCountLastHour: isUp ? randomInt(0, 2) : randomInt(5, 20),
    lastError: isUp ? undefined : 'API timeout',
  };
}

// ═══════════════════════════════════════════════════════════════
// SEED FUNCTION (Main entry point)
// ═══════════════════════════════════════════════════════════════

export interface SeedOptions {
  exchanges?: ExchangeId[];
  symbols?: string[];
  positionsPerSymbol?: number;
  eventsPerSymbol?: number;
  generateStates?: boolean;
  generateHealth?: boolean;
}

export interface SeedResult {
  snapshotsCreated: number;
  eventsCreated: number;
  statesCreated: number;
  healthCreated: number;
  duration: number;
}

/**
 * Seed the database with mock whale data.
 */
export async function seedMockWhaleData(options: SeedOptions = {}): Promise<SeedResult> {
  const startTime = Date.now();
  
  const exchanges = options.exchanges ?? ['hyperliquid', 'binance'];
  const symbols = options.symbols ?? MOCK_CONFIG.SYMBOLS;
  const positionsPerSymbol = options.positionsPerSymbol ?? randomInt(3, 6);
  const eventsPerSymbol = options.eventsPerSymbol ?? randomInt(5, 10);
  const generateStates = options.generateStates ?? true;
  const generateHealth = options.generateHealth ?? true;
  
  // Ensure indexes exist
  await storage.ensureWhaleIndexes();
  
  let snapshotsCreated = 0;
  let eventsCreated = 0;
  let statesCreated = 0;
  let healthCreated = 0;
  
  const allSnapshots: LargePositionSnapshot[] = [];
  const allEvents: WhaleEvent[] = [];
  
  // Generate snapshots and events for each exchange/symbol
  for (const exchange of exchanges) {
    for (const symbol of symbols) {
      // Generate positions
      const positions = generateMockPositionsForSymbol(exchange, symbol, positionsPerSymbol);
      allSnapshots.push(...positions);
      
      // Generate events
      const eventTypes: WhaleEventType[] = ['OPEN', 'CLOSE', 'INCREASE', 'DECREASE'];
      for (let i = 0; i < eventsPerSymbol; i++) {
        const event = generateMockEvent(
          exchange,
          symbol,
          randomChoice(eventTypes),
          Date.now() - randomInt(0, 24 * 60 * 60_000)
        );
        allEvents.push(event);
      }
    }
    
    // Generate health
    if (generateHealth) {
      const health = generateMockHealth(exchange);
      await storage.saveHealth(health);
      healthCreated++;
    }
  }
  
  // Save snapshots
  if (allSnapshots.length > 0) {
    snapshotsCreated = await storage.saveSnapshots(allSnapshots);
  }
  
  // Save events
  if (allEvents.length > 0) {
    eventsCreated = await storage.saveEvents(allEvents);
  }
  
  // Generate and save states
  if (generateStates) {
    for (const exchange of exchanges) {
      for (const symbol of symbols) {
        const symbolSnapshots = allSnapshots.filter(
          s => s.exchange === exchange && s.symbol === symbol
        );
        
        const state = buildWhaleMarketState(exchange, symbol, symbolSnapshots);
        await storage.saveState(state);
        statesCreated++;
      }
    }
  }
  
  const duration = Date.now() - startTime;
  
  console.log(`[S10.W] Mock seed complete: ${snapshotsCreated} snapshots, ${eventsCreated} events, ${statesCreated} states in ${duration}ms`);
  
  return {
    snapshotsCreated,
    eventsCreated,
    statesCreated,
    healthCreated,
    duration,
  };
}

/**
 * Generate a single tick of whale data (for continuous simulation).
 */
export async function generateWhaleTick(
  exchange: ExchangeId,
  symbol: string
): Promise<{
  state: WhaleMarketState;
  indicators: ReturnType<typeof calculateWhaleIndicators>;
}> {
  // Get existing positions or generate new ones
  let positions = await storage.getLatestSnapshots(exchange, symbol, 20);
  
  if (positions.length === 0) {
    positions = generateMockPositionsForSymbol(exchange, symbol);
    await storage.saveSnapshots(positions);
  } else {
    // Simulate position changes
    const changeProb = 0.3; // 30% chance of change per tick
    
    if (Math.random() < changeProb) {
      // Either modify existing or add new
      if (Math.random() > 0.5 && positions.length > 0) {
        // Modify existing (simulate price change)
        const pos = positions[randomInt(0, positions.length - 1)];
        pos.markPrice = (pos.markPrice ?? pos.entryPrice ?? 100) * randomFloat(0.99, 1.01);
        pos.lastSeenTimestamp = Date.now();
      } else {
        // Add new position
        const newPos = generateMockPosition(exchange, symbol);
        positions.push(newPos);
        await storage.saveSnapshot(newPos);
      }
    }
  }
  
  // Build state
  const state = buildWhaleMarketState(exchange, symbol, positions);
  await storage.saveState(state);
  
  // Calculate indicators
  const indicators = calculateWhaleIndicators(
    state,
    randomFloat(0, 0.5),  // volatilitySpike
    randomFloat(0, 0.3)   // liquidityVacuum
  );
  
  return { state, indicators };
}

console.log('[S10.W] Whale Mock Generator loaded');
