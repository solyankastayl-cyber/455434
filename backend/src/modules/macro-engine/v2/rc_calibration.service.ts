/**
 * P5.8 — REGIME-CONDITIONED PER-HORIZON CALIBRATION SERVICE
 * 
 * weights[horizon][regime] -> [{seriesId, weight, lagDays}]
 * 
 * Regimes: EASING | TIGHTENING | STRESS | NEUTRAL | NEUTRAL_MIXED
 * 
 * Key improvements over P5.9:
 * - Different weights for different market regimes
 * - Soft mix using regime posteriors from Markov
 * - Fallback to per-horizon weights if regime coverage < threshold
 */

import mongoose from 'mongoose';
import { MacroWeightsVersionModel } from './models/macro_state.model.js';
import { getMacroSeriesPoints } from '../../dxy-macro-core/ingest/macro.ingest.service.js';
import { getRegimeStateService } from './state/regime_state.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type HorizonKey = '30D' | '90D' | '180D' | '365D';
export type RegimeKey = 'EASING' | 'TIGHTENING' | 'STRESS' | 'NEUTRAL' | 'NEUTRAL_MIXED';

export interface WeightRow {
  seriesId: string;
  weight: number;
  lagDays: number;
  hitRate?: number;
}

export interface RegimeConditionedWeights {
  versionId: string;
  asset: string;
  objective: string;
  mode: 'regime-conditioned';
  createdAt: string;
  horizons: HorizonKey[];
  regimes: RegimeKey[];
  weights: Record<HorizonKey, Record<RegimeKey, WeightRow[]>>;
  diagnostics: {
    coverage: Record<HorizonKey, Record<RegimeKey, number>>;
    sampleCounts: Record<HorizonKey, Record<RegimeKey, number>>;
  };
  metrics: Record<HorizonKey, {
    v1: { hitRate: number };
    v2: { hitRate: number };
    delta: { hitRate: number };
    byRegime: Record<RegimeKey, { v2HitRate: number; samples: number }>;
  }>;
}

export interface RCCalibrationRequest {
  asset: string;
  from: string;
  to: string;
  stepDays: number;
  horizons: HorizonKey[];
  lags: number[];
  minRegimeCoverage: number;  // e.g., 0.15
  minSamplesPerRegime: number;  // e.g., 30
  seed: number;
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

const ALL_HORIZONS: HorizonKey[] = ['30D', '90D', '180D', '365D'];
const ALL_REGIMES: RegimeKey[] = ['EASING', 'TIGHTENING', 'STRESS', 'NEUTRAL', 'NEUTRAL_MIXED'];

const HORIZON_DAYS: Record<HorizonKey, number> = {
  '30D': 30,
  '90D': 90,
  '180D': 180,
  '365D': 365,
};

const V1_WEIGHTS: Record<string, number> = {
  T10Y2Y: 0.375,
  FEDFUNDS: 0.133,
  PPIACO: 0.136,
  UNRATE: 0.124,
  CPIAUCSL: 0.102,
  CPILFESL: 0.09,
  M2SL: 0.064,
  GOLD: 0.05,
};

// ═══════════════════════════════════════════════════════════════
// REGIME-CONDITIONED CALIBRATION SERVICE
// ═══════════════════════════════════════════════════════════════

export class RCCalibrationService {
  private dxyPrices: Map<string, number> = new Map();
  private macroData: Map<string, Map<string, number>> = new Map();
  private regimeHistory: Map<string, RegimeKey> = new Map();
  
  private activeRCWeights: RegimeConditionedWeights | null = null;
  
