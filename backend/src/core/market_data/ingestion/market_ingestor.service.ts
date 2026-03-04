/**
 * Market Ingestor Service (P1.5)
 * 
 * Orchestrates market data ingestion from all sources.
 * Handles rate limiting, deduplication, and backfill.
 */

import { coingeckoAdapter } from '../adapters/index.js';
import { getDefaultSymbols, getBestSource } from '../adapters/symbol_resolver.service.js';
import {
  upsertCandles,
  CandleInterval,
  MarketSource,
  IMarketCandle
} from '../storage/market_candle.model.js';
import {
  updateSyncProgress,
  recordSyncError,
  getOrCreateSourceState,
  getAllSourceStates
} from '../storage/market_source_state.model.js';

// ============================================
// Types
// ============================================

export interface SyncResult {
  symbol: string;
  source: MarketSource;
  interval: CandleInterval;
  candlesAdded: number;
  durationMs: number;
  error?: string;
}

export interface BatchSyncResult {
  results: SyncResult[];
  totalCandles: number;
  errors: number;
  durationMs: number;
}

// ============================================
// Configuration
// ============================================

const DEFAULT_INTERVALS: CandleInterval[] = ['1h'];
const ENABLED_SOURCES: MarketSource[] = ['coingecko'];

// Check environment for additional sources
if (process.env.MARKET_BINANCE_ENABLED === 'true') {
  ENABLED_SOURCES.push('binance');
}
if (process.env.MARKET_BYBIT_ENABLED === 'true') {
  ENABLED_SOURCES.push('bybit');
}

// ============================================
// Ingestor Service
// ============================================

/**
 * Sync candles for a single symbol/interval
 */
export async function syncSymbol(
  symbol: string,
  interval: CandleInterval = '1h',
  source?: MarketSource
): Promise<SyncResult> {
  const startTime = Date.now();
  const actualSource = source || getBestSource(symbol);
  
  try {
    // Get current state
    const state = await getOrCreateSourceState(actualSource, symbol, interval);
    
    // Check if paused
    if (state.status === 'PAUSED') {
      return {
        symbol,
        source: actualSource,
        interval,
        candlesAdded: 0,
        durationMs: Date.now() - startTime,
        error: 'Source is paused'
      };
    }
    
    // Calculate time range
    const now = Date.now();
    const fromTs = state.lastSyncedTs > 0 
      ? state.lastSyncedTs 
      : now - 24 * 60 * 60 * 1000; // Default: last 24 hours
    
    // Fetch candles
    const adapter = getAdapter(actualSource);
    const response = await adapter.fetchCandles({
      symbol,
      interval,
      fromTs,
      toTs: now
    });
    
    // Upsert to database
    const candlesAdded = await upsertCandles(response.candles);
    
    // Update state
    const latestTs = response.candles.length > 0 
      ? Math.max(...response.candles.map(c => c.ts))
      : state.lastSyncedTs;
    
    await updateSyncProgress(
      actualSource,
      symbol,
      interval,
      latestTs,
      candlesAdded,
      Date.now() - startTime
    );
    
    return {
      symbol,
      source: actualSource,
      interval,
      candlesAdded,
      durationMs: Date.now() - startTime
    };
    
  } catch (error) {
    const errorMsg = (error as Error).message;
    
    await recordSyncError(actualSource, symbol, interval, errorMsg);
    
    return {
      symbol,
      source: actualSource,
      interval,
      candlesAdded: 0,
      durationMs: Date.now() - startTime,
      error: errorMsg
    };
  }
}

/**
 * Sync all configured symbols
 */
export async function syncAllSymbols(
  intervals: CandleInterval[] = DEFAULT_INTERVALS
): Promise<BatchSyncResult> {
  const startTime = Date.now();
  const symbols = getDefaultSymbols();
  const results: SyncResult[] = [];
  let totalCandles = 0;
  let errors = 0;
  
  for (const symbol of symbols) {
    for (const interval of intervals) {
      const result = await syncSymbol(symbol, interval);
      results.push(result);
      totalCandles += result.candlesAdded;
      if (result.error) errors++;
      
      // Small delay between symbols to avoid rate limits
      await sleep(500);
    }
  }
  
  return {
    results,
    totalCandles,
    errors,
    durationMs: Date.now() - startTime
  };
}

/**
 * Backfill historical data
 */
export async function backfillSymbol(
  symbol: string,
  interval: CandleInterval,
  days: number = 30,
  source?: MarketSource
): Promise<SyncResult> {
  const startTime = Date.now();
  const actualSource = source || getBestSource(symbol);
  
  try {
    const now = Date.now();
    const fromTs = now - days * 24 * 60 * 60 * 1000;
    
    const adapter = getAdapter(actualSource);
    const response = await adapter.fetchCandles({
      symbol,
      interval,
      fromTs,
      toTs: now
    });
    
    const candlesAdded = await upsertCandles(response.candles);
    
    // Update state with earliest timestamp
    const latestTs = response.candles.length > 0 
      ? Math.max(...response.candles.map(c => c.ts))
      : 0;
    
    await updateSyncProgress(
      actualSource,
      symbol,
      interval,
      latestTs,
      candlesAdded,
      Date.now() - startTime
    );
    
    return {
      symbol,
      source: actualSource,
      interval,
      candlesAdded,
      durationMs: Date.now() - startTime
    };
    
  } catch (error) {
    const errorMsg = (error as Error).message;
    
    await recordSyncError(actualSource, symbol, interval, errorMsg);
    
    return {
      symbol,
      source: actualSource,
      interval,
      candlesAdded: 0,
      durationMs: Date.now() - startTime,
      error: errorMsg
    };
  }
}

/**
 * Get ingestion status
 */
export async function getIngestionStatus(): Promise<{
  enabledSources: MarketSource[];
  configuredSymbols: string[];
  states: Awaited<ReturnType<typeof getAllSourceStates>>;
}> {
  return {
    enabledSources: ENABLED_SOURCES,
    configuredSymbols: getDefaultSymbols(),
    states: await getAllSourceStates()
  };
}

// ============================================
// Helpers
// ============================================

function getAdapter(source: MarketSource) {
  switch (source) {
    case 'coingecko':
      return coingeckoAdapter;
    case 'binance':
    case 'bybit':
      // TODO: Implement binance/bybit adapters
      throw new Error(`${source} adapter not yet implemented`);
    default:
      throw new Error(`Unknown source: ${source}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
