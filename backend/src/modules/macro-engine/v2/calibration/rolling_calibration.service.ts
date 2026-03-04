/**
 * ROLLING CALIBRATION SERVICE — P2 Adaptive Weights
 * 
 * Recalibrates correlation weights on rolling window:
 * - Every N days (default: 30)
 * - Rolling window (default: 5 years = 1260 trading days)
 * - Stores versioned weights in MongoDB
 * 
 * This is INSTITUTIONAL: model self-tunes, no manual weight tweaking.
 */

import { MacroWeightsVersionModel, IMacroWeightsVersion } from '../models/macro_state.model.js';

// Default weights from V1 correlation analysis (fallback when no calibrated weights)
const DEFAULT_OPTIMIZED_WEIGHTS: Record<string, number> = {
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
// CALIBRATION CONFIG
// ═══════════════════════════════════════════════════════════════

const CALIBRATION_CONFIG = {
  windowDays: 1260,               // 5 years of trading days
  stepDays: 30,                   // Recalibrate every 30 days
  minDataPoints: 252,             // Minimum 1 year of data
  noiseThreshold: 0.03,           // |corr| < 0.03 = noise
  lagOptions: [10, 30, 60, 90, 120, 180], // Lag options to test
};

// Series to calibrate
const CALIBRATION_SERIES = [
  { key: 'T10Y2Y', role: 'curve' },
  { key: 'FEDFUNDS', role: 'rates' },
  { key: 'CPIAUCSL', role: 'inflation' },
  { key: 'CPILFESL', role: 'inflation' },
  { key: 'UNRATE', role: 'labor' },
  { key: 'M2SL', role: 'liquidity' },
  { key: 'PPIACO', role: 'inflation' },
  { key: 'GOLD', role: 'gold' },
];

// ═══════════════════════════════════════════════════════════════
// PEARSON CORRELATION
// ═══════════════════════════════════════════════════════════════

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 10) return 0;
  
  const xSlice = x.slice(0, n);
  const ySlice = y.slice(0, n);
  
  const xMean = xSlice.reduce((a, b) => a + b, 0) / n;
  const yMean = ySlice.reduce((a, b) => a + b, 0) / n;
  
  let num = 0, denomX = 0, denomY = 0;
  
  for (let i = 0; i < n; i++) {
    const dx = xSlice[i] - xMean;
    const dy = ySlice[i] - yMean;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  
  const denom = Math.sqrt(denomX * denomY);
  return denom > 0 ? num / denom : 0;
}

// ═══════════════════════════════════════════════════════════════
// ROLLING CALIBRATION SERVICE
// ═══════════════════════════════════════════════════════════════

export class RollingCalibrationService {
  
  /**
   * Get current weights (latest version)
   */
  async getCurrentWeights(symbol: string): Promise<IMacroWeightsVersion | null> {
    try {
      const weights = await MacroWeightsVersionModel
        .findOne({ symbol })
        .sort({ asOf: -1 })
        .lean();
      
      return weights;
    } catch (e) {
      return null;
    }
  }
  
  /**
   * Get weights history
   */
  async getWeightsHistory(symbol: string, limit: number = 12): Promise<IMacroWeightsVersion[]> {
    try {
      return await MacroWeightsVersionModel
        .find({ symbol })
        .sort({ asOf: -1 })
        .limit(limit)
        .lean();
    } catch (e) {
      return [];
    }
  }
  
