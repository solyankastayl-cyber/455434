/**
 * Chain Sync Service (P2.3.1)
 * 
 * Manages event synchronization from all chains to unified store
 */

import { ALL_ADAPTERS, ADAPTERS_MAP } from './index.js';
import { ingestEvents } from '../cross_chain/ingestion/event_ingestor.service.js';
import type { IChainAdapter } from './base/types.js';

// ============================================
// Sync State Management
// ============================================

interface ChainSyncState {
  chain: string;
  lastSyncedBlock: number;
  lastSyncTime: Date;
  totalEvents: number;
  errors: number;
}

const syncState = new Map<string, ChainSyncState>();

// ============================================
// Sync Functions
// ============================================

/**
 * Sync events from a single chain
 */
export async function syncChain(
  adapter: IChainAdapter,
  startBlock: number,
  endBlock?: number
): Promise<{
  success: boolean;
  eventsIngested: number;
  blocksProcessed: number;
  errors: string[];
}> {
  const config = adapter.getConfig();
  const chainName = config.name;
  
  try {
    // Get latest block if endBlock not specified
    if (!endBlock) {
      endBlock = await adapter.getLatestBlockNumber();
    }
    
    console.log(`[ChainSync] ${chainName}: Syncing blocks ${startBlock} -> ${endBlock}`);
    
    // Fetch and normalize events
    const events = await adapter.fetchAndNormalize(startBlock, endBlock);
    
    if (events.length === 0) {
      console.log(`[ChainSync] ${chainName}: No events found`);
      return {
        success: true,
        eventsIngested: 0,
        blocksProcessed: endBlock - startBlock + 1,
        errors: []
      };
    }
    
    // Ingest to unified store
    const result = await ingestEvents(events);
    
    // Update sync state
    const state = syncState.get(chainName) || {
      chain: chainName,
      lastSyncedBlock: startBlock,
      lastSyncTime: new Date(),
      totalEvents: 0,
      errors: 0
    };
    
    state.lastSyncedBlock = endBlock;
    state.lastSyncTime = new Date();
    state.totalEvents += result.inserted;
    state.errors += result.errors;
    
    syncState.set(chainName, state);
    
    console.log(
      `[ChainSync] ${chainName}: Ingested ${result.inserted} events ` +
      `(${result.duplicates} duplicates, ${result.errors} errors)`
    );
    
    return {
      success: result.success,
      eventsIngested: result.inserted,
      blocksProcessed: endBlock - startBlock + 1,
      errors: result.errorMessages
    };
    
  } catch (error: any) {
    console.error(`[ChainSync] ${chainName}: Sync error:`, error.message);
    
    return {
      success: false,
      eventsIngested: 0,
      blocksProcessed: 0,
      errors: [error.message]
    };
  }
}

/**
 * Sync all chains in parallel
 */
export async function syncAllChains(
  blockRange: number = 1000
): Promise<{
  successful: number;
  failed: number;
  totalEventsIngested: number;
  results: Record<string, any>;
}> {
  console.log('[ChainSync] Starting sync for all chains...');
  
  const results: Record<string, any> = {};
  let successful = 0;
  let failed = 0;
  let totalEventsIngested = 0;
  
  // Sync all chains in parallel
  await Promise.all(
    ALL_ADAPTERS.map(async (adapter) => {
      const config = adapter.getConfig();
      const chainName = config.name;
      
      try {
        // Get latest block
        const latestBlock = await adapter.getLatestBlockNumber();
        const startBlock = Math.max(0, latestBlock - blockRange);
        
        const result = await syncChain(adapter, startBlock, latestBlock);
        
        results[chainName] = result;
        
        if (result.success) {
          successful++;
          totalEventsIngested += result.eventsIngested;
        } else {
          failed++;
        }
        
      } catch (error: any) {
        console.error(`[ChainSync] ${chainName}: Failed to sync:`, error.message);
        results[chainName] = {
          success: false,
          error: error.message
        };
        failed++;
      }
    })
  );
  
  console.log(
    `[ChainSync] Complete: ${successful} successful, ${failed} failed, ` +
    `${totalEventsIngested} total events ingested`
  );
  
  return {
    successful,
    failed,
    totalEventsIngested,
    results
  };
}

/**
 * Sync specific chain by name
 */
export async function syncChainByName(
  chainName: string,
  startBlock: number,
  endBlock?: number
): Promise<any> {
  const adapter = ADAPTERS_MAP.get(chainName);
  
  if (!adapter) {
    throw new Error(`Chain adapter not found: ${chainName}`);
  }
  
  return syncChain(adapter, startBlock, endBlock);
}

/**
 * Get sync state for all chains
 */
export function getSyncState(): ChainSyncState[] {
  return Array.from(syncState.values());
}

/**
 * Get sync state for specific chain
 */
export function getChainSyncState(chainName: string): ChainSyncState | null {
  return syncState.get(chainName) || null;
}
