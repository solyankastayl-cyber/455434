/**
 * SPX REGIME ENGINE — Service
 * 
 * BLOCK B6.11 + B6.14 + B6.15 — Orchestrates regime computation, storage,
 * decade stability analysis, constitution generation, and governance.
 * 
 * Resume-safe with cursor tracking.
 */

import mongoose from 'mongoose';
import { calculateRegimeFeatures, RegimeFeatures } from './regime.features.js';
import { classifyRegime, getRegimeDescription, getRegimeRiskLevel, isModelUsefulRegime } from './regime.tagger.js';
import { RegimeTag, VolBucket, REGIME_CONFIG } from './regime.config.js';
import {
  CONSTITUTION_CONFIG,
  getDecadeFromDate,
  gradeStability,
  determinePolicy,
  calculateSizeCap,
  generateConstitutionHash,
  DecadeStabilityCell,
  StabilityScore,
  DecadeStabilityResult,
  RegimePolicy,
  ConstitutionV2,
  PolicyAction,
} from './regime.constitution.js';
import {
  GOVERNANCE_CONFIG,
  GovernanceStatus,
  ConstitutionVersion,
  ApplyGateResult,
  BacktestConfig,
  BacktestResult,
  PerformanceMetrics,
  RegimePerformanceEntry,
  AuditEntry,
  createAuditEntry,
  canTransition,
  evaluateBacktestForApply,
} from './regime.governance.js';

const ENGINE_VERSION = '1.2.0'; // Updated for B6.15

export interface RegimeDaily {
  date: string;
  idx: number;
  cohort: string;
  preset: string;
  regimeTag: RegimeTag;
  features: RegimeFeatures;
  description: string;
  riskLevel: string;
  computedAt: Date;
  engineVersion: string;
}

export interface RegimeSkillCell {
  regimeTag: RegimeTag;
  horizon: string;
  samples: number;
  baselineUp: number;
  baselineDown: number;
  hitUp: number;
  hitDown: number;
  skillUp: number;
  skillDown: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface RegimeMatrixResult {
  computedAt: string;
  totalSamples: number;
  regimes: string[];
  horizons: string[];
  cells: RegimeSkillCell[];
  summary: {
    bestRegimeDown: string | null;
    worstRegimeDown: string | null;
    bestRegimeTotal: string | null;
  };
}

class SpxRegimeService {
  private db: mongoose.Connection['db'] | null = null;

  private getDb() {
    if (!this.db) {
      this.db = mongoose.connection.db;
    }
    return this.db;
  }

  /**
   * Get or create regime collection
   */
  private async getRegimeCollection() {
    const db = this.getDb();
    if (!db) throw new Error('Database not connected');
    return db.collection('spx_regime_daily');
  }

  /**
   * Ensure indexes exist
   */
  async ensureIndexes(): Promise<void> {
    const col = await this.getRegimeCollection();
    await col.createIndex({ date: 1, preset: 1 }, { unique: true });
    await col.createIndex({ idx: 1 });
    await col.createIndex({ regimeTag: 1 });
    await col.createIndex({ cohort: 1 });
    console.log('[SPX Regime] Indexes ensured');
  }

  /**
   * Compute regime for a single candle index
   */
  async computeRegimeForIdx(
    candles: { date: string; close: number }[],
    idx: number,
    cohort: string,
    preset: string = 'BALANCED'
  ): Promise<RegimeDaily | null> {
    // Need at least 60 candles for features
    if (idx < REGIME_CONFIG.VOL_WINDOW_LONG) return null;
    
    const closes = candles.slice(0, idx + 1).map(c => c.close);
    const features = calculateRegimeFeatures(closes);
    const regimeTag = classifyRegime(features);
    
    return {
      date: candles[idx].date,
      idx,
      cohort,
      preset,
      regimeTag,
      features,
      description: getRegimeDescription(regimeTag),
      riskLevel: getRegimeRiskLevel(regimeTag),
      computedAt: new Date(),
      engineVersion: ENGINE_VERSION,
    };
  }

  /**
   * Recompute regimes for a range
   */
  async recomputeRegimes(options: {
    fromIdx?: number;
    toIdx?: number;
    chunkSize?: number;
    preset?: string;
  } = {}): Promise<{ processed: number; written: number }> {
    const db = this.getDb();
    if (!db) throw new Error('Database not connected');
    
    const { fromIdx = 60, chunkSize = 1000, preset = 'BALANCED' } = options;
    
    // Get all candles
    const candles = await db.collection('spx_candles')
      .find({})
      .sort({ date: 1 })
      .toArray();
    
    const toIdx = options.toIdx ?? candles.length - 1;
    const col = await this.getRegimeCollection();
    
    let processed = 0;
    let written = 0;
    
    // Process in chunks
    for (let i = fromIdx; i <= toIdx && i < candles.length; i += chunkSize) {
      const batch: RegimeDaily[] = [];
      const endIdx = Math.min(i + chunkSize, toIdx + 1, candles.length);
      
      for (let idx = i; idx < endIdx; idx++) {
        // Determine cohort based on date
        const dateStr = candles[idx].date as string;
        const year = parseInt(dateStr.substring(0, 4));
        const cohort = year < 1990 ? 'V1950' : year < 2008 ? 'V1990' : year < 2020 ? 'V2008' : year < 2025 ? 'V2020' : 'LIVE';
        
        const regime = await this.computeRegimeForIdx(
          candles as { date: string; close: number }[],
          idx,
          cohort,
          preset
        );
        
        if (regime) {
          batch.push(regime);
        }
        processed++;
      }
      
      // Upsert batch
      if (batch.length > 0) {
        const ops = batch.map(r => ({
          updateOne: {
            filter: { date: r.date, preset: r.preset },
            update: { $set: r },
            upsert: true,
          }
        }));
        
        const result = await col.bulkWrite(ops);
        written += result.upsertedCount + result.modifiedCount;
      }
      
      console.log(`[SPX Regime] Processed ${processed}/${toIdx - fromIdx + 1}, written ${written}`);
    }
    
    return { processed, written };
  }

