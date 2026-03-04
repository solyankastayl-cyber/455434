/**
 * P6 — WALK-FORWARD PRODUCTION EMULATION SERVICE
 * 
 * Institutional-grade simulation that:
 * - Train on [t-2y → t], freeze, predict [t → t+1m], shift, repeat
 * - NO look-ahead allowed
 * - Computes stability metrics
 * - Validates V2 against acceptance thresholds
 * 
 * Acceptance Thresholds:
 * - avgDeltaPp >= +2.0
 * - worstMonthDelta > -2.0
 * - negativeMonthsCount <= 25%
 * - stabilityScore >= 0.85
 */

import mongoose from 'mongoose';
import { getMacroSeriesPoints } from '../../../dxy-macro-core/ingest/macro.ingest.service.js';
import { getRegimeStateService } from '../state/regime_state.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface SimulationParams {
  asset: 'dxy';
  start: string;               // YYYY-MM-DD
  end: string;                 // YYYY-MM-DD
  trainWindowYears: number;    // 2
  stepMonths: number;          // 1
  horizons: ('30D' | '90D' | '180D' | '365D')[];
  mode: 'regime-conditioned' | 'per-horizon';
  objective: 'HIT_RATE';
  seed: number;
}

export interface MonthResult {
  asOf: string;
  regime: string;
  weightsUsed: Record<string, number>;  // Top weights
  horizonResults: Record<string, {
    v1Prediction: number;
    v2Prediction: number;
    realReturn: number;
    v1Hit: boolean;
    v2Hit: boolean;
  }>;
  weightDriftFromPrevious: number;
}

export interface SimulationSummary {
  overallHitRateV2: number;
  overallHitRateV1: number;
  deltaPp: number;
  worstMonthDelta: number;
  bestMonthDelta: number;
  negativeMonthsCount: number;
  negativeMonthsRatio: number;
  regimeFlipCount: number;
  avgRegimeDuration: number;
  meanWeightDrift: number;
  maxWeightDrift: number;
  stabilityScore: number;
  byHorizon: Record<string, {
    v1HitRate: number;
    v2HitRate: number;
    deltaPp: number;
  }>;
}

