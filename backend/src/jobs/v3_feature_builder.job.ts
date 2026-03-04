/**
 * V3.0 Pack A Feature Builder Job
 * 
 * Runs:
 * - Market V3 features (CEX + Zones) every 5 minutes
 * - Corridor V3 features every 1 hour
 */

import { runMarketFeatureV3Builder } from '../core/features/market_feature_v3.builder.js';
import { runCorridorFeatureV3Builder, getCorridorV3Summary } from '../core/features/corridor_feature_v3.builder.js';

let lastCorridorRun = 0;
const CORRIDOR_INTERVAL = 60 * 60 * 1000; // 1 hour

/**
 * Main V3 feature builder job
 * Call this from scheduler every 5 minutes
 */
export async function runV3FeatureBuilderJob(): Promise<{
  market: { networks: number; spikes: number };
  corridor: { networks: number; corridors: number } | null;
}> {
  const startTime = Date.now();
  
  // Always run market features (5m granularity for spike detection)
  console.log('[V3 Features] Starting market feature builder...');
  const marketResults = await runMarketFeatureV3Builder();
  
  const successNetworks = marketResults.filter(r => r.success).length;
  const spikes = marketResults.filter(r => r.cexSpike && r.cexSpike !== 'NONE').length;
  
  if (spikes > 0) {
    console.log(`[V3 Features] ⚠️ ${spikes} CEX spikes detected!`);
  }
  
  // Run corridor features every hour
  let corridorResult = null;
  const now = Date.now();
  
  if (now - lastCorridorRun >= CORRIDOR_INTERVAL) {
    console.log('[V3 Features] Starting corridor feature builder...');
    const corridorResults = await runCorridorFeatureV3Builder();
    
    const totalCorridors = corridorResults.reduce((sum, r) => sum + r.count, 0);
    corridorResult = {
      networks: corridorResults.filter(r => r.count > 0).length,
      corridors: totalCorridors,
    };
    
    lastCorridorRun = now;
    
    console.log(`[V3 Features] Corridor builder complete: ${totalCorridors} corridors`);
  }
  
  const elapsed = Date.now() - startTime;
  console.log(`[V3 Features] Complete in ${elapsed}ms`);
  
  return {
    market: { networks: successNetworks, spikes },
    corridor: corridorResult,
  };
}

/**
 * Get V3 feature status for admin dashboard
 */
export async function getV3FeatureStatus(network: string): Promise<{
  corridorSummary: Awaited<ReturnType<typeof getCorridorV3Summary>>;
  lastUpdate: number;
}> {
  const corridorSummary = await getCorridorV3Summary(network);
  
  return {
    corridorSummary,
    lastUpdate: Math.floor(Date.now() / 1000),
  };
}

export default { 
  runV3FeatureBuilderJob,
  getV3FeatureStatus,
};
