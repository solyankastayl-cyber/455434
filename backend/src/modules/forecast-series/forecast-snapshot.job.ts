/**
 * FORECAST SNAPSHOT JOB
 * =====================
 * 
 * BLOCK F1: Daily Automatic Snapshot
 * 
 * Runs daily to record forecast points for core universe.
 * Creates historical forecast series over time.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from 'mongodb';
import { getForecastSeriesRepo } from './forecast-series.repo.js';
import { getForecastSnapshotService, VerdictLike } from './forecast-snapshot.service.js';
import type { ForecastModelKey, ForecastHorizon } from './forecast-series.types.js';

// Core universe symbols
const CORE_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'LINK', 'DOGE', 'MATIC'];

// Active models (onchain/sentiment frozen)
const ACTIVE_MODELS: ForecastModelKey[] = ['combined', 'exchange'];

// All horizons
const ALL_HORIZONS: ForecastHorizon[] = ['1D', '7D', '30D'];

type GetVerdictFn = (args: { symbol: string; horizon: ForecastHorizon }) => Promise<VerdictLike | null>;

export interface SnapshotJobConfig {
  enabled: boolean;
  symbols?: string[];
  intervalMs?: number; // Default: 24h
  runOnStart?: boolean;
}

export class ForecastSnapshotJob {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private db: Db,
    private getVerdictV4: GetVerdictFn,
    private config: SnapshotJobConfig
  ) {}

  async start() {
    if (!this.config.enabled) {
      console.log('[ForecastSnapshotJob] Disabled by config');
      return;
    }

    const symbols = this.config.symbols ?? CORE_SYMBOLS;
    const intervalMs = this.config.intervalMs ?? 24 * 60 * 60 * 1000; // 24h default

    console.log(`[ForecastSnapshotJob] Starting with ${symbols.length} symbols, interval ${intervalMs}ms`);

    // Run on start if configured
    if (this.config.runOnStart !== false) {
      // Delay first run to let other services initialize
      setTimeout(() => this.run(), 5000);
    }

    // Schedule periodic runs
    this.intervalId = setInterval(() => this.run(), intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[ForecastSnapshotJob] Stopped');
    }
  }

  async run(): Promise<{ recorded: number; skipped: number; errors: number }> {
    if (this.isRunning) {
      console.log('[ForecastSnapshotJob] Already running, skipping');
      return { recorded: 0, skipped: 0, errors: 0 };
    }

    this.isRunning = true;
    const startTime = Date.now();

    const repo = getForecastSeriesRepo(this.db);
    const snapshotService = getForecastSnapshotService(repo);
    
    await repo.ensureIndexes();

    const symbols = this.config.symbols ?? CORE_SYMBOLS;
    let totalRecorded = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    console.log(`[ForecastSnapshotJob] Running snapshot for ${symbols.length} symbols...`);

    for (const symbol of symbols) {
      for (const horizon of ALL_HORIZONS) {
        for (const model of ACTIVE_MODELS) {
          try {
            // Get verdict from V4 engine
            const verdict = await this.getVerdictV4({ symbol, horizon });
            
            if (!verdict) {
              totalSkipped++;
              continue;
            }

            const result = await snapshotService.recordPoint({
              symbol,
              model,
              horizon,
              verdict,
            });

            if (result.inserted) {
              totalRecorded++;
            } else {
              totalSkipped++; // Already exists for today
            }
          } catch (err: any) {
            totalErrors++;
            console.error(`[ForecastSnapshotJob] Error for ${symbol}/${horizon}/${model}:`, err.message);
          }
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[ForecastSnapshotJob] Complete: ${totalRecorded} recorded, ${totalSkipped} skipped, ${totalErrors} errors (${duration}ms)`);

    this.isRunning = false;

    return { recorded: totalRecorded, skipped: totalSkipped, errors: totalErrors };
  }

  /**
   * Manual trigger for single symbol
   */
  async runForSymbol(symbol: string): Promise<{ recorded: number; skipped: number; errors: number }> {
    const repo = getForecastSeriesRepo(this.db);
    const snapshotService = getForecastSnapshotService(repo);
    
    let recorded = 0;
    let skipped = 0;
    let errors = 0;

    for (const horizon of ALL_HORIZONS) {
      for (const model of ACTIVE_MODELS) {
        try {
          const verdict = await this.getVerdictV4({ symbol, horizon });
          
          if (!verdict) {
            skipped++;
            continue;
          }

          const result = await snapshotService.recordPoint({
            symbol,
            model,
            horizon,
            verdict,
          });

          if (result.inserted) {
            recorded++;
          } else {
            skipped++;
          }
        } catch (err: any) {
          errors++;
        }
      }
    }

    return { recorded, skipped, errors };
  }
}

// Singleton instance
let jobInstance: ForecastSnapshotJob | null = null;

export function getForecastSnapshotJob(
  db: Db, 
  getVerdictV4: GetVerdictFn,
  config: SnapshotJobConfig
): ForecastSnapshotJob {
  if (!jobInstance) {
    jobInstance = new ForecastSnapshotJob(db, getVerdictV4, config);
  }
  return jobInstance;
}

export function registerForecastSnapshotJob(
  app: FastifyInstance,
  deps: {
    db: Db;
    getVerdictV4: GetVerdictFn;
    config: SnapshotJobConfig;
  }
) {
  const job = getForecastSnapshotJob(deps.db, deps.getVerdictV4, deps.config);

  app.addHook('onReady', async () => {
    await job.start();
  });

  app.addHook('onClose', async () => {
    job.stop();
  });

  // Expose job via decorator for manual access
  (app as any).forecastSnapshotJob = job;

  app.log.info('[ForecastSnapshotJob] Registered (Block F1)');
}

console.log('[ForecastSnapshotJob] Module loaded (Block F1)');
