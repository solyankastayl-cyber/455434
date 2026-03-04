/**
 * HEAVY VERDICT JOB
 * =================
 * 
 * P3: Smart Caching Layer - Blocks 21, 24, 27
 * Background job that periodically warms up the heavy verdict cache.
 * 
 * Features:
 * - Precomputes verdicts for popular symbols (Block 27)
 * - Runs on configurable interval (default: 2 minutes)
 * - Skips symbols that already have fresh cache
 * - Parallel computation with configurable concurrency
 * - Auto-prunes dead entries after each run
 * - Smart TTL per horizon (Block 23)
 * - Staggered warmup to avoid CPU spikes (Block 27.3)
 * 
 * Symbols: BTC, ETH, SOL (expandable via Block 28)
 * Horizons: 1D, 7D, 30D
 */

import { HeavyVerdictStore, heavyVerdictStore } from '../runtime/heavy-verdict.store.js';
import { HeavyComputeService, heavyComputeService } from '../runtime/heavy-compute.service.js';
import type { ForecastHorizon } from '../runtime/heavy-verdict.types.js';

export type HeavyJobConfig = {
  enabled: boolean;
  intervalMs: number;           // Interval between runs (default: 2 minutes)
  symbols: string[];            // Symbols to warm up
  horizons: ForecastHorizon[];  // Horizons to warm up
  parallel: number;             // Max parallel computations
  staggerDelayMs: number;       // Block 27.3: Delay between tasks to avoid CPU spikes
};

const DEFAULT_CONFIG: HeavyJobConfig = {
  enabled: true,
  intervalMs: 2 * 60_000,       // 2 minutes
  // BLOCK B: Extended to cover full 'core' universe for rankings
  symbols: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'LINK', 'DOGE', 'MATIC'],
  horizons: ['1D', '7D', '30D'],
  parallel: 3,                  // 3 concurrent computations (increased for larger universe)
  staggerDelayMs: 200,          // Block 27.3: 200ms between tasks (faster warmup)
};

export class HeavyVerdictJob {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastRunAt: number = 0;
  private runCount = 0;

  constructor(
    private cfg: HeavyJobConfig = DEFAULT_CONFIG,
    private store: HeavyVerdictStore = heavyVerdictStore,
    private compute: HeavyComputeService = heavyComputeService
  ) {}

  /**
   * Start the background job
   */
  start() {
    if (!this.cfg.enabled) {
      console.log('[HeavyVerdictJob] Disabled, not starting');
      return;
    }
    if (this.timer) {
      console.log('[HeavyVerdictJob] Already running');
      return;
    }

    console.log(`[HeavyVerdictJob] Starting with interval=${this.cfg.intervalMs}ms, symbols=${this.cfg.symbols.join(',')}`);

    // Immediate warmup (with delay to let server boot)
    setTimeout(() => {
      void this.tick();
    }, 5000);

    // Periodic warmup
    this.timer = setInterval(() => void this.tick(), this.cfg.intervalMs);
  }

  /**
   * Stop the background job
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[HeavyVerdictJob] Stopped');
    }
  }

  /**
   * Get job status
   */
  status() {
    return {
      enabled: this.cfg.enabled,
      running: this.running,
      lastRunAt: this.lastRunAt ? new Date(this.lastRunAt).toISOString() : null,
      runCount: this.runCount,
      config: this.cfg,
    };
  }

  /**
   * Force a run now (for admin/testing)
   */
  async runNow() {
    await this.tick();
  }

  /**
   * Single tick of the job
   */
  private async tick() {
    if (this.running) {
      console.log('[HeavyVerdictJob] Already running, skipping tick');
      return;
    }
    
    this.running = true;
    this.lastRunAt = Date.now();
    this.runCount++;
    
    console.log(`[HeavyVerdictJob] Tick #${this.runCount} starting...`);

    try {
      const tasks: Array<{ symbol: string; horizon: ForecastHorizon }> = [];
      
      // Build list of tasks (skip if fresh cache exists)
      for (const symbol of this.cfg.symbols) {
        for (const horizon of this.cfg.horizons) {
          const key = this.store.makeKey({ symbol, horizon });
          
          // Skip if we have fresh cache
          if (this.store.getFresh(key)) {
            continue;
          }
          
          tasks.push({ symbol, horizon });
        }
      }

      if (tasks.length === 0) {
        console.log('[HeavyVerdictJob] All entries fresh, nothing to do');
        return;
      }

      console.log(`[HeavyVerdictJob] ${tasks.length} tasks to compute`);

      // Run tasks with limited parallelism and staggering (Block 27.3)
      let idx = 0;
      let computed = 0;
      let errors = 0;

      const worker = async () => {
        while (idx < tasks.length) {
          const taskIdx = idx++;
          const { symbol, horizon } = tasks[taskIdx];
          const key = this.store.makeKey({ symbol, horizon });

          try {
            const payload = await this.compute.compute(symbol, horizon);
            // Block 23: Use horizon-aware TTL
            this.store.setWithHorizon(key, payload, horizon);
            computed++;
            console.log(`[HeavyVerdictJob] Warmed ${symbol}/${horizon} in ${payload.computeMs}ms`);
            
            // Block 27.3: Stagger to avoid CPU spikes
            if (this.cfg.staggerDelayMs > 0) {
              await new Promise(r => setTimeout(r, this.cfg.staggerDelayMs));
            }
          } catch (e: any) {
            console.error(`[HeavyVerdictJob] Error computing ${symbol}/${horizon}: ${e.message}`);
            errors++;
          }
        }
      };

      // Start parallel workers
      const workers = Array.from(
        { length: Math.min(this.cfg.parallel, tasks.length) },
        () => worker()
      );
      
      await Promise.all(workers);

      // Prune dead entries
      const pruned = this.store.prune();

      console.log(`[HeavyVerdictJob] Tick #${this.runCount} done: computed=${computed}, errors=${errors}, pruned=${pruned}`);
      
    } catch (e: any) {
      console.error(`[HeavyVerdictJob] Tick error: ${e.message}`);
    } finally {
      this.running = false;
    }
  }
}

// Singleton instance
export const heavyVerdictJob = new HeavyVerdictJob();

console.log('[HeavyVerdictJob] Module loaded');
