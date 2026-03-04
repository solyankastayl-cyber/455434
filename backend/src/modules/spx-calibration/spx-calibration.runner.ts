/**
 * SPX CALIBRATION — Runner Service
 * 
 * BLOCK B6.4.2 + B6.4.5 — Resume-safe calibration with REAL hit logic
 * 
 * Generates snapshots and outcomes for historical SPX data (1950-2026)
 * 
 * B6.4.5 FIX: Real direction prediction based on SMA crossover
 * - predictedDirection computed from short/long SMA trend
 * - hit = (predictedDirection === realizedDirection)
 */

import mongoose from 'mongoose';
import { SpxCandleModel } from '../spx/spx.mongo.js';
import { SpxSnapshotModel } from '../spx-memory/spx-snapshot.model.js';
import { SpxOutcomeModel } from '../spx-memory/spx-outcome.model.js';
import type { SpxCalibrationRunDoc, CalibrationLogDoc } from './spx-calibration.types.js';
import { SPX_HORIZONS, DEFAULT_PRESETS, DEFAULT_ROLES } from './spx-calibration.types.js';
import { pickSpxCohort } from '../spx/spx.cohorts.js';

// ═══════════════════════════════════════════════════════════════
// B6.4.5 — DIRECTION PREDICTION HELPERS
// ═══════════════════════════════════════════════════════════════

type PredictedDirection = 'UP' | 'DOWN' | 'NEUTRAL';

/**
 * Compute SMA for given close prices
 */
function computeSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Predict direction based on SMA crossover
 * Uses short SMA (10) vs long SMA (50) crossover signal
 * 
 * @param recentCloses - Array of close prices (most recent last)
 * @returns PredictedDirection
 */
function predictDirection(recentCloses: number[]): PredictedDirection {
  const shortPeriod = 10;
  const longPeriod = 50;
  
  if (recentCloses.length < longPeriod) {
    // Not enough data - use simple momentum
    if (recentCloses.length < 5) return 'NEUTRAL';
    const recent = recentCloses.slice(-5);
    const momentum = (recent[4] - recent[0]) / recent[0];
    if (momentum > 0.01) return 'UP';
    if (momentum < -0.01) return 'DOWN';
    return 'NEUTRAL';
  }
  
  const shortSMA = computeSMA(recentCloses, shortPeriod);
  const longSMA = computeSMA(recentCloses, longPeriod);
  
  if (!shortSMA || !longSMA) return 'NEUTRAL';
  
  // SMA crossover logic
  const diff = (shortSMA - longSMA) / longSMA;
  
  if (diff > 0.005) return 'UP';    // Short > Long by 0.5% → bullish
  if (diff < -0.005) return 'DOWN'; // Short < Long by 0.5% → bearish
  return 'NEUTRAL';
}

/**
 * Convert direction to action
 */
function directionToAction(dir: PredictedDirection): 'LONG' | 'SHORT' | 'HOLD' {
  switch (dir) {
    case 'UP': return 'LONG';
    case 'DOWN': return 'SHORT';
    default: return 'HOLD';
  }
}

/**
 * Determine realized direction from return
 */
function getRealizedDirection(returnPct: number, threshold = 0.1): PredictedDirection {
  if (returnPct > threshold) return 'UP';
  if (returnPct < -threshold) return 'DOWN';
  return 'NEUTRAL';
}

/**
 * Calculate hit based on predicted vs realized direction
 * 
 * B6.4.5 — Correct hit logic:
 * - UP prediction + positive return = HIT
 * - DOWN prediction + negative return = HIT
 * - NEUTRAL prediction + small return (±threshold) = HIT
 */
function calculateHit(
  predictedDirection: PredictedDirection, 
  returnPct: number,
  threshold = 0.1  // 0.1% threshold for NEUTRAL
): boolean {
  const realizedDirection = getRealizedDirection(returnPct, threshold);
  
  // Direct match
  if (predictedDirection === realizedDirection) return true;
  
  // NEUTRAL predicted - hit if move was small
  if (predictedDirection === 'NEUTRAL' && Math.abs(returnPct) < threshold) return true;
  
  return false;
}