  /**
   * Get regime summary statistics
   */
  async getRegimeSummary(preset: string = 'BALANCED'): Promise<{
    totalDays: number;
    byRegime: Record<string, number>;
    byVolBucket: Record<string, number>;
    lastComputed: string | null;
  }> {
    const col = await this.getRegimeCollection();
    
    const [totalCount, regimeCounts, volCounts, lastDoc] = await Promise.all([
      col.countDocuments({ preset }),
      col.aggregate([
        { $match: { preset } },
        { $group: { _id: '$regimeTag', count: { $sum: 1 } } }
      ]).toArray(),
      col.aggregate([
        { $match: { preset } },
        { $group: { _id: '$features.volBucket', count: { $sum: 1 } } }
      ]).toArray(),
      col.findOne({ preset }, { sort: { computedAt: -1 } }),
    ]);
    
    const byRegime: Record<string, number> = {};
    for (const r of regimeCounts) {
      byRegime[r._id as string] = r.count as number;
    }
    
    const byVolBucket: Record<string, number> = {};
    for (const v of volCounts) {
      byVolBucket[v._id as string] = v.count as number;
    }
    
    return {
      totalDays: totalCount,
      byRegime,
      byVolBucket,
      lastComputed: lastDoc ? (lastDoc.computedAt as Date).toISOString() : null,
    };
  }

  /**
   * Build skill matrix by regime
   */
  async buildRegimeSkillMatrix(preset: string = 'BALANCED'): Promise<RegimeMatrixResult> {
    const db = this.getDb();
    if (!db) throw new Error('Database not connected');
    
    const HORIZONS = ['7d', '14d', '30d', '90d', '180d', '365d'];
    
    // Join regime data with outcomes
    const outcomes = await db.collection('spx_outcomes')
      .find({ preset })
      .toArray();
    
    const regimes = await (await this.getRegimeCollection())
      .find({ preset })
      .toArray();
    
    // Create date -> regime map
    const regimeMap = new Map<string, RegimeTag>();
    for (const r of regimes) {
      regimeMap.set(r.date as string, r.regimeTag as RegimeTag);
    }
    
    // Aggregate by regime x horizon
    const cells: Map<string, {
      samples: number;
      upCorrect: number;    // predicted UP and was UP
      downCorrect: number;  // predicted DOWN and was DOWN
      totalUp: number;      // predicted UP
      totalDown: number;    // predicted DOWN
      actualUp: number;     // actual was UP (regardless of prediction)
      actualDown: number;   // actual was DOWN
    }> = new Map();
    
    for (const outcome of outcomes) {
      const regime = regimeMap.get(outcome.asOfDate as string);
      if (!regime) continue;
      
      const horizon = outcome.horizon as string;
      const key = `${regime}|${horizon}`;
      
      if (!cells.has(key)) {
        cells.set(key, { samples: 0, upCorrect: 0, downCorrect: 0, totalUp: 0, totalDown: 0, actualUp: 0, actualDown: 0 });
      }
      
      const cell = cells.get(key)!;
      cell.samples++;
      
      const expectedDir = outcome.expectedDirection as string;
      const actualRet = outcome.actualReturnPct as number;
      const actualDir = actualRet > 0 ? 'UP' : actualRet < 0 ? 'DOWN' : 'FLAT';
      
      // Track actual direction
      if (actualDir === 'UP') cell.actualUp++;
      else if (actualDir === 'DOWN') cell.actualDown++;
      
      // expectedDirection can be BULL/BEAR or UP/DOWN
      const isExpectedUp = expectedDir === 'UP' || expectedDir === 'BULL';
      const isExpectedDown = expectedDir === 'DOWN' || expectedDir === 'BEAR';
      
      if (isExpectedUp) {
        cell.totalUp++;
        if (actualDir === 'UP') cell.upCorrect++;
      } else if (isExpectedDown) {
        cell.totalDown++;
        if (actualDir === 'DOWN') cell.downCorrect++;
      }
    }
    
    // Calculate skill cells
    const skillCells: RegimeSkillCell[] = [];
    const regimeTags = Object.values(RegimeTag);
    
    for (const regime of regimeTags) {
      for (const horizon of HORIZONS) {
        const key = `${regime}|${horizon}`;
        const cell = cells.get(key);
        
        if (!cell || cell.samples === 0) continue;
        
        // Hit rates
        const hitUp = cell.totalUp > 0 ? cell.upCorrect / cell.totalUp : 0;
        const hitDown = cell.totalDown > 0 ? cell.downCorrect / cell.totalDown : 0;
        
        // Baseline = actual market direction probability
        const baselineUp = cell.samples > 0 ? cell.actualUp / cell.samples : 0.5;
        const baselineDown = cell.samples > 0 ? cell.actualDown / cell.samples : 0.5;
        
        // Skill = hit rate - baseline
        const skillUp = hitUp - baselineUp;
        const skillDown = hitDown - baselineDown;
        
        const confidence = cell.samples < 100 ? 'LOW' : cell.samples < 500 ? 'MEDIUM' : 'HIGH';
        
        skillCells.push({
          regimeTag: regime,
          horizon,
          samples: cell.samples,
          baselineUp,
          baselineDown,
          hitUp,
          hitDown,
          skillUp,
          skillDown,
          confidence,
        });
      }
    }
    
    // Find best/worst regimes
    const regimeSkillDown = new Map<string, { total: number; count: number }>();
    for (const cell of skillCells) {
      if (!regimeSkillDown.has(cell.regimeTag)) {
        regimeSkillDown.set(cell.regimeTag, { total: 0, count: 0 });
      }
      const r = regimeSkillDown.get(cell.regimeTag)!;
      r.total += cell.skillDown;
      r.count++;
    }
    
    let bestRegimeDown: string | null = null;
    let worstRegimeDown: string | null = null;
    let bestSkill = -Infinity;
    let worstSkill = Infinity;
    
    for (const [regime, { total, count }] of regimeSkillDown) {
      const avgSkill = count > 0 ? total / count : 0;
      if (avgSkill > bestSkill) {
        bestSkill = avgSkill;
        bestRegimeDown = regime;
      }
      if (avgSkill < worstSkill) {
        worstSkill = avgSkill;
        worstRegimeDown = regime;
      }
    }
    
    return {
      computedAt: new Date().toISOString(),
      totalSamples: outcomes.length,
      regimes: [...new Set(skillCells.map(c => c.regimeTag))],
      horizons: HORIZONS,
      cells: skillCells,
      summary: {
        bestRegimeDown,
        worstRegimeDown,
        bestRegimeTotal: bestRegimeDown,
      },
    };
  }

  /**
   * Get current regime for live data
   */
  async getCurrentRegime(preset: string = 'BALANCED'): Promise<RegimeDaily | null> {
    const col = await this.getRegimeCollection();
    const latest = await col.findOne(
      { preset },
      { sort: { date: -1 } }
    );
    return latest as RegimeDaily | null;
  }