  /**
   * Check if recalibration is needed
   */
  async needsRecalibration(symbol: string): Promise<boolean> {
    const current = await this.getCurrentWeights(symbol);
    
    if (!current) return true;
    
    const daysSinceLast = Math.floor(
      (Date.now() - current.asOf.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    return daysSinceLast >= CALIBRATION_CONFIG.stepDays;
  }
  
  /**
   * Run recalibration for symbol
   */
  async runCalibration(params: {
    symbol: string;
    dxyPrices: number[];            // DXY daily prices
    dxyDates: string[];             // DXY dates
    macroData: Map<string, Array<{ date: string; value: number }>>;
  }): Promise<IMacroWeightsVersion> {
    console.log(`[Calibration] Running for ${params.symbol}...`);
    
    const now = new Date();
    const components: Array<{
      key: string;
      role: string;
      corr: number;
      lagDays: number;
      weight: number;
    }> = [];
    
    // Compute forward returns for DXY
    const forwardReturns = this.computeForwardReturns(params.dxyPrices, 30);
    
    // Calibrate each series
    for (const series of CALIBRATION_SERIES) {
      const seriesData = params.macroData.get(series.key);
      
      if (!seriesData || seriesData.length < CALIBRATION_CONFIG.minDataPoints) {
        // Use default weight for missing data
        components.push({
          key: series.key,
          role: series.role,
          corr: 0,
          lagDays: 120,
          weight: DEFAULT_OPTIMIZED_WEIGHTS[series.key] || 0.05,
        });
        continue;
      }
      
      // Align macro data with DXY dates
      const aligned = this.alignSeries(seriesData, params.dxyDates, forwardReturns.length);
      
      // Find optimal lag
      const { bestCorr, bestLag } = this.findOptimalLag(
        aligned,
        forwardReturns,
        CALIBRATION_CONFIG.lagOptions
      );
      
      components.push({
        key: series.key,
        role: series.role,
        corr: Math.round(bestCorr * 10000) / 10000,
        lagDays: bestLag,
        weight: 0, // Will compute below
      });
    }
    
    // Compute weights from correlations
    const totalAbsCorr = components
      .filter(c => Math.abs(c.corr) >= CALIBRATION_CONFIG.noiseThreshold)
      .reduce((sum, c) => sum + Math.abs(c.corr), 0);
    
    for (const comp of components) {
      if (Math.abs(comp.corr) < CALIBRATION_CONFIG.noiseThreshold) {
        comp.weight = 0;
      } else {
        comp.weight = totalAbsCorr > 0
          ? Math.round((Math.abs(comp.corr) / totalAbsCorr) * 10000) / 10000
          : 0;
      }
    }
    
    // Compute aggregate correlation
    const aggregateCorr = components
      .filter(c => c.weight > 0)
      .reduce((sum, c) => sum + c.corr * c.weight, 0);
    
    // Quality score
    const qualityScore = Math.round(
      (components.filter(c => c.weight > 0).length / components.length) * 100
    );
    
    // Save to MongoDB
    const version = new MacroWeightsVersionModel({
      symbol: params.symbol,
      asOf: now,
      windowDays: CALIBRATION_CONFIG.windowDays,
      stepDays: CALIBRATION_CONFIG.stepDays,
      components,
      aggregateCorr: Math.round(aggregateCorr * 10000) / 10000,
      qualityScore,
    });
    
    try {
      await version.save();
      console.log(`[Calibration] Saved weights for ${params.symbol}: aggregate corr = ${aggregateCorr.toFixed(4)}`);
    } catch (e) {
      console.log('[Calibration] Error saving weights:', (e as any).message);
    }
    
    return version;
  }
  
  /**
   * Compute forward returns
   */
  private computeForwardReturns(prices: number[], horizonDays: number): number[] {
    const returns: number[] = [];
    for (let i = 0; i < prices.length - horizonDays; i++) {
      returns.push((prices[i + horizonDays] - prices[i]) / prices[i]);
    }
    return returns;
  }
  
  /**
   * Align macro series with DXY dates
   */
  private alignSeries(
    macroData: Array<{ date: string; value: number }>,
    dxyDates: string[],
    targetLength: number
  ): number[] {
    const macroMap = new Map(macroData.map(d => [d.date, d.value]));
    const result: number[] = [];
    
    for (let i = 0; i < Math.min(dxyDates.length, targetLength); i++) {
      const date = dxyDates[i];
      // Try exact match
      let val = macroMap.get(date);
      
      // Try monthly date (for monthly series)
      if (val === undefined) {
        const monthlyDate = date.slice(0, 7) + '-01';
        val = macroMap.get(monthlyDate);
      }
      
      result.push(val || result[result.length - 1] || 0);
    }
    
    return result;
  }
  
  /**
   * Find optimal lag for correlation
   */
  private findOptimalLag(
    macroSeries: number[],
    forwardReturns: number[],
    lagOptions: number[]
  ): { bestCorr: number; bestLag: number } {
    let bestCorr = 0;
    let bestLag = lagOptions[0];
    
    for (const lag of lagOptions) {
      const shifted = macroSeries.slice(lag);
      const returns = forwardReturns.slice(0, shifted.length);
      
      const corr = pearsonCorrelation(shifted, returns);
      
      if (Math.abs(corr) > Math.abs(bestCorr)) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
    
    return { bestCorr, bestLag };
  }
  
  /**
   * Get effective weights (current or default)
   */
  async getEffectiveWeights(symbol: string): Promise<Record<string, number>> {
    const current = await this.getCurrentWeights(symbol);
    
    if (current?.components) {
      const weights: Record<string, number> = {};
      for (const comp of current.components) {
        weights[comp.key] = comp.weight;
      }
      return weights;
    }
    
    // Fallback to defaults
    return { ...DEFAULT_OPTIMIZED_WEIGHTS };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let instance: RollingCalibrationService | null = null;

export function getRollingCalibrationService(): RollingCalibrationService {
  if (!instance) {
    instance = new RollingCalibrationService();
  }
  return instance;
}
