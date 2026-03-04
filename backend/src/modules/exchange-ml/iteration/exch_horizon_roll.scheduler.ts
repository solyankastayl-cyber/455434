/**
 * BLOCK 7 — Auto Roll 30D When 7D Resolves
 * =========================================
 * 
 * Automated segment roll scheduler:
 * 1. Monitors 7D resolved outcomes
 * 2. Recalculates horizon bias
 * 3. If bias > threshold → rolls 30D segment
 * 4. New 30D starts from CURRENT market price (not old segment close)
 * 
 * This is real institutional-grade ML lifecycle evolution.
 */

import { Db } from 'mongodb';
import { ExchForecastSegmentService, getExchForecastSegmentService, RollReason } from './exch_forecast_segment.service.js';
import { ExchForecastSegmentRepo, getExchForecastSegmentRepo } from './exch_forecast_segment.repo.js';
import { ExchHorizon, ExchDriftState } from './exch_forecast_segment.model.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface HorizonRollDeps {
  segmentService: ExchForecastSegmentService;
  segmentRepo: ExchForecastSegmentRepo;
  exchangeEngine: {
    getForecast: (args: { asset: string; horizon: ExchHorizon }) => Promise<{
      modelVersion: string;
      entryPrice: number;
      targetPrice: number;
      expectedReturn: number;
      confidence: number;
      biasApplied: number;
      driftState: ExchDriftState;
    } | null>;
  };
  horizonPerformanceService: {
    getBiasForHorizon: (asset: string, horizon: ExchHorizon) => Promise<number>;
  };
}

interface HorizonRollConfig {
  checkIntervalMs: number;       // How often to check (default: 1 hour)
  minBiasFor30DRoll: number;     // Minimum absolute bias to trigger 30D roll
  resolutionWindowMinutes: number; // Look for resolved 7D within this window
  assets: string[];              // Assets to monitor
}

const DEFAULT_CONFIG: HorizonRollConfig = {
  checkIntervalMs: 60 * 60 * 1000, // 1 hour
  minBiasFor30DRoll: 0.15,         // 15% bias threshold
  resolutionWindowMinutes: 120,     // 2 hours
  assets: ['BTC', 'ETH'],          // Default assets
};

// ═══════════════════════════════════════════════════════════════
// SCHEDULER
// ═══════════════════════════════════════════════════════════════

let schedulerInterval: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Process 7D resolutions and potentially roll 30D segments.
 */
async function process7DResolutions(deps: HorizonRollDeps, config: HorizonRollConfig): Promise<{
  processed: number;
  rolled: string[];
  skipped: string[];
}> {
  const result = {
    processed: 0,
    rolled: [] as string[],
    skipped: [] as string[],
  };

  try {
    // Find recently resolved 7D segments
    const resolved7D = await deps.segmentRepo.findRecentlyResolved(
      '7D',
      config.resolutionWindowMinutes
    );

    console.log(`[HorizonRoll] Found ${resolved7D.length} recently resolved 7D segments`);

    // Get unique assets from resolved segments
    const assets = [...new Set(resolved7D.map(s => s.asset))];

    for (const asset of assets) {
      result.processed++;

      try {
        // Get current 7D bias
        const bias7D = await deps.horizonPerformanceService.getBiasForHorizon(asset, '7D');
        const biasAbs = Math.abs(bias7D);

        console.log(`[HorizonRoll] ${asset} 7D bias: ${bias7D.toFixed(4)} (abs: ${biasAbs.toFixed(4)})`);

        // Check if bias is strong enough to warrant 30D roll
        if (biasAbs < config.minBiasFor30DRoll) {
          console.log(`[HorizonRoll] ${asset} bias below threshold (${config.minBiasFor30DRoll}), skipping`);
          result.skipped.push(`${asset}: bias ${biasAbs.toFixed(4)} < ${config.minBiasFor30DRoll}`);
          continue;
        }

        // Get new 30D forecast (starts from CURRENT market price)
        const forecast = await deps.exchangeEngine.getForecast({
          asset,
          horizon: '30D',
        });

        if (!forecast) {
          console.warn(`[HorizonRoll] Could not get 30D forecast for ${asset}`);
          result.skipped.push(`${asset}: no forecast available`);
          continue;
        }

        // Roll 30D segment
        const rollResult = await deps.segmentService.maybeRollSegment({
          asset,
          horizon: '30D',
          modelVersion: forecast.modelVersion,
          entryPrice: forecast.entryPrice,  // CURRENT market price
          targetPrice: forecast.targetPrice,
          expectedReturn: forecast.expectedReturn,
          confidence: forecast.confidence,
          biasApplied: bias7D,  // Apply 7D bias to 30D
          driftState: forecast.driftState,
          reason: 'BIAS_CROSSED',
          minBiasAbsToRoll: config.minBiasFor30DRoll,
        });

        if (rollResult.rolled) {
          console.log(`[HorizonRoll] 🔁 30D rolled for ${asset} due to 7D bias=${bias7D.toFixed(4)}`);
          result.rolled.push(`${asset}: segment ${rollResult.active?.segmentId}`);
        } else {
          console.log(`[HorizonRoll] ${asset} 30D not rolled: ${rollResult.reason}`);
          result.skipped.push(`${asset}: ${rollResult.reason}`);
        }
      } catch (assetErr: any) {
        console.error(`[HorizonRoll] Error processing ${asset}:`, assetErr);
        result.skipped.push(`${asset}: error - ${assetErr.message}`);
      }
    }
  } catch (err) {
    console.error('[HorizonRoll] Error in process7DResolutions:', err);
  }

  return result;
}

