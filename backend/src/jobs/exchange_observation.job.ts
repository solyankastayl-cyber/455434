/**
 * Exchange Observation Collection Job
 * 
 * Periodically collects market observations with LIVE data from providers.
 * This feeds into the ML training pipeline.
 */

import * as observationService from '../modules/exchange/observation/observation.service.js';
import { fetchLiveData, liveSnapshotToObservationInput, isDataSufficient } from '../modules/exchange/data/realdata.service.js';

// Configuration
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const COLLECTION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 2;

let isRunning = false;
let intervalId: NodeJS.Timeout | null = null;
let lastRun: Date | null = null;
let successCount = 0;
let errorCount = 0;

/**
 * Collect observation for a single symbol
 */
async function collectForSymbol(symbol: string): Promise<boolean> {
  let retries = 0;
  
  while (retries <= MAX_RETRIES) {
    try {
      // Fetch live data from providers
      const liveData = await fetchLiveData(symbol);
      
      if (!liveData) {
        console.warn(`[ExchangeObsJob] No live data for ${symbol}`);
        retries++;
        continue;
      }
      
      // Check data quality
      if (!isDataSufficient(liveData.sourceMeta)) {
        console.warn(`[ExchangeObsJob] Insufficient data for ${symbol}:`, liveData.sourceMeta.missing);
        retries++;
        continue;
      }
      
      // Convert to observation input
      const input = liveSnapshotToObservationInput(liveData);
      
      // Create observation with indicators
      const observation = await observationService.createObservationWithIndicators({
        ...input,
        source: 'scheduled_job',
      });
      
      console.log(`[ExchangeObsJob] Created observation for ${symbol}: regime=${observation.regime}, patterns=${observation.patternCount}, dataMode=${liveData.sourceMeta.dataMode}`);
      
      return true;
    } catch (error: any) {
      console.error(`[ExchangeObsJob] Error collecting ${symbol} (attempt ${retries + 1}):`, error.message);
      retries++;
      
      if (retries <= MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * retries));
      }
    }
  }
  
  return false;
}

/**
 * Main collection run
 */
async function runCollection(): Promise<void> {
  if (isRunning) {
    console.log('[ExchangeObsJob] Already running, skipping');
    return;
  }
  
  isRunning = true;
  const startTime = Date.now();
  
  try {
    console.log(`[ExchangeObsJob] Starting collection for ${SYMBOLS.length} symbols...`);
    
    let success = 0;
    let failed = 0;
    
    for (const symbol of SYMBOLS) {
      const result = await collectForSymbol(symbol);
      if (result) {
        success++;
        successCount++;
      } else {
        failed++;
        errorCount++;
      }
      
      // Small delay between symbols
      await new Promise(r => setTimeout(r, 500));
    }
    
    const duration = Date.now() - startTime;
    console.log(`[ExchangeObsJob] Collection complete: ${success}/${SYMBOLS.length} success, ${failed} failed, took ${duration}ms`);
    
  } catch (error: any) {
    console.error('[ExchangeObsJob] Collection run failed:', error.message);
    errorCount++;
  } finally {
    isRunning = false;
    lastRun = new Date();
  }
}

/**
 * Start the collection job
 */
export function startExchangeObservationJob(): { success: boolean; message: string } {
  if (intervalId) {
    return { success: false, message: 'Job already running' };
  }
  
  console.log(`[ExchangeObsJob] Starting job (interval: ${COLLECTION_INTERVAL_MS / 1000}s)`);
  
  // Run immediately
  runCollection();
  
  // Schedule periodic runs
  intervalId = setInterval(runCollection, COLLECTION_INTERVAL_MS);
  
  return { success: true, message: `Started collecting every ${COLLECTION_INTERVAL_MS / 1000}s` };
}

/**
 * Stop the collection job
 */
export function stopExchangeObservationJob(): { success: boolean; message: string } {
  if (!intervalId) {
    return { success: false, message: 'Job not running' };
  }
  
  clearInterval(intervalId);
  intervalId = null;
  
  console.log('[ExchangeObsJob] Job stopped');
  
  return { success: true, message: 'Job stopped' };
}

/**
 * Get job status
 */
export function getExchangeObservationJobStatus(): {
  running: boolean;
  lastRun: Date | null;
  stats: { success: number; errors: number };
  symbols: string[];
  intervalMs: number;
} {
  return {
    running: intervalId !== null,
    lastRun,
    stats: { success: successCount, errors: errorCount },
    symbols: SYMBOLS,
    intervalMs: COLLECTION_INTERVAL_MS,
  };
}

/**
 * Trigger manual run
 */
export async function triggerManualCollection(): Promise<{
  success: boolean;
  collected: number;
  errors: number;
}> {
  if (isRunning) {
    return { success: false, collected: 0, errors: 0 };
  }
  
  const beforeSuccess = successCount;
  const beforeErrors = errorCount;
  
  await runCollection();
  
  return {
    success: true,
    collected: successCount - beforeSuccess,
    errors: errorCount - beforeErrors,
  };
}

console.log('[ExchangeObsJob] Module loaded');