  /**
   * B6.12.2 — Generate outcomes from candles + regimes
   * 
   * Creates spx_outcomes collection with:
   * - idx: candle index
   * - date: as-of date
   * - horizon: 7d, 14d, 30d, 90d, 180d, 365d
   * - expectedDirection: SMA-based prediction
   * - actualReturnPct: real forward return
   * - realizedDirection: UP/DOWN based on actual return
   * 
   * Join is by idx, not date string.
   */
  async generateOutcomes(options: {
    preset?: string;
    fromIdx?: number;
    toIdx?: number;
  } = {}): Promise<{ generated: number; written: number }> {
    const db = this.getDb();
    if (!db) throw new Error('Database not connected');
    
    const { preset = 'BALANCED', fromIdx = 60 } = options;
    
    // Get all candles sorted by date
    const candles = await db.collection('spx_candles')
      .find({})
      .sort({ date: 1 })
      .toArray();
    
    // toIdx: use provided value or go to end minus shortest horizon
    // Each horizon will check if future data exists
    const toIdx = options.toIdx ?? candles.length - 1;
    const outcomesCol = db.collection('spx_outcomes');
    
    // Horizons in trading days
    const HORIZONS: { label: string; days: number }[] = [
      { label: '7d', days: 5 },
      { label: '14d', days: 10 },
      { label: '30d', days: 21 },
      { label: '90d', days: 63 },
      { label: '180d', days: 126 },
      { label: '365d', days: 252 },
    ];
    
    let generated = 0;
    let written = 0;
    const batchSize = 5000;
    let batch: any[] = [];
    
    for (let idx = fromIdx; idx <= toIdx && idx < candles.length; idx++) {
      const candle = candles[idx];
      const close = candle.close as number;
      const dateStr = candle.date as string;
      
      // Calculate SMA50 for prediction
      const sma50Window = candles.slice(Math.max(0, idx - 49), idx + 1);
      const sma50 = sma50Window.reduce((s, c) => s + (c.close as number), 0) / sma50Window.length;
      
      // SMA-based prediction: price > SMA50 → expect UP, else DOWN
      const expectedDirection = close > sma50 ? 'UP' : 'DOWN';
      
      for (const h of HORIZONS) {
        const futureIdx = idx + h.days;
        if (futureIdx >= candles.length) continue;
        
        const futureClose = candles[futureIdx].close as number;
        const actualReturnPct = (futureClose - close) / close;
        const realizedDirection = actualReturnPct > 0 ? 'UP' : actualReturnPct < 0 ? 'DOWN' : 'FLAT';
        
        batch.push({
          updateOne: {
            filter: { idx, horizon: h.label, preset },
            update: {
              $set: {
                idx,
                date: dateStr,
                asOfDate: dateStr,
                horizon: h.label,
                preset,
                expectedDirection,
                actualReturnPct,
                realizedDirection,
                closeAtPrediction: close,
                closeAtOutcome: futureClose,
                sma50AtPrediction: sma50,
                computedAt: new Date(),
              }
            },
            upsert: true,
          }
        });
        
        generated++;
      }
      
      // Write batch
      if (batch.length >= batchSize) {
        const result = await outcomesCol.bulkWrite(batch);
        written += result.upsertedCount + result.modifiedCount;
        console.log(`[SPX Outcomes] Generated ${generated}, written ${written}, idx ${idx}/${toIdx}`);
        batch = [];
      }
    }
    
    // Final batch
    if (batch.length > 0) {
      const result = await outcomesCol.bulkWrite(batch);
      written += result.upsertedCount + result.modifiedCount;
    }
    
    // Create indexes
    await outcomesCol.createIndex({ idx: 1, horizon: 1, preset: 1 }, { unique: true });
    await outcomesCol.createIndex({ date: 1 });
    await outcomesCol.createIndex({ preset: 1 });
    
    console.log(`[SPX Outcomes] Complete: generated ${generated}, written ${written}`);
    return { generated, written };
  }