const RUN_ID = 'SPX_CALIBRATION';
const ENGINE_VERSION = 'spx-v2.1';

// ═══════════════════════════════════════════════════════════════
// MONGO MODELS (inline for calibration)
// ═══════════════════════════════════════════════════════════════

const CalibrationRunSchema = new mongoose.Schema<SpxCalibrationRunDoc>({
  _id: { type: String, required: true },
  state: { type: String, required: true },
  startedAt: String,
  updatedAt: String,
  range: { start: String, end: String },
  presets: [String],
  roles: [String],
  firstIdx: Number,
  lastIdx: Number,
  cursorIdx: Number,
  chunkSize: Number,
  horizons: [{ name: String, aftermathDays: Number, windowLen: Number }],
  writtenSnapshots: { type: Number, default: 0 },
  writtenOutcomes: { type: Number, default: 0 },
  skippedNoHistory: { type: Number, default: 0 },
  skippedNoOutcome: { type: Number, default: 0 },
  stopRequested: Boolean,
  engineVersion: String,
  policyHash: String,
  source: String,
  lastError: String,
}, { collection: 'spx_calibration_runs' });

const CalibrationLogSchema = new mongoose.Schema<CalibrationLogDoc>({
  ts: String,
  level: String,
  msg: String,
  extra: mongoose.Schema.Types.Mixed,
}, { collection: 'spx_calibration_logs' });

const CalibrationRunModel = mongoose.models.SpxCalibrationRun || 
  mongoose.model<SpxCalibrationRunDoc>('SpxCalibrationRun', CalibrationRunSchema);

const CalibrationLogModel = mongoose.models.SpxCalibrationLog ||
  mongoose.model<CalibrationLogDoc>('SpxCalibrationLog', CalibrationLogSchema);

// ═══════════════════════════════════════════════════════════════
// CALIBRATION RUNNER CLASS
// ═══════════════════════════════════════════════════════════════

export class SpxCalibrationRunner {
  
