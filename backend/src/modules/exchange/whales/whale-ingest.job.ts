/**
 * S10.W-HL.1 — Whale Ingest Job
 * 
 * Background job that:
 * 1. Fetches snapshots from whale providers
 * 2. Generates whale events (diff logic)
 * 3. Builds whale market state
 * 4. Saves everything to MongoDB
 * 
 * NO trading, NO signals — only data ingestion.
 */

import { hyperliquidWhaleProvider } from './providers/hyperliquid.provider.js';
import * as storage from './whale-storage.service.js';
import { buildWhaleMarketState, calculateWhaleIndicators } from './whale-state.service.js';
import {
  LargePositionSnapshot,
  WhaleEvent,
  WhaleMarketState,
  ExchangeId,
  WhaleEventType,
} from './whale.types.js';
import { v4 as uuidv4 } from 'uuid';

// ═══════════════════════════════════════════════════════════════
// STATE TRACKING
// ═══════════════════════════════════════════════════════════════

// Track previous snapshots for diff calculation
const previousSnapshots: Map<string, Map<string, LargePositionSnapshot>> = new Map();

// Job state
let isRunning = false;
let lastRunTime = 0;
let totalRuns = 0;
let totalErrors = 0;

// ═══════════════════════════════════════════════════════════════
// DIFF ENGINE - Generate events from snapshot changes
// ═══════════════════════════════════════════════════════════════

function generateWhaleEvents(
  exchange: ExchangeId,
  symbol: string,
  prevSnapshots: LargePositionSnapshot[],
  currSnapshots: LargePositionSnapshot[]
): WhaleEvent[] {
  const events: WhaleEvent[] = [];
  const now = Date.now();
  
  // Index previous by positionId
  const prevMap = new Map<string, LargePositionSnapshot>();
  for (const snap of prevSnapshots) {
    if (snap.positionId) {
      prevMap.set(snap.positionId, snap);
    }
  }
  
  // Index current by positionId
  const currMap = new Map<string, LargePositionSnapshot>();
  for (const snap of currSnapshots) {
    if (snap.positionId) {
      currMap.set(snap.positionId, snap);
    }
  }
  
  // Check for OPEN and INCREASE/DECREASE
  for (const [posId, curr] of currMap) {
    const prev = prevMap.get(posId);
    
    if (!prev) {
      // New position → OPEN
      events.push({
        id: uuidv4(),
        exchange,
        symbol,
        eventType: 'OPEN',
        side: curr.side,
        deltaUsd: curr.sizeUsd,
        totalSizeUsd: curr.sizeUsd,
        timestamp: now,
        source: curr.source,
        positionId: posId,
        wallet: curr.wallet,
      });
    } else {
      // Existing position → check for size changes
      const delta = curr.sizeUsd - prev.sizeUsd;
      const threshold = prev.sizeUsd * 0.05; // 5% change threshold
      
      if (delta > threshold) {
        events.push({
          id: uuidv4(),
          exchange,
          symbol,
          eventType: 'INCREASE',
          side: curr.side,
          deltaUsd: delta,
          totalSizeUsd: curr.sizeUsd,
          timestamp: now,
          source: curr.source,
          positionId: posId,
          wallet: curr.wallet,
        });
      } else if (delta < -threshold) {
        events.push({
          id: uuidv4(),
          exchange,
          symbol,
          eventType: 'DECREASE',
          side: curr.side,
          deltaUsd: delta,
          totalSizeUsd: curr.sizeUsd,
          timestamp: now,
          source: curr.source,
          positionId: posId,
          wallet: curr.wallet,
        });
      }
    }
  }
  
  // Check for CLOSE
  for (const [posId, prev] of prevMap) {
    if (!currMap.has(posId)) {
      events.push({
        id: uuidv4(),
        exchange,
        symbol,
        eventType: 'CLOSE',
        side: prev.side,
        deltaUsd: -prev.sizeUsd,
        totalSizeUsd: 0,
        timestamp: now,
        source: prev.source,
        positionId: posId,
        wallet: prev.wallet,
      });
    }
  }
  
  return events;
}