  /**
   * B6.12.2 — Build skill matrix with idx-based join
   * 
   * Правильный join: outcome.idx === regime.idx
   * Baseline считается внутри каждого regime subset
   */
  async buildRegimeSkillMatrixV2(preset: string = 'BALANCED'): Promise<RegimeMatrixResult> {
    const db = this.getDb();
    if (!db) throw new Error('Database not connected');
    
    const HORIZONS = ['7d', '14d', '30d', '90d', '180d', '365d'];
    
    // Get regimes by idx
    const regimes = await (await this.getRegimeCollection())
      .find({ preset })
      .toArray();
    
    // Create idx -> regime map
    const regimeByIdx = new Map<number, RegimeTag>();
    for (const r of regimes) {
      regimeByIdx.set(r.idx as number, r.regimeTag as RegimeTag);
    }
    
    // Get outcomes
    const outcomes = await db.collection('spx_outcomes')
      .find({ preset })
      .toArray();
    
    if (outcomes.length === 0) {
      console.log('[SPX Regime Matrix] No outcomes found. Run generateOutcomes first.');
      return {
        computedAt: new Date().toISOString(),
        totalSamples: 0,
        regimes: [],
        horizons: HORIZONS,
        cells: [],
        summary: { bestRegimeDown: null, worstRegimeDown: null, bestRegimeTotal: null },
      };
    }
    
    // Aggregate by regime x horizon
    // Key: regimeTag|horizon
    const cells: Map<string, {
      samples: number;
      upCorrect: number;    // predicted UP and was UP
      downCorrect: number;  // predicted DOWN and was DOWN
      totalUp: number;      // predicted UP
      totalDown: number;    // predicted DOWN
      actualUp: number;     // actual was UP
      actualDown: number;   // actual was DOWN
    }> = new Map();
    
    let joinedCount = 0;
    
    for (const outcome of outcomes) {
      const idx = outcome.idx as number;
      const regime = regimeByIdx.get(idx);
      
      if (!regime) continue; // No regime for this idx
      
      joinedCount++;
      const horizon = outcome.horizon as string;
      const key = `${regime}|${horizon}`;
      
      if (!cells.has(key)) {
        cells.set(key, { 
          samples: 0, upCorrect: 0, downCorrect: 0, 
          totalUp: 0, totalDown: 0, actualUp: 0, actualDown: 0 
        });
      }
      
      const cell = cells.get(key)!;
      cell.samples++;
      
      const expectedDir = outcome.expectedDirection as string;
      const realizedDir = outcome.realizedDirection as string;
      
      // Track actual direction (for baseline)
      if (realizedDir === 'UP') cell.actualUp++;
      else if (realizedDir === 'DOWN') cell.actualDown++;
      
      // Track predictions
      if (expectedDir === 'UP') {
        cell.totalUp++;
        if (realizedDir === 'UP') cell.upCorrect++;
      } else if (expectedDir === 'DOWN') {
        cell.totalDown++;
        if (realizedDir === 'DOWN') cell.downCorrect++;
      }
    }
    
    console.log(`[SPX Regime Matrix] Joined ${joinedCount}/${outcomes.length} outcomes with regimes`);
    
    // Calculate skill cells
    const skillCells: RegimeSkillCell[] = [];
    const regimeTags = Object.values(RegimeTag);
    
    for (const regime of regimeTags) {
      for (const horizon of HORIZONS) {
        const key = `${regime}|${horizon}`;
        const cell = cells.get(key);
        
        if (!cell || cell.samples === 0) continue;
        
        // Hit rates
        const hitUp = cell.totalUp > 0 ? cell.upCorrect / cell.totalUp : 0;
        const hitDown = cell.totalDown > 0 ? cell.downCorrect / cell.totalDown : 0;
        
        // Baseline = actual market direction probability WITHIN THIS REGIME
        const baselineUp = cell.samples > 0 ? cell.actualUp / cell.samples : 0.5;
        const baselineDown = cell.samples > 0 ? cell.actualDown / cell.samples : 0.5;
        
        // Skill = hit rate - baseline (regime-conditioned)
        const skillUp = hitUp - baselineUp;
        const skillDown = hitDown - baselineDown;
        
        // Confidence based on samples
        let confidence: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
        if (cell.samples >= 2000) confidence = 'HIGH';
        else if (cell.samples >= 500) confidence = 'MEDIUM';
        
        skillCells.push({
          regimeTag: regime,
          horizon,
          samples: cell.samples,
          baselineUp,
          baselineDown,
          hitUp,
          hitDown,
          skillUp,
          skillDown,
          confidence,
        });
      }
    }
    
    // Find best/worst regimes by average skillDown
    const regimeSkillDown = new Map<string, { total: number; count: number }>();
    for (const cell of skillCells) {
      if (!regimeSkillDown.has(cell.regimeTag)) {
        regimeSkillDown.set(cell.regimeTag, { total: 0, count: 0 });
      }
      const r = regimeSkillDown.get(cell.regimeTag)!;
      r.total += cell.skillDown;
      r.count++;
    }
    
    let bestRegimeDown: string | null = null;
    let worstRegimeDown: string | null = null;
    let bestSkill = -Infinity;
    let worstSkill = Infinity;
    
    for (const [regime, { total, count }] of regimeSkillDown) {
      const avgSkill = count > 0 ? total / count : 0;
      if (avgSkill > bestSkill) {
        bestSkill = avgSkill;
        bestRegimeDown = regime;
      }
      if (avgSkill < worstSkill) {
        worstSkill = avgSkill;
        worstRegimeDown = regime;
      }
    }
    
    return {
      computedAt: new Date().toISOString(),
      totalSamples: joinedCount,
      regimes: [...new Set(skillCells.map(c => c.regimeTag))],
      horizons: HORIZONS,
      cells: skillCells,
      summary: {
        bestRegimeDown,
        worstRegimeDown,
        bestRegimeTotal: bestRegimeDown,
      },
    };
  }

  /**
   * B6.14.1 — Build Decade Stability Analysis
   * 
   * For each (regimeTag, horizon), calculates skill per decade
   * and derives stability metrics.
   */
  async buildDecadeStability(preset: string = 'BALANCED'): Promise<DecadeStabilityResult> {
    const db = this.getDb();
    if (!db) throw new Error('Database not connected');
    
    const HORIZONS = ['7d', '14d', '30d', '90d', '180d', '365d'];
    
    // Get regimes with decade info
    const regimes = await (await this.getRegimeCollection())
      .find({ preset })
      .toArray();
    
    // Create idx -> (regime, decade) map
    const regimeByIdx = new Map<number, { tag: RegimeTag; decade: string }>();
    for (const r of regimes) {
      const decade = getDecadeFromDate(r.date as string);
      regimeByIdx.set(r.idx as number, { tag: r.regimeTag as RegimeTag, decade });
    }
    
    // Get outcomes
    const outcomes = await db.collection('spx_outcomes')
      .find({ preset })
      .toArray();
    
    // Aggregate by regime × horizon × decade
    // Key: regimeTag|horizon|decade
    const decadeCells: Map<string, {
      samples: number;
      upCorrect: number;
      downCorrect: number;
      totalUp: number;
      totalDown: number;
      actualUp: number;
      actualDown: number;
    }> = new Map();
    
    for (const outcome of outcomes) {
      const idx = outcome.idx as number;
      const regimeInfo = regimeByIdx.get(idx);
      if (!regimeInfo) continue;
      
      const { tag: regime, decade } = regimeInfo;
      const horizon = outcome.horizon as string;
      const key = `${regime}|${horizon}|${decade}`;
      
      if (!decadeCells.has(key)) {
        decadeCells.set(key, {
          samples: 0, upCorrect: 0, downCorrect: 0,
          totalUp: 0, totalDown: 0, actualUp: 0, actualDown: 0
        });
      }
      
      const cell = decadeCells.get(key)!;
      cell.samples++;
      
      const expectedDir = outcome.expectedDirection as string;
      const realizedDir = outcome.realizedDirection as string;
      
      if (realizedDir === 'UP') cell.actualUp++;
      else if (realizedDir === 'DOWN') cell.actualDown++;
      
      if (expectedDir === 'UP') {
        cell.totalUp++;
        if (realizedDir === 'UP') cell.upCorrect++;
      } else if (expectedDir === 'DOWN') {
        cell.totalDown++;
        if (realizedDir === 'DOWN') cell.downCorrect++;
      }
    }
    
    // Build stability scores
    const stabilityScores: StabilityScore[] = [];
    const regimeTags = Object.values(RegimeTag);
    
    for (const regime of regimeTags) {
      for (const horizon of HORIZONS) {
        const decadeStats: DecadeStabilityCell[] = [];
        let totalSamples = 0;
        
        for (const decade of CONSTITUTION_CONFIG.DECADES) {
          const key = `${regime}|${horizon}|${decade}`;
          const cell = decadeCells.get(key);
          
          if (!cell || cell.samples === 0) continue;
          
          const hitUp = cell.totalUp > 0 ? cell.upCorrect / cell.totalUp : 0;
          const hitDown = cell.totalDown > 0 ? cell.downCorrect / cell.totalDown : 0;
          const baselineUp = cell.actualUp / cell.samples;
          const baselineDown = cell.actualDown / cell.samples;
          const skillUp = hitUp - baselineUp;
          const skillDown = hitDown - baselineDown;
          
          decadeStats.push({
            regimeTag: regime,
            horizon,
            decade,
            samples: cell.samples,
            skillDown,
            skillUp,
            hitDown,
            hitUp,
          });
          
          totalSamples += cell.samples;
        }
        
        if (decadeStats.length === 0) continue;
        
        // Calculate stability metrics
        const decadesWithData = decadeStats.length;
        const decadesWithMinSamples = decadeStats.filter(
          d => d.samples >= CONSTITUTION_CONFIG.MIN_DECADE_SAMPLES
        ).length;
        
        const qualifiedDecades = decadeStats.filter(
          d => d.samples >= CONSTITUTION_CONFIG.MIN_DECADE_SAMPLES
        );
        
        const coverage = decadesWithMinSamples / CONSTITUTION_CONFIG.DECADES.length;
        const consistency = qualifiedDecades.length > 0
          ? qualifiedDecades.filter(d => d.skillDown > 0).length / qualifiedDecades.length
          : 0;
        
        const skillDownValues = qualifiedDecades.map(d => d.skillDown);
        const meanSkillDown = skillDownValues.length > 0
          ? skillDownValues.reduce((a, b) => a + b, 0) / skillDownValues.length
          : 0;
        
        // Calculate std
        let stdSkillDown = 0;
        if (skillDownValues.length > 0) {
          const squareDiffs = skillDownValues.map(v => Math.pow(v - meanSkillDown, 2));
          stdSkillDown = Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / skillDownValues.length);
        }
        
        const stabilityGrade = gradeStability(decadesWithMinSamples, consistency, totalSamples);
        const confidenceUplift = decadesWithMinSamples >= 3 && consistency >= CONSTITUTION_CONFIG.MIN_CONSISTENCY;
        
        stabilityScores.push({
          regimeTag: regime,
          horizon,
          decadeStats,
          decadesWithData,
          decadesWithMinSamples,
          coverage,
          consistency,
          meanSkillDown,
          stdSkillDown,
          stabilityGrade,
          confidenceUplift,
        });
      }
    }
    