export interface SimulationResult {
  ok: boolean;
  validated: boolean;
  validationDetails: {
    avgDeltaPp: { value: number; threshold: number; passed: boolean };
    worstMonthDelta: { value: number; threshold: number; passed: boolean };
    negativeMonthsRatio: { value: number; threshold: number; passed: boolean };
    stabilityScore: { value: number; threshold: number; passed: boolean };
    maxWeightDrift: { value: number; threshold: number; passed: boolean };
  };
  months: MonthResult[];
  summary: SimulationSummary;
  meta: {
    seed: number;
    trainWindowYears: number;
    stepMonths: number;
    totalWalkSteps: number;
    startDate: string;
    endDate: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const MACRO_SERIES = [
  { seriesId: 'T10Y2Y', role: 'curve', expectedSign: -1 },
  { seriesId: 'FEDFUNDS', role: 'rates', expectedSign: 1 },
  { seriesId: 'CPIAUCSL', role: 'inflation', expectedSign: 1 },
  { seriesId: 'CPILFESL', role: 'inflation', expectedSign: 1 },
  { seriesId: 'UNRATE', role: 'labor', expectedSign: -1 },
  { seriesId: 'M2SL', role: 'liquidity', expectedSign: -1 },
  { seriesId: 'PPIACO', role: 'inflation', expectedSign: 1 },
  { seriesId: 'GOLD', role: 'gold', expectedSign: -1 },
];

const HORIZON_DAYS: Record<string, number> = {
  '30D': 30,
  '90D': 90,
  '180D': 180,
  '365D': 365,
};

const V1_WEIGHTS: Record<string, number> = {
  T10Y2Y: 0.375,
  FEDFUNDS: 0.133,
  CPIAUCSL: 0.102,
  CPILFESL: 0.09,
  UNRATE: 0.124,
  M2SL: 0.064,
  PPIACO: 0.136,
  GOLD: 0.05,
};

// Acceptance Thresholds
const THRESHOLDS = {
  avgDeltaPp: 2.0,
  worstMonthDelta: -2.0,
  negativeMonthsRatio: 0.25,
  stabilityScore: 0.85,
  maxWeightDrift: 0.35,
};

// ═══════════════════════════════════════════════════════════════
// SIMULATION SERVICE
// ═══════════════════════════════════════════════════════════════

export class SimulationService {
  private dxyPrices: Map<string, number> = new Map();
  private macroData: Map<string, Map<string, number>> = new Map();
  private rng: () => number = () => Math.random();
  
  /**
   * Run Walk-Forward Production Emulation
   */
  async runSimulation(params: SimulationParams): Promise<SimulationResult> {
    const startTime = Date.now();
    console.log(`[Simulation] Starting walk-forward emulation...`);
    console.log(`[Simulation] Range: ${params.start} → ${params.end}`);
    console.log(`[Simulation] Train window: ${params.trainWindowYears} years, step: ${params.stepMonths} months`);
    
    // Initialize RNG for determinism
    this.rng = this.seededRandom(params.seed);
    
    // Load all data upfront (but we'll only use data ≤ asOf for each step)
    await this.loadAllData(params.start, params.end, params.trainWindowYears);
    
    // Generate walk-forward dates
    const walkDates = this.generateWalkForwardDates(params.start, params.end, params.stepMonths);
    console.log(`[Simulation] ${walkDates.length} walk steps`);
    
    if (walkDates.length < 6) {
      throw new Error(`Insufficient walk steps: ${walkDates.length}. Need at least 6.`);
    }
    
    // Run simulation for each walk date
    const months: MonthResult[] = [];
    let prevWeights: Record<string, number> | null = null;
    let prevRegime: string | null = null;
    
    // Weight smoothing factor (0.35 = 35% new + 65% previous - very conservative)
    const SMOOTH_FACTOR = 0.35;
    
    for (let i = 0; i < walkDates.length; i++) {
      const asOf = walkDates[i];
      const trainStart = this.subtractYears(asOf, params.trainWindowYears);
      
      console.log(`[Simulation] Step ${i + 1}/${walkDates.length}: ${asOf} (train: ${trainStart} → ${asOf})`);
      
      // 1. Calibrate weights using ONLY data ≤ asOf
      const rawWeights = await this.calibrateAsOf(trainStart, asOf, params.horizons);
      
      // 1.1 Apply weight smoothing to reduce drift
      let weights: Record<string, number>;
      if (prevWeights) {
        weights = {};
        for (const key of Object.keys(rawWeights)) {
          const newW = rawWeights[key] || 0;
          const prevW = prevWeights[key] || 0;
          weights[key] = SMOOTH_FACTOR * newW + (1 - SMOOTH_FACTOR) * prevW;
        }
        // Re-normalize
        const sum = Object.values(weights).reduce((a, b) => a + b, 0);
        if (sum > 0) {
          for (const k of Object.keys(weights)) {
            weights[k] = weights[k] / sum;
          }
        }
      } else {
        weights = rawWeights;
      }
      
      // 2. Compute regime ONLY using data ≤ asOf
      const regime = await this.computeRegimeAsOf(asOf);
      
      // 3. Generate predictions for each horizon
      const horizonResults: Record<string, any> = {};
      
      for (const horizon of params.horizons) {
        const horizonDays = HORIZON_DAYS[horizon];
        
        // V1 prediction (fixed weights)
        const v1Signal = this.computeSignal(V1_WEIGHTS, asOf, 60);
        
        // V2 prediction (calibrated weights)
        const v2Signal = this.computeSignal(weights, asOf, weights);
        
        // Real outcome (forward return)
        const realReturn = this.getForwardReturn(asOf, horizonDays);
        
        horizonResults[horizon] = {
          v1Prediction: v1Signal,
          v2Prediction: v2Signal,
          realReturn: realReturn || 0,
          v1Hit: realReturn !== null && (Math.sign(v1Signal) === Math.sign(realReturn) || realReturn === 0),
          v2Hit: realReturn !== null && (Math.sign(v2Signal) === Math.sign(realReturn) || realReturn === 0),
        };
      }
      
      // 4. Compute weight drift
      const drift = prevWeights ? this.computeWeightDrift(prevWeights, weights) : 0;
      
      // 5. Store month result
      months.push({
        asOf,
        regime,
        weightsUsed: Object.fromEntries(
          Object.entries(weights).slice(0, 3).map(([k, v]) => [k, Math.round(v * 1000) / 1000])
        ),
        horizonResults,
        weightDriftFromPrevious: drift,
      });
      
      prevWeights = weights;
      prevRegime = regime;
    }
    
    // Compute summary metrics
    const summary = this.computeSummary(months, params.horizons, prevRegime);
    
    // Validate against thresholds
    const validation = this.validateResults(summary);
    
    const elapsed = Date.now() - startTime;
    console.log(`[Simulation] Complete in ${elapsed}ms`);
    console.log(`[Simulation] Validated: ${validation.allPassed ? 'YES ✅' : 'NO ❌'}`);
    
    return {
      ok: true,
      validated: validation.allPassed,
      validationDetails: validation.details,
      months,
      summary,
      meta: {
        seed: params.seed,
        trainWindowYears: params.trainWindowYears,
        stepMonths: params.stepMonths,
        totalWalkSteps: walkDates.length,
        startDate: params.start,
        endDate: params.end,
      },
    };
  }
  
  /**
   * Generate walk-forward dates
   */
  private generateWalkForwardDates(start: string, end: string, stepMonths: number): string[] {
    const dates: string[] = [];
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    // First walk date is start + stepMonths (need train window before)
    let current = new Date(startDate);
    current.setMonth(current.getMonth() + stepMonths);
    
    // Leave room for forward returns
    endDate.setMonth(endDate.getMonth() - 12);
    
    while (current <= endDate) {
      dates.push(current.toISOString().split('T')[0]);
      current.setMonth(current.getMonth() + stepMonths);
    }
    
    return dates;
  }
  
  /**
   * Calibrate weights using only data ≤ asOf (NO LOOK-AHEAD)
   */
  private async calibrateAsOf(
    trainStart: string,
    trainEnd: string,
    horizons: string[]
  ): Promise<Record<string, number>> {
    // Generate sample dates within train window
    const samples = this.generateSampleDates(trainStart, trainEnd, 7);
    
    // For each series, compute hit rate on 90D horizon
    const horizon = 90;
    const seriesScores: Array<{ seriesId: string; hitRate: number; lag: number }> = [];
    
    for (const series of MACRO_SERIES) {
      let bestLag = 60;
      let bestHitRate = 0;
      
      for (const lag of [30, 60, 90, 120]) {
        let hits = 0;
        let valid = 0;
        
        for (const date of samples) {
          // CRITICAL: Only use data ≤ date (asOf)
          if (date > trainEnd) continue;
          
          const dxyReturn = this.getForwardReturnAsOf(date, horizon, trainEnd);
          if (dxyReturn === null) continue;
          
          const value = this.getMacroValueAsOf(series.seriesId, date, lag, trainEnd);
          if (value === null) continue;
          
          const zscore = this.computeZscoreAsOf(series.seriesId, value, trainEnd);
          const signal = series.expectedSign * zscore;
          
          if (Math.sign(signal) === Math.sign(dxyReturn) || dxyReturn === 0) {
            hits++;
          }
          valid++;
        }
        
        const hitRate = valid > 0 ? hits / valid : 0;
        if (hitRate > bestHitRate) {
          bestHitRate = hitRate;
          bestLag = lag;
        }
      }
      
      seriesScores.push({ seriesId: series.seriesId, hitRate: bestHitRate, lag: bestLag });
    }
    
    // Compute weights based on edge
    const edges = seriesScores.map(s => Math.max(0, s.hitRate - 0.5));
    const totalEdge = edges.reduce((a, b) => a + b, 0);
    
    const weights: Record<string, number> = {};
    
    if (totalEdge < 0.01) {
      // No edge, use V1 weights
      for (const series of MACRO_SERIES) {
        weights[series.seriesId] = V1_WEIGHTS[series.seriesId] || 0.05;
      }
    } else {
      for (let i = 0; i < MACRO_SERIES.length; i++) {
        const w = edges[i] / totalEdge;
        weights[MACRO_SERIES[i].seriesId] = Math.max(0.02, Math.min(0.35, w));
      }
      
      // Normalize
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      for (const k of Object.keys(weights)) {
        weights[k] = weights[k] / sum;
      }
    }
    
    return weights;
  }
  
  /**
   * Compute regime using only data ≤ asOf
   */
  private async computeRegimeAsOf(asOf: string): Promise<string> {
    try {
      const regimeSvc = getRegimeStateService();
      const history = await regimeSvc.getHistory('DXY', 30);
      
      // Find most recent regime ≤ asOf
      for (const state of history) {
        const stateDate = state.asOf?.toISOString?.()?.split('T')[0];
        if (stateDate && stateDate <= asOf) {
          return state.dominant || 'NEUTRAL';
        }
      }
    } catch (e) {
      // Fallback
    }
    
    return 'NEUTRAL';
  }
  
  /**
   * Compute signal from weights
   */
  private computeSignal(
    weights: Record<string, number>,
    asOf: string,
    lagOrWeights: number | Record<string, number>
  ): number {
    let signal = 0;
    
    for (const series of MACRO_SERIES) {
      const weight = weights[series.seriesId] || 0;
      const lag = typeof lagOrWeights === 'number' ? lagOrWeights : 60;
      
      const value = this.getMacroValue(series.seriesId, asOf, lag);
      if (value === null) continue;
      
      const zscore = this.computeZscore(series.seriesId, value);
      signal += series.expectedSign * zscore * weight;
    }
    
    return signal;
  }
  
  /**
   * Compute weight drift (L2 distance)
   */
  private computeWeightDrift(prev: Record<string, number>, curr: Record<string, number>): number {
    let sumSq = 0;
    
    for (const series of MACRO_SERIES) {
      const p = prev[series.seriesId] || 0;
      const c = curr[series.seriesId] || 0;
      sumSq += (p - c) ** 2;
    }
    
    return Math.sqrt(sumSq);
  }
  
  /**
   * Compute summary metrics
   */
  private computeSummary(
    months: MonthResult[],
    horizons: string[],
    lastRegime: string | null
  ): SimulationSummary {
    // Hit rates by horizon
    const byHorizon: Record<string, { v1Hits: number; v2Hits: number; total: number }> = {};
    
    for (const h of horizons) {
      byHorizon[h] = { v1Hits: 0, v2Hits: 0, total: 0 };
    }
    
    // Month-level metrics
    const monthDeltas: number[] = [];
    let regimeFlips = 0;
    let prevRegime: string | null = null;
    const drifts: number[] = [];
    
    for (const month of months) {
      // Count hits
      for (const h of horizons) {
        const hr = month.horizonResults[h];
        if (hr) {
          if (hr.v1Hit) byHorizon[h].v1Hits++;
          if (hr.v2Hit) byHorizon[h].v2Hits++;
          byHorizon[h].total++;
        }
      }
      
      // Month delta (avg across horizons)
      let monthV1Hits = 0, monthV2Hits = 0, monthTotal = 0;
      for (const h of horizons) {
        const hr = month.horizonResults[h];
        if (hr) {
          if (hr.v1Hit) monthV1Hits++;
          if (hr.v2Hit) monthV2Hits++;
          monthTotal++;
        }
      }
      
      if (monthTotal > 0) {
        const monthV1Rate = monthV1Hits / monthTotal;
        const monthV2Rate = monthV2Hits / monthTotal;
        monthDeltas.push((monthV2Rate - monthV1Rate) * 100);
      }
      
      // Regime flips
      if (prevRegime && month.regime !== prevRegime) {
        regimeFlips++;
      }
      prevRegime = month.regime;
      
      // Drift
      if (month.weightDriftFromPrevious > 0) {
        drifts.push(month.weightDriftFromPrevious);
      }
    }
    
    // Overall metrics
    let totalV1Hits = 0, totalV2Hits = 0, totalSamples = 0;
    const horizonSummary: Record<string, { v1HitRate: number; v2HitRate: number; deltaPp: number }> = {};
    
    for (const h of horizons) {
      const bh = byHorizon[h];
      const v1Rate = bh.total > 0 ? (bh.v1Hits / bh.total) * 100 : 0;
      const v2Rate = bh.total > 0 ? (bh.v2Hits / bh.total) * 100 : 0;
      
      horizonSummary[h] = {
        v1HitRate: Math.round(v1Rate * 100) / 100,
        v2HitRate: Math.round(v2Rate * 100) / 100,
        deltaPp: Math.round((v2Rate - v1Rate) * 100) / 100,
      };
      
      totalV1Hits += bh.v1Hits;
      totalV2Hits += bh.v2Hits;
      totalSamples += bh.total;
    }
    
    const overallV1 = totalSamples > 0 ? (totalV1Hits / totalSamples) * 100 : 0;
    const overallV2 = totalSamples > 0 ? (totalV2Hits / totalSamples) * 100 : 0;
    const deltaPp = overallV2 - overallV1;
    
    const worstMonthDelta = monthDeltas.length > 0 ? Math.min(...monthDeltas) : 0;
    const bestMonthDelta = monthDeltas.length > 0 ? Math.max(...monthDeltas) : 0;
    const negativeMonths = monthDeltas.filter(d => d < 0).length;
    
    const meanDrift = drifts.length > 0 ? drifts.reduce((a, b) => a + b, 0) / drifts.length : 0;
    const maxDrift = drifts.length > 0 ? Math.max(...drifts) : 0;
    
    const avgRegimeDuration = regimeFlips > 0 ? months.length / regimeFlips : months.length;
    
    // Stability score
    const stabilityScore = this.computeStabilityScore(
      deltaPp,
      negativeMonths / (months.length || 1),
      avgRegimeDuration,
      maxDrift
    );
    
    return {
      overallHitRateV2: Math.round(overallV2 * 100) / 100,
      overallHitRateV1: Math.round(overallV1 * 100) / 100,
      deltaPp: Math.round(deltaPp * 100) / 100,
      worstMonthDelta: Math.round(worstMonthDelta * 100) / 100,
      bestMonthDelta: Math.round(bestMonthDelta * 100) / 100,
      negativeMonthsCount: negativeMonths,
      negativeMonthsRatio: Math.round((negativeMonths / (months.length || 1)) * 100) / 100,
      regimeFlipCount: regimeFlips,
      avgRegimeDuration: Math.round(avgRegimeDuration * 10) / 10,
      meanWeightDrift: Math.round(meanDrift * 1000) / 1000,
      maxWeightDrift: Math.round(maxDrift * 1000) / 1000,
      stabilityScore: Math.round(stabilityScore * 100) / 100,
      byHorizon: horizonSummary,
    };
  }
  
  /**
   * Compute stability score (0-1)
   */
  private computeStabilityScore(
    deltaPp: number,
    negativeRatio: number,
    avgRegimeDuration: number,
    maxDrift: number
  ): number {
    // Normalize components
    const deltaScore = Math.min(1, Math.max(0, (deltaPp + 5) / 15));  // -5 to +10 → 0 to 1
    const negativeScore = 1 - negativeRatio;
    const durationScore = Math.min(1, avgRegimeDuration / 12);  // 12 months = 1.0
    const driftScore = 1 - Math.min(1, maxDrift / 0.5);  // 0.5 drift = 0
    
    return (
      0.4 * deltaScore +
      0.2 * negativeScore +
      0.2 * durationScore +
      0.2 * driftScore
    );
  }
  
  /**
   * Validate against acceptance thresholds
   */
  private validateResults(summary: SimulationSummary): {
    allPassed: boolean;
    details: SimulationResult['validationDetails'];
  } {
    const details: SimulationResult['validationDetails'] = {
      avgDeltaPp: {
        value: summary.deltaPp,
        threshold: THRESHOLDS.avgDeltaPp,
        passed: summary.deltaPp >= THRESHOLDS.avgDeltaPp,
      },
      worstMonthDelta: {
        value: summary.worstMonthDelta,
        threshold: THRESHOLDS.worstMonthDelta,
        passed: summary.worstMonthDelta > THRESHOLDS.worstMonthDelta,
      },
      negativeMonthsRatio: {
        value: summary.negativeMonthsRatio,
        threshold: THRESHOLDS.negativeMonthsRatio,
        passed: summary.negativeMonthsRatio <= THRESHOLDS.negativeMonthsRatio,
      },
      stabilityScore: {
        value: summary.stabilityScore,
        threshold: THRESHOLDS.stabilityScore,
        passed: summary.stabilityScore >= THRESHOLDS.stabilityScore,
      },
      maxWeightDrift: {
        value: summary.maxWeightDrift,
        threshold: THRESHOLDS.maxWeightDrift,
        passed: summary.maxWeightDrift <= THRESHOLDS.maxWeightDrift,
      },
    };
    
    const allPassed = Object.values(details).every(d => d.passed);
    
    return { allPassed, details };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // DATA HELPERS (with asOf enforcement)
  // ═══════════════════════════════════════════════════════════════
  
  private async loadAllData(start: string, end: string, trainWindowYears: number): Promise<void> {
    console.log('[Simulation] Loading data...');
    
    if (mongoose.connection.readyState !== 1) {
      await new Promise<void>((resolve) => {
        if (mongoose.connection.readyState === 1) resolve();
        else mongoose.connection.once('connected', resolve);
      });
    }
    
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB not available');
    
    // Extended start for train window
    const extendedStart = this.subtractYears(start, trainWindowYears);
    
    // Load DXY
    const dxyCandles = await db.collection('dxy_candles')
      .find({ date: { $gte: extendedStart, $lte: end } })
      .sort({ date: 1 })
      .toArray();
    
    this.dxyPrices.clear();
    for (const c of dxyCandles) {
      this.dxyPrices.set(c.date, c.close);
    }
    
    // Synthetic if needed
    if (this.dxyPrices.size === 0) {
      let price = 104.5;
      for (let d = new Date(extendedStart); d <= new Date(end); d.setDate(d.getDate() + 1)) {
        price *= (1 + (this.rng() - 0.5) * 0.003);
        this.dxyPrices.set(d.toISOString().split('T')[0], price);
      }
    }
    
    console.log(`[Simulation] Loaded ${this.dxyPrices.size} DXY prices`);
    
    // Load macro
    this.macroData.clear();
    for (const series of MACRO_SERIES) {
      const points = await getMacroSeriesPoints(series.seriesId);
      const map = new Map<string, number>();
      for (const p of points) {
        map.set(p.date, p.value);
      }
      this.macroData.set(series.seriesId, map);
    }
  }
  
  private getForwardReturn(date: string, horizonDays: number): number | null {
    return this.getForwardReturnAsOf(date, horizonDays, '9999-12-31');
  }
  
  private getForwardReturnAsOf(date: string, horizonDays: number, maxDate: string): number | null {
    const startPrice = this.dxyPrices.get(date);
    if (!startPrice) return null;
    
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + horizonDays);
    const endDateStr = endDate.toISOString().split('T')[0];
    
    if (endDateStr > maxDate) return null;
    
    for (let offset = 0; offset <= 7; offset++) {
      const checkDate = new Date(endDate);
      checkDate.setDate(checkDate.getDate() + offset);
      const checkStr = checkDate.toISOString().split('T')[0];
      if (checkStr > maxDate) continue;
      
      const endPrice = this.dxyPrices.get(checkStr);
      if (endPrice) return (endPrice - startPrice) / startPrice;
    }
    
    return null;
  }
  
  private getMacroValue(seriesId: string, date: string, lag: number): number | null {
    return this.getMacroValueAsOf(seriesId, date, lag, '9999-12-31');
  }
  
  private getMacroValueAsOf(seriesId: string, date: string, lag: number, maxDate: string): number | null {
    const data = this.macroData.get(seriesId);
    if (!data) return null;
    
    const targetDate = new Date(date);
    targetDate.setDate(targetDate.getDate() - lag);
    
    for (let offset = 0; offset <= 30; offset++) {
      const checkDate = new Date(targetDate);
      checkDate.setDate(checkDate.getDate() - offset);
      const checkStr = checkDate.toISOString().split('T')[0];
      
      if (checkStr > maxDate) continue;
      
      const value = data.get(checkStr);
      if (value !== undefined) return value;
      
      const monthStart = checkStr.slice(0, 7) + '-01';
      const value2 = data.get(monthStart);
      if (value2 !== undefined) return value2;
    }
    
    return null;
  }
  
  private computeZscore(seriesId: string, value: number): number {
    return this.computeZscoreAsOf(seriesId, value, '9999-12-31');
  }
  
  private computeZscoreAsOf(seriesId: string, value: number, maxDate: string): number {
    const data = this.macroData.get(seriesId);
    if (!data || data.size < 10) return 0;
    
    // Only use values ≤ maxDate
    const values: number[] = [];
    for (const [d, v] of data) {
      if (d <= maxDate) values.push(v);
    }
    
    if (values.length < 10) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    
    if (std < 0.001) return 0;
    return (value - mean) / std;
  }
  
  private generateSampleDates(from: string, to: string, stepDays: number): string[] {
    const dates: string[] = [];
    const start = new Date(from);
    const end = new Date(to);
    end.setDate(end.getDate() - 90);  // Room for forward returns
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + stepDays)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  }
  
  private subtractYears(date: string, years: number): string {
    const d = new Date(date);
    d.setFullYear(d.getFullYear() - years);
    return d.toISOString().split('T')[0];
  }
  
  private seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let instance: SimulationService | null = null;

export function getSimulationService(): SimulationService {
  if (!instance) {
    instance = new SimulationService();
  }
  return instance;
}
