/**
 * P8.0-B2 — Dataset Builder Service
 * 
 * Builds asOf-safe (X, y) training dataset from historical prices + regime data.
 * 
 * Labels: y_h = log(P[t+h] / P[t])
 * X: Feature vector at time t (via FeatureBuilder, but simplified for training)
 * Expert: argmax(regimePosterior at t)
 * 
 * STRICT: if t+h has no price data → sample is skipped (no lookahead)
 */

import { getMongoDb } from '../../../../db/mongoose.js';
import { Horizon, HORIZONS } from '../contracts/quantile_forecast.contract.js';
import { DatasetSample } from '../contracts/quantile_train.contract.js';
import { FEATURE_COUNT } from '../contracts/feature_vector.contract.js';
import { getMacroEnginePack } from '../../adapters/sources.adapter.js';

// Horizon → calendar days
const HORIZON_DAYS: Record<Horizon, number> = {
  '30D': 30,
  '90D': 90,
  '180D': 180,
  '365D': 365,
};

// Step size mapping
const STEP_DAYS: Record<string, number> = {
  'DAILY': 1,
  'WEEKLY': 7,
  'MONTHLY': 30,
};

interface PriceRecord {
  date: Date;
  close: number;
}

export class DatasetBuilderService {
  
  /**
   * Build training dataset for asset
   */
  async buildDataset(params: {
    asset: string;
    start: string;
    end: string;
    step: string;
    horizons: Horizon[];
    regimeExperts: string[];
  }): Promise<{
    samples: DatasetSample[];
    stats: {
      totalDates: number;
      validSamples: number;
      skippedNoForwardPrice: number;
      perExpert: Record<string, number>;
    };
  }> {
    const { asset, start, end, step, horizons, regimeExperts } = params;
    
    // 1. Load all price data from MongoDB
    const prices = await this.loadPrices(asset, start, end);
    if (prices.length === 0) {
      throw new Error(`No price data for ${asset} between ${start} and ${end}`);
    }
    
    // Build price lookup by date string
    const priceMap = new Map<string, number>();
    for (const p of prices) {
      const dateStr = this.dateToStr(p.date);
      priceMap.set(dateStr, p.close);
    }
    
    // 2. Generate sample dates
    const stepDays = STEP_DAYS[step] || 7;
    const sampleDates = this.generateSampleDates(start, end, stepDays, priceMap);
    
    // 3. Build samples
    const samples: DatasetSample[] = [];
    let skippedNoForwardPrice = 0;
    const perExpert: Record<string, number> = {};
    for (const expert of regimeExperts) perExpert[expert] = 0;
    
    for (const dateStr of sampleDates) {
      const price = priceMap.get(dateStr);
      if (!price) continue;
      
      // Check all forward prices exist
      const labels: Record<string, number> = {};
      let allHorizonsValid = true;
      
      for (const h of horizons) {
        const forwardDate = this.addDays(dateStr, HORIZON_DAYS[h]);
        const forwardPrice = this.findNearestPrice(forwardDate, priceMap, 5);
        
        if (!forwardPrice) {
          allHorizonsValid = false;
          break;
        }
        
        // y_h = log(P[t+h] / P[t])
        labels[h] = Math.log(forwardPrice / price);
      }
      
      if (!allHorizonsValid) {
        skippedNoForwardPrice++;
        continue;
      }
      
      // Get regime at time t (this is NOT lookahead — regime is computed from data ≤ t)
      const regime = await this.getRegimeAtDate(asset, dateStr);
      const expertRegime = this.assignExpert(regime, regimeExperts);
      
      // Build simplified feature vector (from price data only for training)
      const features = this.buildTrainingFeatures(dateStr, priceMap, prices);
      
      samples.push({
        asOf: dateStr,
        expertRegime,
        features,
        labels: labels as Record<Horizon, number>,
      });
      
      if (perExpert[expertRegime] !== undefined) {
        perExpert[expertRegime]++;
      }
    }
    
    return {
      samples,
      stats: {
        totalDates: sampleDates.length,
        validSamples: samples.length,
        skippedNoForwardPrice,
        perExpert,
      },
    };
  }
  