    return {
      computedAt: new Date().toISOString(),
      horizons: HORIZONS,
      regimes: [...new Set(stabilityScores.map(s => s.regimeTag))],
      cells: stabilityScores,
    };
  }

  /**
   * B6.14.2 — Build Constitution from Matrix + Stability
   */
  async buildConstitution(preset: string = 'BALANCED'): Promise<ConstitutionV2> {
    // Get matrix and stability data
    const matrix = await this.buildRegimeSkillMatrixV2(preset);
    const stability = await this.buildDecadeStability(preset);
    
    // Aggregate by regime (across all horizons)
    const regimeAggregates = new Map<RegimeTag, {
      samples: number;
      skillDownSum: number;
      skillUpSum: number;
      horizonCount: number;
      bestStability: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNPROVEN';
      avgCoverage: number;
      avgConsistency: number;
    }>();
    
    // Aggregate matrix data
    for (const cell of matrix.cells) {
      if (!regimeAggregates.has(cell.regimeTag)) {
        regimeAggregates.set(cell.regimeTag, {
          samples: 0,
          skillDownSum: 0,
          skillUpSum: 0,
          horizonCount: 0,
          bestStability: 'UNPROVEN',
          avgCoverage: 0,
          avgConsistency: 0,
        });
      }
      const agg = regimeAggregates.get(cell.regimeTag)!;
      agg.samples += cell.samples;
      agg.skillDownSum += cell.skillDown;
      agg.skillUpSum += cell.skillUp;
      agg.horizonCount++;
    }
    
    // Add stability data
    for (const stab of stability.cells) {
      const agg = regimeAggregates.get(stab.regimeTag);
      if (!agg) continue;
      
      // Keep best stability grade
      const gradeOrder = { HIGH: 3, MEDIUM: 2, LOW: 1, UNPROVEN: 0 };
      if (gradeOrder[stab.stabilityGrade] > gradeOrder[agg.bestStability]) {
        agg.bestStability = stab.stabilityGrade;
      }
      agg.avgCoverage = Math.max(agg.avgCoverage, stab.coverage);
      agg.avgConsistency = Math.max(agg.avgConsistency, stab.consistency);
    }
    
    // Build policies
    const policies: RegimePolicy[] = [];
    const regimeTags = Object.values(RegimeTag);
    
    for (const regime of regimeTags) {
      const agg = regimeAggregates.get(regime);
      
      if (!agg || agg.horizonCount === 0) {
        // No data for this regime
        policies.push({
          regimeTag: regime,
          status: 'UNPROVEN',
          shortFilterPolicy: 'CAUTION',
          longFilterPolicy: 'CAUTION',
          sizeCapShort: CONSTITUTION_CONFIG.CAP_UNPROVEN,
          sizeCapLong: CONSTITUTION_CONFIG.CAP_UNPROVEN,
          samples: 0,
          avgSkillDown: 0,
          avgSkillUp: 0,
          stabilityGrade: 'UNPROVEN',
          decadeCoverage: 0,
          notes: ['No data available for this regime'],
        });
        continue;
      }
      
      const avgSkillDown = agg.skillDownSum / agg.horizonCount;
      const avgSkillUp = agg.skillUpSum / agg.horizonCount;
      const perDaySamples = Math.floor(agg.samples / 6); // Divide by horizons
      
      // Determine status
      let status: 'PROVEN' | 'MODERATE' | 'UNPROVEN' | 'NEGATIVE';
      if (avgSkillDown < CONSTITUTION_CONFIG.SKILL_NEGATIVE) {
        status = 'NEGATIVE';
      } else if (
        perDaySamples >= CONSTITUTION_CONFIG.MIN_SAMPLES_RULE &&
        agg.bestStability === 'HIGH'
      ) {
        status = 'PROVEN';
      } else if (
        perDaySamples >= CONSTITUTION_CONFIG.MIN_SAMPLES_MODERATE &&
        (agg.bestStability === 'MEDIUM' || agg.bestStability === 'HIGH')
      ) {
        status = 'MODERATE';
      } else {
        status = 'UNPROVEN';
      }
      
      // Determine policies
      const shortFilterPolicy = determinePolicy(avgSkillDown, agg.bestStability, status);
      const longFilterPolicy = determinePolicy(avgSkillUp, agg.bestStability, status);
      
      // Check for crisis regime overlay
      const isCrisisRegime = regime.includes('HIGHVOL');
      const isFastVShape = regime.includes('FAST_SHOCK_VSHAPE');
      
      const sizeCapShort = calculateSizeCap(shortFilterPolicy, isCrisisRegime, isFastVShape);
      const sizeCapLong = calculateSizeCap(longFilterPolicy, isCrisisRegime, isFastVShape);
      
      // Generate notes
      const notes: string[] = [];
      if (status === 'PROVEN') {
        notes.push(`Strong evidence: ${perDaySamples} samples, ${agg.bestStability} stability`);
      }
      if (status === 'UNPROVEN' && avgSkillDown > CONSTITUTION_CONFIG.SKILL_THRESHOLD_HIGH) {
        notes.push(`High skill (+${(avgSkillDown * 100).toFixed(1)}%) but insufficient stability`);
      }
      if (status === 'NEGATIVE') {
        notes.push(`Model hurts in this regime (skill ${(avgSkillDown * 100).toFixed(1)}%)`);
      }
      if (isCrisisRegime) {
        notes.push('Crisis regime: size caps reduced');
      }
      if (agg.avgConsistency < 0.5) {
        notes.push(`Low consistency across decades (${(agg.avgConsistency * 100).toFixed(0)}%)`);
      }
      
      policies.push({
        regimeTag: regime,
        status,
        shortFilterPolicy,
        longFilterPolicy,
        sizeCapShort,
        sizeCapLong,
        samples: perDaySamples,
        avgSkillDown,
        avgSkillUp,
        stabilityGrade: agg.bestStability,
        decadeCoverage: agg.avgCoverage,
        notes,
      });
    }
    
    // Sort by status priority
    const statusOrder = { PROVEN: 0, MODERATE: 1, UNPROVEN: 2, NEGATIVE: 3 };
    policies.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
    
    // Summary
    const summary = {
      totalRegimes: policies.length,
      proven: policies.filter(p => p.status === 'PROVEN').length,
      moderate: policies.filter(p => p.status === 'MODERATE').length,
      unproven: policies.filter(p => p.status === 'UNPROVEN').length,
      negative: policies.filter(p => p.status === 'NEGATIVE').length,
    };
    
    return {
      version: `v2.${Date.now()}`,
      hash: generateConstitutionHash(policies),
      generatedAt: new Date().toISOString(),
      preset,
      minSamplesRule: CONSTITUTION_CONFIG.MIN_SAMPLES_RULE,
      minStabilityScore: CONSTITUTION_CONFIG.MIN_CONSISTENCY,
      policies,
      summary,
    };
  }