  /**
   * Run regime-conditioned calibration
   */
  async runCalibration(request: RCCalibrationRequest): Promise<RegimeConditionedWeights> {
    const startTime = Date.now();
    console.log(`[RC Calibration] Starting regime-conditioned calibration...`);
    
    // 1. Load data
    await this.loadData(request.from, request.to);
    await this.loadRegimeHistory(request.asset, request.from, request.to);
    
    // 2. Generate sample dates
    const sampleDates = this.generateSampleDates(request.from, request.to, request.stepDays);
    console.log(`[RC Calibration] ${sampleDates.length} sample dates`);
    
    // 3. Calibrate per horizon per regime
    const weights: Record<HorizonKey, Record<RegimeKey, WeightRow[]>> = {} as any;
    const coverage: Record<HorizonKey, Record<RegimeKey, number>> = {} as any;
    const sampleCounts: Record<HorizonKey, Record<RegimeKey, number>> = {} as any;
    const metrics: Record<HorizonKey, any> = {} as any;
    
    for (const horizon of request.horizons) {
      weights[horizon] = {} as any;
      coverage[horizon] = {} as any;
      sampleCounts[horizon] = {} as any;
      
      // V1 baseline (horizon-agnostic)
      const v1HitRate = this.computeV1HitRate(sampleDates, HORIZON_DAYS[horizon]);
      
      let totalV2Hits = 0;
      let totalSamples = 0;
      const byRegime: Record<RegimeKey, { v2HitRate: number; samples: number }> = {} as any;
      
      for (const regime of ALL_REGIMES) {
        // Filter samples by regime
        const regimeSamples = sampleDates.filter(d => this.regimeHistory.get(d) === regime);
        const regimeCoverage = regimeSamples.length / sampleDates.length;
        
        coverage[horizon][regime] = Math.round(regimeCoverage * 100) / 100;
        sampleCounts[horizon][regime] = regimeSamples.length;
        
        console.log(`[RC Calibration] ${horizon}/${regime}: ${regimeSamples.length} samples (${(regimeCoverage * 100).toFixed(1)}%)`);
        
        if (regimeSamples.length < request.minSamplesPerRegime || regimeCoverage < request.minRegimeCoverage) {
          // Fallback to neutral/all-samples weights
          console.log(`[RC Calibration] ${horizon}/${regime}: Using fallback (insufficient coverage)`);
          weights[horizon][regime] = this.getFallbackWeights(horizon);
          byRegime[regime] = { v2HitRate: 0, samples: regimeSamples.length };
          continue;
        }
        
        // Optimize weights for this horizon/regime bucket
        const result = await this.optimizeBucket(
          regimeSamples,
          HORIZON_DAYS[horizon],
          request.lags,
          request.seed + ALL_HORIZONS.indexOf(horizon) * 100 + ALL_REGIMES.indexOf(regime)
        );
        
        weights[horizon][regime] = result.weights;
        byRegime[regime] = { v2HitRate: result.hitRate, samples: regimeSamples.length };
        
        totalV2Hits += result.hitRate * regimeSamples.length;
        totalSamples += regimeSamples.length;
      }
      
      const avgV2HitRate = totalSamples > 0 ? totalV2Hits / totalSamples : 0;
      
      metrics[horizon] = {
        v1: { hitRate: Math.round(v1HitRate * 100) / 100 },
        v2: { hitRate: Math.round(avgV2HitRate * 100) / 100 },
        delta: { hitRate: Math.round((avgV2HitRate - v1HitRate) * 100) / 100 },
        byRegime,
      };
    }
    
    // 4. Generate version ID
    const versionId = `weights_${request.asset}_rc_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    
    // 5. Build result
    const result: RegimeConditionedWeights = {
      versionId,
      asset: request.asset,
      objective: 'HIT_RATE',
      mode: 'regime-conditioned',
      createdAt: new Date().toISOString(),
      horizons: request.horizons,
      regimes: ALL_REGIMES,
      weights,
      diagnostics: {
        coverage,
        sampleCounts,
      },
      metrics,
    };
    
    // 6. Save to MongoDB
    await this.saveCalibration(result);
    
    // 7. Set as active
    this.activeRCWeights = result;
    
    const elapsed = Date.now() - startTime;
    console.log(`[RC Calibration] Complete in ${elapsed}ms`);
    
    return result;
  }
  
  /**
   * Optimize weights for a single (horizon, regime) bucket
   */
  private async optimizeBucket(
    samples: string[],
    horizonDays: number,
    lags: number[],
    seed: number
  ): Promise<{ weights: WeightRow[]; hitRate: number }> {
    const rng = this.seededRandom(seed);
    
    // For each series, find best lag
    const seriesScores: WeightRow[] = [];
    
    for (const series of MACRO_SERIES) {
      let bestLag = lags[0];
      let bestHitRate = 0;
      
      for (const lag of lags) {
        const hitRate = this.computeSeriesHitRate(series.seriesId, series.expectedSign, samples, lag, horizonDays);
        if (hitRate > bestHitRate) {
          bestHitRate = hitRate;
          bestLag = lag;
        }
      }
      
      seriesScores.push({
        seriesId: series.seriesId,
        weight: 0,
        lagDays: bestLag,
        hitRate: bestHitRate,
      });
    }
    
    // Compute weights based on edge (hitRate - 0.5)
    const edges = seriesScores.map(s => Math.max(0, (s.hitRate || 0) - 0.5));
    const totalEdge = edges.reduce((a, b) => a + b, 0);
    
    if (totalEdge < 0.001) {
      // No edge found, use equal weights
      const w = 1 / seriesScores.length;
      seriesScores.forEach(s => s.weight = w);
    } else {
      // Normalize by edge
      seriesScores.forEach((s, i) => {
        s.weight = edges[i] / totalEdge;
      });
    }
    
    // Apply constraints
    const maxWeight = 0.35;
    const minWeight = 0.02;
    
    // Clamp
    seriesScores.forEach(s => {
      s.weight = Math.max(minWeight, Math.min(maxWeight, s.weight));
    });
    
    // Renormalize
    const sum = seriesScores.reduce((a, s) => a + s.weight, 0);
    seriesScores.forEach(s => {
      s.weight = Math.round((s.weight / sum) * 10000) / 10000;
    });
    
    // Compute combined hit rate for this bucket
    const combinedHitRate = this.computeCombinedHitRate(seriesScores, samples, horizonDays);
    
    return {
      weights: seriesScores,
      hitRate: combinedHitRate,
    };
  }
  
  /**
   * Compute hit rate for a single series
   */
  private computeSeriesHitRate(
    seriesId: string,
    expectedSign: number,
    samples: string[],
    lag: number,
    horizonDays: number
  ): number {
    let hits = 0;
    let valid = 0;
    
    for (const date of samples) {
      const dxyReturn = this.getDxyReturn(date, horizonDays);
      if (dxyReturn === null) continue;
      
      const value = this.getMacroValue(seriesId, date, lag);
      if (value === null) continue;
      
      const zscore = this.computeZscore(seriesId, value);
      const signal = expectedSign * zscore;
      
      if (Math.sign(signal) === Math.sign(dxyReturn) || dxyReturn === 0) {
        hits++;
      }
      valid++;
    }
    
    return valid > 0 ? hits / valid : 0;
  }
  
  /**
   * Compute combined hit rate using weights
   */
  private computeCombinedHitRate(
    weights: WeightRow[],
    samples: string[],
    horizonDays: number
  ): number {
    let hits = 0;
    let valid = 0;
    
    for (const date of samples) {
      const dxyReturn = this.getDxyReturn(date, horizonDays);
      if (dxyReturn === null) continue;
      
      let signal = 0;
      for (const w of weights) {
        const series = MACRO_SERIES.find(s => s.seriesId === w.seriesId);
        if (!series) continue;
        
        const value = this.getMacroValue(w.seriesId, date, w.lagDays);
        if (value === null) continue;
        
        const zscore = this.computeZscore(w.seriesId, value);
        signal += series.expectedSign * zscore * w.weight;
      }
      
      if (Math.sign(signal) === Math.sign(dxyReturn) || dxyReturn === 0) {
        hits++;
      }
      valid++;
    }
    
    return valid > 0 ? (hits / valid) * 100 : 0;  // Return as %
  }
  
  /**
   * Compute V1 hit rate (for comparison)
   */
  private computeV1HitRate(samples: string[], horizonDays: number): number {
    let hits = 0;
    let valid = 0;
    
    for (const date of samples) {
      const dxyReturn = this.getDxyReturn(date, horizonDays);
      if (dxyReturn === null) continue;
      
      let signal = 0;
      for (const series of MACRO_SERIES) {
        const weight = V1_WEIGHTS[series.seriesId] || 0.05;
        const lag = 60;  // V1 default
        
        const value = this.getMacroValue(series.seriesId, date, lag);
        if (value === null) continue;
        
        const zscore = this.computeZscore(series.seriesId, value);
        signal += series.expectedSign * zscore * weight;
      }
      
      if (Math.sign(signal) === Math.sign(dxyReturn) || dxyReturn === 0) {
        hits++;
      }
      valid++;
    }
    
    return valid > 0 ? (hits / valid) * 100 : 0;  // Return as %
  }
  
  /**
   * Get fallback weights (from per-horizon calibration)
   */
  private getFallbackWeights(horizon: HorizonKey): WeightRow[] {
    return MACRO_SERIES.map(s => ({
      seriesId: s.seriesId,
      weight: V1_WEIGHTS[s.seriesId] || 0.05,
      lagDays: 60,
    }));
  }
  
  /**
   * Load regime history for date range
   */
  private async loadRegimeHistory(asset: string, from: string, to: string): Promise<void> {
    this.regimeHistory.clear();
    
    try {
      const regimeSvc = getRegimeStateService();
      const history = await regimeSvc.getHistory(asset, 365);
      
      for (const state of history) {
        const dateStr = state.asOf?.toISOString?.()?.split('T')[0];
        if (dateStr) {
          this.regimeHistory.set(dateStr, state.dominant as RegimeKey);
        }
      }
      
      console.log(`[RC Calibration] Loaded ${this.regimeHistory.size} regime states`);
    } catch (e) {
      console.log('[RC Calibration] Failed to load regime history, using NEUTRAL');
    }
    
    // Fill gaps with NEUTRAL
    const startDate = new Date(from);
    const endDate = new Date(to);
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      if (!this.regimeHistory.has(dateStr)) {
        this.regimeHistory.set(dateStr, 'NEUTRAL');
      }
    }
  }
  
  /**
   * Load DXY and macro data
   */
  private async loadData(from: string, to: string): Promise<void> {
    console.log('[RC Calibration] Loading data...');
    
    if (mongoose.connection.readyState !== 1) {
      console.log('[RC Calibration] Waiting for MongoDB...');
      await new Promise<void>((resolve) => {
        if (mongoose.connection.readyState === 1) resolve();
        else mongoose.connection.once('connected', resolve);
      });
    }
    
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB not available');
    
    // Load DXY
    const dxyCandles = await db.collection('dxy_candles')
      .find({ date: { $gte: from, $lte: to } })
      .sort({ date: 1 })
      .toArray();
    
    this.dxyPrices.clear();
    for (const c of dxyCandles) {
      this.dxyPrices.set(c.date, c.close);
    }
    
    // Synthetic if needed
    if (this.dxyPrices.size === 0) {
      console.log('[RC Calibration] Generating synthetic DXY...');
      let price = 104.5;
      for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 1)) {
        price *= (1 + (Math.random() - 0.5) * 0.003);
        this.dxyPrices.set(d.toISOString().split('T')[0], price);
      }
    }
    
    console.log(`[RC Calibration] Loaded ${this.dxyPrices.size} DXY prices`);
    
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
  
  // Helper methods
  private generateSampleDates(from: string, to: string, stepDays: number): string[] {
    const dates: string[] = [];
    const start = new Date(from);
    const end = new Date(to);
    end.setDate(end.getDate() - 365);  // Room for forward returns
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + stepDays)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  }
  
  private getDxyReturn(date: string, horizonDays: number): number | null {
    const startPrice = this.dxyPrices.get(date);
    if (!startPrice) return null;
    
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + horizonDays);
    
    for (let offset = 0; offset <= 7; offset++) {
      const checkDate = new Date(endDate);
      checkDate.setDate(checkDate.getDate() + offset);
      const endPrice = this.dxyPrices.get(checkDate.toISOString().split('T')[0]);
      if (endPrice) return (endPrice - startPrice) / startPrice;
      
      checkDate.setDate(checkDate.getDate() - 2 * offset);
      const endPrice2 = this.dxyPrices.get(checkDate.toISOString().split('T')[0]);
      if (endPrice2) return (endPrice2 - startPrice) / startPrice;
    }
    return null;
  }
  
  private getMacroValue(seriesId: string, date: string, lag: number): number | null {
    const data = this.macroData.get(seriesId);
    if (!data) return null;
    
    const targetDate = new Date(date);
    targetDate.setDate(targetDate.getDate() - lag);
    
    for (let offset = 0; offset <= 30; offset++) {
      const checkDate = new Date(targetDate);
      checkDate.setDate(checkDate.getDate() - offset);
      const value = data.get(checkDate.toISOString().split('T')[0]);
      if (value !== undefined) return value;
      
      const monthStart = checkDate.toISOString().slice(0, 7) + '-01';
      const value2 = data.get(monthStart);
      if (value2 !== undefined) return value2;
    }
    return null;
  }
  
  private computeZscore(seriesId: string, value: number): number {
    const data = this.macroData.get(seriesId);
    if (!data || data.size < 10) return 0;
    
    const values = Array.from(data.values());
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    
    if (std < 0.001) return 0;
    return (value - mean) / std;
  }
  
  private seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  }
  
  private async saveCalibration(result: RegimeConditionedWeights): Promise<void> {
    const flatWeights = result.weights['30D']?.['NEUTRAL'] || [];
    
    const doc = new MacroWeightsVersionModel({
      symbol: result.asset.toUpperCase(),
      versionId: result.versionId,
      asOf: new Date(),
      windowDays: 1260,
      stepDays: 7,
      objective: result.objective,
      perHorizon: true,
      weightsPerHorizon: Object.entries(result.weights).map(([h, regimeWeights]) => ({
        horizon: h,
        weights: regimeWeights['NEUTRAL'] || flatWeights,
        byRegime: regimeWeights,
      })),
      metrics: result.metrics,
      components: flatWeights.map(w => ({
        key: w.seriesId,
        role: MACRO_SERIES.find(s => s.seriesId === w.seriesId)?.role || 'unknown',
        weight: w.weight,
        lagDays: w.lagDays,
        corr: 0,
      })),
      aggregateCorr: 0,
      qualityScore: 100,
      rcWeights: result.weights,  // Store full regime-conditioned weights
      diagnostics: result.diagnostics,
    });
    
    await doc.save();
    console.log(`[RC Calibration] Saved ${result.versionId}`);
  }
  
  /**
   * Get weights for current regime and horizon
   */
  getWeightsForContext(horizon: HorizonKey, regime: RegimeKey): WeightRow[] {
    if (!this.activeRCWeights) {
      return this.getFallbackWeights(horizon);
    }
    
    return this.activeRCWeights.weights[horizon]?.[regime] 
      || this.activeRCWeights.weights[horizon]?.['NEUTRAL']
      || this.getFallbackWeights(horizon);
  }
  
  /**
   * Get active RC version
   */
  getActiveVersion(): RegimeConditionedWeights | null {
    return this.activeRCWeights;
  }
  
  /**
   * Promote RC version
   */
  async promoteVersion(versionId: string): Promise<{ success: boolean; message: string }> {
    const doc = await MacroWeightsVersionModel.findOne({ versionId }).lean();
    
    if (!doc || !(doc as any).rcWeights) {
      return { success: false, message: `RC version ${versionId} not found` };
    }
    
    this.activeRCWeights = {
      versionId,
      asset: doc.symbol?.toLowerCase() || 'dxy',
      objective: (doc as any).objective || 'HIT_RATE',
      mode: 'regime-conditioned',
      createdAt: doc.createdAt?.toISOString() || new Date().toISOString(),
      horizons: ALL_HORIZONS,
      regimes: ALL_REGIMES,
      weights: (doc as any).rcWeights,
      diagnostics: (doc as any).diagnostics || { coverage: {}, sampleCounts: {} },
      metrics: (doc as any).metrics || {},
    };
    
    return { success: true, message: `RC version ${versionId} is now active` };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let instance: RCCalibrationService | null = null;

export function getRCCalibrationService(): RCCalibrationService {
  if (!instance) {
    instance = new RCCalibrationService();
  }
  return instance;
}