  /**
   * Load prices from MongoDB
   */
  private async loadPrices(asset: string, start: string, end: string): Promise<PriceRecord[]> {
    const db = getMongoDb()!;
    const collection = asset === 'dxy' ? 'dxy_candles' : `${asset}_candles`;
    
    // Extend end date by 365 days to cover forward labels
    const extendedEnd = this.addDays(end, 400);
    
    const docs = await db.collection(collection)
      .find({
        date: {
          $gte: new Date(start),
          $lte: new Date(extendedEnd),
        },
      })
      .sort({ date: 1 })
      .project({ _id: 0, date: 1, close: 1 })
      .toArray();
    
    return docs.map(d => ({
      date: new Date(d.date),
      close: d.close as number,
    }));
  }
  
  /**
   * Generate sample dates within range, only on days with price data
   */
  private generateSampleDates(
    start: string, end: string, stepDays: number, priceMap: Map<string, number>
  ): string[] {
    const dates: string[] = [];
    let current = new Date(start);
    const endDate = new Date(end);
    
    while (current <= endDate) {
      const dateStr = this.dateToStr(current);
      
      // Only include dates where we have price data
      if (priceMap.has(dateStr)) {
        dates.push(dateStr);
      }
      
      current = new Date(current.getTime() + stepDays * 86400000);
    }
    
    return dates;
  }
  
  /**
   * Find nearest price within tolerance days
   */
  private findNearestPrice(dateStr: string, priceMap: Map<string, number>, tolerance: number): number | null {
    // Exact match
    if (priceMap.has(dateStr)) return priceMap.get(dateStr)!;
    
    // Search nearby
    for (let d = 1; d <= tolerance; d++) {
      const before = this.addDays(dateStr, -d);
      if (priceMap.has(before)) return priceMap.get(before)!;
      const after = this.addDays(dateStr, d);
      if (priceMap.has(after)) return priceMap.get(after)!;
    }
    
    return null;
  }
  
  /**
   * Get regime probabilities at date (from macro engine or fallback)
   */
  private async getRegimeAtDate(asset: string, dateStr: string): Promise<Record<string, number>> {
    try {
      const pack = await getMacroEnginePack(asset as any, dateStr);
      const probs = pack?.regime?.probs || pack?.regime?.posterior || {};
      return {
        EASING: probs['EASING'] || 0,
        TIGHTENING: probs['TIGHTENING'] || 0,
        STRESS: probs['STRESS'] || 0,
        NEUTRAL: probs['NEUTRAL'] || 0.5,
        NEUTRAL_MIXED: probs['MIXED'] || probs['NEUTRAL_MIXED'] || 0,
      };
    } catch {
      // Fallback: NEUTRAL
      return { EASING: 0, TIGHTENING: 0, STRESS: 0, NEUTRAL: 1, NEUTRAL_MIXED: 0 };
    }
  }
  
  /**
   * Assign expert = argmax(regime probs), constrained to allowed experts
   */
  private assignExpert(probs: Record<string, number>, allowedExperts: string[]): string {
    let best = 'NEUTRAL';
    let bestProb = -1;
    
    for (const [regime, prob] of Object.entries(probs)) {
      if (allowedExperts.includes(regime) && prob > bestProb) {
        bestProb = prob;
        best = regime;
      }
    }
    
    return best;
  }
  
