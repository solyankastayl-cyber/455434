/**
 * DEX Feature Adapter Service
 * 
 * Reads DEX features from dex-indexer (port 7099)
 * Applies safety guards before including in dataset
 */
import axios from 'axios';

const DEX_API_URL = process.env.DEX_API_URL || 'http://localhost:7099';

// Safety thresholds
const MIN_POOLS = 10;           // Minimum pools to consider DEX data valid
const MIN_ROWS_24H = 50;        // Minimum feature rows in last 24h
const MIN_COVERAGE = 0.3;       // Minimum universe coverage (30%)

export interface DexAggregates {
  dex_liquidity_net_1h: number;
  dex_liquidity_net_24h: number;
  dex_lp_spike_level: number;
  dex_lp_spike_direction: number;
  dex_depth_index: number;
  dex_thin_liquidity_share: number;
  dex_price_confidence_avg: number;
  dex_universe_coverage: number;
}

export interface DexStats {
  pools: number;
  featuresRows24h: number;
  coverage: number;
}

export interface DexAvailabilityResult {
  available: boolean;
  reason?: string;
  stats?: DexStats;
  aggregates?: DexAggregates;
}

/**
 * Check DEX data availability and get aggregates
 */
export async function getDexAggregates(network: string): Promise<DexAvailabilityResult> {
  try {
    // 1. Check B3 status
    const statusRes = await axios.get(`${DEX_API_URL}/b3/status`, { timeout: 5000 });
    
    if (!statusRes.data?.ok) {
      return { available: false, reason: 'DEX_API_ERROR' };
    }
    
    const networkData = statusRes.data.data?.[network.toLowerCase()];
    if (!networkData) {
      return { available: false, reason: 'NETWORK_NOT_INDEXED' };
    }
    
    // 2. Check pool count
    const poolsRes = await axios.get(`${DEX_API_URL}/dex/pools?network=${network}&limit=1`, { timeout: 5000 });
    const poolCount = poolsRes.data?.count || 0;
    
    if (poolCount < MIN_POOLS) {
      return {
        available: false,
        reason: 'INSUFFICIENT_POOLS',
        stats: { pools: poolCount, featuresRows24h: 0, coverage: 0 },
      };
    }
    
    // 3. Get LP features count (last 24h)
    const lpRes = await axios.get(`${DEX_API_URL}/b3/lp/${network}?limit=500`, { timeout: 5000 });
    const lpCount = lpRes.data?.data?.count || 0;
    
    if (lpCount < MIN_ROWS_24H) {
      return {
        available: false,
        reason: 'INSUFFICIENT_LP_DATA',
        stats: { pools: poolCount, featuresRows24h: lpCount, coverage: 0 },
      };
    }
    
    // 4. Get universe and calculate coverage
    const universeRes = await axios.get(`${DEX_API_URL}/b3/universe/${network}`, { timeout: 5000 });
    const universeSize = universeRes.data?.data?.tokenCount || 0;
    
    const depthRes = await axios.get(`${DEX_API_URL}/b3/status`, { timeout: 5000 });
    const depthCount = depthRes.data?.data?.[network.toLowerCase()]?.depthSnapshots || 0;
    
    const coverage = universeSize > 0 ? depthCount / universeSize : 0;
    
    if (coverage < MIN_COVERAGE) {
      return {
        available: false,
        reason: 'INSUFFICIENT_COVERAGE',
        stats: { pools: poolCount, featuresRows24h: lpCount, coverage },
      };
    }
    
    // 5. Calculate aggregates from LP features
    const aggregates = await calculateAggregates(network, lpRes.data?.data?.features || []);
    
    return {
      available: true,
      stats: { pools: poolCount, featuresRows24h: lpCount, coverage },
      aggregates,
    };
    
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[DEX Adapter] Error for ${network}:`, errMsg);
    return {
      available: false,
      reason: `DEX_UNAVAILABLE: ${errMsg}`,
    };
  }
}

/**
 * Calculate aggregate DEX features from LP data
 */
async function calculateAggregates(network: string, lpFeatures: any[]): Promise<DexAggregates> {
  if (lpFeatures.length === 0) {
    return defaultAggregates();
  }
  
  // Aggregate LP metrics
  let totalNet1h = 0;
  let totalNet24h = 0;
  let spikeHighCount = 0;
  let spikeMedCount = 0;
  let addCount = 0;
  let removeCount = 0;
  
  for (const lp of lpFeatures) {
    totalNet1h += lp.netLiquidity1h || 0;
    totalNet24h += lp.netLiquidity24h || 0;
    
    if (lp.spikeLevel === 'HIGH') spikeHighCount++;
    else if (lp.spikeLevel === 'MEDIUM') spikeMedCount++;
    
    if (lp.spikeDirection === 'ADD') addCount++;
    else if (lp.spikeDirection === 'REMOVE') removeCount++;
  }
  
  // Calculate aggregate spike level (0, 1, 2)
  let aggSpikeLevel = 0;
  if (spikeHighCount > 0) aggSpikeLevel = 2;
  else if (spikeMedCount > lpFeatures.length * 0.2) aggSpikeLevel = 1;
  
  // Calculate aggregate spike direction (-1, 0, 1)
  let aggSpikeDir = 0;
  if (addCount > removeCount * 1.5) aggSpikeDir = 1;
  else if (removeCount > addCount * 1.5) aggSpikeDir = -1;
  
  // Get depth aggregates
  let depthIndex = 0.5; // Default middle
  let thinShare = 0;
  
  try {
    const depthRes = await axios.get(`${DEX_API_URL}/b3/status`, { timeout: 3000 });
    // Placeholder: would calculate from depth snapshots
  } catch {}
  
  // Get price confidence average
  let priceConfAvg = 0.5;
  try {
    const priceRes = await axios.get(`${DEX_API_URL}/b3/price/${network}?limit=100`, { timeout: 3000 });
    const prices = priceRes.data?.data?.prices || [];
    if (prices.length > 0) {
      priceConfAvg = prices.reduce((sum: number, p: any) => sum + (p.confidence || 0), 0) / prices.length;
    }
  } catch {}
  
  // Universe coverage
  let universeCoverage = 0;
  try {
    const universeRes = await axios.get(`${DEX_API_URL}/b3/universe/${network}`, { timeout: 3000 });
    const universeSize = universeRes.data?.data?.tokenCount || 0;
    universeCoverage = universeSize > 0 ? lpFeatures.length / universeSize : 0;
  } catch {}
  
  return {
    dex_liquidity_net_1h: Math.round(totalNet1h * 100) / 100,
    dex_liquidity_net_24h: Math.round(totalNet24h * 100) / 100,
    dex_lp_spike_level: aggSpikeLevel,
    dex_lp_spike_direction: aggSpikeDir,
    dex_depth_index: Math.round(depthIndex * 1000) / 1000,
    dex_thin_liquidity_share: Math.round(thinShare * 1000) / 1000,
    dex_price_confidence_avg: Math.round(priceConfAvg * 1000) / 1000,
    dex_universe_coverage: Math.round(universeCoverage * 1000) / 1000,
  };
}

/**
 * Default zero aggregates when no data
 */
function defaultAggregates(): DexAggregates {
  return {
    dex_liquidity_net_1h: 0,
    dex_liquidity_net_24h: 0,
    dex_lp_spike_level: 0,
    dex_lp_spike_direction: 0,
    dex_depth_index: 0,
    dex_thin_liquidity_share: 0,
    dex_price_confidence_avg: 0,
    dex_universe_coverage: 0,
  };
}

export default {
  getDexAggregates,
};
