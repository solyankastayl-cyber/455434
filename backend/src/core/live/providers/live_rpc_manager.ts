/**
 * Live RPC Manager
 * 
 * Manages RPC provider connections with automatic failover.
 * Primary: Infura, Secondary: Ankr
 * 
 * Features:
 * - Health scoring (0-100)
 * - Auto-switch on errors/timeouts
 * - Latency tracking
 */

import { RATE_CONFIG } from '../live_ingestion.types.js';

// ==================== TYPES ====================

interface ProviderConfig {
  name: 'infura' | 'ankr';
  url: string;
  health: number;
  lastError?: string;
  lastErrorAt?: Date;
  totalCalls: number;
  totalErrors: number;
  avgLatencyMs: number;
}

interface RpcCallResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  provider: 'infura' | 'ankr';
  latencyMs: number;
}

// ==================== STATE ====================

let providers: ProviderConfig[] = [];
let currentProviderIndex = 0;
let initialized = false;

// ==================== INITIALIZATION ====================

/**
 * Initialize RPC providers from environment
 */
export function initRpcProviders(): void {
  const infuraUrl = process.env.INFURA_RPC_URL;
  const ankrUrl = process.env.ANKR_RPC_URL;
  
  providers = [];
  
  if (infuraUrl) {
    providers.push({
      name: 'infura',
      url: infuraUrl,
      health: 100,
      totalCalls: 0,
      totalErrors: 0,
      avgLatencyMs: 0,
    });
  }
  
  if (ankrUrl) {
    providers.push({
      name: 'ankr',
      url: ankrUrl,
      health: 100,
      totalCalls: 0,
      totalErrors: 0,
      avgLatencyMs: 0,
    });
  }
  
  if (providers.length === 0) {
    throw new Error('[RPC] No providers configured. Set INFURA_RPC_URL or ANKR_RPC_URL');
  }
  
  currentProviderIndex = 0;
  initialized = true;
  
  console.log(`[RPC] Initialized ${providers.length} providers: ${providers.map(p => p.name).join(', ')}`);
}

/**
 * Get current active provider
 */
export function getCurrentProvider(): ProviderConfig {
  if (!initialized || providers.length === 0) {
    initRpcProviders();
  }
  return providers[currentProviderIndex];
}

/**
 * Get provider name
 */
export function getCurrentProviderName(): 'infura' | 'ankr' {
  return getCurrentProvider().name;
}

// ==================== HEALTH MANAGEMENT ====================

/**
 * Record successful call
 */
function recordSuccess(latencyMs: number): void {
  const provider = providers[currentProviderIndex];
  provider.totalCalls++;
  
  // Exponential moving average for latency
  provider.avgLatencyMs = provider.avgLatencyMs * 0.9 + latencyMs * 0.1;
  
  // Restore health on success (slow recovery)
  if (provider.health < 100) {
    provider.health = Math.min(100, provider.health + 2);
  }
}

/**
 * Record failed call
 */
function recordError(error: string, shouldSwitch: boolean): void {
  const provider = providers[currentProviderIndex];
  provider.totalCalls++;
  provider.totalErrors++;
  provider.lastError = error;
  provider.lastErrorAt = new Date();
  
  // Decrease health on error
  provider.health = Math.max(0, provider.health - 20);
  
  // Switch provider if health is low or explicit switch requested
  if (shouldSwitch && providers.length > 1) {
    switchProvider();
  }
}

/**
 * Switch to next available provider
 */
function switchProvider(): void {
  if (providers.length <= 1) return;
  
  const oldProvider = providers[currentProviderIndex].name;
  currentProviderIndex = (currentProviderIndex + 1) % providers.length;
  const newProvider = providers[currentProviderIndex].name;
  
  console.log(`[RPC] Switched provider: ${oldProvider} → ${newProvider}`);
}

/**
 * Check if we should switch based on current health
 */
function shouldSwitchProvider(error: string): boolean {
  const provider = providers[currentProviderIndex];
  
  // Always switch on rate limit
  if (error.includes('429') || error.includes('rate limit')) {
    return true;
  }
  
  // Switch if health drops below threshold
  if (provider.health < 50) {
    return true;
  }
  
  return false;
}

// ==================== RPC CALLS ====================

/**
 * Make JSON-RPC call with retry and failover
 */
