/**
 * PHASE 1 — Network Config Service
 * ==================================
 * 
 * Runtime configuration for network/proxy management.
 * Changes apply immediately without restart.
 */

import { NetworkConfigModel } from './network.config.model.js';
import { 
  NetworkConfig, 
  DEFAULT_NETWORK_CONFIG,
  ProxyPoolItem,
} from './network.config.types.js';

// ═══════════════════════════════════════════════════════════════
// CACHED CONFIG (in-memory for performance)
// ═══════════════════════════════════════════════════════════════

let cachedConfig: NetworkConfig | null = null;
let lastFetch = 0;
const CACHE_TTL = 5000; // 5 seconds

// ═══════════════════════════════════════════════════════════════
// GET CONFIG
// ═══════════════════════════════════════════════════════════════

/**
 * Get current network config (with caching)
 */
export async function getNetworkConfig(): Promise<NetworkConfig> {
  const now = Date.now();
  
  if (cachedConfig && (now - lastFetch) < CACHE_TTL) {
    return cachedConfig;
  }
  
  let config = await NetworkConfigModel.findById('default').lean();
  
  if (!config) {
    // Create default config
    config = await NetworkConfigModel.create({
      _id: 'default',
      ...DEFAULT_NETWORK_CONFIG,
      updatedAt: new Date(),
    });
  }
  
  cachedConfig = config as NetworkConfig;
  lastFetch = now;
  
  return cachedConfig;
}

/**
 * Force refresh config from DB
 */
export async function refreshNetworkConfig(): Promise<NetworkConfig> {
  cachedConfig = null;
  lastFetch = 0;
  return getNetworkConfig();
}

// ═══════════════════════════════════════════════════════════════
// UPDATE CONFIG
// ═══════════════════════════════════════════════════════════════

/**
 * Update network config
 */
export async function updateNetworkConfig(
  patch: Partial<NetworkConfig>,
  updatedBy?: string
): Promise<NetworkConfig> {
  const update = {
    ...patch,
    updatedAt: new Date(),
    updatedBy,
  };
  
  const config = await NetworkConfigModel.findByIdAndUpdate(
    'default',
    { $set: update },
    { new: true, upsert: true }
  ).lean();
  
  // Invalidate cache immediately
  cachedConfig = config as NetworkConfig;
  lastFetch = Date.now();
  
  console.log(`[Network] Config updated: egressMode=${config.egressMode}`);
  
  return cachedConfig;
}

// ═══════════════════════════════════════════════════════════════
// PROXY POOL MANAGEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Add proxy to pool
 */
export async function addProxyToPool(proxy: Omit<ProxyPoolItem, 'errorCount' | 'lastUsed'>): Promise<NetworkConfig> {
  const newProxy: ProxyPoolItem = {
    ...proxy,
    errorCount: 0,
  };
  
  return updateNetworkConfig({
    $push: { proxyPool: newProxy } as any,
  } as any);
}

/**
 * Remove proxy from pool
 */
export async function removeProxyFromPool(proxyId: string): Promise<NetworkConfig> {
  const config = await getNetworkConfig();
  const filtered = config.proxyPool.filter(p => p.id !== proxyId);
  return updateNetworkConfig({ proxyPool: filtered });
}

/**
 * Update proxy error count
 */
export async function recordProxyError(proxyId: string, error: string): Promise<void> {
  const config = await getNetworkConfig();
  const proxy = config.proxyPool.find(p => p.id === proxyId);
  
  if (proxy) {
    proxy.errorCount++;
    proxy.lastError = error;
    
    // Auto-disable after 5 consecutive errors
    if (proxy.errorCount >= 5) {
      proxy.enabled = false;
      console.log(`[Network] Proxy ${proxyId} disabled after 5 errors`);
    }
    
    await updateNetworkConfig({ proxyPool: config.proxyPool });
  }
}

/**
 * Reset proxy errors
 */
export async function resetProxyErrors(proxyId: string): Promise<void> {
  const config = await getNetworkConfig();
  const proxy = config.proxyPool.find(p => p.id === proxyId);
  
  if (proxy) {
    proxy.errorCount = 0;
    proxy.lastError = undefined;
    proxy.enabled = true;
    await updateNetworkConfig({ proxyPool: config.proxyPool });
  }
}

// ═══════════════════════════════════════════════════════════════
// PROXY SELECTION
// ═══════════════════════════════════════════════════════════════

let poolIndex = 0;

/**
 * Select proxy from pool (round-robin with weight)
 */
export function selectProxyFromPool(pool: ProxyPoolItem[]): ProxyPoolItem | null {
  const enabled = pool.filter(p => p.enabled);
  if (enabled.length === 0) return null;
  
  // Simple round-robin for now
  const proxy = enabled[poolIndex % enabled.length];
  poolIndex++;
  
  return proxy;
}

/**
 * Get active proxy URL based on current config
 */
export async function getActiveProxyUrl(): Promise<string | null> {
  const config = await getNetworkConfig();
  
  if (config.egressMode === 'direct') {
    // Check for Emergent integration proxy as fallback
    const integrationProxy = process.env.integration_proxy_url;
    if (integrationProxy) {
      console.log('[Network] Using Emergent integration proxy');
      return integrationProxy;
    }
    return null;
  }
  
  if (config.egressMode === 'proxy' && config.proxy?.enabled) {
    return config.proxy.url;
  }
  
  if (config.egressMode === 'proxy_pool') {
    const proxy = selectProxyFromPool(config.proxyPool);
    return proxy?.url || null;
  }
  
  return null;
}

console.log('[Phase 1] Network Config Service loaded');
