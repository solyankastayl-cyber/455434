/**
 * Node Analytics Job - ETAP D2
 * 
 * Cron job to pre-calculate node analytics for all networks.
 * Runs periodically to populate the node_analytics collection.
 * 
 * Graph builder READS from this collection, never calculates.
 * This ensures consistent, fast graph rendering.
 */

import { calculateNetworkNodeAnalytics } from '../core/graph_analytics/node_analytics.service.js';
import type { NetworkType } from '../common/network.types.js';

// Supported networks for analytics calculation
const SUPPORTED_NETWORKS: NetworkType[] = ['ethereum', 'arbitrum', 'optimism', 'polygon', 'base'];

// Job state
let lastRunTime: Date | null = null;
let isRunning = false;
let lastResults: Map<string, { processed: number; errors: number }> = new Map();

/**
 * Run node analytics calculation for all networks
 */
export async function runNodeAnalyticsJob(): Promise<{
  executed: boolean;
  duration: number;
  results: Record<string, { processed: number; errors: number }>;
  errors: string[];
}> {
  if (isRunning) {
    console.log('[NodeAnalytics Job] Already running, skipping');
    return {
      executed: false,
      duration: 0,
      results: {},
      errors: ['Job already running'],
    };
  }

  isRunning = true;
  const startTime = Date.now();
  const results: Record<string, { processed: number; errors: number }> = {};
  const errors: string[] = [];

  try {
    console.log('[NodeAnalytics Job] Starting node analytics calculation...');

    for (const network of SUPPORTED_NETWORKS) {
      try {
        console.log(`[NodeAnalytics Job] Processing network: ${network}`);
        
        const result = await calculateNetworkNodeAnalytics(network, {
          batchSize: 50,
          maxNodes: 1000,  // Limit to prevent long processing
        });
        
        results[network] = result;
        lastResults.set(network, result);
        
        console.log(`[NodeAnalytics Job] ${network}: ${result.processed} nodes, ${result.errors} errors`);
        
      } catch (err) {
        const errorMsg = `Failed to process ${network}: ${err}`;
        errors.push(errorMsg);
        console.error(`[NodeAnalytics Job] ${errorMsg}`);
        results[network] = { processed: 0, errors: 1 };
      }
    }

    lastRunTime = new Date();
    const duration = Date.now() - startTime;
    
    console.log(`[NodeAnalytics Job] Completed in ${duration}ms`);

    return {
      executed: true,
      duration,
      results,
      errors,
    };

  } catch (err) {
    console.error('[NodeAnalytics Job] Fatal error:', err);
    return {
      executed: false,
      duration: Date.now() - startTime,
      results,
      errors: [`Fatal error: ${err}`],
    };
  } finally {
    isRunning = false;
  }
}

/**
 * Get job status
 */
export function getNodeAnalyticsJobStatus(): {
  lastRunTime: Date | null;
  isRunning: boolean;
  lastResults: Record<string, { processed: number; errors: number }>;
} {
  return {
    lastRunTime,
    isRunning,
    lastResults: Object.fromEntries(lastResults),
  };
}
