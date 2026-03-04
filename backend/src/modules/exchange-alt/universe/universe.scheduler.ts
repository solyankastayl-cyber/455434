/**
 * STAGE 2 — Universe Scheduler
 * =============================
 * Periodic refresh of alt universe.
 */

import type { Db } from 'mongodb';
import { universeBuilder } from './universe.builder.js';
import type { Venue } from '../types.js';

let refreshInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export interface SchedulerConfig {
  intervalMs: number;         // Refresh interval
  venues: Venue[];            // Venues to refresh
  runOnStart: boolean;        // Run immediately on start
}

const DEFAULT_CONFIG: SchedulerConfig = {
  intervalMs: 6 * 60 * 60 * 1000,  // 6 hours
  venues: ['BINANCE'],
  runOnStart: true,
};

/**
 * Start universe refresh scheduler
 */
export function startUniverseScheduler(db: Db, config?: Partial<SchedulerConfig>) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  if (isRunning) {
    console.log('[UniverseScheduler] Already running');
    return;
  }

  universeBuilder.init(db);
  
  const runRefresh = async () => {
    console.log('[UniverseScheduler] Running refresh...');
    for (const venue of cfg.venues) {
      try {
        await universeBuilder.refresh(venue);
      } catch (err) {
        console.error(`[UniverseScheduler] Error refreshing ${venue}:`, err);
      }
    }
  };

  if (cfg.runOnStart) {
    void runRefresh();
  }

  refreshInterval = setInterval(runRefresh, cfg.intervalMs);
  isRunning = true;
  
  console.log(`[UniverseScheduler] Started (interval: ${cfg.intervalMs / 1000 / 60}min)`);
}

/**
 * Stop universe refresh scheduler
 */
export function stopUniverseScheduler() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  isRunning = false;
  console.log('[UniverseScheduler] Stopped');
}

/**
 * Force refresh now
 */
export async function forceRefresh(venue: Venue = 'BINANCE') {
  return universeBuilder.refresh(venue);
}

console.log('[Universe] Scheduler loaded');