export async function rpcCall<T>(
  method: string,
  params: any[],
  retries: number = RATE_CONFIG.MAX_RETRIES
): Promise<RpcCallResult<T>> {
  if (!initialized) {
    initRpcProviders();
  }
  
  let lastError = '';
  
  for (let attempt = 0; attempt < retries; attempt++) {
    const provider = getCurrentProvider();
    const startTime = Date.now();
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RATE_CONFIG.RPC_TIMEOUT_MS);
      
      const response = await fetch(provider.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method,
          params,
          id: Date.now(),
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeout);
      
      const latencyMs = Date.now() - startTime;
      
      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${response.statusText}`;
        recordError(lastError, shouldSwitchProvider(lastError));
        continue;
      }
      
      const data = await response.json() as { result?: T; error?: { message: string; code: number } };
      
      if (data.error) {
        lastError = data.error.message || 'RPC error';
        
        // Check if we should reduce range (too many results)
        if (lastError.includes('too many results') || lastError.includes('query returned more than')) {
          // Don't count as provider error, return it to caller
          return {
            ok: false,
            error: lastError,
            provider: provider.name,
            latencyMs,
          };
        }
        
        recordError(lastError, shouldSwitchProvider(lastError));
        continue;
      }
      
      // Success
      recordSuccess(latencyMs);
      
      return {
        ok: true,
        data: data.result,
        provider: provider.name,
        latencyMs,
      };
      
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      lastError = err.name === 'AbortError' ? 'Request timeout' : err.message;
      recordError(lastError, true);
      
      // Brief delay before retry
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  
  return {
    ok: false,
    error: lastError,
    provider: getCurrentProvider().name,
    latencyMs: 0,
  };
}

// ==================== CONVENIENCE METHODS ====================

/**
 * Get latest block number
 */
export async function getBlockNumber(): Promise<{ ok: boolean; blockNumber?: number; error?: string; provider: string }> {
  const result = await rpcCall<string>('eth_blockNumber', []);
  
  if (!result.ok || !result.data) {
    return { ok: false, error: result.error, provider: result.provider };
  }
  
  return {
    ok: true,
    blockNumber: parseInt(result.data, 16),
    provider: result.provider,
  };
}

/**
 * Get logs for a contract
 */
export async function getLogs(params: {
  address: string;
  fromBlock: number;
  toBlock: number;
  topics: string[];
}): Promise<{
  ok: boolean;
  logs?: any[];
  error?: string;
  provider: string;
  latencyMs: number;
}> {
  const result = await rpcCall<any[]>('eth_getLogs', [{
    address: params.address.toLowerCase(),
    fromBlock: '0x' + params.fromBlock.toString(16),
    toBlock: '0x' + params.toBlock.toString(16),
    topics: params.topics,
  }]);
  
  return {
    ok: result.ok,
    logs: result.data,
    error: result.error,
    provider: result.provider,
    latencyMs: result.latencyMs,
  };
}

/**
 * Get block by number (for timestamp)
 */
export async function getBlock(blockNumber: number): Promise<{
  ok: boolean;
  block?: { timestamp: number; number: number };
  error?: string;
}> {
  const result = await rpcCall<any>('eth_getBlockByNumber', [
    '0x' + blockNumber.toString(16),
    false, // Don't include transactions
  ]);
  
  if (!result.ok || !result.data) {
    return { ok: false, error: result.error };
  }
  
  return {
    ok: true,
    block: {
      number: parseInt(result.data.number, 16),
      timestamp: parseInt(result.data.timestamp, 16),
    },
  };
}

// ==================== DIAGNOSTICS ====================

/**
 * Get provider health stats
 */
export function getProviderStats(): {
  current: string;
  providers: Array<{
    name: string;
    health: number;
    totalCalls: number;
    errorRate: number;
    avgLatencyMs: number;
    lastError?: string;
  }>;
} {
  return {
    current: getCurrentProviderName(),
    providers: providers.map(p => ({
      name: p.name,
      health: p.health,
      totalCalls: p.totalCalls,
      errorRate: p.totalCalls > 0 ? p.totalErrors / p.totalCalls : 0,
      avgLatencyMs: Math.round(p.avgLatencyMs),
      lastError: p.lastError,
    })),
  };
}