  private async log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, extra?: any) {
    await CalibrationLogModel.create({
      ts: new Date().toISOString(),
      level,
      msg,
      extra: extra ?? null
    });
    console.log(`[SPX Calibration] [${level}] ${msg}`, extra ? JSON.stringify(extra).slice(0, 200) : '');
  }

  async initOrLoad(params: {
    start: string;
    end: string;
    presets?: string[];
    roles?: string[];
    chunkSize?: number;
    policyHash?: string;
    source?: string;
  }): Promise<SpxCalibrationRunDoc> {
    const { 
      start, 
      end, 
      presets = DEFAULT_PRESETS, 
      roles = DEFAULT_ROLES, 
      chunkSize = 50,
      policyHash = 'spx-policy-v2.1-default',
      source = 'BOOTSTRAP'
    } = params;

    // Get idx range from candles
    const rangeCandles = await SpxCandleModel.find({
      symbol: 'SPX',
      date: { $gte: start, $lte: end }
    })
      .select({ idx: 1, date: 1 })
      .sort({ idx: 1 })
      .lean()
      .exec();

    if (!rangeCandles.length) {
      throw new Error('No SPX candles in requested range');
    }

    const firstIdx = (rangeCandles[0] as any).idx as number;
    const lastIdx = (rangeCandles[rangeCandles.length - 1] as any).idx as number;

    // Check existing run
    const existing = await CalibrationRunModel.findById(RUN_ID).lean().exec();
    if (existing && (existing.state === 'RUNNING' || existing.state === 'STOPPING')) {
      return existing;
    }

    // Create or reset run
    const doc: SpxCalibrationRunDoc = {
      _id: RUN_ID,
      state: 'IDLE',
      startedAt: undefined,
      updatedAt: new Date().toISOString(),
      range: { start, end },
      presets,
      roles,
      firstIdx,
      lastIdx,
      cursorIdx: existing?.cursorIdx ?? firstIdx, // Resume from cursor if exists
      chunkSize,
      horizons: SPX_HORIZONS,
      writtenSnapshots: existing?.writtenSnapshots ?? 0,
      writtenOutcomes: existing?.writtenOutcomes ?? 0,
      skippedNoHistory: existing?.skippedNoHistory ?? 0,
      skippedNoOutcome: existing?.skippedNoOutcome ?? 0,
      stopRequested: false,
      engineVersion: ENGINE_VERSION,
      policyHash,
      source,
      lastError: undefined,
    };

    await CalibrationRunModel.findByIdAndUpdate(
      RUN_ID,
      { $set: doc },
      { upsert: true }
    ).exec();

    await this.log('INFO', 'Calibration initialized', { 
      start, end, firstIdx, lastIdx, 
      cursorIdx: doc.cursorIdx,
      totalCandles: rangeCandles.length 
    });

    return doc;
  }

  async requestStop() {
    await CalibrationRunModel.findByIdAndUpdate(RUN_ID, { 
      $set: { stopRequested: true, state: 'STOPPING' } 
    }).exec();
    await this.log('WARN', 'Stop requested');
  }

  async reset() {
    await CalibrationRunModel.findByIdAndDelete(RUN_ID).exec();
    await this.log('INFO', 'Calibration reset');
    return { ok: true };
  }

  async getStatus(): Promise<SpxCalibrationRunDoc | null> {
    return CalibrationRunModel.findById(RUN_ID).lean().exec();
  }

  async getLogs(limit: number = 50) {
    return CalibrationLogModel.find()
      .sort({ ts: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  /**
   * Run one chunk of calibration
   */
  async runOnce(): Promise<SpxCalibrationRunDoc> {
    const run = await CalibrationRunModel.findById(RUN_ID).exec();
    if (!run) throw new Error('Calibration not initialized');

    if (run.state === 'DONE') return run.toObject();
    
    if (run.stopRequested) {
      run.state = 'IDLE';
      await run.save();
      await this.log('WARN', 'Stopped (graceful)');
      return run.toObject();
    }

    // Mark as running
    run.state = 'RUNNING';
    run.startedAt = run.startedAt || new Date().toISOString();
    run.updatedAt = new Date().toISOString();
    run.lastError = undefined;
    await run.save();

    const startIdx = run.cursorIdx;
    const endIdx = Math.min(run.cursorIdx + run.chunkSize - 1, run.lastIdx);

    await this.log('INFO', 'Chunk start', { startIdx, endIdx, chunkSize: run.chunkSize });

    try {
      // Get candles for this chunk
      const candles = await SpxCandleModel.find({
        symbol: 'SPX',
        idx: { $gte: startIdx, $lte: endIdx }
      })
        .sort({ idx: 1 })
        .lean()
        .exec();

      // Process each candle
      for (const candle of candles) {
        const idx = (candle as any).idx as number;
        const asOfDate = (candle as any).date as string;
        // Handle different field names: 'c' or 'close'
        const closePrice = (candle as any).c ?? (candle as any).close;
        
        // Skip if no valid close price
        if (closePrice == null || isNaN(closePrice)) {
          console.log(`[Calibration] Skipping idx ${idx}: no valid close price`);
          continue;
        }

        // Check stop request periodically
        if (idx % 20 === 0) {
          const current = await CalibrationRunModel.findById(RUN_ID).lean().exec();
          if (current?.stopRequested) {
            run.state = 'IDLE';
            run.cursorIdx = idx;
            await run.save();
            await this.log('WARN', 'Stopped mid-chunk', { idx });
            return run.toObject();
          }
        }

        // B6.4.5 — Get recent closes for direction prediction
        const historyWindow = 60; // Need 60 candles for SMA(50) + buffer
        const historyCandles = await SpxCandleModel.find({
          symbol: 'SPX',
          idx: { $gte: Math.max(0, idx - historyWindow), $lte: idx }
        })
          .sort({ idx: 1 })
          .select({ close: 1, c: 1 })
          .lean()
          .exec();
        
        const recentCloses = historyCandles.map(
          (c: any) => c.c ?? c.close
        ).filter((v: number) => v != null && !isNaN(v));

        // Process each horizon
        for (const h of run.horizons) {
          // Check history requirement
          const hasHistory = (idx - run.firstIdx + 1) >= h.windowLen;
          if (!hasHistory) {
            run.skippedNoHistory++;
            continue;
          }

          // Determine cohort from date
          const cohort = pickSpxCohort(asOfDate);

          // B6.4.5 — Compute predicted direction
          const predictedDirection = predictDirection(recentCloses);
          const action = directionToAction(predictedDirection);

          // Process each preset × role
          for (const preset of run.presets) {
            for (const role of run.roles) {
              // Build unique snapshot ID
              const snapshotKey = `${asOfDate}_${h.name}_${preset}_${role}_${run.source}`;

              // Check if snapshot exists (idempotent)
              const existingSnap = await SpxSnapshotModel.findOne({
                symbol: 'SPX',
                asOfDate,
                horizon: h.name,
                preset,
                source: run.source
              }).lean().exec();

              let snapshotId: string;
              let snapPredictedDirection = predictedDirection;

              if (existingSnap) {
                snapshotId = String((existingSnap as any)._id);
                // Use existing direction for outcome calculation
                snapPredictedDirection = (existingSnap as any).direction === 'UP' ? 'UP' 
                  : (existingSnap as any).direction === 'DOWN' ? 'DOWN' : 'NEUTRAL';
              } else {
                // Create snapshot with REAL direction prediction
                const snapshot = await SpxSnapshotModel.create({
                  symbol: 'SPX',
                  asOfDate,
                  horizon: h.name,
                  tier: this.getTierFromHorizon(h.name),
                  preset,
                  source: run.source,
                  
                  // B6.4.5 — Real predicted direction
                  direction: predictedDirection,
                  action,
                  consensusIndex: predictedDirection === 'UP' ? 70 : predictedDirection === 'DOWN' ? 30 : 50,
                  conflictLevel: 'MODERATE',
                  structuralLock: false,
                  sizeMultiplier: predictedDirection === 'NEUTRAL' ? 0.5 : 1.0,
                  confidence: predictedDirection === 'NEUTRAL' ? 0.3 : 0.6,
                  
                  // Phase/divergence
                  phaseType: 'UNKNOWN',
                  divergenceGrade: 'C',
                  divergenceScore: 0,
                  
                  // Match info
                  matchesCount: 0,
                  
                  // Audit
                  policyHash: run.policyHash,
                  engineVersion: run.engineVersion,
                });

                snapshotId = String(snapshot._id);
                run.writtenSnapshots++;
              }

              // Check if outcome can be resolved
              const hasOutcome = (idx + h.aftermathDays) <= run.lastIdx;
              if (!hasOutcome) {
                run.skippedNoOutcome++;
                continue;
              }

              // Check if outcome exists
              const existingOutcome = await SpxOutcomeModel.findOne({ snapshotId }).lean().exec();
              if (existingOutcome) continue;

              // Get exit candle
              const exitCandle = await SpxCandleModel.findOne({
                symbol: 'SPX',
                idx: idx + h.aftermathDays
              }).lean().exec();

              if (!exitCandle) {
                run.skippedNoOutcome++;
                continue;
              }

              const exitClose = (exitCandle as any).c ?? (exitCandle as any).close;
              const exitDate = (exitCandle as any).date as string;
              
              // Skip if no valid exit close
              if (exitClose == null || isNaN(exitClose)) {
                run.skippedNoOutcome++;
                continue;
              }
              
              const returnPct = ((exitClose / closePrice) - 1) * 100;
              
              // Skip if return is invalid
              if (isNaN(returnPct)) {
                run.skippedNoOutcome++;
                continue;
              }

              // B6.4.5 — Real hit calculation based on predicted direction
              const hit = calculateHit(snapPredictedDirection, returnPct);
              const expectedDir = snapPredictedDirection === 'UP' ? 'BULL' 
                : snapPredictedDirection === 'DOWN' ? 'BEAR' : 'NEUTRAL';

              // Create outcome with real direction prediction
              await SpxOutcomeModel.create({
                snapshotId,
                symbol: 'SPX',
                source: run.source,
                preset,
                asOfDate,
                horizon: h.name,
                resolvedDate: exitDate,
                entryClose: closePrice,
                exitClose,
                actualReturnPct: Math.round(returnPct * 10000) / 10000,
                expectedDirection: expectedDir,
                hit,
              });

              run.writtenOutcomes++;
            }
          }
        }
      }

      // Update cursor
      const newCursor = endIdx + 1;
      run.cursorIdx = newCursor;
      run.updatedAt = new Date().toISOString();

      if (newCursor > run.lastIdx) {
        run.state = 'DONE';
        await this.log('INFO', 'Calibration completed', {
          writtenSnapshots: run.writtenSnapshots,
          writtenOutcomes: run.writtenOutcomes
        });
      } else {
        await this.log('INFO', 'Chunk completed', { 
          newCursor, 
          progress: `${Math.round((newCursor - run.firstIdx) / (run.lastIdx - run.firstIdx) * 100)}%`,
          writtenSnapshots: run.writtenSnapshots,
          writtenOutcomes: run.writtenOutcomes
        });
      }

      await run.save();
      return run.toObject();

    } catch (err: any) {
      run.state = 'FAILED';
      run.lastError = err.message || String(err);
      await run.save();
      await this.log('ERROR', 'Calibration failed', { error: run.lastError });
      throw err;
    }
  }

  private getTierFromHorizon(horizon: string): string {
    if (['7d', '14d'].includes(horizon)) return 'TIMING';
    if (['30d', '90d'].includes(horizon)) return 'TACTICAL';
    return 'STRUCTURE';
  }

  /**
   * B6.4.5 — Recompute outcomes only (fix hit logic without recreating snapshots)
   * 
   * This method:
   * 1. Iterates through existing snapshots
   * 2. Gets historical closes for direction prediction
   * 3. Updates snapshot.direction if needed
   * 4. Recomputes hit for existing outcomes
   */
  async recomputeOutcomes(batchSize: number = 1000): Promise<{
    processed: number;
    updated: number;
    errors: number;
    hitStats: { total: number; hits: number; hitRate: number };
  }> {
    await this.log('INFO', 'Starting outcome recompute', { batchSize });

    let processed = 0;
    let updated = 0;
    let errors = 0;
    let totalHits = 0;
    let totalOutcomes = 0;

    // Get all outcomes in batches
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const outcomes = await SpxOutcomeModel.find({})
        .skip(skip)
        .limit(batchSize)
        .lean()
        .exec();

      if (outcomes.length === 0) {
        hasMore = false;
        break;
      }

      for (const outcome of outcomes) {
        try {
          processed++;
          totalOutcomes++;

          // Get snapshot
          const snapshot = await SpxSnapshotModel.findById(outcome.snapshotId).lean().exec();
          if (!snapshot) {
            errors++;
            continue;
          }

          // Get candle for this snapshot
          const candle = await SpxCandleModel.findOne({
            symbol: 'SPX',
            date: (snapshot as any).asOfDate
          }).lean().exec();

          if (!candle) {
            errors++;
            continue;
          }

          const idx = (candle as any).idx;
          if (idx == null) {
            errors++;
            continue;
          }

          // Get recent closes for direction prediction
          const historyWindow = 60;
          const historyCandles = await SpxCandleModel.find({
            symbol: 'SPX',
            idx: { $gte: Math.max(0, idx - historyWindow), $lte: idx }
          })
            .sort({ idx: 1 })
            .select({ close: 1, c: 1 })
            .lean()
            .exec();

          const recentCloses = historyCandles.map(
            (c: any) => c.c ?? c.close
          ).filter((v: number) => v != null && !isNaN(v));

          // Compute direction
          const predictedDirection = predictDirection(recentCloses);
          
          // Calculate new hit
          const returnPct = (outcome as any).actualReturnPct;
          const newHit = calculateHit(predictedDirection, returnPct);

          if (newHit) totalHits++;

          // Update snapshot direction if changed
          if ((snapshot as any).direction !== predictedDirection) {
            await SpxSnapshotModel.updateOne(
              { _id: outcome.snapshotId },
              { 
                $set: { 
                  direction: predictedDirection,
                  action: directionToAction(predictedDirection)
                } 
              }
            ).exec();
          }

          // Update outcome hit
          const expectedDir = predictedDirection === 'UP' ? 'BULL' 
            : predictedDirection === 'DOWN' ? 'BEAR' : 'NEUTRAL';

          await SpxOutcomeModel.updateOne(
            { _id: (outcome as any)._id },
            { $set: { hit: newHit, expectedDirection: expectedDir } }
          ).exec();

          updated++;
        } catch (err: any) {
          errors++;
          console.error('[Recompute] Error:', err.message);
        }
      }

      skip += batchSize;
      
      if (processed % 5000 === 0) {
        await this.log('INFO', 'Recompute progress', { 
          processed, updated, errors, 
          hitRate: totalOutcomes > 0 ? Math.round(totalHits / totalOutcomes * 100) : 0 
        });
      }
    }

    const hitRate = totalOutcomes > 0 ? Math.round(totalHits / totalOutcomes * 1000) / 10 : 0;

    await this.log('INFO', 'Recompute completed', {
      processed,
      updated,
      errors,
      hitRate: `${hitRate}%`
    });

    return {
      processed,
      updated,
      errors,
      hitStats: {
        total: totalOutcomes,
        hits: totalHits,
        hitRate
      }
    };
  }

  /**
   * B6.4.6 — Get coverage report by decade/horizon/cohort
   */
  async getCoverageReport(): Promise<{
    totalOutcomes: number;
    totalSnapshots: number;
    totalCandles: number;
    expectedOutcomes: number;
    coveragePercent: number;
    byDecade: Array<{ decade: string; count: number; expected: number; coverage: number }>;
    byHorizon: Array<{ horizon: string; count: number }>;
    byCohort: Array<{ cohort: string; count: number }>;
    completionStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';
  }> {
    // Get totals
    const [totalOutcomes, totalSnapshots, totalCandles] = await Promise.all([
      SpxOutcomeModel.countDocuments({ symbol: 'SPX' }).exec(),
      SpxSnapshotModel.countDocuments({ symbol: 'SPX' }).exec(),
      SpxCandleModel.countDocuments({ symbol: 'SPX' }).exec(),
    ]);

    // Expected: candles * horizons * presets (simplified)
    // Actually it's more complex due to horizon aftermath requirements
    const horizonCount = SPX_HORIZONS.length; // 6
    const presetCount = DEFAULT_PRESETS.length; // 1 (BALANCED)
    const roleCount = DEFAULT_ROLES.length; // 1 (PRIMARY)
    
    // Rough expected: each candle can generate outcomes for each horizon
    // minus the aftermath days at the end
    const avgAftermath = 100; // Average aftermath days
    const effectiveCandles = Math.max(0, totalCandles - avgAftermath);
    const expectedOutcomes = effectiveCandles * horizonCount * presetCount * roleCount;

    // By decade aggregation
    const decadeAgg = await SpxOutcomeModel.aggregate([
      { $match: { symbol: 'SPX' } },
      { 
        $addFields: { 
          decade: { $concat: [{ $substr: ['$asOfDate', 0, 3] }, '0s'] } 
        } 
      },
      { $group: { _id: '$decade', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).exec();

    // Expected per decade (rough estimate based on trading days)
    const decadeExpected: Record<string, number> = {
      '1950s': 2500 * 6, // ~2500 trading days * 6 horizons
      '1960s': 2500 * 6,
      '1970s': 2500 * 6,
      '1980s': 2500 * 6,
      '1990s': 2500 * 6,
      '2000s': 2500 * 6,
      '2010s': 2500 * 6,
      '2020s': 1500 * 6, // 2020-2025 = ~6 years
    };

    const byDecade = Object.keys(decadeExpected).map(decade => {
      const found = decadeAgg.find(d => d._id === decade);
      const count = found?.count || 0;
      const expected = decadeExpected[decade];
      return {
        decade,
        count,
        expected,
        coverage: expected > 0 ? Math.round(count / expected * 100) : 0
      };
    });

    // By horizon aggregation
    const horizonAgg = await SpxOutcomeModel.aggregate([
      { $match: { symbol: 'SPX' } },
      { $group: { _id: '$horizon', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).exec();

    const byHorizon = horizonAgg.map(h => ({
      horizon: h._id,
      count: h.count
    }));

    // By cohort (using asOfDate ranges)
    const cohortRanges = [
      { cohort: 'V1950', start: '1950-01-01', end: '1989-12-31' },
      { cohort: 'V1990', start: '1990-01-01', end: '2007-12-31' },
      { cohort: 'V2008', start: '2008-01-01', end: '2019-12-31' },
      { cohort: 'V2020', start: '2020-01-01', end: '2025-12-31' },
      { cohort: 'LIVE', start: '2026-01-01', end: '2099-12-31' },
    ];

    const byCohort = await Promise.all(
      cohortRanges.map(async ({ cohort, start, end }) => {
        const count = await SpxOutcomeModel.countDocuments({
          symbol: 'SPX',
          asOfDate: { $gte: start, $lte: end }
        }).exec();
        return { cohort, count };
      })
    );

    // Coverage percent
    const coveragePercent = expectedOutcomes > 0 
      ? Math.round(totalOutcomes / expectedOutcomes * 1000) / 10 
      : 0;

    // Completion status
    let completionStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' = 'NOT_STARTED';
    if (totalOutcomes > 0 && coveragePercent < 90) {
      completionStatus = 'IN_PROGRESS';
    } else if (coveragePercent >= 90 || totalOutcomes >= 100000) {
      completionStatus = 'COMPLETE';
    }

    return {
      totalOutcomes,
      totalSnapshots,
      totalCandles,
      expectedOutcomes,
      coveragePercent,
      byDecade,
      byHorizon,
      byCohort,
      completionStatus
    };
  }

  /**
   * B6.4.6 — Run calibration continuously until completion or stop
   */
  async runContinuous(maxChunks: number = 100, chunkSize: number = 500): Promise<void> {
    await this.log('INFO', 'Starting continuous calibration', { maxChunks, chunkSize });
    
    // Re-initialize with larger chunk size for efficiency
    const status = await this.getStatus();
    if (status.run) {
      // Update chunk size for existing run
      await CalibrationRunModel.findByIdAndUpdate(
        RUN_ID,
        { $set: { chunkSize } }
      ).exec();
    } else {
      // Initialize if not exists
      await this.initOrLoad({
        start: '1950-01-03',
        end: '2026-02-20',
        chunkSize,
        presets: DEFAULT_PRESETS,
        roles: DEFAULT_ROLES,
        source: 'BOOTSTRAP'
      });
    }
    
    let chunksRun = 0;
    let lastOutcomes = 0;

    while (chunksRun < maxChunks) {
      // Check for stop request
      const currentStatus = await this.getStatus();
      if (currentStatus.run?.stopRequested) {
        await this.log('INFO', 'Continuous run stopped by request', { chunksRun });
        break;
      }

      // Check if complete
      if (currentStatus.run?.state === 'DONE' || (currentStatus.run?.cursorIdx && currentStatus.run?.lastIdx && currentStatus.run?.cursorIdx >= currentStatus.run?.lastIdx)) {
        await this.log('INFO', 'Calibration complete!', { 
          chunksRun, 
          totalOutcomes: currentStatus.run?.writtenOutcomes 
        });
        break;
      }

      // Run one chunk using runOnce
      try {
        const result = await this.runOnce();
        chunksRun++;
        
        const newOutcomes = result.writtenOutcomes || 0;
        const chunkWritten = newOutcomes - lastOutcomes;
        lastOutcomes = newOutcomes;

        // Log progress every 10 chunks
        if (chunksRun % 10 === 0) {
          await this.log('INFO', 'Continuous progress', {
            chunksRun,
            totalOutcomes: newOutcomes,
            cursorIdx: result.cursorIdx,
            progress: `${Math.round((result.cursorIdx - (result.firstIdx || 0)) / ((result.lastIdx || 1) - (result.firstIdx || 0)) * 100)}%`
          });
        }

        // Small delay to prevent overwhelming MongoDB
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (err: any) {
        await this.log('ERROR', 'Chunk failed', { error: err.message });
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    await this.log('INFO', 'Continuous run finished', { chunksRun, totalOutcomes: lastOutcomes });
  }
}

export const spxCalibrationRunner = new SpxCalibrationRunner();
export default SpxCalibrationRunner;
