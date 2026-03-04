/**
 * HEAVY VERDICT REFRESH JOB
 * =========================
 * 
 * P3: Smart Caching Layer - Blocks 12, 13, 21
 * Proactive refresh of cache entries before they expire.
 * 
 * Features:
 * - Scans cache every 15 seconds
 * - Refreshes entries that are near expiry (within refresh window)
 * - Uses single-flight to prevent duplicate refreshes (Block 22)
 * - Does not refresh if entry is already being refreshed
 * - Uses horizon-aware TTL (Block 23)
 * - Implements TTL Auto-Refresh (Block 13)
 */

import { HeavyVerdictStore, heavyVerdictStore } from '../runtime/heavy-verdict.store.js';
import { HeavyComputeService, heavyComputeService } from '../runtime/heavy-compute.service.js';
import type { ForecastHorizon } from '../runtime/heavy-verdict.types.js';

const DEFAULT_INTERVAL_MS = 15_000;     // Check every 15 seconds
const DEFAULT_REFRESH_WINDOW_MS = 60_000; // Refresh entries expiring in 60 seconds

export class HeavyVerdictRefreshJob {
  private timer: NodeJS.Timeout | null = null;
  private refreshCount = 0;
  private errorCount = 0;

  constructor(
    private store: HeavyVerdictStore = heavyVerdictStore,
    private compute: HeavyComputeService = heavyComputeService,
    private intervalMs: number = DEFAULT_INTERVAL_MS,
    private refreshWindowMs: number = DEFAULT_REFRESH_WINDOW_MS
  ) {}

  /**
   * Start the refresh job
   */
  start() {
    if (this.timer) {
      console.log('[HeavyRefreshJob] Already running');
      return;
    }

    console.log(`[HeavyRefreshJob] Starting with interval=${this.intervalMs}ms, refreshWindow=${this.refreshWindowMs}ms`);

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  /**
   * Stop the refresh job
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[HeavyRefreshJob] Stopped');
    }
  }

  /**
   * Get job status
   */
  status() {
    return {
      running: this.timer !== null,
      intervalMs: this.intervalMs,
      refreshWindowMs: this.refreshWindowMs,
      refreshCount: this.refreshCount,
      errorCount: this.errorCount,
    };
  }

  /**
   * Single tick of the refresh job
   */
  private async tick() {
    const keys = this.store.keys();
    let refreshed = 0;
    let skipped = 0;

    for (const key of keys) {
      // Skip if already refreshing
      if (this.store.getInFlight(key)) {
        skipped++;
        continue;
      }

      // Check if near expiry
      if (!this.store.isNearExpiry(key, this.refreshWindowMs)) {
        continue;
      }

      // Parse key to get symbol and horizon
      const parsed = this.parseKey(key);
      if (!parsed) continue;

      const { symbol, horizon } = parsed;

      // Block 22: Start refresh with single-flight protection
      const p = (async () => {
        try {
          const fresh = await this.compute.compute(symbol, horizon as ForecastHorizon);
          // Block 23: Use horizon-aware TTL
          this.store.setWithHorizon(key, fresh, horizon as ForecastHorizon);
          this.refreshCount++;
          refreshed++;
          return fresh;
        } catch (e: any) {
          console.warn(`[HeavyRefreshJob] Refresh failed for ${key}:`, e.message);
          this.errorCount++;
          // Keep old value in cache
          const old = this.store.getStaleOk(key);
          return old.value;
        } finally {
          this.store.clearInFlight(key);
        }
      })();

      this.store.setInFlight(key, p);
    }

    if (refreshed > 0) {
      console.log(`[HeavyRefreshJob] Refreshed ${refreshed} entries, skipped ${skipped}`);
    }
  }

  /**
   * Parse cache key to extract symbol and horizon
   */
  private parseKey(key: string): { symbol: string; horizon: string } | null {
    // Key format: "symbol:BTC|h:1D"
    const match = key.match(/symbol:(\w+)\|h:(\w+)/);
    if (!match) return null;
    return { symbol: match[1], horizon: match[2] };
  }
}

// Singleton instance
export const heavyVerdictRefreshJob = new HeavyVerdictRefreshJob();

console.log('[HeavyVerdictRefreshJob] Module loaded (Blocks 12, 13, 21)');