  /**
   * Save constitution to database
   */
  async saveConstitution(constitution: ConstitutionV2): Promise<void> {
    const db = this.getDb();
    if (!db) throw new Error('Database not connected');
    
    const col = db.collection('spx_constitutions');
    
    await col.updateOne(
      { preset: constitution.preset },
      { 
        $set: constitution,
        $push: {
          history: {
            hash: constitution.hash,
            generatedAt: constitution.generatedAt,
            summary: constitution.summary,
          }
        }
      },
      { upsert: true }
    );
    
    console.log(`[SPX Constitution] Saved v2 hash=${constitution.hash}`);
  }

  /**
   * Get saved constitution
   */
  async getConstitution(preset: string = 'BALANCED'): Promise<ConstitutionV2 | null> {
    const db = this.getDb();
    if (!db) return null;
    
    const col = db.collection('spx_constitutions');
    const doc = await col.findOne({ preset });
    
    if (!doc) return null;
    
    // Remove MongoDB _id
    const { _id, history, ...constitution } = doc;
    return constitution as unknown as ConstitutionV2;
  }

  // ===== B6.15 GOVERNANCE METHODS =====

  /**
   * Get constitution versions collection
   */
  private async getVersionsCollection() {
    const db = this.getDb();
    if (!db) throw new Error('Database not connected');
    return db.collection('spx_constitution_versions');
  }

  /**
   * Create a new constitution version from current constitution
   */
  async createConstitutionVersion(preset: string = 'BALANCED'): Promise<ConstitutionVersion> {
    const constitution = await this.getConstitution(preset);
    if (!constitution) {
      throw new Error('No constitution found. Generate one first.');
    }
    
    // Get metrics snapshot
    const matrix = await this.buildRegimeSkillMatrixV2(preset);
    const summary = await this.getRegimeSummary(preset);
    
    // Count LIVE samples (last 30 days)
    const db = this.getDb();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const liveSamples = await db!.collection('spx_regime_daily').countDocuments({
      preset,
      computedAt: { $gte: thirtyDaysAgo }
    });
    
    // Find top/worst regimes
    const sortedPolicies = [...constitution.policies].sort((a, b) => b.avgSkillDown - a.avgSkillDown);
    const topRegime = sortedPolicies[0]?.regimeTag || 'UNKNOWN';
    const worstRegime = sortedPolicies[sortedPolicies.length - 1]?.regimeTag || 'UNKNOWN';
    
    const version: ConstitutionVersion = {
      hash: constitution.hash,
      version: constitution.version,
      createdAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
      preset,
      status: 'GENERATED',
      policies: constitution.policies,
      summary: constitution.summary,
      metricsSnapshot: {
        totalSamples: matrix.totalSamples,
        liveSamples,
        lastComputedAt: matrix.computedAt,
        topRegime,
        worstRegime,
      },
      auditLog: [
        createAuditEntry('GENERATED', `Constitution v2 created with hash ${constitution.hash}`)
      ],
    };
    
    // Save to versions collection
    const col = await this.getVersionsCollection();
    await col.insertOne(version);
    
    console.log(`[SPX Governance] Created version ${version.hash} with status GENERATED`);
    return version;
  }

  /**
   * Get all constitution versions
   */
  async getConstitutionVersions(preset: string = 'BALANCED'): Promise<ConstitutionVersion[]> {
    const col = await this.getVersionsCollection();
    const versions = await col
      .find({ preset })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();
    
    return versions.map(v => {
      const { _id, ...rest } = v;
      return rest as unknown as ConstitutionVersion;
    });
  }

  /**
   * Get active (APPLIED) constitution version
   */
  async getActiveConstitution(preset: string = 'BALANCED'): Promise<ConstitutionVersion | null> {
    const col = await this.getVersionsCollection();
    const active = await col.findOne({ preset, status: 'APPLIED' });
    
    if (!active) return null;
    
    const { _id, ...rest } = active;
    return rest as unknown as ConstitutionVersion;
  }

