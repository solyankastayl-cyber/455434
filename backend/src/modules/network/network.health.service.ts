/**
 * PHASE 1 — Network Health Service
 * ==================================
 * 
 * Probes exchange endpoints to check connectivity.
 */

import { createHttpClient } from './httpClient.factory.js';
import { getNetworkConfig } from './network.config.service.js';
import { ProbeResult, NetworkHealth, NetworkHealthStatus } from './network.config.types.js';

// ═══════════════════════════════════════════════════════════════
// PROBE ENDPOINTS
// ═══════════════════════════════════════════════════════════════

const PROBE_ENDPOINTS = {
  BINANCE: {
    name: 'Binance Futures',
    url: 'https://fapi.binance.com/fapi/v1/time',
  },
  BYBIT: {
    name: 'Bybit',
    url: 'https://api.bybit.com/v5/market/time',
  },
  COINBASE: {
    name: 'Coinbase',
    url: 'https://api.exchange.coinbase.com/time',
  },
  HYPERLIQUID: {
    name: 'Hyperliquid',
    url: 'https://api.hyperliquid.xyz/info',
  },
};

// ═══════════════════════════════════════════════════════════════
// PROBE FUNCTION
// ═══════════════════════════════════════════════════════════════

function detectErrorReason(error: any): ProbeResult['reason'] {
  const status = error.response?.status;
  const message = error.message?.toLowerCase() || '';
  
  if (status === 451 || status === 403) return 'GEO_BLOCK';
  if (status === 401 || status === 403) return 'AUTH';
  if (message.includes('timeout') || error.code === 'ECONNABORTED') return 'TIMEOUT';
  if (message.includes('network') || error.code === 'ENOTFOUND') return 'NETWORK';
  
  return 'UNKNOWN';
}

/**
 * Probe a single endpoint
 */
export async function probeEndpoint(
  provider: string,
  url: string
): Promise<ProbeResult> {
  const start = Date.now();
  
  try {
    const client = await createHttpClient({ timeout: 8000 });
    
    // Hyperliquid requires POST with body
    let response;
    if (provider === 'HYPERLIQUID') {
      response = await client.post(url, { type: 'meta' });
    } else {
      response = await client.get(url);
    }
    
    return {
      provider,
      url,
      ok: true,
      latencyMs: Date.now() - start,
      httpCode: response.status,
      timestamp: Date.now(),
    };
  } catch (error: any) {
    return {
      provider,
      url,
      ok: false,
      latencyMs: Date.now() - start,
      httpCode: error.response?.status,
      reason: detectErrorReason(error),
      error: error.message,
      timestamp: Date.now(),
    };
  }
}

/**
 * Probe all configured endpoints
 */
export async function probeAllEndpoints(): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  
  for (const [key, endpoint] of Object.entries(PROBE_ENDPOINTS)) {
    const result = await probeEndpoint(key, endpoint.url);
    results.push(result);
  }
  
  return results;
}

/**
 * Probe specific provider
 */
export async function probeProvider(provider: string): Promise<ProbeResult | null> {
  const endpoint = PROBE_ENDPOINTS[provider as keyof typeof PROBE_ENDPOINTS];
  if (!endpoint) return null;
  
  return probeEndpoint(provider, endpoint.url);
}

// ═══════════════════════════════════════════════════════════════
// HEALTH STATUS
// ═══════════════════════════════════════════════════════════════

/**
 * Get overall network health
 */
export async function getNetworkHealth(): Promise<NetworkHealth> {
  const config = await getNetworkConfig();
  const probes = await probeAllEndpoints();
  
  const okCount = probes.filter(p => p.ok).length;
  const total = probes.length;
  
  let status: NetworkHealthStatus = 'HEALTHY';
  if (okCount === 0) status = 'DOWN';
  else if (okCount < total) status = 'DEGRADED';
  
  // Get active proxy
  let activeProxy: string | undefined;
  if (config.egressMode === 'proxy' && config.proxy?.enabled) {
    activeProxy = config.proxy.url.replace(/:[^:@]+@/, ':***@'); // Mask password
  } else if (config.egressMode === 'proxy_pool') {
    const enabled = config.proxyPool.filter(p => p.enabled);
    if (enabled.length > 0) {
      activeProxy = `pool (${enabled.length} proxies)`;
    }
  }
  
  return {
    status,
    egressMode: config.egressMode,
    activeProxy,
    probes,
    lastCheck: Date.now(),
  };
}

console.log('[Phase 1] Network Health Service loaded');
