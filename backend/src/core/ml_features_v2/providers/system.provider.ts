/**
 * System Feature Provider (P0.6)
 * 
 * Extracts ML features from Ingestion Control (P0.1) for data quality context.
 */

import {
  ProviderContext,
  ProviderResult,
  SystemFeatureKey,
  FeatureValue
} from '../types/feature.types.js';
import { ChainSyncStateModel } from '../../ingestion_control/chain_sync_state.model.js';

// ============================================
// Types
// ============================================

export type SystemFeatures = Partial<Record<SystemFeatureKey, FeatureValue>>;

// Supported chains
const ALL_CHAINS = ['ETH', 'ARB', 'OP', 'BASE', 'POLY', 'BNB', 'AVAX', 'ZKSYNC', 'SCROLL', 'LINEA'];

// ============================================
// System Provider
// ============================================

export async function extractSystemFeatures(
  ctx: ProviderContext
): Promise<ProviderResult<SystemFeatures>> {
  const startTime = Date.now();
  const errors: string[] = [];
  const features: SystemFeatures = {};
  
  try {
    // Get all chain sync states
    const chainStates = await ChainSyncStateModel.find({}).lean();
    
    if (chainStates.length === 0) {
      // No ingestion data - return healthy defaults
      return {
        features: createDefaultSystemFeatures(),
        source: 'SYSTEM',
        timestamp: new Date(),
        errors: [],
        durationMs: Date.now() - startTime
      };
    }
    
    // Calculate data freshness (max lag across chains)
    let maxLagMs = 0;
    let totalChains = 0;
    let healthyChains = 0;
    let totalErrorRate = 0;
    let totalEvents = 0;
    
    for (const state of chainStates) {
      totalChains++;
      
      // Calculate lag
      if (state.headBlock && state.lastSyncedBlock) {
        // Assume ~12 second block time average
        const blockLag = state.headBlock - state.lastSyncedBlock;
        const lagMs = blockLag * 12 * 1000;
        if (lagMs > maxLagMs) {
          maxLagMs = lagMs;
        }
      }
      
      // Track healthy chains
      if (state.status === 'ACTIVE' || state.status === 'SYNCING') {
        healthyChains++;
      }
      
      // Track errors (if available)
      if (state.errorCount !== undefined) {
        totalErrorRate += state.errorCount;
      }
      
      // Track events processed (if available)
      if (state.eventsProcessed !== undefined) {
        totalEvents += state.eventsProcessed;
      }
    }
    
    // Feature: Data freshness lag
    features.system_dataFreshnessLagMs = maxLagMs;
    
    // Feature: Chain coverage (0-1)
    features.system_chainCoverage = totalChains > 0
      ? Math.round((healthyChains / ALL_CHAINS.length) * 100) / 100
      : 0;
    
    // Feature: Error rate (normalized)
    // Assume > 100 errors = 1.0 error rate
    features.system_errorRate = Math.min(1, totalErrorRate / 100);
    
    // Feature: Events in window (proxy for data volume)
    features.system_eventsInWindow = totalEvents;
    
    // Feature: Overall health
    const isHealthy = healthyChains >= Math.floor(totalChains * 0.7) // 70%+ healthy
      && maxLagMs < 10 * 60 * 1000 // < 10 min lag
      && totalErrorRate < 50;
    
    features.system_ingestionHealthy = isHealthy;
    
  } catch (err) {
    errors.push(`System provider error: ${(err as Error).message}`);
    return {
      features: createDefaultSystemFeatures(),
      source: 'SYSTEM',
      timestamp: new Date(),
      errors,
      durationMs: Date.now() - startTime
    };
  }
  
  return {
    features,
    source: 'SYSTEM',
    timestamp: new Date(),
    errors,
    durationMs: Date.now() - startTime
  };
}

// ============================================
// Helpers
// ============================================

function createDefaultSystemFeatures(): SystemFeatures {
  return {
    system_dataFreshnessLagMs: 0,
    system_chainCoverage: 1,
    system_errorRate: 0,
    system_eventsInWindow: 0,
    system_ingestionHealthy: true
  };
}

/**
 * Get feature count for system
 */
export function getSystemFeatureCount(): number {
  return 5;
}