/**
 * Start the horizon roll scheduler.
 */
export function startHorizonRollScheduler(
  db: Db,
  deps: Partial<HorizonRollDeps>,
  config: Partial<HorizonRollConfig> = {}
): void {
  if (schedulerInterval) {
    console.log('[HorizonRoll] Scheduler already running');
    return;
  }

  const finalConfig: HorizonRollConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  // Build full deps with defaults
  const fullDeps: HorizonRollDeps = {
    segmentService: deps.segmentService || getExchForecastSegmentService(db),
    segmentRepo: deps.segmentRepo || getExchForecastSegmentRepo(db),
    exchangeEngine: deps.exchangeEngine || {
      getForecast: async ({ asset, horizon }) => {
        // Default: try to get from heavy compute service
        try {
          const { heavyComputeService } = await import('../../verdict/runtime/heavy-compute.service.js');
          const payload = await heavyComputeService.compute(asset, horizon);
          
          if (payload?.verdict) {
            const entryPrice = payload.layers?.snapshot?.price || 100000;
            const expectedReturn = payload.verdict.expectedReturn || 0.05;
            
            return {
              modelVersion: `exchange_v4.${Date.now() % 1000}`,
              entryPrice,
              targetPrice: entryPrice * (1 + expectedReturn),
              expectedReturn,
              confidence: payload.verdict.confidenceAdjusted || payload.verdict.confidence || 0.5,
              biasApplied: payload.crossHorizonBias?.applied || 0,
              driftState: (payload.drift?.state as ExchDriftState) || 'NORMAL',
            };
          }
        } catch (e) {
          console.warn('[HorizonRoll] Could not get forecast from heavy compute:', e);
        }
        return null;
      },
    },
    horizonPerformanceService: deps.horizonPerformanceService || {
      getBiasForHorizon: async (asset, horizon) => {
        // Default: try to get from cascade service
        try {
          const { getHorizonCascadeService } = await import('../performance/horizon_cascade.service.js');
          const cascadeService = getHorizonCascadeService(db);
          const state = await cascadeService.getState(asset, horizon);
          return state?.bias || 0;
        } catch (e) {
          console.warn('[HorizonRoll] Could not get bias from cascade service:', e);
        }
        return 0;
      },
    },
  };

  console.log(`[HorizonRoll] Starting scheduler (interval: ${finalConfig.checkIntervalMs}ms)`);

  // Run immediately on start
  setTimeout(async () => {
    if (!isRunning) {
      isRunning = true;
      console.log('[HorizonRoll] Running initial check...');
      const result = await process7DResolutions(fullDeps, finalConfig);
      console.log(`[HorizonRoll] Initial check complete: ${result.rolled.length} rolled, ${result.skipped.length} skipped`);
      isRunning = false;
    }
  }, 5000);

  // Schedule periodic checks
  schedulerInterval = setInterval(async () => {
    if (isRunning) {
      console.log('[HorizonRoll] Previous run still in progress, skipping');
      return;
    }

    isRunning = true;
    console.log('[HorizonRoll] Running scheduled check...');
    
    try {
      const result = await process7DResolutions(fullDeps, finalConfig);
      console.log(`[HorizonRoll] Check complete: processed=${result.processed}, rolled=${result.rolled.length}, skipped=${result.skipped.length}`);
    } catch (err) {
      console.error('[HorizonRoll] Scheduled check error:', err);
    } finally {
      isRunning = false;
    }
  }, finalConfig.checkIntervalMs);

  console.log('[HorizonRoll] Scheduler started');
}

/**
 * Stop the horizon roll scheduler.
 */
export function stopHorizonRollScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[HorizonRoll] Scheduler stopped');
  }
}

/**
 * Check if scheduler is running.
 */
export function isHorizonRollSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}

/**
 * Manually trigger 7D resolution processing (for testing).
 */
export async function triggerHorizonRollCheck(db: Db): Promise<{
  processed: number;
  rolled: string[];
  skipped: string[];
}> {
  const deps: HorizonRollDeps = {
    segmentService: getExchForecastSegmentService(db),
    segmentRepo: getExchForecastSegmentRepo(db),
    exchangeEngine: {
      getForecast: async ({ asset, horizon }) => {
        try {
          const { heavyComputeService } = await import('../../verdict/runtime/heavy-compute.service.js');
          const payload = await heavyComputeService.compute(asset, horizon);
          
          if (payload?.verdict) {
            const entryPrice = payload.layers?.snapshot?.price || 100000;
            const expectedReturn = payload.verdict.expectedReturn || 0.05;
            
            return {
              modelVersion: `exchange_v4.${Date.now() % 1000}`,
              entryPrice,
              targetPrice: entryPrice * (1 + expectedReturn),
              expectedReturn,
              confidence: payload.verdict.confidenceAdjusted || payload.verdict.confidence || 0.5,
              biasApplied: payload.crossHorizonBias?.applied || 0,
              driftState: (payload.drift?.state as ExchDriftState) || 'NORMAL',
            };
          }
        } catch (e) {
          // Fallback
        }
        return null;
      },
    },
    horizonPerformanceService: {
      getBiasForHorizon: async (asset, horizon) => {
        try {
          const { getHorizonCascadeService } = await import('../performance/horizon_cascade.service.js');
          const cascadeService = getHorizonCascadeService(db);
          const state = await cascadeService.getState(asset, horizon);
          return state?.bias || 0;
        } catch (e) {
          // Fallback
        }
        return 0;
      },
    },
  };

  return process7DResolutions(deps, DEFAULT_CONFIG);
}

console.log('[HorizonRoll] Scheduler module loaded (BLOCK 7)');