  /**
   * Build simplified training features from price data
   * Uses the same 53-dimensional structure but computed from available data
   */
  private buildTrainingFeatures(
    dateStr: string,
    priceMap: Map<string, number>,
    allPrices: PriceRecord[]
  ): number[] {
    const features = new Array(FEATURE_COUNT).fill(0);
    const currentPrice = priceMap.get(dateStr) || 0;
    if (currentPrice === 0) return features;
    
    // Returns (indices 23-26)
    const ret5 = this.computeReturn(dateStr, 5, priceMap);
    const ret20 = this.computeReturn(dateStr, 20, priceMap);
    const ret60 = this.computeReturn(dateStr, 60, priceMap);
    const ret120 = this.computeReturn(dateStr, 120, priceMap);
    features[23] = this.clip(ret5, -0.15, 0.15) / 0.15;
    features[24] = this.clip(ret20, -0.15, 0.15) / 0.15;
    features[25] = this.clip(ret60, -0.25, 0.25) / 0.25;
    features[26] = this.clip(ret120, -0.30, 0.30) / 0.30;
    
    // Volatility (indices 27-29)
    const vol20 = this.computeVol(dateStr, 20, priceMap);
    const vol60 = this.computeVol(dateStr, 60, priceMap);
    features[27] = this.clip(vol20 / 0.20, 0, 1);
    features[28] = this.clip(vol60 / 0.20, 0, 1);
    features[29] = vol60 > 0 ? this.clip(vol20 / vol60, 0, 3) / 3 : 0;
    
    // Trend (indices 30-32)
    features[30] = this.clip(ret60 / 0.10, -1, 1); // slope proxy
    features[31] = this.clip((ret20 - ret60) / 0.05, -1, 1); // ema gap proxy
    features[32] = ret60 > 0 ? 1 : (ret60 < -0.05 ? -1 : 0); // breakout proxy
    
    // Drawdown (indices 33-35)
    const dd90 = this.computeDrawdown(dateStr, 90, priceMap);
    const dd180 = this.computeDrawdown(dateStr, 180, priceMap);
    features[33] = this.clip(dd90 / -0.20, 0, 1);
    features[34] = this.clip(dd180 / -0.30, 0, 1);
    features[35] = vol20 > vol60 * 1.5 ? 1 : 0; // vol spike
    
    return features;
  }
  
  // ─────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────
  
  private computeReturn(dateStr: string, days: number, priceMap: Map<string, number>): number {
    const current = priceMap.get(dateStr);
    const past = this.findNearestPrice(this.addDays(dateStr, -days), priceMap, 3);
    if (!current || !past || past === 0) return 0;
    return Math.log(current / past);
  }
  
  private computeVol(dateStr: string, window: number, priceMap: Map<string, number>): number {
    const returns: number[] = [];
    for (let d = 1; d <= window; d++) {
      const today = this.findNearestPrice(this.addDays(dateStr, -d), priceMap, 1);
      const yesterday = this.findNearestPrice(this.addDays(dateStr, -d - 1), priceMap, 1);
      if (today && yesterday && yesterday > 0) {
        returns.push(Math.log(today / yesterday));
      }
    }
    if (returns.length < 5) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance * 252); // Annualized
  }
  
  private computeDrawdown(dateStr: string, window: number, priceMap: Map<string, number>): number {
    const current = priceMap.get(dateStr);
    if (!current) return 0;
    
    let peak = current;
    for (let d = 1; d <= window; d++) {
      const p = this.findNearestPrice(this.addDays(dateStr, -d), priceMap, 1);
      if (p && p > peak) peak = p;
    }
    
    return peak > 0 ? (current - peak) / peak : 0;
  }
  
  private dateToStr(date: Date): string {
    return date.toISOString().split('T')[0];
  }
  
  private addDays(dateStr: string, days: number): string {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return this.dateToStr(date);
  }
  
  private clip(value: number, min: number, max: number): number {
    if (isNaN(value)) return 0;
    return Math.max(min, Math.min(max, value));
  }
}

// Singleton
let instance: DatasetBuilderService | null = null;

export function getDatasetBuilderService(): DatasetBuilderService {
  if (!instance) {
    instance = new DatasetBuilderService();
  }
  return instance;
}