  /**
   * Check APPLY gates
   */
  async checkApplyGates(hash: string, preset: string = 'BALANCED'): Promise<ApplyGateResult> {
    const db = this.getDb();
    if (!db) throw new Error('Database not connected');
    
    const blockers: string[] = [];
    
    // Gate 1: LIVE samples >= 30
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const liveSamples = await db.collection('spx_regime_daily').countDocuments({
      preset,
      computedAt: { $gte: thirtyDaysAgo }
    });
    const liveSamplesPassed = liveSamples >= GOVERNANCE_CONFIG.MIN_LIVE_SAMPLES;
    if (!liveSamplesPassed) {
      blockers.push(`Insufficient LIVE samples: ${liveSamples}/${GOVERNANCE_CONFIG.MIN_LIVE_SAMPLES}`);
    }
    
    // Gate 2: No negative drift in last 60 days
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    
    // Calculate simple drift from outcomes
    const recentOutcomes = await db.collection('spx_outcomes')
      .find({ preset, computedAt: { $gte: sixtyDaysAgo } })
      .toArray();
    
    let driftValue = 0;
    if (recentOutcomes.length > 0) {
      const avgReturn = recentOutcomes.reduce((sum, o) => sum + (o.actualReturnPct || 0), 0) / recentOutcomes.length;
      driftValue = avgReturn; // Simplified drift calculation
    }
    const driftPassed = driftValue >= GOVERNANCE_CONFIG.MAX_DRIFT_THRESHOLD;
    if (!driftPassed) {
      blockers.push(`Negative drift detected: ${(driftValue * 100).toFixed(2)}%`);
    }
    
    // Gate 3: No CRITICAL regime instability
    const stability = await this.buildDecadeStability(preset);
    const criticalRegimes = stability.cells
      .filter(s => s.stabilityGrade === 'UNPROVEN' && s.decadesWithMinSamples === 0)
      .map(s => s.regimeTag);
    const stabilityPassed = criticalRegimes.length === 0;
    if (!stabilityPassed) {
      blockers.push(`Critical instability in: ${criticalRegimes.join(', ')}`);
    }
    
    return {
      canApply: blockers.length === 0,
      gates: {
        liveSamples: { passed: liveSamplesPassed, current: liveSamples, required: GOVERNANCE_CONFIG.MIN_LIVE_SAMPLES },
        driftCheck: { passed: driftPassed, last60DaysDrift: driftValue, threshold: GOVERNANCE_CONFIG.MAX_DRIFT_THRESHOLD },
        stabilityCheck: { passed: stabilityPassed, criticalRegimes },
      },
      blockers,
    };
  }

  /**
   * Transition constitution version to new status
   */
  async transitionConstitution(
    hash: string,
    targetStatus: GovernanceStatus,
    preset: string = 'BALANCED',
    actor: string = 'SYSTEM'
  ): Promise<{ success: boolean; version?: ConstitutionVersion; error?: string }> {
    const col = await this.getVersionsCollection();
    
    // Get current version
    const current = await col.findOne({ hash, preset });
    if (!current) {
      return { success: false, error: `Version ${hash} not found` };
    }
    
    // Check if transition is valid
    if (!canTransition(current.status as GovernanceStatus, targetStatus)) {
      return { 
        success: false, 
        error: `Invalid transition: ${current.status} → ${targetStatus}` 
      };
    }
    
    // Special handling for APPLY
    if (targetStatus === 'APPLIED') {
      const gates = await this.checkApplyGates(hash, preset);
      if (!gates.canApply) {
        return { 
          success: false, 
          error: `APPLY blocked: ${gates.blockers.join('; ')}` 
        };
      }
      
      // Deactivate previous APPLIED version
      await col.updateMany(
        { preset, status: 'APPLIED' },
        { 
          $set: { status: 'ROLLED_BACK', rolledBackAt: new Date().toISOString() },
          $push: { auditLog: createAuditEntry('ROLLED_BACK', `Replaced by ${hash}`, actor) as any }
        }
      );
    }
    
    // Update status
    const updateFields: Record<string, any> = {
      status: targetStatus,
    };
    
    switch (targetStatus) {
      case 'DRY_RUN':
        updateFields.dryRunStartedAt = new Date().toISOString();
        break;
      case 'PROPOSED':
        updateFields.proposedAt = new Date().toISOString();
        break;
      case 'APPLIED':
        updateFields.appliedAt = new Date().toISOString();
        break;
      case 'ROLLED_BACK':
        updateFields.rolledBackAt = new Date().toISOString();
        break;
    }
    
    await col.updateOne(
      { hash, preset },
      { 
        $set: updateFields,
        $push: { 
          auditLog: createAuditEntry(targetStatus, `Transitioned to ${targetStatus}`, actor) as any
        }
      }
    );
    
    const updated = await col.findOne({ hash, preset });
    const { _id, ...rest } = updated!;
    
    console.log(`[SPX Governance] ${hash}: ${current.status} → ${targetStatus}`);
    return { success: true, version: rest as unknown as ConstitutionVersion };
  }

  // ===== B6.14.4 CONSTITUTION BACKTESTER =====