// ═══════════════════════════════════════════════════════════════
// MAIN INGEST FUNCTION
// ═══════════════════════════════════════════════════════════════

export async function runWhaleIngest(): Promise<{
  snapshotsSaved: number;
  eventsSaved: number;
  statesSaved: number;
  durationMs: number;
}> {
  const startTime = Date.now();
  let snapshotsSaved = 0;
  let eventsSaved = 0;
  let statesSaved = 0;
  
  try {
    isRunning = true;
    
    // Fetch snapshots from provider
    const result = await hyperliquidWhaleProvider.fetchSnapshots();
    
    if (result.errors.length > 0) {
      console.warn('[WhaleIngest] Provider had errors:', result.errors.slice(0, 3));
    }
    
    const snapshots = result.snapshots;
    
    if (snapshots.length === 0) {
      console.log('[WhaleIngest] No snapshots to process');
      return { snapshotsSaved: 0, eventsSaved: 0, statesSaved: 0, durationMs: Date.now() - startTime };
    }
    
    // Group by symbol
    const bySymbol = new Map<string, LargePositionSnapshot[]>();
    for (const snap of snapshots) {
      const list = bySymbol.get(snap.symbol) ?? [];
      list.push(snap);
      bySymbol.set(snap.symbol, list);
    }
    
    // Process each symbol
    for (const [symbol, symbolSnapshots] of bySymbol) {
      const exchange: ExchangeId = 'hyperliquid';
      
      // Get previous snapshots for this symbol
      const exchangeKey = `${exchange}-${symbol}`;
      const prevByPos = previousSnapshots.get(exchangeKey) ?? new Map();
      const prevSnapshots = Array.from(prevByPos.values());
      
      // Generate events
      const events = generateWhaleEvents(exchange, symbol, prevSnapshots, symbolSnapshots);
      
      // Save snapshots
      for (const snap of symbolSnapshots) {
        await storage.saveSnapshot(snap);
        snapshotsSaved++;
      }
      
      // Save events
      for (const event of events) {
        await storage.saveEvent(event);
        eventsSaved++;
      }
      
      // Build and save state
      const state = buildWhaleMarketState(exchange, symbol, symbolSnapshots);
      await storage.saveState(state);
      statesSaved++;
      
      // Update health
      await storage.saveHealth({
        exchange,
        status: 'UP',
        lastUpdate: Date.now(),
        coverage: 1.0,
        confidence: 0.95,
        positionsTracked: symbolSnapshots.length,
        errorCountLastHour: 0,
      });
      
      // Update previous snapshots cache
      const newPrevMap = new Map<string, LargePositionSnapshot>();
      for (const snap of symbolSnapshots) {
        if (snap.positionId) {
          newPrevMap.set(snap.positionId, snap);
        }
      }
      previousSnapshots.set(exchangeKey, newPrevMap);
    }
    
    totalRuns++;
    lastRunTime = Date.now();
    
  } catch (error: any) {
    console.error('[WhaleIngest] Error:', error.message);
    totalErrors++;
  } finally {
    isRunning = false;
  }
  
  const durationMs = Date.now() - startTime;
  console.log(`[WhaleIngest] Completed: ${snapshotsSaved} snapshots, ${eventsSaved} events, ${statesSaved} states in ${durationMs}ms`);
  
  return { snapshotsSaved, eventsSaved, statesSaved, durationMs };
}

// ═══════════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════════

export function getIngestStatus() {
  return {
    isRunning,
    lastRunTime,
    totalRuns,
    totalErrors,
    providerDataMode: hyperliquidWhaleProvider.getDataMode(),
    providerRunning: hyperliquidWhaleProvider.isRunning(),
  };
}

console.log('[S10.W-HL.1] Whale Ingest Job loaded');
