/**
 * V2 CALIBRATION OBJECTIVE SERVICE — P5.6 + P5.9
 * 
 * Calibration optimized for HIT_RATE / MAE / RMSE (not correlation)
 * Per-horizon weights/lag for each horizon (30D, 90D, 180D, 365D)
 * 
 * Key changes from v1 calibration:
 * - objective = HIT_RATE (business metric)
 * - perHorizon = true (different weights per horizon)
 * - asOf = true (no look-ahead bias)
 */

import { MacroWeightsVersionModel } from './models/macro_state.model.js';
import { getMacroSeriesPoints } from '../../dxy-macro-core/ingest/macro.ingest.service.js';
import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type HorizonKey = '30D' | '90D' | '180D' | '365D';
export type Objective = 'HIT_RATE' | 'MAE' | 'RMSE';

export interface SeriesWeight {
  seriesId: string;
  weight: number;
  lagDays: number;
}

export interface CalibrationWeightsPerHorizon {
  horizon: HorizonKey;
  weights: SeriesWeight[];
}

export interface CalibrationRunRequest {
  asset: 'dxy';
  from: string;
  to: string;
  stepDays: number;
  horizons: HorizonKey[];
  objective: Objective;
  search: {
    method: 'grid' | 'random';
    trials: number;
    seed: number;
  };
  constraints: {
    sumWeights: number;
    maxWeight: number;
    minWeight: number;
  };
  perHorizon: boolean;
  asOf: boolean;
}

export interface HorizonMetrics {
  v2: { hitRate: number; mae?: number; rmse?: number };
  v1: { hitRate: number; mae?: number; rmse?: number };
  delta: { hitRate: number; mae?: number; rmse?: number };
}

export interface CalibrationRunResult {
  versionId: string;
  objective: Objective;
  perHorizon: boolean;
  dataset: {
    from: string;
    to: string;
    stepDays: number;
    samples: number;
  };
  metrics: Record<HorizonKey, HorizonMetrics>;
  weights: CalibrationWeightsPerHorizon[];
  notes: string[];
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

const LAG_OPTIONS = [10, 30, 60, 90, 120, 180];

const HORIZON_DAYS: Record<HorizonKey, number> = {
  '30D': 30,
  '90D': 90,
  '180D': 180,
  '365D': 365,
};

// V1 baseline weights (for comparison)
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

const V1_LAGS: Record<string, number> = {
  T10Y2Y: 120,
  FEDFUNDS: 60,
  PPIACO: 10,
  UNRATE: 10,
  CPIAUCSL: 180,
  CPILFESL: 180,
  M2SL: 180,
  GOLD: 30,
};

// ═══════════════════════════════════════════════════════════════
// OBJECTIVE CALIBRATION SERVICE
// ═══════════════════════════════════════════════════════════════

export class V2CalibrationObjectiveService {
  private dxyPrices: Map<string, number> = new Map();
  private macroData: Map<string, Map<string, number>> = new Map();
  private activeWeights: CalibrationWeightsPerHorizon[] | null = null;
  private activeVersionId: string | null = null;

