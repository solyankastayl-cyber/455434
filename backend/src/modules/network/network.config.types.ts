/**
 * PHASE 1 — Network Config Types
 * ================================
 * 
 * Runtime network configuration for proxy management.
 * Managed from admin UI without rebuild.
 */

// ═══════════════════════════════════════════════════════════════
// EGRESS MODES
// ═══════════════════════════════════════════════════════════════

export type EgressMode = 'direct' | 'proxy' | 'proxy_pool';

// ═══════════════════════════════════════════════════════════════
// PROXY CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface ProxyConfig {
  url: string;           // http://user:pass@ip:port
  timeoutMs: number;     // default 8000
  enabled: boolean;
}

export interface ProxyPoolItem {
  id: string;
  url: string;
  weight: number;        // for weighted selection
  enabled: boolean;
  lastError?: string;
  errorCount: number;
  lastUsed?: number;
}

// ═══════════════════════════════════════════════════════════════
// RETRY CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface RetryConfig {
  attempts: number;      // default 3
  backoffMs: number;     // default 500
  maxBackoffMs: number;  // default 5000
}

// ═══════════════════════════════════════════════════════════════
// NETWORK CONFIG (MAIN)
// ═══════════════════════════════════════════════════════════════

export interface NetworkConfig {
  _id: string;           // always "default"
  egressMode: EgressMode;
  
  proxy?: ProxyConfig;
  proxyPool: ProxyPoolItem[];
  
  retry: RetryConfig;
  
  // Provider-specific timeouts
  binanceTimeoutMs: number;
  bybitTimeoutMs: number;
  defaultTimeoutMs: number;
  
  updatedAt: Date;
  updatedBy?: string;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT CONFIG
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_NETWORK_CONFIG: Omit<NetworkConfig, '_id' | 'updatedAt'> = {
  egressMode: 'direct',
  
  proxy: {
    url: '',
    timeoutMs: 8000,
    enabled: false,
  },
  
  proxyPool: [],
  
  retry: {
    attempts: 3,
    backoffMs: 500,
    maxBackoffMs: 5000,
  },
  
  binanceTimeoutMs: 8000,
  bybitTimeoutMs: 8000,
  defaultTimeoutMs: 10000,
};

// ═══════════════════════════════════════════════════════════════
// PROBE RESULT
// ═══════════════════════════════════════════════════════════════

export interface ProbeResult {
  provider: string;
  url: string;
  ok: boolean;
  latencyMs?: number;
  httpCode?: number;
  reason?: 'GEO_BLOCK' | 'TIMEOUT' | 'AUTH' | 'NETWORK' | 'UNKNOWN';
  error?: string;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// HEALTH STATUS
// ═══════════════════════════════════════════════════════════════

export type NetworkHealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export interface NetworkHealth {
  status: NetworkHealthStatus;
  egressMode: EgressMode;
  activeProxy?: string;
  probes: ProbeResult[];
  lastCheck: number;
}

console.log('[Phase 1] Network Config Types loaded');
