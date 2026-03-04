/**
 * P0.2a Provider Pool Service
 * 
 * Manages external API providers with:
 * - Round-robin / least-used selection
 * - Cooldown on errors (429, 5xx)
 * - Auto-recovery
 * - Usage tracking
 */

// ============================================
// TYPES
// ============================================

export type ProviderType = 'coingecko' | 'binance';

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  apiKey?: string;
  baseUrl: string;
  weight: number;
  cooldownMs: number;
  rateLimit: {
    requestsPerMinute: number;
  };
}

export interface ProviderState {
  lastErrorAt: number;
  disabledUntil: number;
  requestCount: number;
  errorCount: number;
  lastRequestAt: number;
}

export interface ProviderStatus {
  id: string;
  type: ProviderType;
  healthy: boolean;
  requestCount: number;
  errorCount: number;
  disabledUntil: number | null;
  cooldownRemainingSec: number;
}

// ============================================
// DEFAULT PROVIDERS
// ============================================

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'coingecko_free_1',
    type: 'coingecko',
    baseUrl: 'https://api.coingecko.com/api/v3',
    weight: 1,
    cooldownMs: 60 * 1000, // 1 minute on error
    rateLimit: { requestsPerMinute: 10 },
  },
  // Binance as backup provider (no API key required for public endpoints)
  {
    id: 'binance_public_1',
    type: 'binance',
    baseUrl: 'https://api.binance.com/api/v3',
    weight: 2, // Lower priority (higher weight = less preferred in round-robin)
    cooldownMs: 30 * 1000, // 30 seconds on error
    rateLimit: { requestsPerMinute: 60 }, // Binance has higher rate limits
  },
];

// ============================================
// PROVIDER POOL CLASS
// ============================================

export class ProviderPool {
  private providers: ProviderConfig[];
  private state: Map<string, ProviderState>;
  private inFlightRequests: Map<string, Promise<any>>;

  constructor(providers: ProviderConfig[] = DEFAULT_PROVIDERS) {
    this.providers = providers;
    this.state = new Map();
    this.inFlightRequests = new Map();

    // Initialize state for each provider
    for (const p of providers) {
      this.state.set(p.id, {
        lastErrorAt: 0,
        disabledUntil: 0,
        requestCount: 0,
        errorCount: 0,
        lastRequestAt: 0,
      });
    }

    console.log(`[ProviderPool] Initialized with ${providers.length} providers`);
  }

  /**
   * Get an available provider (not in cooldown)
   * Uses least-used strategy for load balancing
   */
  getAvailableProvider(): ProviderConfig | null {
    const now = Date.now();

    // Filter available providers (not in cooldown)
    const available = this.providers.filter((p) => {
      const st = this.state.get(p.id);
      return !st?.disabledUntil || st.disabledUntil < now;
    });

    if (available.length === 0) {
      console.log('[ProviderPool] No available providers');
      return null;
    }

    // Sort by least requests (round-robin effect)
    available.sort((a, b) => {
      const sa = this.state.get(a.id)?.requestCount ?? 0;
      const sb = this.state.get(b.id)?.requestCount ?? 0;
      return sa - sb;
    });

    return available[0];
  }

  /**
   * Mark provider as successful
   */
  markSuccess(providerId: string): void {
    const st = this.state.get(providerId);
    if (!st) return;

    st.requestCount += 1;
    st.lastRequestAt = Date.now();
    // Reset error count on consecutive successes
    if (st.errorCount > 0) {
      st.errorCount = Math.max(0, st.errorCount - 1);
    }
  }

  /**
   * Mark provider as failed, apply cooldown
   */
  markFailure(providerId: string): void {
    const provider = this.providers.find((p) => p.id === providerId);
    const st = this.state.get(providerId);
    if (!st || !provider) return;

    st.errorCount += 1;
    st.lastErrorAt = Date.now();
    st.disabledUntil = Date.now() + provider.cooldownMs;

    console.log(
      `[ProviderPool] Provider ${providerId} disabled until ${new Date(st.disabledUntil).toISOString()}`
    );
  }

  /**
   * Check if a request is already in-flight (deduplication)
   */
  getInFlight<T>(key: string): Promise<T> | null {
    return this.inFlightRequests.get(key) as Promise<T> | null;
  }

  /**
   * Register an in-flight request
   */
  setInFlight<T>(key: string, promise: Promise<T>): void {
    this.inFlightRequests.set(key, promise);
    // Auto-cleanup after resolution
    promise.finally(() => {
      this.inFlightRequests.delete(key);
    });
  }

  /**
   * Get status of all providers
   */
  getStatus(): ProviderStatus[] {
    const now = Date.now();

    return this.providers.map((p) => {
      const st = this.state.get(p.id)!;
      const cooldownRemaining = Math.max(0, (st.disabledUntil - now) / 1000);

      return {
        id: p.id,
        type: p.type,
        healthy: st.disabledUntil < now,
        requestCount: st.requestCount,
        errorCount: st.errorCount,
        disabledUntil: st.disabledUntil > now ? st.disabledUntil : null,
        cooldownRemainingSec: Math.round(cooldownRemaining),
      };
    });
  }

  /**
   * Add a new provider at runtime
   */
  addProvider(config: ProviderConfig): void {
    this.providers.push(config);
    this.state.set(config.id, {
      lastErrorAt: 0,
      disabledUntil: 0,
      requestCount: 0,
      errorCount: 0,
      lastRequestAt: 0,
    });
    console.log(`[ProviderPool] Added provider: ${config.id}`);
  }

  /**
   * Remove a provider
   */
  removeProvider(providerId: string): void {
    this.providers = this.providers.filter((p) => p.id !== providerId);
    this.state.delete(providerId);
    console.log(`[ProviderPool] Removed provider: ${providerId}`);
  }

  /**
   * Reset all provider states
   */
  reset(): void {
    for (const [id] of this.state) {
      this.state.set(id, {
        lastErrorAt: 0,
        disabledUntil: 0,
        requestCount: 0,
        errorCount: 0,
        lastRequestAt: 0,
      });
    }
    console.log('[ProviderPool] All providers reset');
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let poolInstance: ProviderPool | null = null;

export function getProviderPool(): ProviderPool {
  if (!poolInstance) {
    poolInstance = new ProviderPool();
  }
  return poolInstance;
}

export function resetProviderPool(): void {
  poolInstance = null;
}

export default {
  ProviderPool,
  getProviderPool,
  resetProviderPool,
};