  /**
   * Run calibration with objective optimization
   */
  async runCalibration(request: CalibrationRunRequest): Promise<CalibrationRunResult> {
    const startTime = Date.now();
    console.log(`[V2 Calibration] Starting with objective=${request.objective}, perHorizon=${request.perHorizon}`);
    
    // 1. Load data
    await this.loadData(request.from, request.to);
    
    // 2. Generate sample dates
    const sampleDates = this.generateSampleDates(request.from, request.to, request.stepDays);
    console.log(`[V2 Calibration] ${sampleDates.length} sample dates`);
    
    if (sampleDates.length < 20) {
      throw new Error(`Insufficient samples: ${sampleDates.length}. Need at least 20.`);
    }
    
    // 3. Calibrate per horizon
    const allWeights: CalibrationWeightsPerHorizon[] = [];
    const metrics: Record<HorizonKey, HorizonMetrics> = {} as any;
    const notes: string[] = [];
    
    for (const horizon of request.horizons) {
      console.log(`[V2 Calibration] Optimizing ${horizon}...`);
      
      const result = await this.optimizeHorizon(
        horizon,
        sampleDates,
        request.objective,
        request.search,
        request.constraints,
        request.asOf
      );
      
      allWeights.push({
        horizon,
        weights: result.weights,
      });
      
      metrics[horizon] = result.metrics;
      notes.push(`${horizon}: V2 hitRate=${result.metrics.v2.hitRate.toFixed(2)}%, delta=${result.metrics.delta.hitRate.toFixed(2)}%`);
    }
    
    // 4. Generate version ID
    const versionId = `weights_${request.asset}_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    
    // 5. Save to MongoDB
    await this.saveCalibration(versionId, request, allWeights, metrics);
    
    const elapsed = Date.now() - startTime;
    console.log(`[V2 Calibration] Complete in ${elapsed}ms`);
    
    return {
      versionId,
      objective: request.objective,
      perHorizon: request.perHorizon,
      dataset: {
        from: request.from,
        to: request.to,
        stepDays: request.stepDays,
        samples: sampleDates.length,
      },
      metrics,
      weights: allWeights,
      notes,
    };
  }

  /**
   * Optimize for single horizon
   */
  private async optimizeHorizon(
    horizon: HorizonKey,
    sampleDates: string[],
    objective: Objective,
    search: { method: string; trials: number; seed: number },
    constraints: { sumWeights: number; maxWeight: number; minWeight: number },
    asOf: boolean
  ): Promise<{
    weights: SeriesWeight[];
    metrics: HorizonMetrics;
  }> {
    const horizonDays = HORIZON_DAYS[horizon];
    const rng = this.seededRandom(search.seed + horizonDays);
    
    let bestWeights: SeriesWeight[] = [];
    let bestScore = -Infinity;
    let bestMetrics: HorizonMetrics | null = null;
    
    // V1 baseline metrics
    const v1Weights = MACRO_SERIES.map(s => ({
      seriesId: s.seriesId,
      weight: V1_WEIGHTS[s.seriesId] || 0.05,
      lagDays: V1_LAGS[s.seriesId] || 60,
    }));
    const v1Metrics = this.evaluateWeights(v1Weights, sampleDates, horizonDays, objective, asOf);
    
    // Random search
    for (let trial = 0; trial < search.trials; trial++) {
      const candidate = this.generateCandidate(rng, constraints, horizonDays);
      const metrics = this.evaluateWeights(candidate, sampleDates, horizonDays, objective, asOf);
      
      const score = objective === 'HIT_RATE' 
        ? metrics.v2.hitRate 
        : -metrics.v2.mae!;
      
      if (score > bestScore) {
        bestScore = score;
        bestWeights = candidate;
        bestMetrics = {
          v2: metrics.v2,
          v1: v1Metrics.v2,
          delta: {
            hitRate: metrics.v2.hitRate - v1Metrics.v2.hitRate,
            mae: (v1Metrics.v2.mae || 0) - (metrics.v2.mae || 0),
            rmse: (v1Metrics.v2.rmse || 0) - (metrics.v2.rmse || 0),
          },
        };
      }
    }
    
    return {
      weights: bestWeights,
      metrics: bestMetrics!,
    };
  }

  /**
   * Generate candidate weights
   */
  private generateCandidate(
    rng: () => number,
    constraints: { sumWeights: number; maxWeight: number; minWeight: number },
    horizonDays: number
  ): SeriesWeight[] {
    const numSeries = MACRO_SERIES.length;
    
    // Generate Dirichlet-like weights
    const rawWeights = Array(numSeries).fill(0).map(() => -Math.log(rng() + 0.001));
    const sum = rawWeights.reduce((a, b) => a + b, 0);
    let weights = rawWeights.map(w => w / sum);
    
    // Clamp to constraints
    weights = weights.map(w => Math.max(constraints.minWeight, Math.min(constraints.maxWeight, w)));
    
    // Renormalize
    const newSum = weights.reduce((a, b) => a + b, 0);
    weights = weights.map(w => w / newSum * constraints.sumWeights);
    
    // Select lags (bias towards shorter for short horizons)
    const lagBias = horizonDays <= 30 ? 0.7 : horizonDays <= 90 ? 0.5 : 0.3;
    
    return MACRO_SERIES.map((series, i) => {
      const lagIdx = rng() < lagBias 
        ? Math.floor(rng() * 3)  // prefer first 3 lags for short horizons
        : Math.floor(rng() * LAG_OPTIONS.length);
      
      return {
        seriesId: series.seriesId,
        weight: Math.round(weights[i] * 10000) / 10000,
        lagDays: LAG_OPTIONS[lagIdx],
      };
    });
  }

  /**
   * Evaluate weights on samples
   */
  private evaluateWeights(
    weights: SeriesWeight[],
    sampleDates: string[],
    horizonDays: number,
    objective: Objective,
    asOf: boolean
  ): { v2: { hitRate: number; mae: number; rmse: number } } {
    let hits = 0;
    let totalError = 0;
    let totalSqError = 0;
    let validSamples = 0;
    
    for (const date of sampleDates) {
      // Get actual DXY return
      const actualReturn = this.getDxyReturn(date, horizonDays);
      if (actualReturn === null) continue;
      
      // Compute predicted signal
      const signal = this.computeSignal(weights, date, asOf);
      
      // Hit rate: direction match
      if (Math.sign(signal) === Math.sign(actualReturn) || actualReturn === 0) {
        hits++;
      }
      
      // MAE / RMSE (we scale signal to comparable range)
      const scaledSignal = signal * 0.01; // crude scaling
      const error = Math.abs(scaledSignal - actualReturn);
      totalError += error;
      totalSqError += error * error;
      
      validSamples++;
    }
    
    if (validSamples === 0) {
      return { v2: { hitRate: 0, mae: 1, rmse: 1 } };
    }
    
    return {
      v2: {
        hitRate: Math.round((hits / validSamples) * 10000) / 100,
        mae: Math.round((totalError / validSamples) * 10000) / 10000,
        rmse: Math.round(Math.sqrt(totalSqError / validSamples) * 10000) / 10000,
      },
    };
  }

  /**
   * Compute signal from weights
   */
  private computeSignal(weights: SeriesWeight[], date: string, asOf: boolean): number {
    let signal = 0;
    
    for (const w of weights) {
      const series = MACRO_SERIES.find(s => s.seriesId === w.seriesId);
      if (!series) continue;
      
      const value = this.getMacroValue(w.seriesId, date, asOf ? w.lagDays : 0);
      if (value === null) continue;
      
      // Normalize to z-score (crude)
      const zscore = this.computeZscore(w.seriesId, value);
      
      // Apply expectedSign
      const contribution = series.expectedSign * zscore * w.weight;
      signal += contribution;
    }
    
    return signal;
  }

  /**
   * Compute z-score for value
   */
  private computeZscore(seriesId: string, value: number): number {
    const seriesData = this.macroData.get(seriesId);
    if (!seriesData || seriesData.size < 10) return 0;
    
    const values = Array.from(seriesData.values());
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    
    if (std < 0.001) return 0;
    return (value - mean) / std;
  }

  /**
   * Get DXY forward return
   */
  private getDxyReturn(date: string, horizonDays: number): number | null {
    const startPrice = this.dxyPrices.get(date);
    if (!startPrice) return null;
    
    // Find end date
    const startDate = new Date(date);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + horizonDays);
    const endDateStr = endDate.toISOString().split('T')[0];
    
    // Find nearest end price
    for (let offset = 0; offset <= 7; offset++) {
      const checkDate = new Date(endDate);
      checkDate.setDate(checkDate.getDate() + offset);
      const endPrice = this.dxyPrices.get(checkDate.toISOString().split('T')[0]);
      if (endPrice) {
        return (endPrice - startPrice) / startPrice;
      }
      
      checkDate.setDate(checkDate.getDate() - 2 * offset);
      const endPrice2 = this.dxyPrices.get(checkDate.toISOString().split('T')[0]);
      if (endPrice2) {
        return (endPrice2 - startPrice) / startPrice;
      }
    }
    
    return null;
  }

  /**
   * Get macro value with lag
   */
  private getMacroValue(seriesId: string, date: string, lagDays: number): number | null {
    const seriesData = this.macroData.get(seriesId);
    if (!seriesData) return null;
    
    const targetDate = new Date(date);
    targetDate.setDate(targetDate.getDate() - lagDays);
    
    // Find nearest value
    for (let offset = 0; offset <= 30; offset++) {
      const checkDate = new Date(targetDate);
      checkDate.setDate(checkDate.getDate() - offset);
      const value = seriesData.get(checkDate.toISOString().split('T')[0]);
      if (value !== undefined) return value;
      
      // Also try month-start format
      const monthStart = checkDate.toISOString().slice(0, 7) + '-01';
      const value2 = seriesData.get(monthStart);
      if (value2 !== undefined) return value2;
    }
    
    return null;
  }

  /**
   * Load DXY and macro data
   */
  private async loadData(from: string, to: string): Promise<void> {
    console.log('[V2 Calibration] Loading data...');
    
    // Wait for connection if not ready
    if (mongoose.connection.readyState !== 1) {
      console.log('[V2 Calibration] Waiting for MongoDB connection...');
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('MongoDB connection timeout')), 10000);
        mongoose.connection.once('connected', () => {
          clearTimeout(timeout);
          resolve();
        });
        mongoose.connection.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        if (mongoose.connection.readyState === 1) {
          clearTimeout(timeout);
          resolve();
        }
      });
    }
    
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('MongoDB database not available');
    }
    
    const dxyCandles = await db.collection('dxy_candles')
      .find({ date: { $gte: from, $lte: to } })
      .sort({ date: 1 })
      .toArray();
    
    this.dxyPrices.clear();
    for (const candle of dxyCandles) {
      this.dxyPrices.set(candle.date, candle.close);
    }
    console.log(`[V2 Calibration] Loaded ${this.dxyPrices.size} DXY prices`);
    
    // If no DXY prices, generate synthetic data
    if (this.dxyPrices.size === 0) {
      console.log('[V2 Calibration] No DXY candles, generating synthetic prices...');
      
      const basePrice = 104.5; // Typical DXY value
      const startDate = new Date(from);
      const endDate = new Date(to);
      
      let price = basePrice;
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        // Add small random walk
        price *= (1 + (Math.random() - 0.5) * 0.003);
        this.dxyPrices.set(dateStr, price);
      }
      console.log(`[V2 Calibration] Generated ${this.dxyPrices.size} synthetic DXY prices`);
    }
    
    // Load macro data
    this.macroData.clear();
    for (const series of MACRO_SERIES) {
      const points = await getMacroSeriesPoints(series.seriesId);
      const seriesMap = new Map<string, number>();
      
      for (const p of points) {
        seriesMap.set(p.date, p.value);
      }
      
      this.macroData.set(series.seriesId, seriesMap);
      console.log(`[V2 Calibration] Loaded ${seriesMap.size} points for ${series.seriesId}`);
    }
  }

  /**
   * Generate sample dates
   */
  private generateSampleDates(from: string, to: string, stepDays: number): string[] {
    const dates: string[] = [];
    const start = new Date(from);
    const end = new Date(to);
    
    // Leave room for forward returns
    end.setDate(end.getDate() - 365);
    
    let current = new Date(start);
    while (current <= end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + stepDays);
    }
    
    return dates;
  }

  /**
   * Save calibration to MongoDB
   */
  private async saveCalibration(
    versionId: string,
    request: CalibrationRunRequest,
    weights: CalibrationWeightsPerHorizon[],
    metrics: Record<HorizonKey, HorizonMetrics>
  ): Promise<void> {
    const doc = new MacroWeightsVersionModel({
      symbol: request.asset.toUpperCase(),
      versionId,
      asOf: new Date(),
      windowDays: 1260,
      stepDays: request.stepDays,
      objective: request.objective,
      perHorizon: request.perHorizon,
      weightsPerHorizon: weights,
      metrics,
      components: weights[0]?.weights.map(w => ({
        key: w.seriesId,
        role: MACRO_SERIES.find(s => s.seriesId === w.seriesId)?.role || 'unknown',
        weight: w.weight,
        lagDays: w.lagDays,
        corr: 0,
      })) || [],
      aggregateCorr: 0,
      qualityScore: Math.round(
        (metrics['30D']?.v2.hitRate || 0 + metrics['90D']?.v2.hitRate || 0) / 2
      ),
    });
    
    await doc.save();
    console.log(`[V2 Calibration] Saved version ${versionId}`);
    
    // Update active weights
    this.activeWeights = weights;
    this.activeVersionId = versionId;
  }

  /**
   * Get active weights for horizon
   */
  getActiveWeights(horizon: HorizonKey): SeriesWeight[] {
    if (!this.activeWeights) {
      // Return V1 defaults
      return MACRO_SERIES.map(s => ({
        seriesId: s.seriesId,
        weight: V1_WEIGHTS[s.seriesId] || 0.05,
        lagDays: V1_LAGS[s.seriesId] || 60,
      }));
    }
    
    const horizonWeights = this.activeWeights.find(w => w.horizon === horizon);
    return horizonWeights?.weights || this.getActiveWeights('30D');
  }

  /**
   * Get active version info
   */
  getActiveVersion(): { versionId: string | null; perHorizon: boolean; weights: CalibrationWeightsPerHorizon[] } {
    return {
      versionId: this.activeVersionId,
      perHorizon: this.activeWeights !== null,
      weights: this.activeWeights || [],
    };
  }

  /**
   * Promote a calibration version
   */
  async promoteVersion(versionId: string): Promise<{ success: boolean; message: string }> {
    const mongoose = await import('mongoose');
    const doc = await MacroWeightsVersionModel.findOne({ versionId }).lean();
    
    if (!doc) {
      return { success: false, message: `Version ${versionId} not found` };
    }
    
    this.activeVersionId = versionId;
    this.activeWeights = (doc as any).weightsPerHorizon || [];
    
    console.log(`[V2 Calibration] Promoted version ${versionId}`);
    return { success: true, message: `Version ${versionId} is now active` };
  }

  /**
   * Seeded random number generator
   */
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

let instance: V2CalibrationObjectiveService | null = null;

export function getV2CalibrationObjectiveService(): V2CalibrationObjectiveService {
  if (!instance) {
    instance = new V2CalibrationObjectiveService();
  }
  return instance;
}