  /**
   * Run backtest for a specific period
   */
  async runBacktest(config: BacktestConfig): Promise<BacktestResult> {
    const db = this.getDb();
    if (!db) throw new Error('Database not connected');
    
    const constitution = await this.getConstitution(config.preset);
    if (!constitution) {
      throw new Error('No constitution found');
    }
    
    // Get candles for period
    const candles = await db.collection('spx_candles')
      .find({ date: { $gte: config.startDate, $lte: config.endDate } })
      .sort({ date: 1 })
      .toArray();
    
    // Get regimes for period
    const regimes = await (await this.getRegimeCollection())
      .find({ preset: config.preset, date: { $gte: config.startDate, $lte: config.endDate } })
      .toArray();
    
    // Create policy lookup
    const policyByRegime = new Map<string, RegimePolicy>();
    for (const p of constitution.policies) {
      policyByRegime.set(p.regimeTag, p);
    }
    
    // Simulate strategies
    const tradingDays = candles.length;
    
    // Raw model: always trade
    let rawReturns: number[] = [];
    let filteredReturns: number[] = [];
    let buyHoldReturns: number[] = [];
    
    // Track regime performance
    const regimePerf = new Map<string, { days: number; rawSum: number; filteredSum: number; blocked: boolean }>();
    
    for (let i = 1; i < candles.length; i++) {
      const prevClose = candles[i - 1].close as number;
      const currClose = candles[i].close as number;
      const dailyReturn = (currClose - prevClose) / prevClose;
      
      // Buy & hold always gets market return
      buyHoldReturns.push(dailyReturn);
      
      // Find regime for this day
      const regime = regimes.find(r => r.date === candles[i].date);
      const regimeTag = regime?.regimeTag as string || 'UNKNOWN';
      const policy = policyByRegime.get(regimeTag);
      
      // Raw model: simplified - assume model is always long
      rawReturns.push(dailyReturn);
      
      // Constitution filtered: apply size cap
      let filteredReturn = dailyReturn;
      let blocked = false;
      
      if (policy) {
        if (policy.longFilterPolicy === 'BLOCK') {
          filteredReturn = 0; // Don't trade
          blocked = true;
        } else {
          filteredReturn = dailyReturn * policy.sizeCapLong;
        }
      }
      
      filteredReturns.push(filteredReturn);
      
      // Track by regime
      if (!regimePerf.has(regimeTag)) {
        regimePerf.set(regimeTag, { days: 0, rawSum: 0, filteredSum: 0, blocked: false });
      }
      const perf = regimePerf.get(regimeTag)!;
      perf.days++;
      perf.rawSum += dailyReturn;
      perf.filteredSum += filteredReturn;
      if (blocked) perf.blocked = true;
    }
    
    // Calculate performance metrics
    const calcMetrics = (returns: number[]): PerformanceMetrics => {
      const n = returns.length;
      if (n === 0) return { totalReturn: 0, cagr: 0, maxDrawdown: 0, sharpeRatio: 0, hitRate: 0, totalTrades: 0, winRate: 0 };
      
      // Total return (compounded)
      let equity = 1;
      let peak = 1;
      let maxDD = 0;
      let wins = 0;
      
      for (const r of returns) {
        equity *= (1 + r);
        if (equity > peak) peak = equity;
        const dd = (peak - equity) / peak;
        if (dd > maxDD) maxDD = dd;
        if (r > 0) wins++;
      }
      
      const totalReturn = equity - 1;
      const years = n / 252;
      const cagr = years > 0 ? Math.pow(equity, 1 / years) - 1 : 0;
      
      // Sharpe (simplified, assuming 0 risk-free)
      const mean = returns.reduce((a, b) => a + b, 0) / n;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / n;
      const std = Math.sqrt(variance);
      const sharpe = std > 0 ? (mean * Math.sqrt(252)) / (std * Math.sqrt(252)) : 0;
      
      return {
        totalReturn,
        cagr,
        maxDrawdown: maxDD,
        sharpeRatio: sharpe,
        hitRate: n > 0 ? wins / n : 0,
        totalTrades: n,
        winRate: n > 0 ? wins / n : 0,
      };
    };
    
    const rawMetrics = calcMetrics(rawReturns);
    const filteredMetrics = calcMetrics(filteredReturns);
    const buyHoldMetrics = calcMetrics(buyHoldReturns);
    
    // Regime breakdown
    const regimePerformance: RegimePerformanceEntry[] = [];
    for (const [tag, perf] of regimePerf) {
      const policy = policyByRegime.get(tag);
      regimePerformance.push({
        regimeTag: tag,
        tradingDays: perf.days,
        rawReturn: perf.rawSum,
        filteredReturn: perf.filteredSum,
        constitutionPolicy: policy?.longFilterPolicy || 'UNKNOWN',
        blocked: perf.blocked,
      });
    }
    
    // Constitution impact
    const maxDDReduction = rawMetrics.maxDrawdown - filteredMetrics.maxDrawdown;
    const sharpeImprovement = filteredMetrics.sharpeRatio - rawMetrics.sharpeRatio;
    const hitRateChange = filteredMetrics.hitRate - rawMetrics.hitRate;
    const tradesFiltered = rawReturns.length - filteredReturns.filter(r => r !== 0).length;
    const valueAdded = filteredMetrics.cagr - rawMetrics.cagr;
    
    // Verdict
    let verdict: 'APPLY_RECOMMENDED' | 'CAUTION' | 'DO_NOT_APPLY' = 'CAUTION';
    const reasons: string[] = [];
    
    if (maxDDReduction >= GOVERNANCE_CONFIG.MIN_MAXDD_REDUCTION) {
      reasons.push(`MaxDD reduced by ${(maxDDReduction * 100).toFixed(1)}%`);
    }
    if (sharpeImprovement >= GOVERNANCE_CONFIG.MIN_SHARPE_IMPROVEMENT) {
      reasons.push(`Sharpe improved by ${sharpeImprovement.toFixed(2)}`);
    }
    if (valueAdded < GOVERNANCE_CONFIG.MAX_CAGR_DEGRADATION) {
      reasons.push(`WARNING: CAGR degraded by ${(Math.abs(valueAdded) * 100).toFixed(1)}%`);
      verdict = 'DO_NOT_APPLY';
    } else if (maxDDReduction >= GOVERNANCE_CONFIG.MIN_MAXDD_REDUCTION && sharpeImprovement > 0) {
      verdict = 'APPLY_RECOMMENDED';
    }
    
    return {
      period: `${config.startDate} to ${config.endDate}`,
      startDate: config.startDate,
      endDate: config.endDate,
      tradingDays,
      performance: {
        rawModel: rawMetrics,
        constitutionFiltered: filteredMetrics,
        buyHold: buyHoldMetrics,
      },
      regimePerformance,
      constitutionImpact: {
        maxDDReduction,
        sharpeImprovement,
        hitRateChange,
        tradesFiltered,
        valueAdded,
      },
      verdict,
      reasons,
    };
  }

  /**
   * Run full backtest across all standard periods
   */
  async runFullBacktest(preset: string = 'BALANCED'): Promise<{
    results: BacktestResult[];
    overallVerdict: 'APPLY_RECOMMENDED' | 'CAUTION' | 'DO_NOT_APPLY';
    summary: string[];
  }> {
    const results: BacktestResult[] = [];
    
    for (const period of GOVERNANCE_CONFIG.BACKTEST_PERIODS) {
      try {
        const result = await this.runBacktest({
          startDate: period.start,
          endDate: period.end,
          preset,
          benchmarks: ['RAW_MODEL', 'CONSTITUTION_FILTERED', 'BUY_HOLD'],
        });
        results.push({ ...result, period: period.name });
      } catch (err) {
        console.error(`[SPX Backtest] Error in period ${period.name}:`, err);
      }
    }
    
    const evaluation = evaluateBacktestForApply(results);
    
    return {
      results,
      overallVerdict: evaluation.recommendation,
      summary: evaluation.reasons,
    };
  }
}

export const spxRegimeService = new SpxRegimeService();
export default spxRegimeService;
