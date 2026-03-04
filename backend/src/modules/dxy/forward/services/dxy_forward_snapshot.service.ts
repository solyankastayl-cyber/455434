/**
 * DXY FORWARD SNAPSHOT SERVICE
 * 
 * D4.1 — Creates forward signals from DXY focusPack
 * 
 * ISOLATION: DXY only. No BTC/SPX imports.
 */

import { DXY_ASSET, DXY_HORIZON_DAYS, DXY_MODEL_VERSION, MAX_HORIZONS_PER_SNAPSHOT } from '../dxy-forward.constants.js';
import type { DxyForwardSignal, DxyAction, DxySnapshotResult } from '../dxy-forward.types.js';
import { DxyForwardSignalModel } from '../models/dxy_forward_signal.model.js';
import { buildDxyFocusPack, buildDxyHybridPack } from '../../services/dxy-focus-pack.service.js';
import { horizonToDays, type DxyHorizon } from '../../contracts/dxy.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function assertIsoDate(dateStr: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid asOf date format. Expected YYYY-MM-DD, got: ${dateStr}`);
  }
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function horizonToString(days: number): string {
  return `${days}d`;
}

// ═══════════════════════════════════════════════════════════════
// ACTION DETERMINATION
// ═══════════════════════════════════════════════════════════════

function determineAction(forecast: { bear: number; base: number; bull: number }, probUp: number): DxyAction {
  const expectedReturn = forecast.base;
  
  // Simple threshold logic
  if (expectedReturn > 0.005 && probUp > 0.55) return 'LONG';
  if (expectedReturn < -0.005 && probUp < 0.45) return 'SHORT';
  return 'HOLD';
}

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT SERVICE
// ═══════════════════════════════════════════════════════════════

/**
 * Creates forward signals for DXY on a specific date
 * 
 * @param asOf - Date in YYYY-MM-DD format (default: latest candle date)
 * @param horizons - Array of horizon days to generate (default: all)
 * @returns Snapshot result with created count and any errors
 */
export async function createDxySnapshot(params: {
  asOf?: string;
  horizons?: number[];
}): Promise<DxySnapshotResult> {
  const { asOf, horizons: requestedHorizons } = params;
  
  // Use today if not specified
  const targetDate = asOf || new Date().toISOString().slice(0, 10);
  assertIsoDate(targetDate);
  
  // Filter to valid horizons
  const horizons = (requestedHorizons?.length ? requestedHorizons : DXY_HORIZON_DAYS)
    .filter(h => DXY_HORIZON_DAYS.includes(h))
    .slice(0, MAX_HORIZONS_PER_SNAPSHOT);
  
  const created: Array<{ horizonDays: number; created: boolean; skipped: boolean }> = [];
  const errors: Array<{ horizonDays: number; error: string }> = [];
  
  for (const horizonDays of horizons) {
    try {
      const horizonStr = horizonToString(horizonDays);
      
      // Build focusPack for this horizon
      const focusPack = await buildDxyFocusPack(horizonStr);
      
      if (!focusPack) {
        errors.push({ horizonDays, error: 'FocusPack returned null' });
        continue;
      }
      
      // Build hybrid pack for forecast
      const hybridPack = await buildDxyHybridPack(horizonStr);
      
      // Calculate probUp from replay distribution
      const probUp = focusPack.replay.length > 0
        ? focusPack.replay.filter(r => {
            const lastIdx = r.aftermathNormalized.length - 1;
            return lastIdx >= 0 && r.aftermathNormalized[lastIdx] > 0;
          }).length / focusPack.replay.length
        : 0.5;
      
      // Determine action
      const action = determineAction(hybridPack.forecast, probUp);
      
      // Build signal document
      const signal: Omit<DxyForwardSignal, 'createdAt' | 'updatedAt'> = {
        asset: DXY_ASSET,
        asOf: targetDate,
        horizonDays,
        action,
        forecastReturn: hybridPack.forecast.base,
        probUp: clamp01(probUp),
        similarity: clamp01(focusPack.diagnostics.similarity),
        entropy: clamp01(focusPack.diagnostics.entropy),
        modelVersion: DXY_MODEL_VERSION,
        constitutionHash: null,
        diagnostics: {
          sources: {
            matches: 'DXY_FRACTAL_SCAN',
            entropy: 'DXY_DISTRIBUTION',
            scan: focusPack.diagnostics.matchCount.toString(),
          },
        },
      };
      
      // Upsert (setOnInsert to not overwrite existing)
      const result = await DxyForwardSignalModel.updateOne(
        { asset: DXY_ASSET, asOf: targetDate, horizonDays },
        { $setOnInsert: signal },
        { upsert: true }
      );
      
      created.push({
        horizonDays,
        created: result.upsertedCount > 0,
        skipped: result.upsertedCount === 0,
      });
      
    } catch (e: any) {
      errors.push({ horizonDays, error: e?.message || String(e) });
    }
  }
  
  return {
    asset: DXY_ASSET,
    asOf: targetDate,
    focusDays: 30, // default focus
    horizonsAttempted: horizons.length,
    createdCount: created.filter(c => c.created).length,
    errors,
  };
}

/**
 * Get existing signals for a date
 */
export async function getDxySignals(asOf: string): Promise<DxyForwardSignal[]> {
  assertIsoDate(asOf);
  
  return DxyForwardSignalModel
    .find({ asset: DXY_ASSET, asOf })
    .sort({ horizonDays: 1 })
    .lean();
}

/**
 * Get signal count
 */
export async function getDxySignalCount(): Promise<number> {
  return DxyForwardSignalModel.countDocuments({ asset: DXY_ASSET });
}
